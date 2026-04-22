import type { Server, Socket } from "socket.io";
import {
  StrokeEventSchema,
  CanvasClearSchema,
  CanvasUndoSchema,
  WatchStudentPayloadSchema,
  type Ack,
  type CanvasSync,
} from "@ar/shared";
import {
  getRoom,
  recordStroke,
  clearStudentCanvas,
  snapshotCanvas,
  removeStroke,
} from "../state.js";
import { assertTeacher, assertTeacherOrAdmittedStudent } from "../util/auth.js";

// Socket.io sub-room name for a specific student's canvas.
const canvasRoom = (roomId: string, studentId: string) => `${roomId}:student:${studentId}`;

export function registerCanvasHandlers(io: Server, socket: Socket): void {
  socket.on("canvas:stroke", (raw, ack: (r: Ack<{ received: true }>) => void) => {
    const parsed = StrokeEventSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const state = getRoom(parsed.data.roomId);
    if (!state) return ack({ ok: false, code: "NOT_FOUND", message: "Room not found" });

    const err = assertTeacherOrAdmittedStudent(socket, state.room);
    if (err) return ack({ ok: false, ...err });

    // authorId on stroke must match sender identity (prevent spoofing).
    const senderId =
      socket.data.role === "teacher" ? socket.data.teacherId : socket.data.studentId;
    if (parsed.data.stroke.authorId !== senderId) {
      return ack({ ok: false, code: "FORBIDDEN", message: "authorId does not match sender" });
    }

    // Target canvas: student draws on their own; teacher draws on the watched student's.
    const targetStudentId =
      socket.data.role === "teacher" ? socket.data.watchedStudentId : socket.data.studentId;
    if (!targetStudentId) {
      return ack({ ok: false, code: "BAD_REQUEST", message: "No target student canvas" });
    }

    recordStroke(parsed.data.roomId, targetStudentId, parsed.data.stroke, parsed.data.phase);

    // Broadcast only to the canvas sub-room (student + watching teacher), not entire room.
    socket.to(canvasRoom(parsed.data.roomId, targetStudentId)).emit("canvas:stroke", parsed.data);
    ack({ ok: true, data: { received: true } });
  });

  socket.on("canvas:clear", (raw, ack: (r: Ack<{ cleared: true }>) => void) => {
    const parsed = CanvasClearSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const state = getRoom(parsed.data.roomId);
    if (!state) return ack({ ok: false, code: "NOT_FOUND", message: "Room not found" });
    const err = assertTeacher(socket, state.room);
    if (err) return ack({ ok: false, ...err });

    const targetStudentId = socket.data.watchedStudentId;
    if (!targetStudentId) {
      return ack({ ok: false, code: "BAD_REQUEST", message: "No student canvas selected" });
    }

    clearStudentCanvas(parsed.data.roomId, targetStudentId);
    // Broadcast only to the watched student's sub-room.
    io.to(canvasRoom(parsed.data.roomId, targetStudentId)).emit("canvas:clear", parsed.data);
    ack({ ok: true, data: { cleared: true } });
  });

  socket.on("canvas:undo", (raw, ack: (r: Ack<{ removed: true }>) => void) => {
    const parsed = CanvasUndoSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const state = getRoom(parsed.data.roomId);
    if (!state) return ack({ ok: false, code: "NOT_FOUND", message: "Room not found" });

    const err = assertTeacherOrAdmittedStudent(socket, state.room);
    if (err) return ack({ ok: false, ...err });

    const targetStudentId =
      socket.data.role === "teacher" ? socket.data.watchedStudentId : socket.data.studentId;
    if (!targetStudentId) {
      return ack({ ok: false, code: "BAD_REQUEST", message: "No target student canvas" });
    }

    removeStroke(parsed.data.roomId, targetStudentId, parsed.data.strokeId);
    socket.to(canvasRoom(parsed.data.roomId, targetStudentId)).emit("canvas:undo", parsed.data);
    ack({ ok: true, data: { removed: true } });
  });

  socket.on("room:watch", (raw, ack: (r: Ack<CanvasSync>) => void) => {
    const parsed = WatchStudentPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const state = getRoom(parsed.data.roomId);
    if (!state) return ack({ ok: false, code: "NOT_FOUND", message: "Room not found" });

    // Students may only sync their own canvas. Teachers may watch any student.
    if (socket.data.role === "student" && socket.data.studentId !== parsed.data.studentId) {
      return ack({ ok: false, code: "FORBIDDEN", message: "Cannot watch other students" });
    }
    if (socket.data.role === "teacher") {
      const err = assertTeacher(socket, state.room);
      if (err) return ack({ ok: false, ...err });

      // Leave previous canvas sub-room, join the new one.
      if (socket.data.watchedStudentId && socket.data.watchedStudentId !== parsed.data.studentId) {
        socket.leave(canvasRoom(parsed.data.roomId, socket.data.watchedStudentId));
      }
      socket.data.watchedStudentId = parsed.data.studentId;
      socket.join(canvasRoom(parsed.data.roomId, parsed.data.studentId));
    }

    const snap = snapshotCanvas(parsed.data.roomId, parsed.data.studentId);
    const sync: CanvasSync = { roomId: parsed.data.roomId, ...snap };
    socket.emit("canvas:sync", sync);
    ack({ ok: true, data: sync });
  });
}
