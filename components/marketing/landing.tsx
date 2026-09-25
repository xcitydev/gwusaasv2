import { Grain } from "./primitives";
import { SiteNav } from "./site-nav";
import { Hero, Statement } from "./hero";
import {
  Faq,
  Features,
  FinalCta,
  HowItWorks,
  ModelMarquee,
  Pricing,
  VoiceSection,
} from "./sections";
import { SiteFooter } from "./footer";
import { Showcases } from "./showcase";

/** The public homepage — a cinematic screen up top, gold light, motion on every reveal. */
export function Landing() {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background text-foreground">
      <Grain />
      <SiteNav />
      <main>
        <Hero />
        <Showcases />
        <Statement />
        <ModelMarquee />
        <Features />
        <VoiceSection />
        <HowItWorks />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
