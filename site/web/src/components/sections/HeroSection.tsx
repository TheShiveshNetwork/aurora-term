import Strands from "../backgrounds/LightStrands";
import WarpText from "../ui/WarpText";
import { VideoPlayer } from "../ui/VideoPlayer";

export function HeroSection() {
  return (
    <section className="relative min-h-[800px]">
      <div className="absolute inset-x-0 top-0 h-[800px]">
        <Strands
          colors={["#f96e16","#7C3AED","#06B6D4"]}
          count={3}
          speed={0.5}
          amplitude={1}
          waviness={1}
          thickness={0.7}
          glow={2.6}
          taper={3}
          spread={5}
          intensity={1}
          saturation={2.4}
          opacity={.8}
          scale={1.5}
          glass={false}
          refraction={1}
          dispersion={4}
          glassSize={1}
          hueShift={0}
        />
      </div>
      <div className="relative z-10">
        <div className="h-[400px] pt-20">
          <WarpText
            text="Aurora"
            color="#f8f5ff"
            warpStrength={0.08}
            warpScale={1.7}
            speed={0.55}
            pointerInfluence={0.42}
            pointerStrength={0.38}
            refraction={0.018}
            ripple
            fontSize={116}
            fontWeight={800}
            style={{ height: '320px' }}
            fontFamily="inherit"
            letterSpacing={-0.06}
            lineHeight={0.9}
          />
        </div>
        <div className="mx-auto w-full max-w-6xl px-6 pb-16">
          <VideoPlayer
            src="/aurora-terminal-demo.mp4"
            className="w-full shadow-[0_0_80px_rgba(79,140,255,0.08)]"
          />
        </div>
      </div>
    </section>
  );
}
