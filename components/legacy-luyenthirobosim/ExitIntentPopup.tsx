"use client";

import { useState, useEffect, useRef } from "react";
import useCountdown from "./_hooks/useCountdown";
import CountdownTimer from "./CountdownTimer";
import { getNextDeadline } from "./_utils/deadlines";
import { trackAndRedirect } from "./_utils/tracking";
import { PROGRAM_END_LABEL } from "@/lib/uu-dai";

const INTERVAL_MS = 90_000;

export default function ExitIntentPopup() {
  const [visible, setVisible] = useState(false);
  const [closeCount, setCloseCount] = useState(0);
  const timeLeft = useCountdown(getNextDeadline());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setVisible(true), INTERVAL_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [closeCount]);

  const close = () => {
    setVisible(false);
    setCloseCount((c) => c + 1);
  };

  if (!visible) return null;

  const daysLeft = timeLeft.expired ? 0 : timeLeft.days;
  const badgeText = daysLeft > 0
    ? `🔥 SIÊU ƯU ĐÃI – CHỈ CÒN ${daysLeft} NGÀY`
    : "🔥 SIÊU ƯU ĐÃI – HÔM NAY LÀ NGÀY CUỐI";

  return (
    <div
      className="xpop-overlay"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="xpop-title"
    >
      <div className="xpop-modal" onClick={(e) => e.stopPropagation()}>
        <button className="xpop-close" onClick={close} aria-label="Đóng popup">
          ×
        </button>

        <div className="xpop-badge">{badgeText}</div>

        <h2 id="xpop-title" className="xpop-heading">
          Đăng ký ngay hôm nay<br />
          <span>trước khi giá tăng!</span>
        </h2>

        <p className="xpop-sub">
          Ưu đãi kết thúc hết ngày {PROGRAM_END_LABEL}. Sau đó giá trở về mức ban đầu.
          Đây là cơ hội tốt nhất để con bắt đầu luyện thi.
        </p>

        <div className="xpop-countdown">
          <CountdownTimer timeLeft={timeLeft} />
        </div>

        <div className="xpop-cards">
          <div className="xpop-card xpop-card--r1">
            <div className="xpop-card__label">🟦 Bảng R1 · Tiểu học</div>
            <div className="xpop-card__orig">790.000đ</div>
            <div className="xpop-card__price">490.000đ</div>
            <div className="xpop-card__save">Tiết kiệm 300.000đ</div>
          </div>
          <div className="xpop-card xpop-card--r2">
            <div className="xpop-card__label">🟪 Bảng R2 · THCS</div>
            <div className="xpop-card__orig">890.000đ</div>
            <div className="xpop-card__price">490.000đ</div>
            <div className="xpop-card__save">Tiết kiệm 400.000đ</div>
          </div>
        </div>

        <div className="xpop-actions">
          <button
            className="btn btn-r1 xpop-btn cta-shine"
            onClick={() => {
              close();
              trackAndRedirect("R1", "popup_R1");
            }}
          >
            🟦 Đăng ký Bảng R1 ngay — 490.000đ →
          </button>
          <button
            className="btn btn-r2 xpop-btn cta-shine"
            onClick={() => {
              close();
              trackAndRedirect("R2", "popup_R2");
            }}
          >
            🟪 Đăng ký Bảng R2 ngay — 490.000đ →
          </button>
        </div>

        <button className="xpop-dismiss" onClick={close}>
          Tôi muốn đọc thêm trước khi quyết định →
        </button>
      </div>
    </div>
  );
}
