import { Container } from "../ui";
import { AuroraButton } from "../ui/AuroraButton";
import { ChevronRight } from "lucide-react";

export function CtaSection() {
  return (
    <section id="download" className="py-20 text-center">
      <Container>
        <div className="rounded-3xl border border-outline bg-surface/60 p-12 glow">
          <h2 className="text-3xl font-semibold tracking-tight">Ready when you are.</h2>
          <p className="mx-auto mt-3 max-w-md text-[14px] text-on-surface-variant">
            Download the installer, open a folder, and ask Aurora to do the boring parts.
          </p>
          <div className="mt-8 flex justify-center">
            <AuroraButton
              href="https://github.com/TheShiveshNetwork/aurora-term/releases"
              external
            >
              Get Aurora
              <ChevronRight size={16} className="ml-1" />
            </AuroraButton>
          </div>
        </div>
      </Container>
    </section>
  );
}
