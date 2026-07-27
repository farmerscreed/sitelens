import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteLens — Command Console",
  description: "Construction planning, management and monitoring",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-5xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
