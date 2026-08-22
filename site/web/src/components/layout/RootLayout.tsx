import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import Aurora from "../backgrounds/Aurora";

export function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background text-on-background">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <Aurora className="h-full w-full" />
      </div>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
