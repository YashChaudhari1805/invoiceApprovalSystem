import type { Metadata } from "next";
import { Bricolage_Grotesque, Public_Sans } from "next/font/google";
import "@/styles/index.css";
import { ToastProvider } from "@/components/ui/toast";
import { RouteProgressBar } from "@/components/layout/route-progress-bar";

const heading = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-heading", weight: ["500", "600", "700"] });
const body = Public_Sans({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Invoice Approval System",
  description: "Multi-tenant purchase invoice creation, review, and approval",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${heading.variable} ${body.variable}`}>
      <head>
        {/* Runs before hydration/paint. Light is the CSS default (see :root in
            styles/tokens.css), so this script only ever has to ADD
            data-theme="dark" when that was the stored choice. Inline + synchronous is what
            avoids a flash of the wrong theme; an effect in a component
            would run after first paint. The localStorage key here must
            stay in sync with THEME_STORAGE_KEY in components/theme-toggle
            — it's duplicated as a literal because an inline boot script
            can't import a module constant. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("invoice-app-theme")==="dark"){document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning className="min-h-screen bg-canvas font-sans text-ink-900 antialiased">
        <RouteProgressBar />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
