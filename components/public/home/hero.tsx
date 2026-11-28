"use client";

import { useRef } from "react";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { usePub3d } from "@/components/public/pub-design/use-pub-3d";

/**
 * Hero "phòng thí nghiệm không gian" + dải chạy chữ — CHÉP từ Main.dc.html. Cảnh 3D chạy thật bằng
 * `spacelab.js` (hook `usePub3d`, tải SAU sự kiện load + requestIdleCallback); poster tĩnh chỉ là giai đoạn
 * chờ + dự phòng (chế độ nhẹ / giảm chuyển động / không WebGL). `soCoSo` đọc từ `lib/locations` (repo thắng).
 */
export function Hero({ soCoSo }: { soCoSo: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const { ready, khongCo3D } = usePub3d(canvasRef, { kind: "space", model: "gift", anchor: midRef, baseYaw: -0.25 });
  return (
    <>
      <header className="gridbg space-hero" style={{position: "relative", overflow: "hidden", borderBottom: "1px solid var(--line)"}}>
        <div className="space-sky" aria-hidden="true"></div>
        <canvas ref={canvasRef} className="space-cv" data-linh3d={khongCo3D ? "poster" : ready ? "3d" : "cho"} role="img" aria-label="Phòng thí nghiệm không gian 3D: linh vật Sata Robo đứng trên bệ năng lượng, quanh là bánh răng, chip, cảm biến và khối lập trình"></canvas>
        <div className="wrap" style={{paddingLeft: "0", paddingRight: "0"}}>
          <div className="hero-grid">
            <div className="hero-col">
              <div className="iri box load1" style={{borderRadius: "12px", alignSelf: "flex-start", maxWidth: "100%"}}>
                <span style={{display: "block", borderRadius: "11px", padding: "12px 16px", background: "var(--panel)"}}>
                  <span className="mono" style={{display: "flex", gap: "10px", alignItems: "center", fontSize: "11px", color: "var(--muted)"}}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#fe8f2d" aria-hidden="true">
                      <path d="M4 18h6v-6H6c0-2.2 1.8-4 4-4V6c-3.3 0-6 2.7-6 6zm10 0h6v-6h-4c0-2.2 1.8-4 4-4V6c-3.3 0-6 2.7-6 6z"></path>
                    </svg>
                    Buổi 7 · Robot dò line
                  </span>
                  <span className="mono typing" style={{marginTop: "8px", fontSize: "12px", color: "var(--text)"}}>
                    Robot chạy đúng vạch rồi cô ơi!
                  </span>
                </span>
              </div>
              <div className="load2">
                <h1 className="hero-h" style={{whiteSpace: "nowrap"}}>
                  <span className="mono" style={{display: "block", margin: "0 0 16px", fontSize: "12px", lineHeight: "1.5", letterSpacing: ".06em", color: "var(--accT)", whiteSpace: "normal"}}>
                    ● Học Robotics & AI cho trẻ lớp 1–8 tại Đà Nẵng
                  </span>
                  <span className="iri box">
                    <span>
                      Nhà sáng chế
                    </span>
                  </span>
                  {" "}
                  <br />
                  <span className="iri box" style={{marginTop: "10px"}}>
                    <span>
                      <span className="grad">
                        robot nhí.
                      </span>
                    </span>
                  </span>
                </h1>
              </div>
            </div>
            <div className="hero-mid" ref={midRef}>
              <PubAnh id="55b19affb2175edef52469129f9b4339" className={ready && !khongCo3D ? "space-poster gone" : "space-poster"} alt="" aria-hidden="true" sizes="340px" priority />
            </div>
            <div className="hero-col right">
              <ul className="mono load2" style={{margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px", textAlign: "right", color: "var(--muted)"}}>
                <li>
                  <b style={{color: "var(--accT)"}}>
                    [01]
                  </b>
                  {" "}
                  Lớp 1 → Lớp 8
                </li>
                <li>
                  <b style={{color: "var(--accT)"}}>
                    [02]
                  </b>
                  {" "}
                  Tối đa 12 học viên / lớp
                </li>
                <li>
                  <b style={{color: "var(--accT)"}}>
                    [03]
                  </b>
                  {" "}
                  {soCoSo} cơ sở · Đà Nẵng
                </li>
              </ul>
              <div className="load3" style={{display: "flex", flexDirection: "column", gap: "18px"}}>
                <p style={{margin: "0", fontSize: "17px", lineHeight: "1.6", color: "var(--muted)"}}>
                  <strong style={{color: "var(--text)"}}>
                    Sata Robo
                  </strong>
                  {" "}
                  dạy lắp ráp, lập trình robot và AI cho học sinh lớp 1–8 tại {soCoSo} cơ sở ở Đà Nẵng. Mỗi buổi con tự làm cho robot chạy thật; ba mẹ xem thành quả sau mỗi học phần.
                </p>
                <div style={{display: "flex", flexWrap: "wrap", gap: "10px"}}>
                  <a href="#lien-he" className="btn btn-acc">
                    Học thử 1-1 miễn phí
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M7 17L17 7M8 7h9v9"></path>
                    </svg>
                  </a>
                  <a href="#khoa-hoc" className="btn btn-line">
                    Xem khoá học
                  </a>
                </div>
              </div>
            </div>
          </div>
          <div className="stats">
            <div>
              <p className="mono" style={{margin: "0", fontSize: "11px", color: "var(--muted)"}}>
                Học viên
              </p>
              <p className="num" style={{margin: "2px 0 0"}}>
                1.000
                <span style={{color: "#fe8f2d"}}>
                  +
                </span>
              </p>
            </div>
            <div>
              <p className="mono" style={{margin: "0", fontSize: "11px", color: "var(--muted)"}}>
                Giải thưởng
              </p>
              <p className="num" style={{margin: "2px 0 0"}}>
                50
                <span style={{color: "#fe8f2d"}}>
                  +
                </span>
              </p>
            </div>
            <div>
              <p className="mono" style={{margin: "0", fontSize: "11px", color: "var(--muted)"}}>
                PH học tiếp
              </p>
              <p className="num" style={{margin: "2px 0 0"}}>
                98
                <span style={{color: "#fe8f2d"}}>
                  %
                </span>
              </p>
            </div>
            <div>
              <p className="mono" style={{margin: "0", fontSize: "11px", color: "var(--muted)"}}>
                Hỗ trợ lệ phí thi QG
              </p>
              <p className="num" style={{margin: "2px 0 0"}}>
                3
                <span style={{color: "#fe8f2d"}}>
                  tr
                </span>
              </p>
            </div>
          </div>
        </div>
      </header>
      <section aria-label="Bộ robot" style={{overflow: "hidden", background: "var(--marq)", color: "var(--marqText)", padding: "14px 0", position: "relative"}}>
        <div className="marquee mono" style={{fontSize: "14px", whiteSpace: "nowrap"}}>
          <span>
            ✦ RoboSim
          </span>
          <span>
            ✦ Alpha Set
          </span>
          <span>
            ✦ Beta Set
          </span>
          <span>
            ✦ Intel · AI Camera & IoT
          </span>
          <span>
            ✦ Cuộc thi Sáng tạo Robotics 2026
          </span>
          <span>
            ✦ Thuyết trình cuối mỗi học phần
          </span>
          <span>
            ✦ RoboSim
          </span>
          <span>
            ✦ Alpha Set
          </span>
          <span>
            ✦ Beta Set
          </span>
          <span>
            ✦ Intel · AI Camera & IoT
          </span>
          <span>
            ✦ Cuộc thi Sáng tạo Robotics 2026
          </span>
          <span>
            ✦ Thuyết trình cuối mỗi học phần
          </span>
        </div>
      </section>
    </>
  );
}
