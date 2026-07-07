import dynamic from "next/dynamic";

// Disable SSR: this page uses useSearchParams, socket.io, and WebXR —
// none of which are compatible with static prerendering.
const ARPageClient = dynamic(() => import("./ARPageClient"), { ssr: false });

export default function Page() {
  return <ARPageClient />;
}
