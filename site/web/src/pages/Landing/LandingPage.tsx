import { HeroSection } from "../../components/sections/HeroSection";
import { TerminalPreviewSection } from "../../components/sections/TerminalPreviewSection";
import { FeaturesSection } from "../../components/sections/FeaturesSection";
import { CtaSection } from "../../components/sections/CtaSection";

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <TerminalPreviewSection />
      <FeaturesSection />
      <CtaSection />
    </>
  );
}
