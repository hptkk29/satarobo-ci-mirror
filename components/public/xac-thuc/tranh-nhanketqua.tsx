import type { CSSProperties } from "react";
import { PubAnh } from "@/components/public/pub-design/pub-anh";

// Cột trái (`aside.auth-art`) của "Disc-NhanKetQua" — CHÉP nguyên từ artifact; linh vật 3D chạy thật (viewer2.js), poster là giai đoạn chờ.
export function TranhNhanKetQua() {
  return (
    <aside className="auth-art gridbg">
          <div className="load1">
            <span className="label mono">
              <b>
                ●
              </b>
              {" "}Khám phá DISC
            </span>
            <h2>
              Kết quả của cả nhà
              <br />
              <span className="grad">
                đang chờ bạn
              </span>
            </h2>
            <p style={{margin: "10px 0 0", color: "var(--muted)", maxWidth: "460px"}} className="hide-auth-sm">
              Nhận bài về tài khoản để xem lại kết quả và lịch sử các lần làm bài.
            </p>
          </div>
          <div className="stage dstage" aria-hidden="true">
            <div className="dsheet">
              <div className="hd">
                <span>
                  Kết quả DISC · gia đình
                </span>
                <span className="tag dtag">
                  2 bài
                </span>
              </div>
              <div className="dbar" style={{"--f": "var(--fD)"} as CSSProperties}>
                <span className="dchip cD" style={{"--f": "var(--fD)", padding: "0", border: "0", background: "none", boxShadow: "none"} as CSSProperties}>
                  <b>
                    D
                  </b>
                </span>
                <span className="tr">
                  <i style={{width: "58%"}}></i>
                </span>
              </div>
              <div className="dbar" style={{"--f": "var(--fI)"} as CSSProperties}>
                <span className="dchip cI" style={{"--f": "var(--fI)", padding: "0", border: "0", background: "none", boxShadow: "none"} as CSSProperties}>
                  <b>
                    I
                  </b>
                </span>
                <span className="tr">
                  <i style={{width: "84%"}}></i>
                </span>
              </div>
              <div className="dbar" style={{"--f": "var(--fS)"} as CSSProperties}>
                <span className="dchip cS" style={{"--f": "var(--fS)", padding: "0", border: "0", background: "none", boxShadow: "none"} as CSSProperties}>
                  <b>
                    S
                  </b>
                </span>
                <span className="tr">
                  <i style={{width: "66%"}}></i>
                </span>
              </div>
              <div className="dbar" style={{"--f": "var(--fC)"} as CSSProperties}>
                <span className="dchip cC" style={{"--f": "var(--fC)", padding: "0", border: "0", background: "none", boxShadow: "none"} as CSSProperties}>
                  <b>
                    C
                  </b>
                </span>
                <span className="tr">
                  <i style={{width: "38%"}}></i>
                </span>
              </div>
            </div>
            <span className="dletter" style={{background: "var(--fD)", left: "62%", top: "0", animationDelay: "-1s"}}>
              D
            </span>
            <span className="dletter" style={{background: "var(--fI)", right: "2%", top: "22%", animationDelay: "-2.5s", color: "#241133"}}>
              I
            </span>
            <span className="dletter" style={{background: "var(--fS)", left: "36%", bottom: "2%", animationDelay: "-4s"}}>
              S
            </span>
            <span className="dletter" style={{background: "var(--fC)", left: "-2%", top: "0", animationDelay: "-3s"}}>
              C
            </span>
            <span className="dkey">
              <span className="ico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="7.5" cy="15.5" r="4.5"></circle>
                  <path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"></path>
                </svg>
              </span>
              K7M2N-QX4PB
            </span>
            <PubAnh className="dpose2" id="b09f648ab11d0579d24805fe838e0900" alt="" sizes="(max-width: 900px) 120px, 200px" />
          </div>
          <div className="hide-auth-sm" style={{display: "grid", gap: "18px"}}>
            <ul className="perks">
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  </svg>
                </span>
                <span>
                  Chỉ người xác minh được số điện thoại mới xem được kết quả
                </span>
              </li>
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"></path>
                  </svg>
                </span>
                <span>
                  Mã xác minh 6 chữ số gửi qua Zalo
                </span>
              </li>
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
                  </svg>
                </span>
                <span>
                  Kết quả của ba/mẹ và con nằm chung trong tài khoản phụ huynh
                </span>
              </li>
            </ul>
            <p style={{margin: "0", padding: "14px 16px", borderRadius: "14px", background: "var(--panel)", border: "1px solid var(--line)", fontSize: "14px", color: "var(--muted)"}}>
              Cần hỗ trợ? Nhắn Zalo 0837.312.860 – Sata Robo hướng dẫn ngay.
            </p>
          </div>
        </aside>
  );
}
