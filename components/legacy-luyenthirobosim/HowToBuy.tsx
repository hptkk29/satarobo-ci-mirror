"use client";

import { useState, useEffect, useCallback } from "react";

const VIDEO_ID = "3w1rJmB_eo0";

const steps = [
  { num: 1, label: "Truy cập SataWorld.vn" },
  { num: 2, label: "Đăng ký tài khoản miễn phí" },
  { num: 3, label: "Chọn đúng khoá R1 hoặc R2" },
  { num: 4, label: "Thanh toán và xác nhận" },
  { num: 5, label: "Vào tài khoản và học ngay" },
  { num: 6, label: "Zalo hỗ trợ khi cần" },
];

export default function HowToBuy() {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  return (
    <section
      className="lp-howtobuy section"
      id="huong-dan"
      aria-labelledby="howtobuy-heading"
    >
      <div className="container">
        <div className="text-center">
          <span className="lp-howtobuy__badge">▶ HƯỚNG DẪN ĐĂNG KÝ</span>
          <h2 id="howtobuy-heading" className="lp-howtobuy__title">
            Mua và bắt đầu học trong ít phút
            <span className="lp-howtobuy__title-sub">Xem hướng dẫn đầy đủ từng bước</span>
          </h2>
          <p className="lp-howtobuy__subtitle">
            Từ đăng ký tài khoản đến bài học đầu tiên — thực hiện cực kỳ đơn giản
          </p>
        </div>

        <div className="lp-howtobuy__video-wrap">
          <button
            className="lp-howtobuy__thumb"
            onClick={() => setOpen(true)}
            aria-label="Phát video hướng dẫn"
            type="button"
          >
            <img
              src={`https://img.youtube.com/vi/${VIDEO_ID}/maxresdefault.jpg`}
              alt="Hướng dẫn đăng ký tài khoản SataWorld và mua khóa học"
              className="lp-howtobuy__thumb-img"
              loading="lazy"
            />
            <span className="lp-howtobuy__play" aria-hidden="true">▶</span>
            <div className="lp-howtobuy__thumb-caption">
              <p>Hướng dẫn đăng ký tài khoản SataWorld và mua khóa học</p>
            </div>
          </button>
        </div>

        <ol className="lp-howtobuy__steps" aria-label="Các bước đăng ký và học">
          {steps.map((s) => (
            <li key={s.num} className="lp-howtobuy__step">
              <span className="lp-howtobuy__step-num" aria-hidden="true">{s.num}</span>
              <span className="lp-howtobuy__step-label">{s.label}</span>
            </li>
          ))}
        </ol>
      </div>

      {open && (
        <div
          className="lp-vbox-overlay"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Video hướng dẫn"
        >
          <div className="lp-vbox-inner" onClick={(e) => e.stopPropagation()}>
            <button
              className="lp-vbox-close"
              onClick={close}
              aria-label="Đóng video"
              type="button"
            >
              ✕
            </button>
            <div className="lp-vbox-frame">
              <iframe
                src={`https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
                title="Hướng dẫn đăng ký tài khoản SataWorld và mua khóa học"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
