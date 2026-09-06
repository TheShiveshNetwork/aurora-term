import { Container } from "../ui";
import { AuroraButton } from "../ui/AuroraButton";
import { ChevronRight } from "lucide-react";
import GradientWaves from "../backgrounds/GradientWaves"

export function CtaSection() {
  return (
    <section className="py-20 text-center">
      <Container>
        <div className="rounded-3xl relative h-[600px] flex flex-col items-center justify-center border border-outline glow">
          <div className="absolute z-[-1] h-full rounded-3xl overflow-hidden">
            <GradientWaves
              horizonColor="#5227FF"
              waveColor="#FF9FFC"
              crestColor="#FFFFFF"
              speed={0.4}
              amplitude={2.5}
              waveScale={0.6}
              waveRatio={0.9}
              swell={35}
              turbulence={20}
              tilt={1.11}
              zoom={1}
              height={5.5}
              fogDepth={15}
              detail="medium"
              brightness={1}
              opacity={1}
              mouseInteraction
              parallaxStrength={0.5}
              grain
              grainIntensity={0.05}
            />
          </div>
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
