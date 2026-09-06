import { Container } from "../ui";

export function SiteFooter() {
  return (
    <footer className="border-t border-outline-variant">
      <Container className="flex flex-col items-center justify-between gap-4 py-8 text-[12px] text-on-surface-variant md:flex-row">
        <div className="flex items-center gap-2">
          <img src="/aurora-icon.png" alt="Aurora" className="h-12 w-12 object-contain" />
          <span>&copy; 2026 Aurora terminal</span>
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
          <a
            href="/privacy"
            className="transition-colors hover:text-on-background"
          >
            Privacy
          </a>
        </div>
      </Container>
    </footer>
  );
}
