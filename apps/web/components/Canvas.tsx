"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Stroke, StrokeEvent, CanvasSync, CanvasUndo } from "@ar/shared";
import { emitAck, getSocket } from "@/lib/socket";

export interface CanvasHandle {
  undo: () => void;
  redo: () => void;
}

interface Props {
  roomId: string;
  authorId: string;
  canDraw: boolean;
  // When teacher watches a specific student, this is that student's id.
  // The canvas syncs and broadcasts strokes to/from this student's canvas.
  syncStudentId?: string;
  tool?: "pen" | "eraser";
  color?: string;
  size?: number;
  className?: string;
  onExport?: (dataUrl: string) => void;
}

export const CollabCanvas = forwardRef<CanvasHandle, Props>(function CollabCanvas(
  {
    roomId,
    authorId,
    canDraw,
    syncStudentId,
    tool = "pen",
    color = "#ffffff",
    size = 4,
    className,
    onExport,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Map<string, Stroke>>(new Map());
  const inProgressRef = useRef<Map<string, Stroke>>(new Map());
  const activeStrokeIdRef = useRef<string | null>(null);
  const undoStackRef = useRef<Stroke[]>([]);
  const redoStackRef = useRef<Stroke[]>([]);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const drawStroke = (s: Stroke) => {
      if (s.points.length === 0) return;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = s.size;
      if (s.eraser) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = s.color;
      }
      ctx.beginPath();
      ctx.moveTo(s.points[0].x * width, s.points[0].y * height);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x * width, s.points[i].y * height);
      }
      ctx.stroke();
      ctx.restore();
    };

    // Sort committed strokes by creation time so eraser strokes apply in the right order.
    const sorted = [...strokesRef.current.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const s of sorted) drawStroke(s);
    for (const s of inProgressRef.current.values()) drawStroke(s);
    rerender();
  }, [rerender]);

  // Initial sync + live updates
  useEffect(() => {
    const socket = getSocket();
    const targetStudentId = syncStudentId ?? authorId;

    const onSync = (sync: CanvasSync) => {
      if (sync.roomId !== roomId) return;
      strokesRef.current = new Map(sync.committed.map((s) => [s.strokeId, s]));
      inProgressRef.current = new Map(sync.inProgress.map((s) => [s.strokeId, s]));
      undoStackRef.current = [];
      redoStackRef.current = [];
      redraw();
    };
    const onStroke = (ev: StrokeEvent) => {
      if (ev.roomId !== roomId) return;
      if (ev.phase === "end") {
        inProgressRef.current.delete(ev.stroke.strokeId);
        strokesRef.current.set(ev.stroke.strokeId, ev.stroke);
      } else {
        inProgressRef.current.set(ev.stroke.strokeId, ev.stroke);
      }
      redraw();
    };
    const onClear = (payload: { roomId: string }) => {
      if (payload.roomId !== roomId) return;
      strokesRef.current.clear();
      inProgressRef.current.clear();
      undoStackRef.current = [];
      redoStackRef.current = [];
      redraw();
    };
    const onUndo = (ev: CanvasUndo) => {
      if (ev.roomId !== roomId) return;
      strokesRef.current.delete(ev.strokeId);
      inProgressRef.current.delete(ev.strokeId);
      redraw();
    };

    socket.on("canvas:sync", onSync);
    socket.on("canvas:stroke", onStroke);
    socket.on("canvas:clear", onClear);
    socket.on("canvas:undo", onUndo);

    emitAck("room:watch", { roomId, studentId: targetStudentId }).catch(() => {});

    return () => {
      socket.off("canvas:sync", onSync);
      socket.off("canvas:stroke", onStroke);
      socket.off("canvas:clear", onClear);
      socket.off("canvas:undo", onUndo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, authorId, syncStudentId]);

  // Resize: internal resolution matches CSS size × DPR for crisp lines.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(1, 1);
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  const undo = useCallback(() => {
    const stroke = undoStackRef.current.pop();
    if (!stroke) return;
    redoStackRef.current.push(stroke);
    // Optimistic removal so the stroke disappears immediately.
    strokesRef.current.delete(stroke.strokeId);
    inProgressRef.current.delete(stroke.strokeId);
    redraw();
    emitAck("canvas:undo", { roomId, strokeId: stroke.strokeId }).catch(console.error);
  }, [roomId, redraw]);

  const redo = useCallback(() => {
    const stroke = redoStackRef.current.pop();
    if (!stroke) return;
    undoStackRef.current.push(stroke);
    strokesRef.current.set(stroke.strokeId, stroke);
    redraw();
    emitAck("canvas:stroke", { roomId, phase: "end", stroke }).catch(console.error);
  }, [roomId, redraw]);

  useImperativeHandle(ref, () => ({ undo, redo }), [undo, redo]);

  // Keyboard shortcuts: Ctrl+Z / Cmd+Z = undo, +Shift = redo.
  useEffect(() => {
    if (!canDraw) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDraw, undo, redo]);

  // Pointer events → normalized [0,1] points → stroke events
  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      p: e.pressure || 0.5,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const pt = toPoint(e);
    const strokeId = `${authorId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    activeStrokeIdRef.current = strokeId;
    const stroke: Stroke = {
      strokeId,
      authorId,
      color,
      size,
      points: [pt],
      createdAt: Date.now(),
      eraser: tool === "eraser" ? true : undefined,
    };
    inProgressRef.current.set(strokeId, stroke);
    emitAck("canvas:stroke", { roomId, phase: "start", stroke }).catch(console.error);
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    const id = activeStrokeIdRef.current;
    if (!id) return;
    const stroke = inProgressRef.current.get(id);
    if (!stroke) return;
    stroke.points.push(toPoint(e));
    emitAck("canvas:stroke", { roomId, phase: "update", stroke }).catch(console.error);
    redraw();
  };

  const onPointerUp = (_e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    const id = activeStrokeIdRef.current;
    if (!id) return;
    const stroke = inProgressRef.current.get(id);
    activeStrokeIdRef.current = null;
    if (!stroke) return;
    // Commit locally before the server round-trip so the stroke doesn't flicker.
    inProgressRef.current.delete(id);
    strokesRef.current.set(id, stroke);
    undoStackRef.current.push(stroke);
    redoStackRef.current = [];
    redraw();
    emitAck("canvas:stroke", { roomId, phase: "end", stroke }).catch(console.error);
  };

  // Parent can request an export for ML.
  useEffect(() => {
    if (!onExport) return;
    (window as unknown as { __canvasExport?: () => string }).__canvasExport = () => {
      const c = canvasRef.current;
      if (!c) return "";
      return c.toDataURL("image/png");
    };
    return () => {
      delete (window as unknown as { __canvasExport?: () => string }).__canvasExport;
    };
  }, [onExport]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "w-full h-full bg-black/40 rounded-md"}
      style={{ cursor: tool === "eraser" ? "cell" : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
});
