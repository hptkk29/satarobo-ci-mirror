import Image from "next/image";
import Link from "next/link";
import { SATA_ROBO_CONTACT, SATA_ROBO_PHONE } from "@/lib/locations";
import { FF } from "@/components/public/pub-fonts";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { Linh3D } from "@/components/public/pub-design/linh-3d";
import type { TinTucItem } from "@/components/blog/tin-tuc-thuan";
import { baiChoFeed } from "@/components/blog/tin-tuc-thuan";
import { ChipChuyenMuc } from "@/components/blog/tin-tuc-chip";

// Các khối KHUNG của trang Tin tức (chép từ News.dc.html / NewsDetail.dc.html — class, thẻ, style nội tuyến
// giữ nguyên). Server component; riêng linh vật 3D là client component `Linh3D`.

/** Dấu vết trang (`nav.crumb`): mục cuối là trang hiện tại, các mục trước là liên kết. */
export function DuongDan({ muc, lop = "" }: { muc: { ten: string; href?: string }[]; lop?: string }) {
  return (
    <nav className={`crumb${lop ? ` ${lop}` : ""}`} aria-label="Breadcrumb">
      <Link href="/">Trang chủ</Link>
      {muc.map((m, i) => (
        <span key={`${i}-${m.ten}`} style={{ display: "contents" }}>
          <span aria-hidden="true">/</span>
          {m.href && i < muc.length - 1 ? <Link href={m.href}>{m.ten}</Link> : <span aria-current="page">{m.ten}</span>}
        </span>
      ))}
    </nav>
  );
}

/**
 * Đầu trang danh sách / chuyên mục / thẻ (`header.subhero`). Khác artifact có chủ ý, vì DỮ LIỆU THẬT:
 *  - `chips`: chuyên mục có bài thật — chuyên mục trùng nhãn thiết kế đứng đầu theo thứ tự thiết kế (xem
 *    `chuyenMucCoBai`); chip là liên kết lọc chuyên mục (`ChipChuyenMuc`);
 *  - `feed`: 3 bài mới nhất THẬT (ảnh bìa nếu có, không có thì khung `var(--band)` + logo; ít hơn 3 thì đủ số có;
 *    không bài nào thì ẩn cả khối thẻ nổi + huy hiệu "MỚI").
 */
