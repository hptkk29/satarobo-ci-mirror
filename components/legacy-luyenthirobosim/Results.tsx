"use client";

import Image from "next/image";
import { trackAndRedirect } from "./_utils/tracking";

interface Score {
  level: "R1" | "R2";
  colorKey: "r1" | "r2";
  badge: string;
  imgSrc: string;
  imgAlt: string;
  imgW: number;
  imgH: number;
  score: string;
  ctaText: string;
  ctaSub: string;
  event: string;
}

const scores: Score[] = [
  {
    level: "R1",
    colorKey: "r1",
    badge: "🟦 KẾT QUẢ BẢNG R1 — TIỂU HỌC",
    imgSrc: "/luyenthirobosim/R1_RESULT_IMAGE.jpg",
    imgAlt:
      "Kết quả 788/800 điểm Bảng R1 — Học viên Sata Robo giải tối ưu đề vòng loại RBT2026",
    imgW: 2000,
    imgH: 1125,
    score: "781 / 800 điểm",
    ctaText: "🟦 ĐĂNG KÝ BẢNG R1 — 490.000đ",
    ctaSub: "(Cho con TIỂU HỌC)",
    event: "section6_R1",
  },
  {
    level: "R2",
    colorKey: "r2",
    badge: "🟪 KẾT QUẢ BẢNG R2 — THCS",
    imgSrc: "/luyenthirobosim/R2_RESULT_IMAGE.jpg",
    imgAlt:
      "Kết quả 858/900 điểm Bảng R2 — Học viên Sata Robo giải tối ưu đề vòng loại RBT2026",
    imgW: 2559,
    imgH: 1515,
    score: "856 / 900 điểm",
    ctaText: "🟪 ĐĂNG KÝ BẢNG R2 — 490.000đ",
    ctaSub: "(Cho con THCS)",
    event: "section6_R2",
  },
];

export default function Results() {
  return (
    <section
      className="lp-results section section-alt"
      id="results"
      aria-labelledby="results-heading"
    >
      <div className="container">
        <h2 id="results-heading" className="section-title text-center">
          KẾT QUẢ CÁC THÍ SINH ĐÃ THAM GIA KHOÁ LUYỆN THI
        </h2>
        <p className="section-subtitle text-center">
          Đây là điểm số <strong>THẬT</strong> — chụp từ phần mềm RoboSim<br />
          khi giải tối ưu đề thi vòng loại RBT2026 theo đúng kỹ thuật mà Sata Robo dạy trong khoá Luyện Thi.
        </p>

        <div className="lp-results__grid">
          {scores.map((s) => (
            <article
              key={s.level}
              className={`lp-results__card lp-results__card--${s.colorKey}`}
              aria-label={`${s.badge}: ${s.score}`}
            >
              <div className="lp-results__card-badge">{s.badge}</div>
              <div
                className="lp-results__img-wrap"
                style={{ aspectRatio: `${s.imgW} / ${s.imgH}` }}
              >
                <Image
                  src={s.imgSrc}
                  alt={s.imgAlt}
                  className="lp-results__img"
                  loading="lazy"
                  width={s.imgW}
                  height={s.imgH}
                />
              </div>
              <div className="lp-results__score">{s.score}</div>
              <button
                onClick={() => trackAndRedirect(s.level, s.event)}
                className={`btn btn-${s.colorKey} btn-lg lp-results__cta cta-shine`}
                aria-label={`${s.ctaText} ${s.ctaSub} — mở trong tab mới`}
              >
                {s.ctaText}
                <span className="lp-results__cta-sub">{s.ctaSub}</span>
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
