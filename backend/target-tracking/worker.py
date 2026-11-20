"""Private SAM 2.1 video segmentation worker. No geometric or color-key fallback."""
import json
import math
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import threading
import time
import zipfile

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI()
lock = threading.Lock()
predictor = None
torch.set_num_threads(int(os.getenv("TARGET_THREADS", "2")))


def authorize(value):
    secret = os.getenv("CANVAS_TARGET_TRACKING_TOKEN", "")
    if not secret or not secrets.compare_digest(value or "", "Bearer " + secret):
        raise HTTPException(401, "unauthorized")


class LazyFrames:
    """Decode one frame at a time instead of holding 120 seconds of 1024px tensors."""
    def __init__(self, folder, size, device, offload):
        self.paths = sorted(Path(folder).glob("*.jpg"))
        self.size, self.device, self.offload = size, device, offload
        first = cv2.imread(str(self.paths[0]))
        if first is None:
            raise ValueError("unreadable first video frame")
        height, width = first.shape[:2]
        scale = min(1.0, size / max(height, width))
        self.target_width = max(1, round(width * scale))
        self.target_height = max(1, round(height * scale))

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, index):
        image = cv2.imread(str(self.paths[index]))
        if image is None:
            raise ValueError("unreadable video frame")
        if image.shape[1] != self.target_width or image.shape[0] != self.target_height:
            image = cv2.resize(image, (self.target_width, self.target_height), interpolation=cv2.INTER_AREA)
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        value = torch.from_numpy(image.copy()).permute(2, 0, 1).float() / 255
        value = (value - torch.tensor([.485, .456, .406])[:, None, None]) / torch.tensor([.229, .224, .225])[:, None, None]
        return value if self.offload else value.to(self.device)


def load_lazy(video_path, image_size, offload_video_to_cpu, compute_device=torch.device("cpu"), **kwargs):
    frames = LazyFrames(video_path, image_size, compute_device, offload_video_to_cpu)
    return frames, frames.target_height, frames.target_width


def model():
    global predictor
    if predictor is None:
        import sam2.sam2_video_predictor as module
        from sam2.sam2_video_predictor import SAM2VideoPredictor
        module.load_video_frames = load_lazy
        predictor = SAM2VideoPredictor.from_pretrained(
            "facebook/sam2.1-hiera-tiny", device=os.getenv("TARGET_DEVICE", "cpu"),
            apply_postprocessing=False,
        )
    return predictor


def prune_state(state, index):
    # SAM 2 consults a bounded temporal memory. Keep prompted frames permanently;
    # release old non-prompt frames after they have been written to disk.
    for outputs in [state.get("output_dict", {}), *state.get("output_dict_per_obj", {}).values()]:
        bucket = outputs.get("non_cond_frame_outputs", {})
        for key in list(bucket):
            if abs(key - index) > 12:
                del bucket[key]


def contours(mask):
    shapes, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = mask.shape
    polygons = []
    for shape in sorted(shapes, key=cv2.contourArea, reverse=True)[:32]:
        if cv2.contourArea(shape) < 6:
            continue
        shape = cv2.approxPolyDP(shape, .8, True).reshape(-1, 2)
        if len(shape) > 512:
            shape = shape[::math.ceil(len(shape) / 512)]
        if len(shape) >= 3:
            polygons.append([[round(float(x)/w, 5), round(float(y)/h, 5)] for x,y in shape])
    points = cv2.findNonZero(mask)
    box = None
    if points is not None and polygons:
        x,y,bw,bh = cv2.boundingRect(points)
        box = dict(x=x/w, y=y/h, w=bw/w, h=bh/h)
    return polygons, box


