"use client";

import roadmap, { type RoadmapStage } from "./_data/roadmap";
import MobileCarousel from "./MobileCarousel";

const stageColors: Record<string, { bg: string; border: string; text: string }> = {
  green: { bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  yellow: { bg: "#fef9c3", border: "#f59e0b", text: "#78350f" },
  red: { bg: "#fee2e2", border: "#ef4444", text: "#991b1b" },
};

function StageCard({ stage }: { stage: RoadmapStage }) {
  const colors = stageColors[stage.colorKey];
  return (
    <article
      className="lp-roadmap__stage"
      style={{ borderColor: colors.border, backgroundColor: colors.bg }}
      data-num={stage.id}
      aria-label={stage.title}
    >
      <div className="lp-roadmap__stage-header">
        <span className="lp-roadmap__stage-dot" aria-hidden="true">{stage.dot}</span>
        <div>
          <div className="lp-roadmap__stage-sessions" style={{ color: colors.text }}>
            {stage.sessions}
          </div>
          <h3 className="lp-roadmap__stage-title" style={{ color: colors.text }}>
            {stage.title}
          </h3>
        </div>
      </div>
      <p className="lp-roadmap__stage-intro">{stage.intro}</p>
      <ul className="lp-roadmap__stage-points" role="list">
        {stage.points.map((point, i) => (
          <li key={i} role="listitem">
            <span className="lp-roadmap__point-check" aria-hidden="true">•</span>
            {point}
          </li>
        ))}
      </ul>
      <p className="lp-roadmap__stage-summary" style={{ color: colors.text }}>
        {stage.summary}
      </p>
    </article>
  );
}

export default function Roadmap() {
  return (
    <section className="lp-roadmap section" id="roadmap" aria-labelledby="roadmap-heading">
      <div className="container">
        <h2 id="roadmap-heading" className="section-title text-center">
          18 BUỔI — 3 CHẶNG —{" "}
          <span className="gradient-text">1 ĐÍCH ĐẾN</span>
        </h2>
        <p className="section-subtitle text-center">
          Lộ trình con đi từ &ldquo;ôn nền&rdquo; đến &ldquo;tối ưu đề thi vòng loại RBT2026&rdquo;<br />
          Không học vu vơ. Không nhảy cóc. Không bỏ sót.
        </p>

        <div className="lp-roadmap__stages lp-roadmap__desktop" role="list">
          {roadmap.map((stage) => (
            <StageCard key={stage.id} stage={stage} />
          ))}
        </div>

        <div className="lp-roadmap__mobile-carousel">
          <MobileCarousel accentColor="#10b981">
            {roadmap.map((stage) => (
              <StageCard key={stage.id} stage={stage} />
            ))}
          </MobileCarousel>
        </div>

        <div className="lp-roadmap__conclusion">
          <p>
            Sau 18 buổi, con không chỉ &ldquo;biết đề&rdquo; —<br />
            con <strong>CÁCH TỐI ƯU</strong>. Biết <strong>MẸO</strong>. <strong>PHẢN XẠ</strong> nhanh hơn.
          </p>
          <p>
            Đó là khác biệt giữa &ldquo;con học cho biết&rdquo;<br />
            và <strong>&ldquo;con học để PASS vòng loại RBT2026&rdquo;</strong>.
          </p>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .lp-roadmap__mobile-carousel { display: none; }
            @media (max-width: 860px) {
              .lp-roadmap__desktop { display: none !important; }
              .lp-roadmap__mobile-carousel { display: block; }
            }
          `,
        }}
      />
    </section>
  );
}
