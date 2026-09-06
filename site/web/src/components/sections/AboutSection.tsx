import { useEffect, useRef, useState } from "react";
import { Container } from "../ui";
import {
  Check,
  Github,
  ShieldCheck,
  Sparkles,
  Terminal,
  WandSparkles,
} from "lucide-react";

function TerminalDemo() {
  const commands = [
    {
      command: "git status",
      output: ["On branch main", "working tree clean"],
    },
    {
      command: "pnpm dev",
      output: ["Starting development server...", "Local: localhost:3000"],
    },
    {
      command: "docker compose up",
      output: ["Starting services...", "api · db · redis"],
    },
  ];

  const [commandIndex, setCommandIndex] = useState(0);
  const [typed, setTyped] = useState("");

  const current = commands[commandIndex];

  useEffect(() => {
    setTyped("");

    let index = 0;

    const typing = window.setInterval(() => {
      if (index >= current.command.length) {
        window.clearInterval(typing);

        const next = window.setTimeout(() => {
          setCommandIndex((value) => (value + 1) % commands.length);
        }, 1800);

        return () => window.clearTimeout(next);
      }

      setTyped(current.command.slice(0, index + 1));
      index++;
    }, 70);

    return () => window.clearInterval(typing);
  }, [commandIndex]);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0d] shadow-2xl shadow-black/30">
      <div className="flex h-11 items-center border-b border-white/[0.07] px-4">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        </div>

        <div className="mx-auto flex items-center gap-2 text-[11px] text-white/30">
          <Terminal size={12} />
          aurora
        </div>

        <div className="w-10" />
      </div>

      <div className="min-h-[310px] p-6 font-mono text-[12px] leading-7">
        <div className="text-white/25">
          Last login: today
        </div>

        <div className="mt-5 flex">
          <span className="mr-2 text-primary">$</span>
          <span className="text-white/85">{typed}</span>
          <span className="ml-0.5 inline-block h-4 w-px translate-y-1 animate-pulse bg-primary" />
        </div>

        <div className="mt-2 space-y-1 text-white/40">
          {current.output.map((line) => (
            <div
              key={line}
              className={
                typed === current.command
                  ? "opacity-100 transition-opacity duration-500"
                  : "opacity-0"
              }
            >
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute -bottom-20 left-1/2 h-40 w-2/3 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
    </div>
  );
}

function ClassifierDemo() {
  const [mode, setMode] = useState<"command" | "agent">("command");

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMode((value) =>
        value === "command" ? "agent" : "command",
      );
    }, 3200);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full rounded-2xl border border-white/10 bg-[#0b0b0d] p-5 shadow-2xl shadow-black/20">
      {/* Input */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-1">
        <div className="flex min-h-14 items-center px-4">
          <span className="mr-3 font-mono text-sm text-primary">
            $
          </span>

          <span className="font-mono text-[13px] text-white/80">
            {mode === "command"
              ? "git status"
              : "why is my build failing?"}
          </span>

          <span className="ml-1 h-4 w-px animate-pulse bg-primary" />
        </div>
      </div>

      {/* Classifier */}
      <div className="relative mt-8 flex flex-col items-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
          <WandSparkles size={17} />
        </div>

        <div className="mt-3 text-[9px] uppercase tracking-[0.2em] text-white/25">
          Command classifier
        </div>

        {/* Connector */}
        <div className="my-5 h-8 w-px bg-gradient-to-b from-primary/30 to-white/5" />

        <div className="grid w-full grid-cols-2 gap-3">
          <div
            className={[
              "rounded-xl border p-4 transition-all duration-700",
              mode === "command"
                ? "border-primary/25 bg-primary/[0.05]"
                : "border-white/[0.06] bg-white/[0.015]",
            ].join(" ")}
          >
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-white/50" />
              <span className="text-xs text-white/70">
                Terminal
              </span>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-white/35">
              Runs directly.
              <br />
              No AI required.
            </p>

            <div
              className={[
                "mt-3 flex items-center gap-1.5 text-[9px] text-primary transition-opacity duration-500",
                mode === "command"
                  ? "opacity-100"
                  : "opacity-20",
              ].join(" ")}
            >
              <Check size={11} />
              Direct execution
            </div>
          </div>

          <div
            className={[
              "rounded-xl border p-4 transition-all duration-700",
              mode === "agent"
                ? "border-primary/25 bg-primary/[0.05]"
                : "border-white/[0.06] bg-white/[0.015]",
            ].join(" ")}
          >
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-primary" />
              <span className="text-xs text-white/70">
                Agent
              </span>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-white/35">
              Understands intent.
              <br />
              Starts working.
            </p>

            <div
              className={[
                "mt-3 flex items-center gap-1.5 text-[9px] text-primary transition-opacity duration-500",
                mode === "agent"
                  ? "opacity-100"
                  : "opacity-20",
              ].join(" ")}
            >
              <Sparkles size={11} />
              Agentic workflow
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentDemo() {
  const phases = [
    {
      label: "Goal",
      text: "fix the failing build",
      note: "Breaking the goal into steps…",
    },
    {
      label: "Plan",
      text: "Inspect build output",
      note: "Planning what to run first…",
    },
    {
      label: "Work",
      text: "Run a step · read output",
      note: "Reading the result, deciding what's next…",
    },
    {
      label: "Ask",
      text: "Needs your go-ahead",
      note: "Stopped — waiting on you",
    },
  ];

  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPhase((value) => (value + 1) % phases.length);
    }, 2400);

    return () => window.clearInterval(interval);
  }, []);

  const asking = phase === phases.length - 1;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0d] shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles size={14} />
          </div>

          <div>
            <div className="text-xs text-white/75">
              Aurora Agent
            </div>

            <div className="text-[9px] text-white/25">
              Working through a task
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[9px] text-white/25">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          {asking ? "waiting on you" : "active"}
        </div>
      </div>

      <div className="grid min-h-[310px] md:grid-cols-[1fr_230px]">
        {/* Task + steps */}
        <div className="border-b border-white/[0.07] p-5 md:border-b-0 md:border-r">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/25">
            Task
          </div>

          <div className="mt-3 text-sm text-white/75">
            fix the failing build
          </div>

          <div className="mt-7 space-y-2">
            {phases.map((item, index) => {
              const done = index < phase;
              const current = index === phase;

              return (
                <div
                  key={item.label}
                  className={[
                    "flex items-center gap-3 rounded-lg border p-3 transition-all duration-700",
                    current
                      ? "border-primary/20 bg-primary/[0.04]"
                      : "border-transparent",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px]",
                      done
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : current
                          ? "border-primary/30 text-primary"
                          : "border-white/10 text-white/20",
                    ].join(" ")}
                  >
                    {done ? (
                      <Check size={10} />
                    ) : (
                      index + 1
                    )}
                  </div>

                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-white/25">
                      {item.label}
                    </div>

                    <div className="mt-0.5 text-[11px] text-white/55">
                      {item.text}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Activity line */}
          <div className="mt-5 flex items-center gap-2 text-[10px] text-white/35">
            <Sparkles
              size={12}
              className={
                asking
                  ? "text-white/20"
                  : "animate-pulse text-primary"
              }
            />
            {phases[phase].note}
          </div>
        </div>

        {/* Right: working indicator / ask card */}
        <div className="flex flex-col justify-between p-5">
          {asking ? (
            <>
              <div>
                <div className="flex items-center gap-2 text-[10px] text-white/45">
                  <ShieldCheck
                    size={13}
                    className="text-primary"
                  />
                  Needs your attention
                </div>

                <p className="mt-4 text-[11px] leading-relaxed text-white/45">
                  Aurora knows what to run next and is waiting
                  for the go-ahead.
                </p>

                <div className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 font-mono text-[10px] text-white/35">
                  $ pnpm install
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-white/35">
                  Deny
                </button>

                <button className="rounded-lg bg-primary px-3 py-2 text-[10px] font-medium text-primary-foreground">
                  Approve
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                <WandSparkles size={16} />
              </div>

              <div className="text-[10px] text-white/40">
                Working…
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StoryRow({
  eyebrow,
  title,
  description,
  children,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  description: string[];
  children: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={[
        "grid items-start gap-12 py-14 md:grid-cols-2 md:gap-20 md:py-20",
        reverse ? "md:[&>*:first-child]:order-2" : "",
      ].join(" ")}
    >
      <div className={reverse ? "md:order-1" : ""}>
        <div className="text-[10px] font-medium tracking-[0.2em] text-primary/70">
          {eyebrow}
        </div>

        <h3 className="mt-4 max-w-lg text-3xl font-medium tracking-tight md:text-4xl">
          {title}
        </h3>

        <div className="mt-5 max-w-lg space-y-4">
          {description.map((paragraph) => (
            <p
              key={paragraph}
              className="text-[14px] leading-7 text-on-surface-variant md:text-[15px]"
            >
              {paragraph}
            </p>
          ))}
        </div>
      </div>

      <div className={reverse ? "md:order-2" : ""}>
        {children}
      </div>
    </div>
  );
}

const storyItems = [
  {
    eyebrow: "THE TERMINAL YOU ALREADY KNOW",
    title: "Nothing to relearn.",
    description: [
      "Aurora keeps the terminal experience you already know and trust. Your shell stays underneath it all — Aurora simply gives it a more thoughtful interface.",
    ],
    demo: <TerminalDemo />,
  },
  {
    eyebrow: "A SMARTER INTERFACE",
    title: "Just type. Aurora knows.",
    description: [
      "You shouldn't have to decide whether you're talking to your shell or to AI. Aurora uses a powerful local classifier to understand the difference and route your input accordingly.",
    ],
    demo: <ClassifierDemo />,
    reverse: true,
  },
  {
    eyebrow: "THE PART THAT CHANGES HOW YOU WORK",
    title: "An agent that works with you.",
    description: [
      "Most terminal agents are good at generating commands. Aurora goes a step further: it can actually work through a task.",
      "Give it a goal. Aurora breaks it down, runs a step, reads what happened, and decides what comes next. When it reaches something that needs your attention, it stops and asks.",
      "You don't hand over the keys — you work alongside it. Tell Aurora the outcome you're looking for and it plans the steps, runs them, and adapts based on what your environment tells it.",
    ],
    demo: <AgentDemo />,
  },
];

const highlightItems = [
  {
    icon: Terminal,
    title: "A familiar terminal.",
    description: "The workflow you already know.",
  },
  {
    icon: WandSparkles,
    title: "A smarter interface.",
    description: "Intelligence without the friction.",
  },
  {
    icon: Sparkles,
    title: "An agent when you need one.",
    description: "More capable when the task demands it.",
  },
];

export function AboutSection() {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;

    if (!section) return;

    const elements = section.querySelectorAll(
      "[data-reveal]",
    );

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-visible", "true");
          }
        });
      },
      {
        threshold: 0.12,
      },
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="about"
      ref={sectionRef}
      className="relative overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="glow absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 opacity-30" />

        <div className="absolute left-1/2 top-[35%] h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-primary/[0.025] blur-[120px]" />
      </div>

      <Container className="relative">
        <div
          data-reveal
          className="mx-auto max-w-3xl text-center opacity-0 translate-y-6 transition-all duration-1000 data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100 py-14"
        >
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-container px-4 py-1.5 text-[12px] font-medium text-primary">
            <Sparkles size={13} />
            Terminal for the Agentic era
          </div>
          <h1 className="mx-auto max-w-3xl text-balance text-5xl font-semibold tracking-tight md:text-6xl">
            Your terminal needs to think smarter.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-on-surface-variant">
            Terminal emulators are beautiful pieces of software.
            They do exactly what you tell them to do. No more, no less.
            But what if your terminal could understand what you're trying to do, too?
          </p>
        </div>

        <div className="border-t border-white/[0.06]">
          {storyItems.map((item) => (
            <div
              key={item.eyebrow}
              data-reveal
              className="border-t border-white/[0.06] opacity-0 translate-y-8 transition-all duration-1000 data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100"
            >
              <StoryRow
                eyebrow={item.eyebrow}
                title={item.title}
                description={item.description}
                reverse={item.reverse}
              >
                {item.demo}
              </StoryRow>
            </div>
          ))}
        </div>

        <div
          data-reveal
          className="py-12 opacity-0 translate-y-8 transition-all duration-1000 data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100"
        >
          <div className="mx-auto max-w-6xl text-center">
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {highlightItems.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/[0.07] bg-white/[0.015] p-7 text-left"
                >
                  <item.icon size={18} className="text-primary" />

                  <h4 className="mt-5 text-lg font-medium tracking-tight">
                    {item.title}
                  </h4>

                  <p className="mt-2 text-sm text-on-surface-variant">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
