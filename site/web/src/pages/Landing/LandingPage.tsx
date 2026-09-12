import { HeroSection } from "../../components/sections/HeroSection";
import { AboutSection } from "../../components/sections/AboutSection";
import { FeaturesSection } from "../../components/sections/FeaturesSection";
import { CtaSection } from "../../components/sections/CtaSection";
import { PageLoader } from "../../components/layout/PageLoader";
import { usePageReady } from "../../hooks/usePageReady";

export default function LandingPage() {
  const ready = usePageReady();

  return (
    <>
      <PageLoader visible={!ready} />
      <HeroSection />
      <AboutSection />
      <FeaturesSection />
      <CtaSection />
    </>
  );
}