def process(source, request, root):
    started = time.monotonic()
    capture = cv2.VideoCapture(str(source))
    fps = capture.get(cv2.CAP_PROP_FPS)
    count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    capture.release()
    start, end = request["startMs"], request["endMs"]
    if not 0 < fps <= 120 or not 0 < end-start <= 120000 or end > count/fps*1000+60:
        raise ValueError("invalid source duration or frame rate")
    frames = root / "frames"; frames.mkdir()
    masks = root / "masks"; masks.mkdir()
    subprocess.run(["ffmpeg", "-v", "error", "-threads", "1", "-ss", str(start/1000), "-i", str(source), "-t", str((end-start)/1000), "-vf", f"fps={fps},scale=768:768:force_original_aspect_ratio=decrease", "-q:v", "2", "-start_number", "0", str(frames / "%06d.jpg")], check=True, timeout=120)
    paths = sorted(frames.glob("*.jpg"))
    if not paths or len(paths) > 14401:
        raise ValueError("invalid frame count")
    h,w = cv2.imread(str(paths[0])).shape[:2]
    engine = model()
    prompts = request["prompts"]
    first_seed = min(max(0, min(len(paths)-1, round((p["frameMs"]-start)*fps/1000))) for p in prompts)
    results = {}
    preview_done = False
    with torch.inference_mode():
        for reverse in [False, True]:
            if reverse and first_seed == 0:
                continue
            state = engine.init_state(str(frames), offload_video_to_cpu=True, offload_state_to_cpu=True)
            for prompt in prompts:
                index = max(0, min(len(paths)-1, round((prompt["frameMs"]-start)*fps/1000)))
                args = dict(inference_state=state, frame_idx=index, obj_id=1)
                if "box" in prompt:
                    b = prompt["box"]
                    args["box"] = np.array([b["x"]*w, b["y"]*h, (b["x"]+b["w"])*w, (b["y"]+b["h"])*h], dtype=np.float32)
                else:
                    p = prompt["point"]
                    args["points"] = np.array([[p["x"]*w, p["y"]*h]], dtype=np.float32)
                    args["labels"] = np.array([1], dtype=np.int32)
                engine.add_new_points_or_box(**args)
            for index, _, logits in engine.propagate_in_video(state, start_frame_idx=first_seed, reverse=reverse):
                if time.monotonic() - started > 1100:
                    raise TimeoutError("tracking exceeded time budget")
                mask = ((logits[0,0] > 0).cpu().numpy().astype(np.uint8) * 255)
                mask = cv2.resize(mask, (w,h), interpolation=cv2.INTER_NEAREST)
                cv2.imwrite(str(masks / f"{index:06d}.png"), mask)
                polygons, box = contours(mask)
                record = dict(frameMs=round(start+index*1000/fps), polygons=polygons)
                if box:
                    record["box"] = box
                    if not preview_done:
                        image = cv2.imread(str(paths[index]))
                        tint = image.copy(); tint[mask > 0] = [74,163,22]
                        cv2.imwrite(str(root / "preview.jpg"), cv2.addWeighted(image,.65,tint,.35,0))
                        preview_done = True
                results[index] = record
                prune_state(state, index)
            del state
    if len(results) != len(paths) or not preview_done:
        raise ValueError("target not found or incomplete propagation")
    subprocess.run(["ffmpeg", "-v", "error", "-framerate", str(fps), "-i", str(masks / "%06d.png"), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-threads", "1", "-preset", "fast", "-crf", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(root / "mask.mp4")], check=True, timeout=120)
    (root / "result.json").write_text(json.dumps(dict(fps=fps, frames=[results[i] for i in sorted(results)])), encoding="utf-8")
    output = root / "result.zip"
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ["result.json", "mask.mp4", "preview.jpg"]:
            archive.write(root / name, name)
    return output


@app.get("/health")
def health(authorization: str = Header(default="")):
    authorize(authorization)
    return {"ready": predictor is not None, "device": os.getenv("TARGET_DEVICE", "cpu")}


@app.post("/track")
def track(video: UploadFile = File(...), input: str = Form(...), authorization: str = Header(default="")):
    authorize(authorization)
    if not lock.acquire(blocking=False):
        raise HTTPException(429, "worker busy")
    directory = tempfile.TemporaryDirectory(prefix="target-")
    try:
        root = Path(directory.name)
        request = json.loads(input)
        if len(request.get("prompts", [])) not in range(1,9):
            raise ValueError("invalid prompts")
        source = root / "source.mp4"
        total = 0
        with source.open("wb") as out:
            while chunk := video.file.read(1024*1024):
                total += len(chunk)
                if total > 100*1024*1024:
                    raise ValueError("source too large")
                out.write(chunk)
        output = process(source, request, root)
        return FileResponse(output, media_type="application/zip", background=BackgroundTask(directory.cleanup))
    except Exception:
        directory.cleanup()
        raise
    finally:
        lock.release()
