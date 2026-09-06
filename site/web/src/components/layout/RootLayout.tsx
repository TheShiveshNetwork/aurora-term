import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { ScrollManager } from "./ScrollManager";

export function RootLayout({ children, pathname }: { children: ReactNode; pathname?: string }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background text-on-background">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <ScrollManager pathname={pathname} />
    </div>
  );
}