export function TinTucHero({
  duongDan,
  nhan,
  tieuDe,
  tieuDeNhan,
  moTa,
  chips,
  feed,
}: {
  duongDan: { ten: string; href?: string }[];
  nhan: string;
  tieuDe: string;
  tieuDeNhan: string;
  moTa: string;
  chips?: { khoa: string; nhan: string }[];
  feed?: TinTucItem[];
}) {
  const baiFeed = feed ? baiChoFeed(feed) : [];
  return (
    <header className="subhero gridbg">
      <div className="glow" aria-hidden="true" style={{ width: "720px", height: "720px", right: "-160px", top: "-200px" }}></div>
      <div className="wrap subhero-grid">
        <div className="load2">
          <DuongDan muc={duongDan} />
          <span className="label mono">
            <b>●</b>{" "}
            {nhan}
          </span>
          <h1>
            {tieuDe} <span className="grad">{tieuDeNhan}</span>
          </h1>
          <p className="lead">{moTa}</p>
          {chips && chips.length > 0 && (
            <div className="chips">
              {chips.map((c) => (
                <ChipChuyenMuc key={c.khoa} khoa={c.khoa}>
                  {c.nhan}
                </ChipChuyenMuc>
              ))}
            </div>
          )}
        </div>
        <div className="hero-art load3">
          {baiFeed.length > 0 && (
            <>
              <span className="live">MỚI</span>
              <div className="feed">
                {baiFeed.map((p) => (
                  <Link key={p.slug} href={`/tin-tuc/${p.slug}`} className="fcard" style={{ textDecoration: "none", color: "inherit" }}>
                    {p.coverImage ? (
                      <Image src={p.coverImage} alt="" width={124} height={124} sizes="62px" />
                    ) : (
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "62px", height: "62px", borderRadius: "10px", background: "var(--band)", flexShrink: 0 }}>
                        <PubAnh id="7f3174f1b3c85f9cd78c9295c2624fe4" alt="" aria-hidden="true" sizes="36px" style={{ width: "36px", height: "36px", borderRadius: "999px", objectFit: "contain" }} />
                      </span>
                    )}
                    <span>
                      {p.category && <small>{p.category}</small>}
                      <strong>{p.title}</strong>
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
          <Linh3D
            model="wave"
            className="m3w"
            style={{ left: "-8%", width: "54%", top: "14%", bottom: "-6%" }}
            pedestal
            cameraZ={3.6}
            scrollSpin
            lift={0.04}
            baseYaw={-0.2}
            poster={{
              id: "faf517459b9a7277f3119a2826f3ac7c",
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

/** Tên hiển thị của kênh từ URL: "facebook.com/satarobo", "@satarobo". */
export function tenHienThiKenh(url: string): string {
  try {
    const u = new URL(url);
    const duoi = u.pathname.replace(/^\/+|\/+$/g, "");
    if (duoi.startsWith("@")) return duoi;
    return `${u.hostname.replace(/^www\./, "")}/${duoi}`;
  } catch {
    return url;
  }
}

const DUONG_VE = {
  facebook:
    "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  youtube:
    "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  zalo: "M12.49 10.2722v-.4496h1.3467v6.3218h-.7704a.576.576 0 01-.5763-.5729l-.0006.0005a3.273 3.273 0 01-1.9372.6321c-1.8138 0-3.2844-1.4697-3.2844-3.2823 0-1.8125 1.4706-3.2822 3.2844-3.2822a3.273 3.273 0 011.9372.6321l.0006.0005zM6.9188 7.7896v.205c0 .3823-.051.6944-.2995 1.0605l-.03.0343c-.0542.0615-.1815.206-.2421.2843L2.024 14.8h4.8948v.7682a.5764.5764 0 01-.5767.5761H0v-.3622c0-.4436.1102-.6414.2495-.8476L4.8582 9.23H.1922V7.7896h6.7266zm8.5513 8.3548a.4805.4805 0 01-.4803-.4798v-7.875h1.4416v8.3548H15.47zM20.6934 9.6C22.52 9.6 24 11.0807 24 12.9044c0 1.8252-1.4801 3.306-3.3066 3.306-1.8264 0-3.3066-1.4808-3.3066-3.306 0-1.8237 1.4802-3.3044 3.3066-3.3044zm-10.1412 5.253c1.0675 0 1.9324-.8645 1.9324-1.9312 0-1.065-.865-1.9295-1.9324-1.9295s-1.9324.8644-1.9324 1.9295c0 1.0667.865 1.9312 1.9324 1.9312zm10.1412-.0033c1.0737 0 1.945-.8707 1.945-1.9453 0-1.073-.8713-1.9436-1.945-1.9436-1.0753 0-1.945.8706-1.945 1.9436 0 1.0746.8697 1.9453 1.945 1.9453z",
} as const;

const KENH = [
  {
    ten: "Facebook",
    href: SATA_ROBO_CONTACT.facebook,
    hienThi: tenHienThiKenh(SATA_ROBO_CONTACT.facebook),
    mau: "#0866ff",
    moTa: "Ảnh lớp học, lịch khai giảng, sự kiện",
    duongVe: DUONG_VE.facebook,
  },
  {
    ten: "YouTube",
    href: SATA_ROBO_CONTACT.youtube,
    hienThi: tenHienThiKenh(SATA_ROBO_CONTACT.youtube),
    mau: "#ff0000",
    moTa: "Video thuyết trình, giải đề RoboSim",
    duongVe: DUONG_VE.youtube,
  },
  {
    ten: "Zalo",
    href: SATA_ROBO_PHONE.zalo,
    hienThi: SATA_ROBO_PHONE.hien,
    mau: "#0068ff",
    moTa: "Nhận tin ưu đãi & lịch học thử",
    duongVe: DUONG_VE.zalo,
  },
] as const;

/** Khối [02] "Theo dõi Sata Robo": liên kết kênh lấy từ hằng của repo (không gõ tay URL/số). */
export function TheoDoiSata() {
  return (
    <section className="sec gridbg" style={{ backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
      <div className="wrap">
        <div className="head2 sv a-blur">
          <div>
            <span className="label mono">
              <b>[02]</b>{" "}
              Theo dõi Sata Robo
            </span>
            <h2>
              Không bỏ lỡ <span className="grad">tin mới</span>
            </h2>
          </div>
          <p>Lịch khai giảng, ưu đãi và kết quả thi đấu được cập nhật trên các kênh chính thức.</p>
          <PubAnh id="ae64602080af6eeebb18341c8404c4e4" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{ right: "0", top: "-124px", width: "112px", height: "auto" }} sizes="112px" />
        </div>
        <div className="g3">
          {KENH.map((k, i) => (
            <a
              key={k.ten}
              href={k.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`card lift soc-card sv ${i > 0 ? `d${i + 1}` : ""} a-pop`}
              style={{ ["--brand" as string]: k.mau, padding: "22px", gap: "10px", textDecoration: "none", color: "var(--text)" }}
              aria-label={`${k.ten} Sata Robo (mở tab mới)`}
            >
              <span className="soc-ico" style={{ background: k.mau }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true" focusable="false">
                  <path d={k.duongVe}></path>
                </svg>
              </span>
              <strong style={{ fontSize: "17px" }}>{k.ten}</strong>
              <span className="mono" style={{ fontSize: "12px", color: "var(--accT)" }}>
                {k.hienThi}
              </span>
              <span style={{ color: "var(--muted)", fontSize: "14px" }}>{k.moTa}</span>
              <span className="soc-go" aria-hidden="true">
                Theo dõi →
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Dải CTA cuối trang. "Đặt học thử" = liên kết tới form thật (như header / nút nổi), không mở popup. */
export function CtaDocXong({ tieuDe }: { tieuDe: string }) {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="cta-band sv a-iris">
          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <PubAnh id="da847c40d631e0b7a535a73c3172ac50" className="bob" alt="" aria-hidden="true" style={{ width: "96px", height: "auto", flexShrink: 0, filter: "drop-shadow(0 12px 16px rgba(0,0,0,.35))" }} sizes="96px" />
            <div>
              <p style={{ margin: "0", fontFamily: FF.unbounded, fontWeight: 600, fontSize: "clamp(19px,2vw,26px)", lineHeight: 1.3 }}>{tieuDe}</p>
              <p style={{ margin: "6px 0 0", color: "#f3e4ff" }}>Buổi học thử 1-1 miễn phí – con tự lắp 1 robot và cho nó chạy.</p>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <Link href="/lien-he?free-trial=true" className="btn btn-acc">
              Đặt buổi học thử miễn phí
            </Link>
            <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" className="btn" style={{ background: "rgba(255,255,255,.12)", color: "#fff", border: "1.5px solid rgba(255,255,255,.4)" }}>
              Chat Zalo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
