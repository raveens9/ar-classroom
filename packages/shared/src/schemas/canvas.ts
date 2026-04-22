import { z } from "zod";

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
  p: z.number().min(0).max(1).optional(),
});
export type Point = z.infer<typeof PointSchema>;

export const StrokePhaseSchema = z.enum(["start", "update", "end"]);
export type StrokePhase = z.infer<typeof StrokePhaseSchema>;

export const StrokeSchema = z.object({
  strokeId: z.string().min(1),
  authorId: z.string().min(1),
  color: z.string().regex(/^#([0-9a-fA-F]{3}){1,2}$/),
  size: z.number().min(1).max(64),
  points: z.array(PointSchema).min(1),
  createdAt: z.number().int().nonnegative(),
  eraser: z.boolean().optional(),
});
export type Stroke = z.infer<typeof StrokeSchema>;

export const StrokeEventSchema = z.object({
  roomId: z.string().min(1),
  phase: StrokePhaseSchema,
  stroke: StrokeSchema,
});
export type StrokeEvent = z.infer<typeof StrokeEventSchema>;

export const CanvasSyncSchema = z.object({
  roomId: z.string().min(1),
  committed: z.array(StrokeSchema),
  inProgress: z.array(StrokeSchema),
});
export type CanvasSync = z.infer<typeof CanvasSyncSchema>;

export const CanvasClearSchema = z.object({
  roomId: z.string().min(1),
});
export type CanvasClear = z.infer<typeof CanvasClearSchema>;

export const CanvasUndoSchema = z.object({
  roomId: z.string().min(1),
  strokeId: z.string().min(1),
});
export type CanvasUndo = z.infer<typeof CanvasUndoSchema>;
