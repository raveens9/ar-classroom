/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three.js + drei resolve fine out of the box, but transpile in case of ESM quirks
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei", "@ar/shared"],
  // Allow LAN device origins during dev (phone on same Wi-Fi hitting https://192.168.x.x:3000).
  experimental: {
    // Next 14 uses this to permit non-localhost origins during dev.
    // See: https://nextjs.org/docs/app/api-reference/next-config-js/allowedDevOrigins
  },
};
export default nextConfig;
