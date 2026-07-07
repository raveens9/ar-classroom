import type { Metadata, Viewport } from "next";
import { Fredoka } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";

// Rounded display face for kid-facing pages; exposed as a CSS variable and
// only applied through the font-kid utility, so adult pages are unaffected.
const fredoka = Fredoka({ subsets: ["latin"], variable: "--font-kid" });

export const metadata: Metadata = {
  title: "AR Classroom",
  description: "Teacher-student collaborative drawing + AR",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0b0b12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={fredoka.variable}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
