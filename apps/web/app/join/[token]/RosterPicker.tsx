"use client";

import { useRouter } from "next/navigation";

interface Student {
  id: string;
  display_name: string;
}

interface Props {
  students: Student[];
  sessionId: string;
  socketRoomId: string | null;
  classroomId: string;
}

const SESSION_KEY = "ar-student-session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function RosterPicker({ students, sessionId, socketRoomId, classroomId }: Props) {
  const router = useRouter();

  function pick(student: Student) {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        studentId: student.id,
        studentName: student.display_name,
        classroomId,
        sessionId,
        socketRoomId,
        expiresAt: Date.now() + SESSION_TTL_MS,
      })
    );
    router.push("/student");
  }

  if (students.length === 0) {
    return (
      <p className="text-center text-white/50 py-12">
        No students in the roster yet. Ask your teacher to add them.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!socketRoomId && (
        <p className="text-center text-yellow-400/80 text-sm">
          Teacher is still setting up the room — pick your name and you&apos;ll be connected automatically.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {students.map((s) => (
          <button
            key={s.id}
            onClick={() => pick(s)}
            className="bg-white/10 hover:bg-white/20 active:scale-95 transition-all border border-white/10 rounded-2xl py-6 px-4 text-white text-xl font-semibold text-center"
          >
            {s.display_name}
          </button>
        ))}
      </div>
    </div>
  );
}
