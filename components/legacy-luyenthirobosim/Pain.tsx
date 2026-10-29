"use client";

import pains, { type Pain as PainType } from "./_data/pains";
import MobileCarousel from "./MobileCarousel";

const BORDER_COLORS = ["#ef4444", "#f97316", "#eab308"];

function PainCard({ pain, index }: { pain: PainType; index: number }) {
  return (
    <article
      className="lp-pain__card"
      aria-label={pain.label}
      data-num={index + 1}
      style={{ borderLeftColor: BORDER_COLORS[index] }}
    >
      <div className="lp-pain__card-label">
        <span aria-hidden="true">{pain.icon}</span>
        {pain.label}
      </div>
      <h3 className="lp-pain__card-title">{pain.title}</h3>
      <p className="lp-pain__card-body">{pain.body}</p>
    </article>
  );
}

export default function Pain() {
  return (
    <section className="lp-pain section section-alt" id="pain" aria-labelledby="pain-heading">
      <div className="container">
        <h2 id="pain-heading" className="section-title text-center">
          3 SỰ THẬT VỀ VÒNG LOẠI ROBOTICS 2026 —<br />
          <span className="gradient-text">MÀ ÍT TRUNG TÂM DÁM NÓI VỚI BỐ MẸ</span>
        </h2>
        <p className="section-subtitle text-center">
          Bố mẹ đọc xong 3 sự thật này — sẽ hiểu vì sao
          &ldquo;con học chăm, con luyện nhiều&rdquo; <strong>KHÔNG còn là lợi thế</strong> nữa.
        </p>

        <div className="lp-pain__grid lp-pain__desktop">
          {pains.map((pain, i) => (
            <PainCard key={pain.id} pain={pain} index={i} />
          ))}
        </div>

        <div className="lp-pain__mobile-carousel">
          <MobileCarousel accentColor="#ef4444">
            {pains.map((pain, i) => (
              <PainCard key={pain.id} pain={pain} index={i} />
            ))}
          </MobileCarousel>
        </div>

        <div className="lp-pain__pivot">
          <p className="lp-pain__pivot-question">
            Bố mẹ đọc đến đây — thấy đúng không?
          </p>

          <div className="lp-pain__reframe">
            <p>Vấn đề <strong>KHÔNG PHẢI</strong> con không có đề.</p>
            <p>Vấn đề <strong>KHÔNG PHẢI</strong> con không luyện đủ.</p>
            <p>Vấn đề <strong>KHÔNG PHẢI</strong> con không cố gắng.</p>
          </div>

          <div className="lp-pain__core">
            <p>Vấn đề là cả nước đều có đề.</p>
            <p>Cả nước đều luyện free.</p>
            <p>Cả nước đều đứng <strong>CÙNG MỘT VẠCH</strong>.</p>
          </div>

          <p className="lp-pain__conclusion">
            BTC vòng loại không lấy &ldquo;đứng cùng vạch&rdquo;.<br />
            BTC chỉ lấy <strong>NGƯỜI VƯỢT LÊN TRƯỚC</strong>.
          </p>

          <a
            href="#solution"
            className="lp-pain__scroll-cta"
            aria-label="Xem cách đưa con vượt lên trước"
          >
            👉 Mình có cách đưa con bố mẹ vượt lên trước ↓
          </a>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .lp-pain__mobile-carousel { display: none; }
            @media (max-width: 860px) {
              .lp-pain__desktop { display: none !important; }
              .lp-pain__mobile-carousel { display: block; }
            }
          `,
        }}
      />
    </section>
  );
}
