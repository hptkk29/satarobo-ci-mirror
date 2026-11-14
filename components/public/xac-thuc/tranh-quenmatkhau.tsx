import { Linh3D } from "@/components/public/pub-design/linh-3d";

// Cột trái (`aside.auth-art`) của "Forgot" — CHÉP nguyên từ artifact; linh vật 3D chạy thật (viewer2.js), poster là giai đoạn chờ.
export function TranhQuenMatKhau() {
  return (
    <aside className="auth-art gridbg">
          <div className="load1">
            <span className="label mono">
              <b>
                ●
              </b>
              {" "}Khôi phục tài khoản
            </span>
            <h2>
              Lấy lại mật khẩu
              <br />
              <span className="grad">
                trong 3 bước
              </span>
            </h2>
            <p style={{margin: "10px 0 0", color: "var(--muted)", maxWidth: "460px"}} className="hide-auth-sm">
              Xác minh bằng mã gửi về số điện thoại hoặc email đã đăng ký.
            </p>
          </div>
          <div className="stage" aria-hidden="true">
            <span className="lockring"></span>
            <span className="lockring r2"></span>
            <span className="lbadge" style={{left: "-4%", top: "10%"}}>
              <span className="ico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
                </svg>
              </span>
              Tài khoản
            </span>
            <span className="lbadge" style={{right: "-6%", top: "36%", animationDelay: "-1.5s"}}>
              <span className="ico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </span>
              Mã xác minh
            </span>
            <span className="lbadge" style={{left: "2%", bottom: "8%", animationDelay: "-3s"}}>
              <span className="ico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6z"></path>
                </svg>
              </span>
              Mật khẩu mới
            </span>
            <Linh3D model="wave" className="m3w" style={{position: "absolute", inset: "8%", zIndex: "3"}} baseYaw={-0.2} cameraZ={3.3}
              poster={{ id: "faf517459b9a7277f3119a2826f3ac7c", alt: "Linh vật 3D Sata Robo", sizes: "(max-width: 900px) 40vw, 300px", className: "float", style: {position: "absolute", left: "50%", top: "50%", translate: "-50% -50%", height: "auto", zIndex: "3", width: "46%"} }} />
          </div>
          <div className="hide-auth-sm" style={{display: "grid", gap: "18px"}}>
            <ul className="perks">
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
                  </svg>
                </span>
                <span>
                  Nhập số điện thoại hoặc email
                </span>
              </li>
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  </svg>
                </span>
                <span>
                  Xác minh bằng mã 6 số
                </span>
              </li>
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6z"></path>
                  </svg>
                </span>
                <span>
                  Đặt mật khẩu mới và đăng nhập
                </span>
              </li>
            </ul>
            <p style={{margin: "0", padding: "14px 16px", borderRadius: "14px", background: "var(--panel)", border: "1px solid var(--line)", fontSize: "14px", color: "var(--muted)"}}>
              Không còn dùng số cũ? Nhắn Zalo 0837.312.860 để được hỗ trợ xác minh.
            </p>
          </div>
        </aside>
  );
}
