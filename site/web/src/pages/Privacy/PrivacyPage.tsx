import { Container } from "../../components/ui";

const sections = [
  {
    title: "What we store on our servers",
    body: [
      "Account and login information: the email address, display name, and avatar you authenticate with (for example via Google or GitHub), together with the credentials needed to keep you signed in.",
      "Your Aurora settings and configuration: the preferences and settings you choose, which are synced to your account so they stay consistent across your devices.",
    ],
  },
  {
    title: "What stays on your device",
    body: [
      "The AI assistant agent runs locally on your device. Terminal sessions, command history, conversation content, and local memory are processed and stored on your device, not on our servers.",
      "Your AI provider API keys are stored in your device's secure keychain and are never uploaded to our servers.",
    ],
  },
  {
    title: "AI providers",
    body: [
      "When you use AI features, your prompt and the relevant context are sent directly from your device to the AI provider you have configured (such as Anthropic, OpenAI, Google Gemini, Groq, or a local Ollama instance) to generate responses.",
      "These requests go directly to the provider and are not routed through or stored on our servers. We encourage you to review the privacy policy of the AI provider you choose.",
    ],
  },
  {
    title: "How we use your information",
    body: [
      "We use the information we store solely to authenticate you, keep your account secure, and sync your settings across devices.",
    ],
  },
  {
    title: "What we don't do",
    body: [
      "We do not sell, rent, or share your personal information. We do not use your data for advertising. Your terminal output and conversation content are not stored on our servers.",
    ],
  },
  {
    title: "Your choices and rights",
    body: [
      "You can sign out at any time, which stops further account sync. You can request deletion of the account and settings data we hold at any time, and we will remove it.",
      "You can choose to use the app without signing in. Sign-in is optional and only required for account features such as cross-device settings sync.",
    ],
  },
  {
    title: "Changes to this policy",
    body: [
      "If we change how we handle personal information, we will update this page. Continued use of Aurora after changes means you accept the updated policy.",
    ],
  },
  {
    title: "Contact",
    body: [
      "Questions about this policy? Reach out via our GitHub repository: https://github.com/TheShiveshNetwork/aurora-term",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="relative">
      <Container className="relative pt-24 pb-24">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-container px-4 py-1.5 text-[12px] font-medium text-primary">
            Privacy
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-[13px] text-on-surface-variant">
            Last updated: September 5, 2026
          </p>
          <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-on-surface-variant">
            This policy explains what personal information Aurora collects, what we store
            on our servers, and what stays on your device. We keep it simple: we only store
            your login data and your settings, and nothing else.
          </p>

          <div className="mt-12 space-y-6">
            {sections.map((s) => (
              <section
                key={s.title}
                className="rounded-2xl border border-outline-variant bg-surface/50 p-6"
              >
                <h2 className="mb-3 text-[15px] font-semibold text-on-background">{s.title}</h2>
                {s.body.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="mb-2 text-[13px] leading-relaxed text-on-surface-variant last:mb-0"
                  >
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </div>
        </div>
      </Container>
    </div>
  );
}