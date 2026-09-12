import { Container } from "../ui";
import { AuroraButton } from "../ui/AuroraButton";
import { ChevronRight } from "lucide-react";
import GradientWaves from "../backgrounds/GradientWaves"
import { markBackgroundReady } from "../../lib/pageLoad";
import { useExpectBackground } from "../../hooks/usePageAssets";

export function CtaSection() {
  useExpectBackground();

  return (
    <section className="py-20 text-center">
      <Container>
        <div className="relative h-[600px] flex flex-col items-center justify-center rounded-3xl border border-outline glow">
          <div className="absolute inset-0 z-[-1] rounded-3xl overflow-hidden">
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
              onReady={markBackgroundReady}
            />
          </div>
          <div className="relative z-10 flex w-full flex-col items-center justify-center px-6 py-12 pointer-events-auto">
            <h2 className="text-3xl font-semibold tracking-tight">Ready when you are.</h2>
            <p className="mx-auto mt-3 max-w-md text-[14px] text-on-surface-variant">
              Download the installer, open a folder, and ask Aurora to do the boring parts.
            </p>
            <div className="mt-8 flex justify-center">
              <AuroraButton href="/download">
                Get Aurora
                <ChevronRight size={16} className="ml-1" />
              </AuroraButton>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
