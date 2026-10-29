"use client";

import Image from "next/image";
import CompetitionRoadmap from "./CompetitionRoadmap";
import { trackAndRedirect } from "./_utils/tracking";

const HEADER_OFFSET = 126;

export default function Hero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-heading"
      style={{
        background: "linear-gradient(160deg, #fff9f5 0%, #ffffff 50%, #f5f3ff 100%)",
        paddingTop: HEADER_OFFSET,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "40px 24px 24px",
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 48,
          alignItems: "center",
        }}
        className="hero-grid"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span
            role="note"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "linear-gradient(135deg, #F97316, #FBBF24)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              padding: "8px 18px",
              borderRadius: 100,
              boxShadow: "0 4px 16px rgba(249,115,22,0.35)",
              width: "fit-content",
              animation: "pulse 2s ease-in-out infinite",
            }}
          >
            🚨 Vòng loại RBT2026 đã mở — Cả nước đang luyện
          </span>

          <h1
            id="hero-heading"
            style={{
              fontSize: "clamp(32px, 4vw, 52px)",
              fontWeight: 900,
              lineHeight: 1.15,
              color: "#111827",
              margin: 0,
            }}
          >
            Con bạn sẵn sàng<br />
            chinh phục{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #F97316 0%, #7C3AED 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Robotics 2026?
            </span>
          </h1>

          <p style={{ fontSize: 17, color: "#4B5563", lineHeight: 1.7, margin: 0 }}>
            Khoá Luyện Thi <strong>RoboSim</strong> của Sata Robo được tạo ra để{" "}
            <strong>đưa con vào TOP</strong> — pass vòng loại{" "}
            <strong style={{ color: "#F97316" }}>26/07/2026</strong>.
          </p>

          <div
            style={{
              borderLeft: "4px solid #F97316",
              background: "#fff7ed",
              padding: "14px 20px",
              borderRadius: "0 16px 16px 0",
            }}
          >
            <p
              style={{
                fontSize: 11,
                color: "#9CA3AF",
                textTransform: "uppercase",
                letterSpacing: 1,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              Mục tiêu duy nhất của khoá học
            </p>
            <p
              style={{
                fontSize: 20,
                fontWeight: 900,
                color: "#F97316",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                margin: 0,
              }}
            >
              Đưa con vào TOP. Pass vòng loại.
            </p>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => trackAndRedirect("R1", "hero_R1")}
              className="cta-shine"
              aria-label="Đăng ký Bảng R1 cho con học Tiểu học — 490.000đ"
              style={{
                flex: 1,
                minWidth: 180,
                background: "linear-gradient(135deg, #F7941D 0%, #FFAD4D 100%)",
                color: "#fff",
                border: "none",
                padding: "16px 20px",
                borderRadius: 16,
                fontWeight: 800,
                fontSize: 16,
                cursor: "pointer",
                boxShadow: "0 8px 24px rgba(247,148,29,0.40)",
                transition: "transform .2s, box-shadow .2s",
                textAlign: "center",
                lineHeight: 1.4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 12px 32px rgba(247,148,29,0.55)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 8px 24px rgba(247,148,29,0.40)";
              }}
            >
              🟦 Tiểu học → Bảng R1
              <span style={{ display: "block", fontSize: 14, fontWeight: 800, opacity: 0.9, marginTop: 2 }}>
                490.000đ
              </span>
            </button>
            <button
              onClick={() => trackAndRedirect("R2", "hero_R2")}
              className="cta-shine"
              aria-label="Đăng ký Bảng R2 cho con học THCS — 490.000đ"
              style={{
                flex: 1,
                minWidth: 180,
                background: "linear-gradient(135deg, #5b21b6 0%, #8b5cf6 100%)",
                color: "#fff",
                border: "none",
                padding: "16px 20px",
                borderRadius: 16,
                fontWeight: 800,
                fontSize: 16,
                cursor: "pointer",
                boxShadow: "0 8px 24px rgba(124,58,237,0.35)",
                transition: "transform .2s, box-shadow .2s",
                textAlign: "center",
                lineHeight: 1.4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 12px 32px rgba(124,58,237,0.45)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 8px 24px rgba(124,58,237,0.35)";
              }}
            >
              🟪 THCS → Bảng R2
              <span style={{ display: "block", fontSize: 14, fontWeight: 800, opacity: 0.9, marginTop: 2 }}>
                490.000đ
              </span>
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#6B7280" }}>
            <span>⏰ Ưu đãi GIẢM đến 45%.</span>
            <span>⭐ 100% Học viên tại SataRobo đã <strong>PASS</strong> qua vòng loại.</span>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            minHeight: 420,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background:
                "radial-gradient(ellipse at 55% 55%, #ffd6a5 0%, #e9d5ff 55%, transparent 80%)",
              filter: "blur(48px)",
              opacity: 0.7,
              pointerEvents: "none",
            }}
          />

          <Image
            src="/luyenthirobosim/LinhVat.png"
            alt="Linh vật Sata Robo"
            width={400}
            height={420}
            style={{
              position: "relative",
              zIndex: 2,
              width: "100%",
              maxWidth: 400,
              height: "auto",
              objectFit: "contain",
              filter: "drop-shadow(0 24px 48px rgba(124,58,237,0.28))",
            }}
            priority
          />

          <div
            style={{
              position: "absolute",
              top: "20%",
              left: -16,
              zIndex: 10,
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
              border: "1px solid #fed7aa",
              padding: "10px 16px",
              animation: "float 3.5s ease-in-out infinite",
            }}
          >
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600 }}>📅 Vòng loại</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#F97316" }}>26/07/2026</div>
          </div>

          <div
            style={{
              position: "absolute",
              bottom: "18%",
              right: -16,
              zIndex: 10,
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 8px 28px rgba(0,0,0,0.12)",
              border: "1px solid #ddd6fe",
              padding: "10px 16px",
              animation: "float 4s ease-in-out infinite 0.8s",
            }}
          >
            <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600 }}>🏆 Học viên Sata Robo</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#7C3AED" }}>Chinh phục đấu trường Quốc tế</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 48px" }}>
        <p style={{ textAlign: "center", fontSize: 14, color: "#6B7280", fontWeight: 500, marginBottom: 20 }}>
          Hành trình từ vòng loại đến chung kết thế giới — con bố mẹ có thể đi hết:
        </p>
        <CompetitionRoadmap />
        <p style={{ textAlign: "center", fontWeight: 700, color: "#374151", marginTop: 20, fontSize: 15 }}>
          Mọi đứa trẻ đều mơ tới chung kết — nhưng tất cả đều bắt đầu từ{" "}
          <span style={{ color: "#F97316" }}>vòng loại 26/07/2026.</span>
        </p>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 900px) {
              .hero-grid {
                grid-template-columns: 1fr !important;
                gap: 32px !important;
                padding: 32px 20px 24px !important;
              }
            }
            @media (max-width: 768px) { #hero { padding-top: 109px !important; } }
            @media (max-width: 640px) { #hero { padding-top: 132px !important; } }
          `,
        }}
      />
    </section>
  );
}
