package app

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"time"

	"golang.org/x/sync/singleflight"
	"yingce/backend/internal/model"
)

var referencePlaybackBuilds singleflight.Group
var referencePlaybackSlots = make(chan struct{}, 1)

// OpenReferencePlayback supplies a seekable, same-origin preview when the browser
// cannot decode the original or reach its storage endpoint. Recheck ownership on
// every range request, including cache hits.
func (s *Service) OpenReferencePlayback(ctx context.Context, userID, id string) (*os.File, error) {
	if err := s.requireMediaReferenceAccess(); err != nil {
		return nil, err
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		return nil, err
	}
	limit := mediaReferenceMaxBytes
	if resource.Kind != "video" || resource.Status != model.ResourceStatusReady || resource.Size > limit {
		return nil, BadAuthRequest("参考视频不可用或超过大小上限")
	}
	dir := filepath.Join(s.dataDir, "reference-playback-v1")
	key := sha256.Sum256([]byte(userID + "\x00" + id + "\x00" + resource.ETag + "\x00" + resource.ObjectKey))
	path := filepath.Join(dir, fmt.Sprintf("%x.mp4", key))
	if file, err := os.Open(path); err == nil {
		return file, nil
	}
	// Browsers can abandon the first range request and immediately issue another.
	// Share that encode and bound its lifetime independently of any single request.
	done := referencePlaybackBuilds.DoChan(path, func() (any, error) {
		select {
		case referencePlaybackSlots <- struct{}{}:
			defer func() { <-referencePlaybackSlots }()
		default:
			return nil, BadAuthRequest("正在准备其他视频，请稍后重试")
		}
		if _, err := os.Stat(path); err == nil {
			return nil, nil
		}
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
		pruneReferencePlayback(dir)
		buildCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		return nil, s.withMediaResourceFileContext(buildCtx, userID, id, limit, func(_ *model.Resource, src string) error {
			meta, err := probeReferenceMediaFile(buildCtx, src)
			if err != nil {
				return err
			}
			if meta.DurationMs <= 0 || meta.DurationMs > mediaReferenceMaxSourceMs+50 {
				return BadAuthRequest("视频时长超出预览范围")
			}
			out, err := os.CreateTemp(dir, ".building-*.mp4")
			if err != nil {
				return err
			}
			defer os.Remove(out.Name())
			if err := out.Close(); err != nil {
				return err
			}
			bin, err := renderFfmpegBinary()
			if err != nil {
				return err
			}
			// Preserve display aspect ratio, timing and audio. Downloads and final
			// clips continue to use the full original resource.
			args := []string{"-nostdin", "-v", "error", "-y", "-threads", "2", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1"}
			if meta.VideoCodec == "h264" && meta.PixelFormat == "yuv420p" && meta.Level > 0 && meta.Level <= 42 && resource.Size <= 256<<20 {
				args = append(args, "-c:v", "copy")
			} else {
				args = append(args, "-vf", "scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-filter_threads", "1", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "24", "-maxrate", "1800k", "-bufsize", "3600k", "-pix_fmt", "yuv420p")
			}
			args = append(args, "-c:a", "aac", "-profile:a", "aac_low", "-ac", "2", "-b:a", "96k", "-movflags", "+faststart", out.Name())
			if err := exec.CommandContext(buildCtx, bin, args...).Run(); err != nil {
				return fmt.Errorf("无法生成兼容播放视频: %w", err)
			}
			return os.Rename(out.Name(), path)
		})
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-done:
		if result.Err != nil {
			return nil, result.Err
		}
		return os.Open(path)
	}
}

func pruneReferencePlayback(dir string) {
	entries, _ := os.ReadDir(dir)
	var files []os.FileInfo
	for _, entry := range entries {
		if info, err := entry.Info(); err == nil && info.Mode().IsRegular() && filepath.Ext(info.Name()) == ".mp4" {
			files = append(files, info)
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ModTime().After(files[j].ModTime()) })
	var total int64
	for _, file := range files {
		if time.Since(file.ModTime()) > 24*time.Hour || total+file.Size() > 1<<30 {
			_ = os.Remove(filepath.Join(dir, file.Name()))
		} else {
			total += file.Size()
		}
	}
}
