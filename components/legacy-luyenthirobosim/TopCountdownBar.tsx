"use client";

import useCountdown from "./_hooks/useCountdown";
import useScrollPosition from "./_hooks/useScrollPosition";
import { getNextDeadline, getExamDate } from "./_utils/deadlines";
import CountdownTimer from "./CountdownTimer";

export default function TopCountdownBar() {
  const dealDeadline = useCountdown(getNextDeadline());
  const examDate = useCountdown(getExamDate());
  const scrollY = useScrollPosition();
  const isHidden = scrollY > 150;

  return (
    <div
      className={`lp-top-bar${isHidden ? " lp-top-bar--hidden" : ""}`}
      role="banner"
      aria-label="Thông báo ưu đãi và ngày thi"
    >
      <div className="container lp-top-bar__inner">
        <div className="lp-top-bar__item lp-top-bar__item--urgent">
          <span className="lp-top-bar__icon" aria-hidden="true">⏰</span>
          <span className="lp-top-bar__label--long">ƯU ĐÃI 490K KẾT THÚC SAU:</span>
          <span className="lp-top-bar__label--short" aria-hidden="true">490K HẾT SAU:</span>
          <CountdownTimer timeLeft={dealDeadline} className="lp-top-bar__timer" />
        </div>

        <div className="lp-top-bar__item lp-top-bar__item--exam">
          <span className="lp-top-bar__icon" aria-hidden="true">🏆</span>
          <span className="lp-top-bar__label--long">VÒNG LOẠI 26/7 SAU:</span>
          <span className="lp-top-bar__label--short" aria-hidden="true">THI 26/7 SAU:</span>
          <CountdownTimer timeLeft={examDate} className="lp-top-bar__timer" />
        </div>
      </div>
    </div>
  );
}
