import type { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import {
  CreateRoomPayloadSchema,
  JoinRoomPayloadSchema,
  AdmitStudentPayloadSchema,
  RemoveStudentPayloadSchema,
  type Room,
  type Ack,
} from "@ar/shared";
import {
  createRoom,
  getRoom,
  upsertStudent,
  admitStudent,
  setAdmissionRemoved,
  bindSocket,
  findRoomByTeacher,
} from "../state.js";
import { assertTeacher } from "../util/auth.js";

export function registerRoomHandlers(io: Server, socket: Socket): void {
  socket.on("room:create", (raw, ack: (r: Ack<Room>) => void) => {
    const parsed = CreateRoomPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const { teacherId, mode } = parsed.data;

    // Teacher reconnecting to their existing room is allowed (idempotent).
    const existing = findRoomByTeacher(teacherId);
    const room: Room = existing ?? {
      roomId: nanoid(8),
      teacherId,
      mode,
      createdAt: Date.now(),
      students: [],
    };
    if (!existing) createRoom(room);
    else room.mode = mode;

    socket.data.role = "teacher";
    socket.data.teacherId = teacherId;
    socket.data.roomId = room.roomId;
    bindSocket(socket.id, { role: "teacher", teacherId, roomId: room.roomId });
    socket.join(room.roomId);
    socket.join(`${room.roomId}:teacher`);

    io.to(room.roomId).emit("room:state", room);
    ack({ ok: true, data: room });
  });

  socket.on("room:join", (raw, ack: (r: Ack<Room>) => void) => {
    const parsed = JoinRoomPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const { roomId, studentId, displayName } = parsed.data;
    const state = getRoom(roomId);
    if (!state) return ack({ ok: false, code: "NOT_FOUND", message: "Room not found" });

    const existing = state.room.students.find((s) => s.studentId === studentId);
    const updated = upsertStudent(roomId, {
      studentId,
      displayName,
      state: existing?.state === "ADMITTED" ? "ADMITTED" : "WAITING",
      socketId: socket.id,
      joinedAt: existing?.joinedAt ?? Date.now(),
    });
    if (!updated) return ack({ ok: false, code: "INTERNAL", message: "Could not register student" });

    socket.data.role = "student";
    socket.data.studentId = studentId;
    socket.data.roomId = roomId;
    bindSocket(socket.id, { role: "student", studentId, roomId });
    socket.join(roomId);
    socket.join(`${roomId}:student:${studentId}`);

    io.to(roomId).emit("room:state", updated);
    ack({ ok: true, data: updated });
  });

  socket.on("room:admit", (raw, ack: (r: Ack<Room>) => void) => {
    const parsed = AdmitStudentPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const state = getRoom(parsed.data.roomId);
    if (!state) return ack({ ok: false, code: "NOT_FOUND", message: "Room not found" });
    const err = assertTeacher(socket, state.room);
    if (err) return ack({ ok: false, ...err });

    const updated = admitStudent(parsed.data.roomId, parsed.data.studentId);
    if (!updated) return ack({ ok: false, code: "NOT_FOUND", message: "Student not in room" });

    io.to(parsed.data.roomId).emit("room:state", updated);
    ack({ ok: true, data: updated });
  });

  socket.on("room:remove", (raw, ack: (r: Ack<Room>) => void) => {
    const parsed = RemoveStudentPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const state = getRoom(parsed.data.roomId);
    if (!state) return ack({ ok: false, code: "NOT_FOUND", message: "Room not found" });
    const err = assertTeacher(socket, state.room);
    if (err) return ack({ ok: false, ...err });

    const updated = setAdmissionRemoved(parsed.data.roomId, parsed.data.studentId);
    if (!updated) return ack({ ok: false, code: "NOT_FOUND", message: "Student not in room" });

    io.to(parsed.data.roomId).emit("room:state", updated);
    ack({ ok: true, data: updated });
  });
}
