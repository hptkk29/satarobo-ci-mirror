"use client";

import Image from "next/image";
import courses from "./_data/courses";
import { trackAndRedirect } from "./_utils/tracking";
import { SATA_ROBO_PHONE } from "@/lib/locations";

export default function Courses() {
  return (
    <section
      className="lp-courses section section-alt"
      id="courses"
      aria-labelledby="courses-heading"
    >
      <div className="container">
        <h2 id="courses-heading" className="section-title text-center">
          KHOÁ LUYỆN THI ROBOSIM —<br />
          <span className="gradient-text">TIỂU HỌC CHỌN R1, THCS CHỌN R2</span>
        </h2>
        <p className="section-subtitle text-center">
          Sata Robo có 2 nội dung khoá luyện thi — tương ứng 2 bảng thi vòng loại RBT2026.<br />
          Bố mẹ chọn theo lứa tuổi của con. Đơn giản vậy thôi.
        </p>

        <div className="lp-courses__swap-badge" role="note">
          💡 Lỡ chọn nhầm bảng? Sata Robo hỗ trợ đổi khoá miễn phí trong 7 ngày đầu.
        </div>

        <div className="course-grid">
          {courses.map((course) => (
            <article
              key={course.id}
              className={`course-card course-card-${course.colorKey}`}
              aria-label={`${course.title} — ${course.subtitle}`}
            >
              <span className={`course-card-tag tag-${course.colorKey}`}>{course.badge}</span>
              <h3>{course.title}</h3>
              <p className="lp-courses__tagline">{course.tagline}</p>

              <ul className="lp-courses__meta" aria-label="Thông tin khoá học">
                <li>
                  <span className="lp-courses__meta-icon" aria-hidden="true">👤</span>
                  <strong>Dành cho:</strong> {course.audience}
                </li>
                <li>
                  <span className="lp-courses__meta-icon" aria-hidden="true">📋</span>
                  <strong>Bảng đề thi:</strong> {course.examBoard}
                </li>
                <li>
                  <span className="lp-courses__meta-icon" aria-hidden="true">⏰</span>
                  <strong>Thời lượng:</strong> {course.duration}
                </li>
              </ul>

              <div className="lp-courses__outcomes">
                <p><strong>🎯 Đầu ra:</strong></p>
                <ul>{course.outcomes.map((o) => <li key={o}>✓ {o}</li>)}</ul>
              </div>

              <div className="lp-courses__price">
                <div className="lp-courses__price-original"><s>{course.originalPrice}</s></div>
                <div className="lp-courses__price-sale">
                  <strong>{course.salePrice}</strong>
                  <span className="lp-courses__discount">🔥 {course.discount} — chỉ trước ngày thi</span>
                </div>
              </div>

              <ul className="features-list" aria-label="Bố mẹ nhận được">
                {course.features.map((f) => (
                  <li key={f}>
                    <span className={`check check-${course.colorKey}`} aria-hidden="true">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => trackAndRedirect(course.level as "R1" | "R2", `section4_${course.level}`)}
                className={`btn btn-${course.colorKey} btn-lg lp-courses__cta cta-shine`}
                aria-label={`${course.ctaText} — mở trong tab mới`}
              >
                {course.ctaText}
              </button>
            </article>
          ))}
        </div>

        <div className="lp-courses__closer">
          <h3>🔥 Mình nói thẳng với bố mẹ:</h3>
          <p>❌ Không học khoá luyện thi → Con đứng chung vạch với cả nước → Bị loại.</p>
          <p>✅ Học khoá luyện thi 490k → Con biết MẸO + TRICK → Vượt lên trước → <strong>PASS</strong>.</p>

          <div className="lp-vs" aria-label="So sánh chi phí: 10 cốc trà sữa vs Khoá học Sata Robo">
            <div className="lp-vs__left">
              <div className="lp-vs__bubbles" aria-hidden="true">
                {Array.from({ length: 10 }).map((_, i) => (
                  <span key={i} className="lp-vs__bubble">🧋</span>
                ))}
              </div>
              <p className="lp-vs__label">Mua 10 cốc trà sữa</p>
              <p className="lp-vs__price">450.000đ</p>
              <p className="lp-vs__sub">Uống xong là hết — không còn lại gì</p>
            </div>

            <div className="lp-vs__mid" aria-hidden="true">
              <span className="lp-vs__badge">VS</span>
            </div>

            <div className="lp-vs__right">
              <div className="lp-vs__mascot">
                <Image
                  src="/luyenthirobosim/LinhVat.png"
                  alt="Linh vật Sata Robo"
                  width={64}
                  height={64}
                  loading="lazy"
                />
              </div>
              <p className="lp-vs__label">Khóa học Sata Robo</p>
              <p className="lp-vs__price lp-vs__price--highlight">490.000đ</p>
              <p className="lp-vs__feature">18 buổi học · Truy cập vĩnh viễn</p>
              <p className="lp-vs__feature">Cơ hội vào vòng chung kết quốc gia</p>
            </div>
          </div>

          <p className="lp-courses__closer-question">
            <strong>Bố mẹ thấy đáng không?</strong>
          </p>
        </div>

        <div className="lp-courses__support">
          <p>💡 Bố mẹ phân vân con thuộc bảng nào?</p>
          <p>Inbox mình ngay — gửi tên lớp con đang học, tư vấn miễn phí trong 10 phút.</p>
          <a
            href={SATA_ROBO_PHONE.zalo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-zalo"
            aria-label="Chat Zalo để được tư vấn miễn phí"
          >
            💬 Chat Zalo →
          </a>
        </div>
      </div>
    </section>
  );
}
