"use client";

const LS_KEY = "ar:studentId";
const LS_NAME = "ar:studentName";

export function resolveStudentId(queryValue: string | null): { id: string; name: string; fresh: boolean } {
  if (typeof window === "undefined") {
    return { id: "Kid-000", name: "Kid-000", fresh: true };
  }
  let id = queryValue?.trim() || localStorage.getItem(LS_KEY);
  let fresh = false;
  if (!id) {
    const n = Math.floor(Math.random() * 900) + 100;
    id = `Kid-${n}`;
    fresh = true;
  }
  localStorage.setItem(LS_KEY, id);
  const name = localStorage.getItem(LS_NAME) || id;
  if (!localStorage.getItem(LS_NAME)) localStorage.setItem(LS_NAME, name);
  return { id, name, fresh };
}

export function setStudentName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_NAME, name);
}

export function teacherId(): string {
  if (typeof window === "undefined") return "teacher-ssr";
  let id = localStorage.getItem("ar:teacherId");
  if (!id) {
    id = `teacher-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem("ar:teacherId", id);
  }
  return id;
}
