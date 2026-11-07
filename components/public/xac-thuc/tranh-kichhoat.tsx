import { Linh3D } from "@/components/public/pub-design/linh-3d";

// Cột trái (`aside.auth-art`) của "Activate" — CHÉP nguyên từ artifact; linh vật 3D chạy thật (viewer2.js), poster là giai đoạn chờ.
export function TranhKichHoat() {
  return (
    <aside className="auth-art gridbg">
          <div className="load1">
            <span className="label mono">
              <b>
                ●
              </b>
              {" "}Bước cuối cùng
            </span>
            <h2>
              Chỉ còn một bước
              <br />
              <span className="grad">
                là xong rồi!
              </span>
            </h2>
            <p style={{margin: "10px 0 0", color: "var(--muted)", maxWidth: "460px"}} className="hide-auth-sm">
              Mã kích hoạt giúp bảo vệ tài khoản và thông tin của con.
            </p>
          </div>
          <div className="stage" aria-hidden="true">
            <div className="phone">
              <span className="mono" style={{fontSize: "10px", color: "var(--muted)", textAlign: "center"}}>
                Zalo · Sata Robo
              </span>
              <div className="bubble">
                Xin chào ba mẹ! Mã kích hoạt tài khoản Sata Robo là:
                <div className="code">
                  <i>
                    4
                  </i>
                  <i>
                    8
                  </i>
                  <i>
                    2
                  </i>
                  <i>
                    9
                  </i>
                  <i>
                    1
                  </i>
                  <i>
                    6
                  </i>
                </div>
              </div>
              <div className="bubble" style={{animationDelay: ".9s"}}>
                Mã có hiệu lực trong 5 phút. Không chia sẻ mã cho bất kỳ ai.
              </div>
              <div className="bubble me" style={{animationDelay: "1.4s"}}>
                Đã nhận, cảm ơn!
              </div>
            </div>
            <Linh3D model="gift" className="m3w" style={{position: "absolute", left: "-10%", width: "64%", top: "6%", bottom: "-4%", zIndex: "3"}} baseYaw={-0.2} cameraZ={3.3}
              poster={{ id: "09822f256fe47024e33331af8e3a0ea5", alt: "Linh vật 3D Sata Robo", sizes: "(max-width: 900px) 40vw, 300px", className: "float", style: {position: "absolute", left: "50%", top: "50%", translate: "-50% -50%", height: "auto", zIndex: "3", width: "46%"} }} />
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
                  Mã chỉ dùng một lần, hết hạn sau 5 phút
                </span>
              </li>
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"></path>
                  </svg>
                </span>
                <span>
                  Nhận mã qua Zalo, SMS hoặc email
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
                  Không chia sẻ mã cho bất kỳ ai, kể cả nhân viên
                </span>
              </li>
            </ul>
            <p style={{margin: "0", padding: "14px 16px", borderRadius: "14px", background: "var(--panel)", border: "1px solid var(--line)", fontSize: "14px", color: "var(--muted)"}}>
              Gặp khó khăn? Nhắn Zalo 0837.312.860 – Sata Robo hỗ trợ ngay.
            </p>
          </div>
        </aside>
  );
}
