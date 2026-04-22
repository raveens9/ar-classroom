import type { Socket } from "socket.io";
import type { Room, SocketErrorCode } from "@ar/shared";

export interface AuthError {
  code: SocketErrorCode;
  message: string;
}

export function assertTeacher(socket: Socket, room: Room): AuthError | null {
  if (socket.data.role !== "teacher" || socket.data.teacherId !== room.teacherId) {
    return { code: "FORBIDDEN", message: "Teacher-only action" };
  }
  return null;
}

export function assertAdmittedStudent(socket: Socket, room: Room): AuthError | null {
  if (socket.data.role !== "student") {
    return { code: "FORBIDDEN", message: "Student-only action" };
  }
  const studentId = socket.data.studentId as string | undefined;
  if (!studentId) return { code: "UNAUTHORIZED", message: "Not identified" };
  if (room.mode === "CLOSED") return { code: "ROOM_CLOSED", message: "Room is closed" };
  const presence = room.students.find((s) => s.studentId === studentId);
  if (!presence || presence.state !== "ADMITTED") {
    return { code: "NOT_ADMITTED", message: "Student not admitted to room" };
  }
  return null;
}

export function assertTeacherOrAdmittedStudent(socket: Socket, room: Room): AuthError | null {
  if (socket.data.role === "teacher") return assertTeacher(socket, room);
  return assertAdmittedStudent(socket, room);
}
