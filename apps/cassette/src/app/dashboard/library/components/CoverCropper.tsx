"use client";

/**
 * CoverCropper — fixed-square crop for an uploaded playlist cover. Hand-rolled
 * (no cropping library) since the interaction is small: cover-fit the image,
 * let the user drag-to-pan and zoom, export a fixed-size square blob. Adding
 * a dependency for this would outweigh what it saves.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Slider } from "@/app/components/Slider";
import styles from "./CoverCropper.module.css";

const VIEWPORT = 280; // on-screen square, px
const OUTPUT = 640; // exported square, px — matches preset/display resolution

type Transform = { scale: number; minScale: number; offsetX: number; offsetY: number };

export function CoverCropper({
  file,
  onCancel,
  onCropped,
}: {
  file: File;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [transform, setTransform] = useState<Transform | null>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  // Load the file into an <img> and compute the cover-fit starting scale.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const minScale = Math.max(VIEWPORT / img.width, VIEWPORT / img.height);
      setTransform({
        scale: minScale,
        minScale,
        offsetX: (VIEWPORT - img.width * minScale) / 2,
        offsetY: (VIEWPORT - img.height * minScale) / 2,
      });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !transform) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, VIEWPORT, VIEWPORT);
    ctx.drawImage(
      img,
      transform.offsetX,
      transform.offsetY,
      img.width * transform.scale,
      img.height * transform.scale
    );
  }, [transform]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Clamp pan so the image always fully covers the square viewport.
  function clamp(t: Transform): Transform {
    const img = imgRef.current;
    if (!img) return t;
    const w = img.width * t.scale;
    const h = img.height * t.scale;
    const minX = VIEWPORT - w;
    const minY = VIEWPORT - h;
    return {
      ...t,
      offsetX: Math.min(0, Math.max(minX, t.offsetX)),
      offsetY: Math.min(0, Math.max(minY, t.offsetY)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!transform) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, offsetX: transform.offsetX, offsetY: transform.offsetY };
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current || !transform) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setTransform(
      clamp({ ...transform, offsetX: dragRef.current.offsetX + dx, offsetY: dragRef.current.offsetY + dy })
    );
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  function onZoomChange(v: number) {
    if (!transform) return;
    // Zoom around the viewport center so the subject under focus doesn't jump.
    const img = imgRef.current;
    if (!img) return;
    const cx = VIEWPORT / 2;
    const cy = VIEWPORT / 2;
    const prevScale = transform.scale;
    const nextScale = transform.minScale * v;
    const imgX = (cx - transform.offsetX) / prevScale;
    const imgY = (cy - transform.offsetY) / prevScale;
    setTransform(
      clamp({
        ...transform,
        scale: nextScale,
        offsetX: cx - imgX * nextScale,
        offsetY: cy - imgY * nextScale,
      })
    );
  }

  function confirm() {
    const img = imgRef.current;
    if (!img || !transform) return;
    const out = document.createElement("canvas");
    out.width = OUTPUT;
    out.height = OUTPUT;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    const k = OUTPUT / VIEWPORT;
    ctx.drawImage(
      img,
      transform.offsetX * k,
      transform.offsetY * k,
      img.width * transform.scale * k,
      img.height * transform.scale * k
    );
    out.toBlob(
      (blob) => {
        if (blob) onCropped(blob);
      },
      "image/jpeg",
      0.9
    );
  }

  const zoomValue = transform ? transform.scale / transform.minScale : 1;

  return (
    <div className={styles.wrap}>
      <div className={styles.viewport}>
        <canvas
          ref={canvasRef}
          width={VIEWPORT}
          height={VIEWPORT}
          className={styles.canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
      <div className={styles.controls}>
        <Slider
          label="Zoom"
          minValue={1}
          maxValue={4}
          step={0.01}
          value={zoomValue}
          onChange={onZoomChange}
          formatValue={(v) => `${v.toFixed(1)}×`}
        />
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.confirm} onClick={confirm} disabled={!transform}>
          Use this image
        </button>
      </div>
    </div>
  );
}
