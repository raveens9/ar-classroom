import { z } from "zod";

export const ARManifestSchema = z.object({
  manifestId: z.string().min(1),
  authorId: z.string().min(1),
  authorName: z.string().optional(),
  modelUrl: z.string().url(),
  textureUrl: z.string().url().optional(),
  animationName: z.string().optional(),
  label: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
});
export type ARManifest = z.infer<typeof ARManifestSchema>;

export const ARPublishPayloadSchema = z.object({
  roomId: z.string().min(1),
  manifest: ARManifestSchema,
});
export type ARPublishPayload = z.infer<typeof ARPublishPayloadSchema>;

export const ARRoomFeedSchema = z.object({
  roomId: z.string().min(1),
  manifests: z.array(ARManifestSchema),
});
export type ARRoomFeed = z.infer<typeof ARRoomFeedSchema>;

export const SubscribeARPayloadSchema = z.object({
  roomId: z.string().min(1),
  studentId: z.string().min(1),
});
export type SubscribeARPayload = z.infer<typeof SubscribeARPayloadSchema>;

export const ARRestylePayloadSchema = z.object({
  roomId:         z.string().min(1),
  manifestId:     z.string().min(1),
  styledModelUrl: z.string().url(),
});
export type ARRestylePayload = z.infer<typeof ARRestylePayloadSchema>;
