import type { Room, StudentPresence, Stroke, ARManifest } from "@ar/shared";

// In-memory store. Keyed by roomId.
// For production, back with Redis.
interface StudentCanvas {
  committed: Map<string, Stroke>;
  inProgress: Map<string, Stroke>;
}

interface RoomState {
  room: Room;
  // Per-student canvases. Teacher strokes go into the watched student's canvas.
  canvases: Map<string, StudentCanvas>;
  // Published AR manifests, keyed by authorId so each student has exactly one current model.
  arByAuthor: Map<string, ARManifest>;
  // Order of publication for predictable feed.
  arOrder: string[];
}

const rooms = new Map<string, RoomState>();

// Socket <-> identity for cleanup on disconnect.
interface SocketIdentity {
  role: "teacher" | "student";
  roomId: string;
  teacherId?: string;
  studentId?: string;
}
const socketIndex = new Map<string, SocketIdentity>();

function getOrCreateStudentCanvas(state: RoomState, studentId: string): StudentCanvas {
  if (!state.canvases.has(studentId)) {
    state.canvases.set(studentId, { committed: new Map(), inProgress: new Map() });
  }
  return state.canvases.get(studentId)!;
}

export function createRoom(room: Room): RoomState {
  const state: RoomState = {
    room,
    canvases: new Map(),
    arByAuthor: new Map(),
    arOrder: [],
  };
  rooms.set(room.roomId, state);
  return state;
}

export function getRoom(roomId: string): RoomState | undefined {
  return rooms.get(roomId);
}

export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
}

export function upsertStudent(roomId: string, presence: StudentPresence): Room | undefined {
  const state = rooms.get(roomId);
  if (!state) return undefined;
  const existing = state.room.students.findIndex((s) => s.studentId === presence.studentId);
  if (existing >= 0) {
    state.room.students[existing] = presence;
  } else {
    state.room.students.push(presence);
  }
  return state.room;
}

export function removeStudent(roomId: string, studentId: string): Room | undefined {
  const state = rooms.get(roomId);
  if (!state) return undefined;
  state.room.students = state.room.students.filter((s) => s.studentId !== studentId);
  return state.room;
}

export function admitStudent(roomId: string, studentId: string): Room | undefined {
  const state = rooms.get(roomId);
  if (!state) return undefined;
  const s = state.room.students.find((s) => s.studentId === studentId);
  if (!s) return undefined;
  s.state = "ADMITTED";
  return state.room;
}

export function setAdmissionRemoved(roomId: string, studentId: string): Room | undefined {
  const state = rooms.get(roomId);
  if (!state) return undefined;
  const s = state.room.students.find((s) => s.studentId === studentId);
  if (!s) return undefined;
  s.state = "REMOVED";
  return state.room;
}

export function recordStroke(
  roomId: string,
  targetStudentId: string,
  stroke: Stroke,
  phase: "start" | "update" | "end"
): void {
  const state = rooms.get(roomId);
  if (!state) return;
  const canvas = getOrCreateStudentCanvas(state, targetStudentId);
  if (phase === "end") {
    canvas.inProgress.delete(stroke.strokeId);
    canvas.committed.set(stroke.strokeId, stroke);
  } else {
    canvas.inProgress.set(stroke.strokeId, stroke);
  }
}

export function clearStudentCanvas(roomId: string, studentId: string): void {
  const state = rooms.get(roomId);
  if (!state) return;
  const canvas = state.canvases.get(studentId);
  if (!canvas) return;
  canvas.committed.clear();
  canvas.inProgress.clear();
}

export function snapshotCanvas(roomId: string, studentId: string) {
  const state = rooms.get(roomId);
  if (!state) return { committed: [], inProgress: [] };
  const canvas = state.canvases.get(studentId);
  if (!canvas) return { committed: [], inProgress: [] };
  return {
    committed: [...canvas.committed.values()],
    inProgress: [...canvas.inProgress.values()],
  };
}

export function removeStroke(roomId: string, studentId: string, strokeId: string): boolean {
  const state = rooms.get(roomId);
  if (!state) return false;
  const canvas = state.canvases.get(studentId);
  if (!canvas) return false;
  return canvas.committed.delete(strokeId) || canvas.inProgress.delete(strokeId);
}

export function publishAR(roomId: string, manifest: ARManifest): ARManifest[] | undefined {
  const state = rooms.get(roomId);
  if (!state) return undefined;
  if (!state.arByAuthor.has(manifest.authorId)) {
    state.arOrder.push(manifest.authorId);
  }
  state.arByAuthor.set(manifest.authorId, manifest);
  return state.arOrder.map((a) => state.arByAuthor.get(a)!).filter(Boolean);
}

export function arFeed(roomId: string): ARManifest[] {
  const state = rooms.get(roomId);
  if (!state) return [];
  return state.arOrder.map((a) => state.arByAuthor.get(a)!).filter(Boolean);
}

export function bindSocket(socketId: string, identity: SocketIdentity): void {
  socketIndex.set(socketId, identity);
}

export function getSocketIdentity(socketId: string): SocketIdentity | undefined {
  return socketIndex.get(socketId);
}

export function unbindSocket(socketId: string): SocketIdentity | undefined {
  const id = socketIndex.get(socketId);
  socketIndex.delete(socketId);
  return id;
}

export function findRoomByTeacher(teacherId: string): Room | undefined {
  for (const s of rooms.values()) {
    if (s.room.teacherId === teacherId) return s.room;
  }
  return undefined;
}
