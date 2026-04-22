import type { Server, Socket } from "socket.io";
import {
  ARPublishPayloadSchema,
  SubscribeARPayloadSchema,
  type Ack,
  type ARManifest,
  type ARRoomFeed,
} from "@ar/shared";
import { getRoom, publishAR, arFeed } from "../state.js";
import { assertTeacher } from "../util/auth.js";

export function registerARHandlers(io: Server, socket: Socket): void {
  socket.on("ar:publish", (raw, ack: (r: Ack<ARManifest>) => void) => {
    const parsed = ARPublishPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const state = getRoom(parsed.data.roomId);
    if (!state) return ack({ ok: false, code: "NOT_FOUND", message: "Room not found" });

    // Only teacher may publish models (approval gate).
    const err = assertTeacher(socket, state.room);
    if (err) return ack({ ok: false, ...err });

    const feed = publishAR(parsed.data.roomId, parsed.data.manifest);
    if (!feed) return ack({ ok: false, code: "INTERNAL", message: "Could not publish" });

    // Broadcast updated feed to entire room so every student sees every model.
    io.to(parsed.data.roomId).emit("ar:feed", {
      roomId: parsed.data.roomId,
      manifests: feed,
    } satisfies ARRoomFeed);
    io.to(parsed.data.roomId).emit("ar:new", {
      ...parsed.data.manifest,
      roomId: parsed.data.roomId,
    });
    ack({ ok: true, data: parsed.data.manifest });
  });

  socket.on("ar:subscribe", (raw, ack: (r: Ack<ARRoomFeed>) => void) => {
    const parsed = SubscribeARPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return ack({ ok: false, code: "BAD_REQUEST", message: parsed.error.message });
    }
    const state = getRoom(parsed.data.roomId);
    if (!state) return ack({ ok: false, code: "NOT_FOUND", message: "Room not found" });

    // Only admitted students (or teacher) can subscribe.
    if (socket.data.role === "student") {
      const presence = state.room.students.find(
        (s) => s.studentId === parsed.data.studentId && s.studentId === socket.data.studentId
      );
      if (!presence) return ack({ ok: false, code: "FORBIDDEN", message: "Not in room" });
      if (presence.state !== "ADMITTED") {
        return ack({ ok: false, code: "NOT_ADMITTED", message: "Not admitted to room" });
      }
    }

    socket.join(parsed.data.roomId);
    const feed: ARRoomFeed = {
      roomId: parsed.data.roomId,
      manifests: arFeed(parsed.data.roomId),
    };
    socket.emit("ar:feed", feed);
    ack({ ok: true, data: feed });
  });
}
