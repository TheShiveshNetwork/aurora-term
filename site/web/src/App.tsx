import React from "react";
import {
  Blocks,
  Bot,
  ChevronRight,
  Cloud,
  Cpu,
  Github,
  Rocket,
  Sparkles,
  TerminalSquare,
} from "lucide-react";

const features = [
  {
    icon: Cpu,
    title: "Hardware-accelerated terminal",
    description:
      "Output blocks render through the GPU with the WebGL xterm renderer. Scrolling thousands of lines stays at 60fps, even on huge recursive listings.",
  },
  {
    icon: Bot,
    title: "Local agent sidecar",
    description:
      "A native, single-file agent binary runs next to Aurora. It plans multi-step tasks, runs commands in your terminals, and self-corrects when output is truncated.",
  },
  {
    icon: Sparkles,
    title: "Multi-provider AI routing",
    description:
      "Fast, Balanced, and Powerful task tiers route across Anthropic, OpenAI, Gemini, NVIDIA NIM, and local Ollama. API keys live in the OS keychain — never in config files.",
  },
  {
    icon: Blocks,
    title: "GPU-rendered output blocks",
    description:
      "Every command becomes a block with its exit code, duration, and output type. Big results are summarized with a head+tail digest so the agent stays in context.",
  },
  {
    icon: Cloud,
    title: "Cloud settings sync",
    description:
      "Sign in with GitHub, Google, or email and your aurora.json settings follow you across machines. Last-write-wins with a 3-way merge dialog when conflicts occur.",
  },
  {
    icon: TerminalSquare,
    title: "AI-native editor",
    description:
      "CodeMirror with inline AI edits and ghost-text completion. Select code, hit Ctrl+L, and let the agent rewrite it inline with accept/reject.",
  },
];

function FeatureCard({ icon: Icon, title, description }: (typeof features)[number]) {
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface/60 p-6 transition-colors hover:border-primary/40 hover:bg-surface">
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container text-primary">
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <h3 className="mb-2 text-[15px] font-semibold text-on-background">{title}</h3>
      <p className="text-[13px] leading-relaxed text-on-surface-variant">{description}</p>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-background text-on-background">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-outline-variant bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <img src="/aurora-icon.png" alt="Aurora" className="h-7 w-7 rounded-md" />
            <span className="text-[15px] font-semibold tracking-tight">Aurora</span>
          </div>
          <nav className="hidden items-center gap-8 text-[13px] text-on-surface-variant md:flex">
            <a href="#features" className="transition-colors hover:text-on-background">Features</a>
            <a href="#terminal" className="transition-colors hover:text-on-background">Terminal</a>
            <a href="#download" className="transition-colors hover:text-on-background">Download</a>
          </nav>
          <a
            href="/signin"
            className="hidden rounded-full bg-primary px-4 py-1.5 text-[13px] font-medium text-on-primary transition-transform hover:-translate-y-0.5 sm:inline"
          >
            Sign in to sync
          </a>
          <a
            href="https://github.com/anomalyco/aurora"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-full border border-outline px-4 py-1.5 text-[13px] font-medium transition-colors hover:border-primary/50 hover:text-on-background"
          >
            <Github size={15} />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section id="download" className="glow relative overflow-hidden">
        <div className="hero-grid absolute inset-0" />
        <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
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
            <a
              href="https://github.com/anomalyco/aurora/releases"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[14px] font-semibold text-on-primary transition-transform hover:-translate-y-0.5"
            >
              Download for Windows
              <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="https://github.com/anomalyco/aurora"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-full border border-outline px-6 py-3 text-[14px] font-medium transition-colors hover:border-primary/50"
            >
              <Github size={16} />
              View source
            </a>
          </div>
          <p className="mt-4 text-[12px] text-on-surface-variant/70">
            Windows · macOS · Linux — single installer under 15&nbsp;MB
          </p>
        </div>
      </section>

      {/* ── Terminal preview ───────────────────────────────────── */}
      <section id="terminal" className="mx-auto max-w-6xl px-6 py-16">
        <div className="overflow-hidden rounded-2xl border border-outline bg-surface shadow-[0_0_80px_rgba(79,140,255,0.08)]">
          <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-error/70" />
            <span className="h-3 w-3 rounded-full bg-tertiary/70" />
            <span className="h-3 w-3 rounded-full bg-primary/70" />
            <span className="ml-3 font-mono text-[12px] text-on-surface-variant">aurora — Aurora-Server</span>
          </div>
          <img
            src="/screenshots/terminal_empty_state.png"
            alt="Aurora terminal with an AI prompt"
            className="w-full"
          />
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-outline bg-surface">
            <img
              src="/screenshots/command_output_blocks.png"
              alt="GPU-rendered command output blocks"
              className="w-full"
            />
          </div>
          <div className="flex flex-col justify-center gap-4 p-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              Commands become blocks, not walls of text.
            </h2>
            <p className="text-[14px] leading-relaxed text-on-surface-variant">
              Every command captures its exit code, duration, and output type. Huge outputs are
              replaced with a structured head+tail digest — so the agent always knows what ran,
              what it produced, and what to do next.
            </p>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Built for developers who ship</h2>
          <p className="mx-auto mt-3 max-w-xl text-[14px] text-on-surface-variant">
            GPU rendering, a local agent, and AI routing that actually respect your context window.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────── */}
      <section id="download" className="mx-auto max-w-6xl px-6 py-20 text-center">
        <div className="rounded-3xl border border-outline bg-surface/60 p-12 glow">
          <h2 className="text-3xl font-semibold tracking-tight">Ready when you are.</h2>
          <p className="mx-auto mt-3 max-w-md text-[14px] text-on-surface-variant">
            Download the installer, open a folder, and ask Aurora to do the boring parts.
          </p>
          <a
            href="https://github.com/anomalyco/aurora/releases"
            target="_blank"
            rel="noreferrer"
            className="group mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-[14px] font-semibold text-on-primary transition-transform hover:-translate-y-0.5"
          >
            Get Aurora
            <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-outline-variant">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-[12px] text-on-surface-variant md:flex-row">
          <div className="flex items-center gap-2">
            <img src="/aurora-icon.png" alt="Aurora" className="h-5 w-5 rounded" />
            <span>Aurora terminal</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/anomalyco/aurora" target="_blank" rel="noreferrer" className="transition-colors hover:text-on-background">
              Source
            </a>
            <a href="https://github.com/anomalyco/aurora/releases" target="_blank" rel="noreferrer" className="transition-colors hover:text-on-background">
              Releases
            </a>
            <span className="font-mono text-[11px]">v0.1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
