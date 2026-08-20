import { Container, FeatureCard } from "../ui";
import { features } from "../../data/features";

export function FeaturesSection() {
  return (
    <section id="features" className="py-16">
      <Container>
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
      </Container>
    </section>
  );
}
