import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";

const heading = Manrope({ subsets: ["latin"], variable: "--font-heading", weight: ["500", "600", "700"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Invoice Approval System",
  description: "Multi-tenant purchase invoice creation, review, and approval",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body className="min-h-screen bg-ink-50 font-sans text-ink-900 antialiased">{children}</body>
    </html>
  );
}
