"use client";

import { useState } from "react";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { BO_ROBOT, chonBo, lopLuoiBo } from "./home-thuan";

/** Mở đăng ký buổi lắp thử = cuộn tới form `#lien-he` ngay trên trang (popup của layout tự hiện theo hẹn giờ, không có API mở tay). */
function cuonToiForm() {
  document.getElementById("lien-he")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** "Robot con sẽ tự lắp" — CHÉP từ Main.dc.html; một state duy nhất (bộ đang chọn). */
export function RobotTuLap() {
  const [boId, setBoId] = useState<string>(BO_ROBOT[0].id);
  const bo = chonBo(boId);
  return (
      <section id="robot" className="sec" style={{paddingTop: "0"}}>
        <div className="wrap">
          <div className="head2 sv a-blur">
            <div>
              <span className="label mono">
                <b>
                  [✦]
                </b>
                {" "}
                Robot con sẽ tự lắp
              </span>
              <h2>
                Mỗi học phần, con lắp một
                {" "}
                <span className="grad">
                  robot thật
                </span>
              </h2>
            </div>
            <p>
              Chọn bộ robot theo lớp của con. Bấm vào robot bất kỳ để đăng ký buổi lắp thử 1-1 miễn phí.
            </p>
          </div>
          <div className="kit-tabs" role="tablist" aria-label="Bộ robot">
            {BO_ROBOT.map((b) => {
              const bat = b.id === bo.id;
              return (
                <button key={b.id} type="button" role="tab" aria-selected={bat} className={bat ? "kit-tab on" : "kit-tab"} onClick={() => setBoId(b.id)}>
                  <strong>
                    {b.ten}
                  </strong>
                  <small>
                    {b.phu}
                  </small>
                </button>
              );
            })}
          </div>
          <p style={{margin: "0 0 18px", color: "var(--muted)", maxWidth: "720px"}}>
            {bo.moTa}
          </p>
          <div className={lopLuoiBo(bo)}>
            {bo.moHinh.map((m) => (
              <button key={m.ma} type="button" className="kit-card" onClick={cuonToiForm} aria-label={`Đăng ký lắp thử ${m.ten}`}>
                <span className="pic">
                  <PubAnh id={m.ma} alt={`Robot ${m.ten} lắp từ bộ ${bo.ten} tại Sata Robo`} sizes="(max-width: 640px) 45vw, (max-width: 1000px) 30vw, 300px" />
                </span>
                <span style={{display: "flex", flexDirection: "column", gap: "4px", padding: "14px 16px 16px"}}>
                  <strong style={{fontSize: "16px"}}>
                    {m.ten}
                  </strong>
                  <span className="mono" style={{fontSize: "10.5px", color: "var(--muted)"}}>
                    {m.kyNang}
                  </span>
                  <span className="go" style={{marginTop: "6px"}}>
                    Lắp thử con này →
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="kit-cta sv a-blur">
            <div style={{display: "flex", alignItems: "center", gap: "14px"}}>
              <PubAnh id="1f63915100ed3dcdecacdc58c1ce83b3" alt="" aria-hidden="true" style={{width: "64px", height: "auto", flexShrink: "0"}} sizes="64px" />
              <div>
                <p style={{margin: "0", fontWeight: "700", fontSize: "18px"}}>
                  Buổi học thử: con tự lắp 1 robot và cho nó chạy
                </p>
                <p style={{margin: "2px 0 0", color: "#f3e4ff", fontSize: "14px"}}>
                  1 kèm 1 với giáo viên · 0 đồng · ba mẹ ngồi xem cùng
                </p>
              </div>
            </div>
            <button type="button" onClick={cuonToiForm} className="btn btn-acc">
              Đặt buổi lắp thử miễn phí
            </button>
          </div>
        </div>
      </section>
  );
}
