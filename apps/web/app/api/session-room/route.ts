import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ socketRoomId: null });

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("sessions")
    .select("socket_room_id")
    .eq("id", sessionId)
    .single();

  return NextResponse.json({ socketRoomId: data?.socket_room_id ?? null });
}
