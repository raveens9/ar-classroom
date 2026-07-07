import { z } from "zod";

export const RoomModeSchema = z.enum(["OPEN", "CLOSED"]);
export type RoomMode = z.infer<typeof RoomModeSchema>;

export const TopicSchema = z.enum(["animals", "nature", "numbers", "vegetables", "shapes"]);
export type Topic = z.infer<typeof TopicSchema>;

export const AdmissionStateSchema = z.enum(["WAITING", "ADMITTED", "REMOVED"]);
export type AdmissionState = z.infer<typeof AdmissionStateSchema>;

export const StudentPresenceSchema = z.object({
  studentId: z.string().min(1),
  displayName: z.string().min(1),
  state: AdmissionStateSchema,
  socketId: z.string().min(1),
  joinedAt: z.number().int().nonnegative(),
});
export type StudentPresence = z.infer<typeof StudentPresenceSchema>;

export const RoomSchema = z.object({
  roomId: z.string().min(1),
  teacherId: z.string().min(1),
  mode: RoomModeSchema,
  topic: TopicSchema.default("animals"),
  createdAt: z.number().int().nonnegative(),
  students: z.array(StudentPresenceSchema),
});
export type Room = z.infer<typeof RoomSchema>;

export const CreateRoomPayloadSchema = z.object({
  teacherId: z.string().min(1),
  mode: RoomModeSchema,
  topic: TopicSchema.optional().default("animals"),
});
export type CreateRoomPayload = z.infer<typeof CreateRoomPayloadSchema>;

export const JoinRoomPayloadSchema = z.object({
  roomId: z.string().min(1),
  studentId: z.string().min(1),
  displayName: z.string().min(1),
});
export type JoinRoomPayload = z.infer<typeof JoinRoomPayloadSchema>;

export const AdmitStudentPayloadSchema = z.object({
  roomId: z.string().min(1),
  studentId: z.string().min(1),
});
export type AdmitStudentPayload = z.infer<typeof AdmitStudentPayloadSchema>;

export const RemoveStudentPayloadSchema = z.object({
  roomId: z.string().min(1),
  studentId: z.string().min(1),
});
export type RemoveStudentPayload = z.infer<typeof RemoveStudentPayloadSchema>;

export const WatchStudentPayloadSchema = z.object({
  roomId: z.string().min(1),
  studentId: z.string().min(1),
});
export type WatchStudentPayload = z.infer<typeof WatchStudentPayloadSchema>;

export const CloseRoomPayloadSchema = z.object({
  roomId: z.string().min(1),
});
export type CloseRoomPayload = z.infer<typeof CloseRoomPayloadSchema>;
