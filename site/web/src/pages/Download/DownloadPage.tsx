import { Container } from "../../components/ui";
import { AuroraButton } from "../../components/ui/AuroraButton";
import { Apple, ChevronRight, Monitor, TerminalSquare } from "lucide-react";

interface Platform {
  name: string;
  note: string;
  icon: typeof Monitor;
  href: string;
}

const platforms: Platform[] = [
  {
    name: "Windows",
    note: "x86_64 · NSIS installer · under 15 MB",
    icon: Monitor,
    href: "https://github.com/TheShiveshNetwork/aurora-term/releases",
  },
  {
    name: "macOS",
    note: "Universal · Apple Silicon & Intel",
    icon: Apple,
    href: "https://github.com/TheShiveshNetwork/aurora-term/releases",
  },
  {
    name: "Linux",
    note: "AppImage · Debian · RPM",
    icon: TerminalSquare,
    href: "https://github.com/TheShiveshNetwork/aurora-term/releases",
  },
];

export default function DownloadPage() {
  return (
    <div className="relative">
      <Container className="relative pt-28 pb-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-container px-4 py-1.5 text-[12px] font-medium text-primary">
            Get Aurora
          </div>
          <h1 className="text-balance text-5xl font-semibold tracking-tight md:text-6xl">
            Download Aurora
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-[15px] leading-relaxed text-on-surface-variant">
            A single, hardware-accelerated installer for every platform. Open a folder, ask a
            question, and let the local agent plan and run your commands.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <AuroraButton
              href="https://github.com/TheShiveshNetwork/aurora-term/releases"
              external
            >
              Download for Windows
              <ChevronRight size={16} className="ml-1" />
            </AuroraButton>
            <AuroraButton
              variant="ghost"
              href="https://github.com/TheShiveshNetwork/aurora-term/releases"
              external
            >
              View all releases
            </AuroraButton>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-4xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((p) => {
            const Icon = p.icon;
            return (
              <a
                key={p.name}
                href={p.href}
                target="_blank"
                rel="noreferrer"
                className="group rounded-2xl border border-outline-variant bg-surface/50 p-6 backdrop-blur-md transition-colors hover:border-primary/40"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container text-primary">
                  <Icon size={20} strokeWidth={1.75} />
                </div>
                <h3 className="text-[15px] font-semibold text-on-background">{p.name}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-on-surface-variant">{p.note}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-primary transition-transform group-hover:translate-x-0.5">
                  Download
                  <ChevronRight size={14} />
                </span>
              </a>
            );
          })}
        </div>

        <p className="mx-auto mt-16 max-w-md text-center text-[12px] text-on-surface-variant/70">
          Prefer to build from source? Clone the repo and run{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-on-surface">pnpm tauri:build</code>.
        </p>
      </Container>
    </div>
  );
}
