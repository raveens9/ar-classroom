export const dynamic = "force-dynamic";

import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase-server";
import { RosterPicker } from "./RosterPicker";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function JoinPage({ params }: Props) {
  // Opt every fetch in this render out of Next.js's data cache so the roster
  // is always read fresh from the database, even after students are added.
  noStore();
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: classroom } = await supabase
    .from("classrooms")
    .select("id, name")
    .eq("qr_token", token)
    .single();

  if (!classroom) notFound();

  const [{ data: students }, { data: session }] = await Promise.all([
    supabase
      .from("students")
      .select("id, display_name")
      .eq("classroom_id", classroom.id)
      .order("display_name"),
    supabase
      .from("sessions")
      .select("id, socket_room_id")
      .eq("classroom_id", classroom.id)
      .is("ended_at", null)
      .maybeSingle(),
  ]);

  return (
    <main className="min-h-screen bg-[#0b0b12] p-6 flex flex-col items-center">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">{classroom.name}</h1>
          <p className="text-white/50 mt-1">Choose your name</p>
        </div>

        {!session ? (
          <div className="text-center py-12 space-y-2">
            <p className="text-white/60 text-lg">Your teacher hasn&apos;t started the session yet.</p>
            <p className="text-white/40 text-sm">Ask them to start a session, then refresh this page.</p>
          </div>
        ) : (
          <RosterPicker
            students={students ?? []}
            sessionId={session.id}
            socketRoomId={session.socket_room_id}
            classroomId={classroom.id}
          />
        )}
      </div>
    </main>
  );
}
