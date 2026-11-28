import type { CSSProperties } from "react";
import Link from "next/link";
import { FF } from "@/components/public/pub-fonts";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { Linh3D } from "@/components/public/pub-design/linh-3d";
import { LienHeForm } from "@/components/public/lien-he-form";
import { CAU_PHAN_HOI, GIO_LAM_VIEC } from "@/components/public/gio-lam-viec";
import { SATA_ROBO_CONTACT, SATA_ROBO_PHONE, operationalLocations } from "@/lib/locations";
import { duongDanBanDo, gioMoCua, nhanCoSo, tenCoSoNgan } from "@/components/public/gioi-thieu/co-so-thuan";

// Trang Liên hệ — CHÉP từ Contact.dc.html (class, thẻ, style nội tuyến, hiệu ứng giữ nguyên; `fx.js` lo hiện dần).
// Khác artifact có chủ ý (REPO THẮNG): số điện thoại, email, giờ làm việc, địa chỉ/phường từng cơ sở và liên kết
// mạng xã hội đọc từ `lib/locations` (artifact in 0837.812.860, info@, "8:00 – 21:00 · Thứ 3 – Chủ nhật").
// Khối biểu mẫu là `LienHeForm` (gửi lead thật, giữ nguyên logic).

const MO_TA_THEM: Record<string, string> = {
  CS2: "Ngay trung tâm quận Hải Châu.",
};

