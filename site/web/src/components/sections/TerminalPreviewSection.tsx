import { Container } from "../ui";
import { VideoPlayer } from "../ui/VideoPlayer";

export function TerminalPreviewSection() {
  return (
    <section id="terminal" className="py-16">
      <Container>
        <VideoPlayer
          src="/aurora-terminal-demo.mp4"
          className="w-full shadow-[0_0_80px_rgba(79,140,255,0.08)]"
        />
      </Container>
    </section>
  );
}
