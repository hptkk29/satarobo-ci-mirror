"use client";

import Image from "next/image";
import { trackAndRedirect } from "./_utils/tracking";
import { SATA_ROBO_PHONE } from "@/lib/locations";

export default function FinalCTA() {
  return (
    <section
      className="lp-final-cta cta-section"
      id="final-cta"
      aria-labelledby="final-cta-heading"
    >
      <div className="container">
        <Image
          src="/luyenthirobosim/LinhVat.png"
          alt=""
          className="lp-final-cta__mascot"
          aria-hidden="true"
          width={96}
          height={96}
        />
        <h2 id="final-cta-heading">
          BỐ MẸ ĐÃ ĐỌC ĐẾN ĐÂY —<br />
          CHỈ CÒN 1 BƯỚC NỮA CHO CON.
        </h2>
        <p>
          Mỗi ngày trôi qua = 1 ngày các bạn khác đang luyện thêm.<br />
          Đừng để con bố mẹ bị bỏ lại trong nhóm đại trà.
        </p>

        <div className="cta-btns">
          <button
            onClick={() => trackAndRedirect("R1", "section7_R1")}
            className="btn btn-r1 btn-lg cta-shine"
            aria-label="Đăng ký Bảng R1 cho con Tiểu học — 490.000đ, mở trong tab mới"
          >
            🟦 ĐĂNG KÝ BẢNG R1 — 490.000đ
            <span className="lp-final-cta__sub">(Cho con TIỂU HỌC)</span>
          </button>
          <button
            onClick={() => trackAndRedirect("R2", "section7_R2")}
            className="btn btn-r2 btn-lg cta-shine"
            aria-label="Đăng ký Bảng R2 cho con THCS — 490.000đ, mở trong tab mới"
          >
            🟪 ĐĂNG KÝ BẢNG R2 — 490.000đ
            <span className="lp-final-cta__sub">(Cho con THCS)</span>
          </button>
        </div>

        <div className="lp-final-cta__contact">
          <div className="lp-courses__support">
            <p>💡 Bố mẹ cần tư vấn riêng?</p>
            <p>Inbox mình ngay — Để được tư vấn.</p>
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
          <p className="lp-final-cta__response-time">
            Sata Robo phản hồi trong 30 phút (giờ hành chính).
          </p>
        </div>
      </div>
    </section>
  );
}
