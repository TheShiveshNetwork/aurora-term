import { useEffect, useRef, useState } from "react";
import { Container } from "../ui";
import { Github, Menu, X } from "lucide-react";

const links = [
  { href: "/#about", label: "About" },
  { href: "/#features", label: "Features" },
  { href: "/download", label: "Download" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
    };
  }, [open]);

  return (
    <header ref={headerRef} className="fixed w-full top-0 z-20 bg-background/30 backdrop-blur-xl">
      <Container className="flex items-center justify-between py-4">
        <a href="/" className="flex items-center">
          <img src="/aurora-icon.png" alt="Aurora" className="h-12 w-12 rounded-md object-contain" />
        </a>
        <nav className="hidden items-center gap-8 text-[13px] text-on-surface-variant md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-on-background">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/TheShiveshNetwork/aurora-term"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-outline bg-surface/40 text-on-background backdrop-blur-md transition-colors hover:border-primary/50"
          >
            <Github size={16} />
          </a>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-outline bg-surface/40 text-on-background backdrop-blur-md transition-colors hover:border-primary/50 md:hidden"
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </Container>
      {open && (
        <div className="absolute max-w-xs inset-x-0 top-full right-0 px-6 pt-2 md:hidden">
          <nav className="animate-menu-in flex flex-col overflow-hidden rounded-2xl border border-outline bg-surface/60 backdrop-blur-xl">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="px-5 py-3.5 text-[15px] font-medium text-on-surface-variant transition-colors hover:bg-primary-container/40 hover:text-on-background"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
