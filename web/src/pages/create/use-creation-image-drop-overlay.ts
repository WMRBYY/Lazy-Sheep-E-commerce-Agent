import { useCallback, useEffect, useState, type DragEvent } from "react";
import { mightContainCreationImage } from "./creation-image-transfer";

export function useCreationImageDropOverlay() {
    const [draggingImages, setDraggingImages] = useState(false);
    const clear = useCallback(() => setDraggingImages(false), []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") clear();
        };
        const onVisibilityChange = () => {
            if (document.hidden) clear();
        };
        // Native dragging suppresses pointer events; their return also clears an
        // external drag cancelled by the OS without a page dragend event.
        const onPointerMove = (event: PointerEvent) => {
            if (event.buttons === 0) clear();
        };
        // The composer and reference chips consume drops with stopPropagation.
        // Observe completion before them without consuming or importing the file.
        document.addEventListener("drop", clear, true);
        document.addEventListener("dragend", clear, true);
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("pointerdown", clear, true);
        document.addEventListener("pointermove", onPointerMove, true);
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("blur", clear);
        return () => {
            document.removeEventListener("drop", clear, true);
            document.removeEventListener("dragend", clear, true);
            document.removeEventListener("keydown", onKeyDown, true);
            document.removeEventListener("pointerdown", clear, true);
            document.removeEventListener("pointermove", onPointerMove, true);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("blur", clear);
        };
    }, [clear]);

    const onDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || !mightContainCreationImage(event.dataTransfer)) {
            clear();
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDraggingImages(true);
    };
    const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
        if (event.relatedTarget instanceof Node) {
            if (!event.currentTarget.contains(event.relatedTarget)) clear();
            return;
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) clear();
    };

    return { draggingImages, imageDropOverlayHandlers: { onDragOver, onDragLeave } };
}
