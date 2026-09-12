import { HeroSection } from "../../components/sections/HeroSection";
import { AboutSection } from "../../components/sections/AboutSection";
import { FeaturesSection } from "../../components/sections/FeaturesSection";
import { CtaSection } from "../../components/sections/CtaSection";

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <AboutSection />
      <FeaturesSection />
      <CtaSection />
    </>
  );
}
