import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="card max-w-lg w-full text-center">
        <h1 className="text-3xl font-bold mb-2">AR Classroom</h1>
        <p className="text-white/70 mb-6">
          Collaborative drawing with AR model viewing on mobile.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/teacher" className="btn-primary">Teacher</Link>
          <Link href="/student" className="btn-ghost">Student</Link>
          <Link href="/ar" className="btn-ghost">AR</Link>
        </div>
        <div className="mt-3">
          <Link href="/ar-demo" className="btn-ghost w-full">
            AR model demo (no classifier needed)
          </Link>
        </div>
        <p className="text-xs text-white/40 mt-6">
          For mobile AR: open this URL over HTTPS on a device on the same LAN.
        </p>
      </div>
    </main>
  );
}
