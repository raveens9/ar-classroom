import type {
  CanvasSync,
  StrokeEvent,
  CanvasClear,
  CanvasUndo,
} from "./schemas/canvas.js";
import type {
  Room,
  CreateRoomPayload,
  JoinRoomPayload,
  AdmitStudentPayload,
  RemoveStudentPayload,
  WatchStudentPayload,
  CloseRoomPayload,
} from "./schemas/room.js";
import type {
  ARManifest,
  ARPublishPayload,
  ARRestylePayload,
  ARRoomFeed,
  SubscribeARPayload,
} from "./schemas/ar.js";
import type { Ack } from "./schemas/ack.js";

// Events: client -> server
export interface ClientToServerEvents {
  "room:create": (p: CreateRoomPayload, ack: (r: Ack<Room>) => void) => void;
  "room:join": (p: JoinRoomPayload, ack: (r: Ack<Room>) => void) => void;
  "room:admit": (p: AdmitStudentPayload, ack: (r: Ack<Room>) => void) => void;
  "room:remove": (p: RemoveStudentPayload, ack: (r: Ack<Room>) => void) => void;
  "room:close": (p: CloseRoomPayload, ack: (r: Ack<{ closed: true }>) => void) => void;
  "room:watch": (p: WatchStudentPayload, ack: (r: Ack<CanvasSync>) => void) => void;
  "canvas:stroke": (p: StrokeEvent, ack: (r: Ack<{ received: true }>) => void) => void;
  "canvas:clear": (p: CanvasClear, ack: (r: Ack<{ cleared: true }>) => void) => void;
  "canvas:undo": (p: CanvasUndo, ack: (r: Ack<{ removed: true }>) => void) => void;
  "ar:publish": (p: ARPublishPayload, ack: (r: Ack<ARManifest>) => void) => void;
  "ar:subscribe": (p: SubscribeARPayload, ack: (r: Ack<ARRoomFeed>) => void) => void;
  "ar:restyle": (p: ARRestylePayload, ack: (r: Ack<ARManifest>) => void) => void;
}

// Events: server -> client
export interface ServerToClientEvents {
  "room:state": (room: Room) => void;
  "room:closed": (payload: { roomId: string; reason: string }) => void;
  "canvas:sync": (sync: CanvasSync) => void;
  "canvas:stroke": (ev: StrokeEvent) => void;
  "canvas:clear": (payload: CanvasClear) => void;
  "canvas:undo": (ev: CanvasUndo) => void;
  "ar:new": (manifest: ARManifest & { roomId: string }) => void;
  "ar:feed": (feed: ARRoomFeed) => void;
  "system:error": (payload: { code: string; message: string }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  // Assigned during join/create; used for authorization on subsequent events.
  role?: "teacher" | "student";
  teacherId?: string;
  studentId?: string;
  roomId?: string;
  // Teacher: the studentId currently being watched (set on room:watch).
  watchedStudentId?: string;
}
