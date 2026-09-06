import { Container } from "../ui";
import { Github } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 bg-background/30 backdrop-blur-xl">
      <Container className="flex items-center justify-between py-4">
        <a href="/" className="flex items-center">
          <img src="/aurora-icon.png" alt="Aurora" className="h-12 w-12 rounded-md object-contain" />
        </a>
        <nav className="hidden items-center gap-8 text-[13px] text-on-surface-variant md:flex">
          <a href="/#about" className="transition-colors hover:text-on-background">About</a>
          <a href="/#features" className="transition-colors hover:text-on-background">Features</a>
          <a href="/download" className="transition-colors hover:text-on-background">Download</a>
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
        </div>
      </Container>
    </header>
  );
}
