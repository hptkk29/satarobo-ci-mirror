import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { Linh3D } from "@/components/public/pub-design/linh-3d";

// Cột trái (`aside.auth-art`) của "Login" — CHÉP nguyên từ artifact; linh vật 3D chạy thật (viewer2.js), poster là giai đoạn chờ.
export function TranhDangNhap() {
  return (
    <aside className="auth-art gridbg">
          <div className="load1">
            <span className="label mono">
              <b>
                ●
              </b>
              {" "}Cổng phụ huynh & học viên
            </span>
            <h2>
              Mọi điều về hành trình
              <br />
              Robotics của con{" "}
              <span className="grad">
                ở một nơi
              </span>
            </h2>
            <p style={{margin: "10px 0 0", color: "var(--muted)", maxWidth: "460px"}} className="hide-auth-sm">
              Một tài khoản cho cả gia đình – xem lịch học, nhận xét của giáo viên và kết quả thi đấu.
            </p>
          </div>
          <div className="orbit" aria-hidden="true">
            <span className="ringline"></span>
            <span className="ringline r2"></span>
            <div className="spinner">
              <span className="sat s1">
                <PubAnh id="a666ac3e1e338d2186c3c7704b0fa511" alt="" aria-hidden="true"  sizes="(max-width: 900px) 30vw, 160px" />
              </span>
              <span className="sat s2">
                <PubAnh id="dbdef77fa2d35499f574fa1ec71acf88" alt="" aria-hidden="true"  sizes="(max-width: 900px) 30vw, 160px" />
              </span>
              <span className="sat s3">
                <PubAnh id="0f72f010d69f5bd7650a9e5a4f2a072a" alt="" aria-hidden="true"  sizes="(max-width: 900px) 30vw, 160px" />
              </span>
            </div>
            <Linh3D model="wave" className="center" baseYaw={-0.2} cameraZ={3.3}
              poster={{ id: "faf517459b9a7277f3119a2826f3ac7c", alt: "Linh vật 3D Sata Robo", sizes: "(max-width: 900px) 40vw, 300px", className: "float", style: {position: "absolute", left: "50%", top: "50%", translate: "-50% -50%", height: "auto", zIndex: "3", width: "46%"} }} />
          </div>
          <div className="hide-auth-sm" style={{display: "grid", gap: "18px"}}>
            <ul className="perks">
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 6v6l4 2"></path>
                  </svg>
                </span>
                <span>
                  Xem lịch học, điểm danh và nhận xét sau mỗi buổi
                </span>
              </li>
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M23 6l-9.5 9.5-5-5L1 18"></path>
                    <path d="M17 6h6v6"></path>
                  </svg>
                </span>
                <span>
                  Theo dõi tiến độ, dự án và kết quả thi đấu của con
                </span>
              </li>
              <li>
                <span className="ico" style={{width: "38px", height: "38px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                    <circle cx="12" cy="12" r="2.5"></circle>
                  </svg>
                </span>
                <span>
                  Thanh toán học phí, nhận thông báo qua Zalo
                </span>
              </li>
            </ul>
            <p style={{margin: "0", padding: "14px 16px", borderRadius: "14px", background: "var(--panel)", border: "1px solid var(--line)", fontSize: "14px", color: "var(--muted)"}}>
              “Sau mỗi buổi, ba mẹ nhận ngay nhận xét và ảnh con lắp robot.”
            </p>
          </div>
        </aside>
  );
}
