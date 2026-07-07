import dynamic from "next/dynamic";

// Disable SSR: this page uses useSearchParams, socket.io, and Supabase auth —
// none of which are compatible with static prerendering.
const Teacher = dynamic(() => import("./Teacher"), { ssr: false });

export default function Page() {
  return <Teacher />;
}
