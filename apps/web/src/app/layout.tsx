import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/toast";

const heading = Manrope({ subsets: ["latin"], variable: "--font-heading", weight: ["500", "600", "700"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Invoice Approval System",
  description: "Multi-tenant purchase invoice creation, review, and approval",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <head>
        {/* Runs before hydration/paint. Dark is the CSS default (see :root
            in globals.css), so this script only ever has to ADD
            data-theme="light" when that was the stored choice — there's
            nothing to do for a dark-preferring or first-time visitor,
            which is what keeps dark the true default rather than a value
            this script has to actively apply. Inline + synchronous is what
            avoids a flash of the wrong theme; an effect in a component
            would run after first paint. The localStorage key here must
            stay in sync with THEME_STORAGE_KEY in components/theme-toggle
            — it's duplicated as a literal because an inline boot script
            can't import a module constant. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("invoice-app-theme")==="light"){document.documentElement.setAttribute("data-theme","light");}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-ink-900 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
