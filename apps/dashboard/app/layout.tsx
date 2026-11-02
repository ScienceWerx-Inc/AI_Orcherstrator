import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Middleware Console",
  description:
    "Admin console for the multi-tenant AI gateway: routing, providers, models, metering and budgets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