export function LienHeNoiDung() {
  const coSo = operationalLocations();
  const EMAIL = SATA_ROBO_CONTACT.emails.general;
  const GIO = gioMoCua(GIO_LAM_VIEC);
  return (
    <>
    <header className="subhero gridbg">
      <div className="glow" aria-hidden="true" style={{width: "720px", height: "720px", right: "-160px", top: "-200px"}}></div>
      <div className="wrap subhero-grid">
        <div className="load2">
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/">
              Trang chủ
            </Link>
            <span aria-hidden="true">
              /
            </span>
            <span aria-current="page">
              Liên hệ
            </span>
          </nav>
          <span className="label mono">
            <b>
              ●
            </b>
            {" "}
            Liên hệ Sata Robo
          </span>
          <h1>
            Ba mẹ cần tư vấn?
            <br />
            <span className="grad">
              Sata Robo gọi lại ngay
            </span>
          </h1>
          <p className="lead">
            {CAU_PHAN_HOI}. Chọn cách liên hệ thuận tiện nhất cho ba mẹ.
          </p>
          <div className="chips">
            <span className="chip">
              Zalo
              {" "}
              <b>
                {SATA_ROBO_PHONE.hien}
              </b>
            </span>
            <span className="chip">
              {EMAIL}
            </span>
          </div>
          <div style={{display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "26px"}}>
            <Link href="/lien-he?free-trial=true" className="btn btn-acc">
              Đặt buổi học thử 1-1 miễn phí
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17L17 7M8 7h9v9"></path>
              </svg>
            </Link>
            <a href={SATA_ROBO_PHONE.zalo} className="btn btn-line">
              Chat Zalo
            </a>
          </div>
        </div>
        <div className="hero-art load3">
          <div className="glow" aria-hidden="true" style={{width: "380px", height: "380px", left: "50%", top: "50%", margin: "-190px 0 0 -190px"}}></div>
          <Linh3D
            model="wave"
            className=""
            style={{ position: "absolute", inset: 0 }}
            cameraZ={4}
            scrollSpin
            lift={0}
            baseYaw={-0.2}
            poster={{
              id: "faf517459b9a7277f3119a2826f3ac7c",
              alt: "Linh vật 3D Sata Robo",
              sizes: "(max-width: 860px) 60vw, 350px",
              className: "float",
              style: { position: "absolute", left: "50%", top: "50%", translate: "-50% -50%", height: "auto", zIndex: 3, width: "70%" },
              priority: true,
            }}
          />
          <div className="chip" style={{position: "absolute", zIndex: "5", left: "0", top: "6%", boxShadow: "0 14px 30px var(--shadow)"}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"></path>
            </svg>
            Phản hồi trong
            {" "}
            <b>
              30 phút
            </b>
          </div>
          <div className="chip" style={{position: "absolute", zIndex: "5", right: "0", top: "44%", boxShadow: "0 14px 30px var(--shadow)"}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 6v6l4 2"></path>
            </svg>
            <b>
              {GIO}
            </b>
          </div>
          <div className="chip" style={{position: "absolute", zIndex: "5", left: "0", bottom: "4%", boxShadow: "0 14px 30px var(--shadow)"}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <b>
              {coSo.length} cơ sở
            </b>
            {" "}
            Đà Nẵng
          </div>
        </div>
      </div>
    </header>
    <section className="sec">
      <div className="wrap">
        <div className="head2 sv a-mask">
          <div>
            <span className="label mono">
              <b>
                [01]
              </b>
              {" "}
              Cách liên hệ
            </span>
            <h2>
              Chọn kênh
              {" "}
              <span className="grad">
                tiện nhất
              </span>
            </h2>
          </div>
          <span></span>
          <PubAnh id="faf517459b9a7277f3119a2826f3ac7c" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-124px", width: "112px", height: "auto"}} sizes="112px" />
        </div>
        <div className="g3">
          <a href={SATA_ROBO_PHONE.zalo} className="card lift sv  a-pop" style={{padding: "22px", gap: "8px", textDecoration: "none", color: "var(--text)"}}>
            <span className="ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"></path>
              </svg>
            </span>
            <span className="mono" style={{fontSize: "11px", color: "var(--muted)"}}>
              Chat Zalo
            </span>
            <strong style={{fontSize: "19px"}}>
              {SATA_ROBO_PHONE.hien}
            </strong>
            <span style={{color: "var(--muted)", fontSize: "14px"}}>
              Nhanh nhất – tư vấn & đặt lịch học thử
            </span>
          </a>
          <a href="#dang-ky" className="card lift sv d2 a-pop" style={{padding: "22px", gap: "8px", textDecoration: "none", color: "var(--text)"}}>
            <span className="ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
              </svg>
            </span>
            <span className="mono" style={{fontSize: "11px", color: "var(--muted)"}}>
              Giờ làm việc
            </span>
            <strong style={{fontSize: "19px"}}>
              {GIO}
            </strong>
            <span style={{color: "var(--muted)", fontSize: "14px"}}>
              {coSo.length} cơ sở Đà Nẵng
            </span>
          </a>
          <a href={`mailto:${EMAIL}`} className="card lift sv d3 a-pop" style={{padding: "22px", gap: "8px", textDecoration: "none", color: "var(--text)"}}>
            <span className="ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                <path d="M22 6l-10 7L2 6"></path>
              </svg>
            </span>
            <span className="mono" style={{fontSize: "11px", color: "var(--muted)"}}>
              Email
            </span>
            <strong style={{fontSize: "19px"}}>
              {EMAIL}
            </strong>
            <span style={{color: "var(--muted)", fontSize: "14px"}}>
              Hợp tác, hoá đơn, góp ý
            </span>
          </a>
        </div>
      </div>
    </section>
    {/* <section id="dang-ky"> do chính LienHeForm vẽ (logic gửi lead giữ nguyên). */}
    <LienHeForm variant="page" />
    <section className="sec">
      <div className="wrap">
        <div className="head2 sv a-mask">
          <div>
            <span className="label mono">
              <b>
                [03]
              </b>
              {" "}
              Tìm cơ sở gần nhà
            </span>
            <h2>
              {coSo.length} cơ sở tại
              {" "}
              <span className="grad">
                Đà Nẵng
              </span>
            </h2>
          </div>
          <span></span>
          <PubAnh id="ae64602080af6eeebb18341c8404c4e4" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-124px", width: "112px", height: "auto"}} sizes="112px" />
        </div>
        <div className="g2">
          {coSo.map((loc, i) => {
            const ten = `Sata Robo ${tenCoSoNgan(loc.name)}`;
            const moTa = loc.note ?? MO_TA_THEM[loc.code];
            return (
              <article key={loc.id} className={`card sv ${i === 1 ? "d2" : ""} a-slideR`} style={{padding: "0", gap: "0"}}>
                <div className="map" aria-hidden="true">
                  <span className="road" style={{left: "-10%", top: "58%", width: "120%", height: "14px", rotate: "-8deg"}}></span>
                  <span className="road" style={{left: "38%", top: "-10%", width: "12px", height: "130%", rotate: "12deg"}}></span>
                  <span className="road" style={{left: "-10%", top: "22%", width: "70%", height: "8px", rotate: "6deg", opacity: ".6"}}></span>
                  <span className="pin"></span>
                  <span className="mono" style={{position: "absolute", left: "14px", top: "14px", background: "#fe8f2d", color: "#241133", padding: "5px 10px", borderRadius: "8px", fontSize: "12px"}}>
                    {nhanCoSo(loc.code)}
                  </span>
                </div>
                <div style={{padding: "22px", display: "grid", gap: "10px"}}>
                  <h3>{ten}</h3>
                  <p style={{margin: "0", display: "flex", gap: "10px", color: "var(--muted)"}}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <span>
                      {loc.address}{" "}
                      <span style={{opacity: ".8"}}>({loc.district})</span>
                    </span>
                  </p>
                  <p style={{margin: "0", display: "flex", gap: "10px", color: "var(--muted)"}}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10"></circle>
                      <path d="M12 6v6l4 2"></path>
                    </svg>
                    <span>{gioMoCua(loc.workingHours)}</span>
                  </p>
                  {moTa ? <p style={{margin: "0", fontSize: "14px"}}>{moTa}</p> : null}
                  <a href={duongDanBanDo(loc.address)} target="_blank" rel="noopener noreferrer" className="btn btn-acc" style={{justifySelf: "start", minHeight: "44px"}}>
                    Chỉ đường Google Maps
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M7 17L17 7M8 7h9v9"></path>
                    </svg>
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
    <section className="sec">
      <div className="wrap">
        <div className="cta-band sv a-iris">
          <div style={{display: "flex", alignItems: "center", gap: "18px"}}>
            <PubAnh id="9befff8c7810fdf04d94f687c7c23e67" className="bob" alt="" aria-hidden="true" style={{height: "auto", width: "100px", flexShrink: "0", filter: "drop-shadow(0 12px 16px rgba(0,0,0,.35))"}} sizes="100px" />
            <div>
              <p style={{margin: "0", fontFamily: FF.unbounded, fontWeight: "600", fontSize: "clamp(19px,2vw,26px)"}}>
                Kết nối với Sata Robo
              </p>
              <p style={{margin: "6px 0 0", color: "#f3e4ff"}}>
                Theo dõi để nhận lịch khai giảng, ưu đãi và kết quả thi đấu.
              </p>
            </div>
          </div>
          <div style={{display: "flex", flexWrap: "wrap", gap: "10px"}}>
            <a href={SATA_ROBO_CONTACT.facebook} target="_blank" rel="noopener" className="btn soc-btn" aria-label="Facebook Sata Robo (mở tab mới)" style={{...({"--brand": "#0866ff"} as CSSProperties), background: "#0866ff", color: "#fff", minWidth: "140px", gap: "10px"}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true" focusable="false">
                <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"></path>
              </svg>
              Facebook
            </a>
            <a href={SATA_ROBO_CONTACT.youtube} target="_blank" rel="noopener" className="btn soc-btn" aria-label="YouTube Sata Robo (mở tab mới)" style={{...({"--brand": "#ff0000"} as CSSProperties), background: "#ff0000", color: "#fff", minWidth: "140px", gap: "10px"}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true" focusable="false">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"></path>
              </svg>
              YouTube
            </a>
            <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener" className="btn soc-btn" aria-label="Zalo Sata Robo (mở tab mới)" style={{...({"--brand": "#0068ff"} as CSSProperties), background: "#0068ff", color: "#fff", minWidth: "140px", gap: "10px"}}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true" focusable="false">
                <path d="M12.49 10.2722v-.4496h1.3467v6.3218h-.7704a.576.576 0 01-.5763-.5729l-.0006.0005a3.273 3.273 0 01-1.9372.6321c-1.8138 0-3.2844-1.4697-3.2844-3.2823 0-1.8125 1.4706-3.2822 3.2844-3.2822a3.273 3.273 0 011.9372.6321l.0006.0005zM6.9188 7.7896v.205c0 .3823-.051.6944-.2995 1.0605l-.03.0343c-.0542.0615-.1815.206-.2421.2843L2.024 14.8h4.8948v.7682a.5764.5764 0 01-.5767.5761H0v-.3622c0-.4436.1102-.6414.2495-.8476L4.8582 9.23H.1922V7.7896h6.7266zm8.5513 8.3548a.4805.4805 0 01-.4803-.4798v-7.875h1.4416v8.3548H15.47zM20.6934 9.6C22.52 9.6 24 11.0807 24 12.9044c0 1.8252-1.4801 3.306-3.3066 3.306-1.8264 0-3.3066-1.4808-3.3066-3.306 0-1.8237 1.4802-3.3044 3.3066-3.3044zm-10.1412 5.253c1.0675 0 1.9324-.8645 1.9324-1.9312 0-1.065-.865-1.9295-1.9324-1.9295s-1.9324.8644-1.9324 1.9295c0 1.0667.865 1.9312 1.9324 1.9312zm10.1412-.0033c1.0737 0 1.945-.8707 1.945-1.9453 0-1.073-.8713-1.9436-1.945-1.9436-1.0753 0-1.945.8706-1.945 1.9436 0 1.0746.8697 1.9453 1.945 1.9453z"></path>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </section>
    </>
  );
}
