"use client";

import { competitionStages, type CompetitionStage } from "./_data/competition-roadmap";
import MobileCarousel from "./MobileCarousel";

interface ColorTokens {
  hex: string;
  bg: string;
  soft: string;
  shadow: string;
}

const colorConfig: Record<string, ColorTokens> = {
  urgent: { hex: "#F97316", bg: "#FFF7ED", soft: "#FFEDD5", shadow: "rgba(249,115,22,0.24)" },
  warning: { hex: "#D97706", bg: "#FFFBEB", soft: "#FEF3C7", shadow: "rgba(217,119,6,0.20)" },
  "r1-primary": { hex: "#2563EB", bg: "#EFF6FF", soft: "#DBEAFE", shadow: "rgba(37,99,235,0.20)" },
  "r2-primary": { hex: "#7C3AED", bg: "#F5F3FF", soft: "#EDE9FE", shadow: "rgba(124,58,237,0.20)" },
};

function StageCard({ stage }: { stage: CompetitionStage }) {
  const c = colorConfig[stage.color];

  return (
    <div
      role="listitem"
      className="roadmap-card"
      style={{
        width: "100%",
        minWidth: 0,
        minHeight: 178,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: stage.isCurrent
          ? `linear-gradient(145deg, ${c.bg} 0%, #fff 62%, ${c.soft} 100%)`
          : `linear-gradient(145deg, #fff 0%, #fff 64%, ${c.bg} 100%)`,
        border: `2px solid ${c.hex}`,
        borderRadius: 20,
        padding: "22px 16px 18px",
        textAlign: "center",
        boxShadow: stage.isCurrent
          ? `0 14px 34px ${c.shadow}, 0 0 0 5px ${c.hex}20`
          : "0 10px 26px rgba(17,24,39,0.07)",
        animation: stage.isCurrent ? "pulse 2.5s ease-in-out infinite" : "none",
        position: "relative",
        overflow: "hidden",
        transition: "transform .22s ease, box-shadow .22s ease",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -46,
          right: -38,
          width: 116,
          height: 116,
          borderRadius: "50%",
          background: c.soft,
          opacity: 0.75,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          background: `linear-gradient(90deg, ${c.hex}, ${c.hex}66)`,
          borderRadius: "20px 20px 0 0",
        }}
      />

      <span
        style={{
          width: 52,
          height: 52,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          background: "#fff",
          boxShadow: `0 8px 20px ${c.shadow}`,
          fontSize: 31,
          lineHeight: 1,
          position: "relative",
          zIndex: 1,
        }}
        aria-hidden="true"
      >
        {stage.icon}
      </span>

      <div
        style={{
          minHeight: 44,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 900,
            letterSpacing: 1.1,
            textTransform: "uppercase",
            color: c.hex,
            lineHeight: 1.25,
          }}
        >
          {stage.title}
        </div>
        {stage.subtitle && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: c.hex,
              opacity: 0.75,
              lineHeight: 1.25,
            }}
          >
            {stage.subtitle}
          </div>
        )}
      </div>

      <div
        style={{
          minHeight: 34,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          color: "#6B7280",
          fontWeight: 800,
          background: "#F8FAFC",
          border: "1px solid #EEF2F7",
          borderRadius: 12,
          padding: "6px 12px",
          marginTop: 2,
          width: "fit-content",
          maxWidth: "100%",
        }}
      >
        {stage.date}
      </div>

      {stage.isCurrent && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 0.5,
            color: "#fff",
            background: c.hex,
            borderRadius: 100,
            padding: "5px 12px",
            textTransform: "uppercase",
            boxShadow: `0 8px 18px ${c.shadow}`,
          }}
        >
          SẮP DIỄN RA!
        </div>
      )}
    </div>
  );
}

function Arrow({ direction = "right" }: { direction?: "right" | "down" }) {
  return (
    <div
      style={{
        flexShrink: 0,
        width: direction === "right" ? 30 : 36,
        height: direction === "right" ? 30 : 36,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#94A3B8",
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: "50%",
        boxShadow: "0 8px 18px rgba(15,23,42,0.08)",
        fontSize: direction === "right" ? 18 : 16,
        fontWeight: 900,
        lineHeight: 1,
      }}
      aria-hidden="true"
    >
      {direction === "right" ? "→" : "↓"}
    </div>
  );
}

export default function CompetitionRoadmap() {
  return (
    <div role="list" aria-label="Hành trình 4 vòng thi RBT2026">
      <div
        style={{
          display: "none",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 24,
          width: "100%",
        }}
        className="roadmap-desktop"
      >
        {competitionStages.map((stage, i) => (
          <div key={stage.title} style={{ position: "relative", minWidth: 0, display: "flex" }}>
            <StageCard stage={stage} />
            {i < competitionStages.length - 1 && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  right: -27,
                  transform: "translateY(-50%)",
                  zIndex: 4,
                }}
              >
                <Arrow direction="right" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="roadmap-mobile">
        <MobileCarousel accentColor="#F97316">
          {competitionStages.map((stage) => (
            <StageCard key={stage.title} stage={stage} />
          ))}
        </MobileCarousel>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (min-width: 768px) {
              .roadmap-desktop { display: grid !important; }
              .roadmap-mobile  { display: none  !important; }
            }
            .roadmap-mobile { display: block; }
            @media (hover: hover) {
              .roadmap-card:hover {
                transform: translateY(-5px);
                box-shadow: 0 18px 42px rgba(15,23,42,0.12) !important;
              }
            }
          `,
        }}
      />
    </div>
  );
}
