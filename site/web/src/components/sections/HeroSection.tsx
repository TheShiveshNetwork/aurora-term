import { Container } from "../ui";
import { AuroraButton } from "../ui/AuroraButton";
import { ChevronRight, Github, Rocket } from "lucide-react";

export function HeroSection() {
  return (
    <section id="download" className="relative overflow-hidden">
      <Container className="relative pt-24 pb-20 text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-container px-4 py-1.5 text-[12px] font-medium text-primary">
          <Rocket size={13} />
          AI-native developer terminal
        </div>
        <h1 className="mx-auto max-w-3xl text-balance text-5xl font-semibold tracking-tight md:text-6xl">
          The terminal that
          <span className="bg-gradient-to-r from-primary via-secondary to-tertiary bg-clip-text text-transparent">
            {" "}
            thinks with you.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-on-surface-variant">
          Aurora is a hardware-accelerated developer terminal with a local agent sidecar,
          GPU-rendered output blocks, and multi-provider AI routing — built on Tauri, Rust,
          and React. Ask a question, and an agent plans and runs the commands for you.
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
            href="https://github.com/TheShiveshNetwork/aurora-term"
            external
          >
            <Github size={16} className="mr-1" />
            View source
          </AuroraButton>
        </div>
        <p className="mt-4 text-[12px] text-on-surface-variant/70">
          Windows · macOS · Linux — single installer under 15&nbsp;MB
        </p>
      </Container>
    </section>
  );
}
