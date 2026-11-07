import Image from "next/image";
import { DuongDan } from "@/components/blog/tin-tuc-khung";
import { FF } from "@/components/public/pub-fonts";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { Linh3D } from "@/components/public/pub-design/linh-3d";
import { TIEU_DE_THU_CHU_DONG } from "@/components/jobs/viec-lam-thuan";

// Các khối KHUNG của trang /tuyen-dung — chép từ Careers.dc.html (class, thẻ, style nội tuyến, hiệu ứng `.sv`/`.a-*`
// giữ như artifact; `fx.js` lo việc hiện dần). Server component; riêng linh vật 3D là client component `Linh3D`.

const ICON_GUI = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"></path>
  </svg>
);

export function linkGuiCv(email: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(TIEU_DE_THU_CHU_DONG)}`;
}

/**
 * Đầu trang. `anh` là ảnh thẻ nhân viên: mặc định ảnh của artifact, quản trị đổi được bằng khoá `hero-image-url`
 * của trang "tuyen-dung" (nên có thể là địa chỉ ngoài — dùng next/image trực tiếp với `sizes`).
 */
export function TuyenDungHero({ email, anh }: { email: string; anh: { src: string; alt: string } }) {
  return (
    <header className="subhero gridbg">
      <div className="glow" aria-hidden="true" style={{ width: "720px", height: "720px", right: "-160px", top: "-200px" }}></div>
      <div className="wrap subhero-grid">
        <div className="load2">
          <DuongDan muc={[{ ten: "Tuyển dụng" }]} />
          <span className="label mono">
            <b>●</b>{" "}
            Tuyển dụng
          </span>
          <h1>
            Gia nhập <span className="grad">Sata Robo</span>
          </h1>
          <p className="lead">Cùng xây dựng tương lai giáo dục Robotics tại Việt Nam – nơi đam mê công nghệ và giáo dục gặp nhau.</p>
          <div className="chips">
            <span className="chip">Team trẻ, năng động</span>
            <span className="chip">
              Lương + <b>KPI</b> + tháng 13
            </span>
            <span className="chip">
              Mentor <b>1-1</b>
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "26px" }}>
            <a href={linkGuiCv(email)} className="btn btn-acc">
              Gửi CV ngay
              {ICON_GUI}
            </a>
            <a href="#vi-tri" className="btn btn-line">
              Xem vị trí
            </a>
          </div>
        </div>
        <div className="hero-art load3">
          <div className="idcard">
            <Image src={anh.src} alt={anh.alt} width={769} height={768} sizes="(max-width: 860px) 45vw, 210px" quality={85} priority />
            <p style={{ margin: "8px 0 0", fontWeight: 700 }}>Bạn – Thành viên mới</p>
            <p className="mono" style={{ margin: "2px 0 0", fontSize: "10px", color: "var(--accT)" }}>
              SATA ROBO TEAM · 2026
            </p>
            <div className="bar"></div>
          </div>
          <span className="perk" style={{ left: "2%", top: "6%" }}>
            Thưởng <b>KPI</b>
          </span>
          <span className="perk" style={{ right: "4%", bottom: "13%", animationDelay: "-1.5s" }}>
            Lương <b>tháng 13</b>
          </span>
          <span className="perk" style={{ right: "18%", bottom: "2%", animationDelay: "-3s" }}>
            Mentor <b>1-1</b>
          </span>
          <Linh3D
            model="heart"
            className="m3w"
            style={{ left: "-4%", width: "54%", top: "10%", bottom: "-4%" }}
            pedestal
            cameraZ={3.6}
            scrollSpin
            lift={0.04}
            baseYaw={-0.2}
            poster={{
              id: "2e4a9309e1a6bfcb633b68ee102428e9",
              alt: "Linh vật 3D Sata Robo",
              sizes: "(max-width: 860px) 40vw, 200px",
              className: "float",
              style: { position: "absolute", left: "50%", top: "50%", translate: "-50% -50%", height: "auto", zIndex: 3, width: "70%" },
              priority: true,
            }}
          />
        </div>
      </div>
    </header>
  );
}

/** Đầu mục 2 cột dùng chung của trang tuyển dụng (`.head2` + nhãn `[số]` + sticker). */
export function DauMuc({
  so,
  nhan,
  tieuDe,
  tieuDeNhan,
  sticker,
  hieuUng,
}: {
  so: string;
  nhan: string;
  tieuDe: string;
  tieuDeNhan: string;
  sticker: string;
  hieuUng: "a-mask" | "a-blur";
}) {
  return (
    <div className={`head2 sv ${hieuUng}`}>
      <div>
        <span className="label mono">
          <b>[{so}]</b>{" "}
          {nhan}
        </span>
        <h2>
          {tieuDe} <span className="grad">{tieuDeNhan}</span>
        </h2>
      </div>
      <span></span>
      <PubAnh id={sticker} className="sticker bob hide-sm" alt="" aria-hidden="true" style={{ right: "0", top: "-124px", width: "112px", height: "auto" }} sizes="112px" />
    </div>
  );
}

const ICON_PROPS = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const LY_DO = [
  {
    ten: "Văn hoá tích cực",
    moTa: "Team trẻ, năng động, học hỏi liên tục.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
      </svg>
    ),
  },
  {
    ten: "Lương cạnh tranh",
    moTa: "Lương cứng + thưởng KPI + lương tháng 13.",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="2" y="6" width="20" height="12" rx="2"></rect>
        <circle cx="12" cy="12" r="2.5"></circle>
      </svg>
    ),
  },
  {
    ten: "Đào tạo bài bản",
    moTa: "Mentor 1-1 và ngân sách cho học liệu.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"></path>
        <path d="M6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5"></path>
      </svg>
    ),
  },
  {
    ten: "Lộ trình thăng tiến",
    moTa: "Đánh giá năng lực rõ ràng, minh bạch.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M23 6l-9.5 9.5-5-5L1 18"></path>
        <path d="M17 6h6v6"></path>
      </svg>
    ),
  },
] as const;

export function LyDoChon() {
  return (
    <section className="sec">
      <div className="wrap">
        <DauMuc so="01" nhan="Vì sao chọn Sata Robo" tieuDe="Làm việc ở đây" tieuDeNhan="thế nào?" sticker="42d4d66e4311582de0d03b3122bb7b04" hieuUng="a-mask" />
        <div className="g4">
          {LY_DO.map((l, i) => (
            <article key={l.ten} className={`card lift sv ${i > 0 ? `d${i + 1}` : ""} a-flip`} style={{ padding: "22px", gap: "10px" }}>
              <span className="ico">{l.icon}</span>
              <h3>{l.ten}</h3>
              <p style={{ margin: "0", color: "var(--muted)" }}>{l.moTa}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Khối "Không thấy vị trí phù hợp?" ngay dưới danh sách. */
export function GuiCvChuDong({ email }: { email: string }) {
  return (
    <div className="card sv a-blur" style={{ marginTop: "22px", padding: "20px 24px", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
      <p style={{ margin: "0" }}>
        <b>Không thấy vị trí phù hợp? </b>
        <span style={{ color: "var(--muted)" }}>
          Gửi CV chủ động – tiêu đề: <b style={{ color: "var(--text)" }}>{TIEU_DE_THU_CHU_DONG}</b>
        </span>
      </p>
      <a href={linkGuiCv(email)} className="btn btn-line" style={{ minHeight: "44px" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2"></rect>
          <path d="M22 6l-10 7L2 6"></path>
        </svg>
        {email}
      </a>
    </div>
  );
}

const BUOC = [
  { so: "01", ten: "Chọn vị trí & nộp hồ sơ", moTa: (email: string) => `Bấm vào vị trí để xem chi tiết rồi gửi CV về ${email}.` },
  { so: "02", ten: "Nhân sự xem hồ sơ", moTa: () => "Bộ phận Nhân sự xem hồ sơ và liên hệ khi có vị trí phù hợp." },
  { so: "03", ten: "Phỏng vấn & dạy thử", moTa: () => "Trao đổi trực tiếp tại cơ sở; vị trí giáo viên có thêm buổi dạy thử." },
] as const;

export function CachUngTuyen({ email }: { email: string }) {
  return (
    <section className="sec">
      <div className="wrap">
        <DauMuc so="03" nhan="Cách ứng tuyển" tieuDe="3 bước" tieuDeNhan="đơn giản" sticker="a8d293a9efc52ad97026bd2d0dc02db2" hieuUng="a-mask" />
        <div className="g3">
          {BUOC.map((b, i) => (
            <div key={b.so} className={`card sv ${i > 0 ? `d${i + 1}` : ""} a-slideR`} style={{ padding: "22px", gap: "8px" }}>
              <span className="num-big grad">{b.so}</span>
              <h3>{b.ten}</h3>
              <p style={{ margin: "0", color: "var(--muted)" }}>{b.moTa(email)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const ANH_MOT_NGAY = [
  { id: "029a284702854cdb0fb142cbce5bc3fb", alt: "Lớp học Robotics", lop: "zoom sv  a-tilt big", sizes: "(max-width: 860px) 100vw, 600px" },
  { id: "13da897c33250d37f7f5ee9047ef2b1b", alt: "Phòng Lab", lop: "zoom sv d2 a-tilt ", sizes: "(max-width: 860px) 50vw, 300px" },
  { id: "fb9cb7b939b33ebb33a07455f5e11eca", alt: "Học viên cùng giáo viên", lop: "zoom sv d3 a-tilt ", sizes: "(max-width: 860px) 50vw, 300px" },
  { id: "8fc7aaf0088b11dee2ad657e3688f291", alt: "Cùng lập trình", lop: "zoom sv d4 a-tilt ", sizes: "(max-width: 860px) 50vw, 300px" },
  { id: "115b2c0af08632a373b177181586bc33", alt: "Chuẩn bị thi đấu", lop: "zoom sv d4 a-tilt ", sizes: "(max-width: 860px) 50vw, 300px" },
] as const;

export function MotNgayOSata() {
  return (
    <section className="sec gridbg" style={{ backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
      <div className="wrap">
        <DauMuc so="04" nhan="Một ngày ở Sata Robo" tieuDe="Nơi đam mê công nghệ" tieuDeNhan="gặp giáo dục" sticker="9befff8c7810fdf04d94f687c7c23e67" hieuUng="a-blur" />
        <div className="mosaic">
          {ANH_MOT_NGAY.map((a) => (
            <figure key={a.id} className={a.lop.trim()} style={{ margin: "0", borderRadius: "16px", overflow: "hidden" }}>
              <PubAnh id={a.id} alt={a.alt} style={{ width: "100%", height: "100%", objectFit: "cover" }} sizes={a.sizes} />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaTuyenDung({ email }: { email: string }) {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="cta-band sv a-iris">
          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <PubAnh id="3d425f2a2c063a1916225676ca19f4f4" className="bob" alt="" aria-hidden="true" style={{ height: "auto", width: "96px", flexShrink: 0, filter: "drop-shadow(0 12px 16px rgba(0,0,0,.35))" }} sizes="96px" />
            <div>
              <p style={{ margin: "0", fontFamily: FF.unbounded, fontWeight: 600, fontSize: "clamp(19px,2vw,26px)" }}>Sẵn sàng đồng hành cùng những kỹ sư nhí?</p>
              <p style={{ margin: "6px 0 0", color: "#f3e4ff" }}>Gửi CV về {email} – chúng tôi phản hồi khi có vị trí phù hợp.</p>
            </div>
          </div>
          <a href={linkGuiCv(email)} className="btn btn-acc">
            Gửi CV ngay
          </a>
        </div>
      </div>
    </section>
  );
}
