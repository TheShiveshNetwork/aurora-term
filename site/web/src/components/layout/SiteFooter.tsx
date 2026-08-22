import { Container } from "../ui";

export function SiteFooter() {
  return (
    <footer className="border-t border-outline-variant">
      <Container className="flex flex-col items-center justify-between gap-4 py-8 text-[12px] text-on-surface-variant md:flex-row">
        <div className="flex items-center gap-2">
          <img src="/aurora-icon.png" alt="Aurora" className="h-5 w-5 rounded object-contain" />
          <span>Aurora terminal</span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/TheShiveshNetwork/aurora-term"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-on-background"
          >
            Source
          </a>
          <a
            href="https://github.com/TheShiveshNetwork/aurora-term/releases"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-on-background"
          >
            Releases
          </a>
          <span className="font-mono text-[11px]">v0.1.0</span>
        </div>
      </Container>
    </footer>
  );
}
