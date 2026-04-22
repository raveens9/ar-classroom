import { z } from "zod";

export const SocketErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "NOT_FOUND",
  "BAD_REQUEST",
  "FORBIDDEN",
  "CONFLICT",
  "INTERNAL",
  "NOT_ADMITTED",
  "ROOM_CLOSED",
]);
export type SocketErrorCode = z.infer<typeof SocketErrorCodeSchema>;

export const AckErrorSchema = z.object({
  ok: z.literal(false),
  code: SocketErrorCodeSchema,
  message: z.string(),
});
export type AckError = z.infer<typeof AckErrorSchema>;

export const ackSuccess = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ ok: z.literal(true), data });

export type AckSuccess<T> = { ok: true; data: T };
export type Ack<T> = AckSuccess<T> | AckError;
