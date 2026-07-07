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

// Stable per-tile avatar color so a pre-reader can find "their" tile by color
// with the aide's help.
const AVATAR_COLORS = ["#FFC53D", "#FF6B6B", "#3FBF63", "#4EA8F2", "#8B5CF6", "#F472B6"];

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
      <p className="text-center text-kid-ink/50 py-12">
        No students in the roster yet. Ask your teacher to add them.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!socketRoomId && (
        <p className="text-center text-amber-600 text-sm">
          Teacher is still setting up the room — pick your name and you&apos;ll be connected automatically.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {students.map((s, i) => (
          <button
            key={s.id}
            onClick={() => pick(s)}
            className="kid-btn min-h-[80px] flex-col gap-1 rounded-3xl px-4 py-4"
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-kid-ink"
              style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
              aria-hidden="true"
            >
              {s.display_name.charAt(0).toUpperCase()}
            </span>
            <span className="text-center leading-tight">{s.display_name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
