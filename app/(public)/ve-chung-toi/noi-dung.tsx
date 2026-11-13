import Link from "next/link";
import { FF } from "@/components/public/pub-fonts";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { Linh3D } from "@/components/public/pub-design/linh-3d";
import { SATA_ROBO_CONTACT, SATA_ROBO_PHONE, operationalLocations } from "@/lib/locations";
import { THONG_TIN_THEM_CO_SO, duongDanBanDo, gioMoCua, nhanCoSo, tenCoSoNgan } from "@/components/public/gioi-thieu/co-so-thuan";

// Trang Về chúng tôi — CHÉP từ About.dc.html (class, thẻ, style nội tuyến, hiệu ứng giữ nguyên; `fx.js` lo hiện dần).
// Khác artifact có chủ ý (REPO THẮNG): khối "N cơ sở" đọc địa chỉ/giờ/phường từ `lib/locations`; khung pháp nhân
// in "Mã số doanh nghiệp … cấp ngày …" và "Địa chỉ" (không gắn nhãn "Trụ sở" — hồ sơ BCT cấm, và 211 Nguyễn Hữu Thọ
// là địa chỉ kinh doanh, không phải trụ sở đăng ký).

export function VeChungToiNoiDung() {
  const coSo = operationalLocations();
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
              Về chúng tôi
            </span>
          </nav>
          <span className="label mono">
            <b>
              ●
            </b>
            {" "}
            Câu chuyện thương hiệu Sata Robo
          </span>
          <h1>
            Khơi nguồn sáng tạo –
            <br />
            <span className="grad">
              Chắp cánh tương lai
            </span>
          </h1>
          <p className="lead">
            Sata Robo là trung tâm đào tạo STEM – Lập trình Robotics & AI cho học sinh lớp 1–8 tại Đà Nẵng, thuộc hệ sinh thái giáo dục SataWorld.
          </p>
          <div className="chips">
            <span className="chip">
              <b>
                {coSo.length}
              </b>
              {" "}
              cơ sở Đà Nẵng
            </span>
            <span className="chip">
              <b>
                ≤12
              </b>
              {" "}
              học viên / lớp
            </span>
            <span className="chip">
              <b>
                2.000+
              </b>
              {" "}
              phụ huynh đồng hành
            </span>
            <span className="chip">
              Hệ sinh thái
              {" "}
              <b>
                SataWorld
              </b>
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
          <svg className="line-svg" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 4 Q50 22 100 4" fill="none" stroke="var(--line2)" strokeWidth="0.6"></path>
          </svg>
          <figure className="pola" style={{margin: "0", left: "6%", animationDelay: "-1.2s"}}>
            <PubAnh id="817119f3691f9cd172643974d8b5d84c" alt="Ảnh ngày hội tại Sata Robo" sizes="(max-width: 860px) 30vw, 150px" priority />
            <span>
              Ngày hội
            </span>
          </figure>
          <figure className="pola" style={{margin: "0", left: "36%", animationDelay: "-2.4s"}}>
            <PubAnh id="0e5b07ed475d8ff299cd1364c7d6c4f6" alt="Ảnh bạn bè tại Sata Robo" sizes="(max-width: 860px) 30vw, 150px" priority />
            <span>
              Bạn bè
            </span>
          </figure>
          <figure className="pola" style={{margin: "0", left: "66%", animationDelay: "0s"}}>
            <PubAnh id="f71e84fb731737f008e409125c96e7d5" alt="Ảnh đấu trường tại Sata Robo" sizes="(max-width: 860px) 30vw, 150px" priority />
            <span>
              Đấu trường
            </span>
          </figure>
          <Linh3D
            model="heart"
            className="m3w m3-about"
            style={{ left: "24%", right: "24%", top: "50%", bottom: "-6%" }}
            pedestal
            cameraZ={3.6}
            scrollSpin
            lift={0.04}
            baseYaw={-0.2}
            poster={{
              id: "2e4a9309e1a6bfcb633b68ee102428e9",
              alt: "Linh vật 3D Sata Robo",
              sizes: "(max-width: 860px) 40vw, 180px",
              className: "float",
              style: { position: "absolute", left: "50%", top: "50%", translate: "-50% -50%", height: "auto", zIndex: 3, width: "70%" },
              priority: true,
            }}
          />
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
              Câu chuyện của chúng tôi
            </span>
            <h2>
              Hành trình khơi mầm sáng tạo cho
              {" "}
              <span className="grad">
                thế hệ trẻ Việt Nam
              </span>
            </h2>
          </div>
          <span></span>
          <PubAnh id="7e643cba294434d8258e05d15f9c242c" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-124px", width: "112px", height: "auto"}} sizes="112px" />
        </div>
        <div className="g2" style={{alignItems: "center", gap: "clamp(20px,4vw,48px)"}}>
          <div className="sv a-curtain brk" style={{position: "relative", borderRadius: "22px", overflow: "hidden", minHeight: "380px"}}>
            <PubAnh id="f71e84fb731737f008e409125c96e7d5" alt="Hội trường thi đấu Robotics đông kín học sinh" style={{position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover"}} sizes="(max-width: 860px) 100vw, 560px" />
          </div>
          <div className="sv a-slideR" style={{display: "flex", flexDirection: "column", gap: "16px"}}>
            <p style={{margin: "0", fontFamily: FF.unbounded, fontWeight: "500", fontSize: "clamp(18px,1.6vw,23px)", lineHeight: "1.5"}}>
              “Trong mỗi đứa trẻ đều có một tiềm năng vô hạn, chỉ chờ được
              {" "}
              <span className="grad">
                khơi dậy
              </span>
              {" "}
              bằng tri thức và trải nghiệm thực tế.”
            </p>
            <p style={{margin: "0", color: "var(--muted)"}}>
              Nhiều học sinh vẫn học trong khuôn khổ lý thuyết khô khan, thiếu môi trường thực hành và sân chơi quốc tế. Sata Robo ra đời để lấp đầy khoảng trống đó:
            </p>
            <ul style={{margin: "0", padding: "0", listStyle: "none", display: "grid", gap: "10px"}}>
              <li style={{display: "flex", gap: "12px"}}>
                <span className="ico" style={{width: "36px", height: "36px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6z"></path>
                  </svg>
                </span>
                <span>
                  Chương trình Robotics & công nghệ sinh động, gắn liền với thực tiễn.
                </span>
              </li>
              <li style={{display: "flex", gap: "12px"}}>
                <span className="ico" style={{width: "36px", height: "36px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"></path>
                  </svg>
                </span>
                <span>
                  Tổ chức cuộc thi từ cấp trường đến quốc tế để con được cọ xát thật.
                </span>
              </li>
              <li style={{display: "flex", gap: "12px"}}>
                <span className="ico" style={{width: "36px", height: "36px"}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="6"></circle>
                    <circle cx="12" cy="12" r="2"></circle>
                  </svg>
                </span>
                <span>
                  Rèn tư duy logic, sáng tạo, tinh thần hợp tác và bản lĩnh hội nhập – đúng định hướng STEM.
                </span>
              </li>
            </ul>
            <p style={{margin: "6px 0 0", paddingLeft: "14px", borderLeft: "3px solid #fe8f2d", color: "var(--text)"}}>
              Gieo những hạt mầm trải nghiệm hôm nay, ngày mai sẽ nảy nở một thế hệ trẻ vững vàng hơn, sáng tạo hơn và nhân văn hơn.
            </p>
          </div>
        </div>
      </div>
    </section>
    <section className="sec gridbg" style={{backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)"}}>
      <div className="wrap">
        <div className="head2 sv a-blur">
          <div>
            <span className="label mono">
              <b>
                [02]
              </b>
              {" "}
              Định hướng
            </span>
            <h2>
              Tầm nhìn &
              {" "}
              <span className="grad">
                Sứ mệnh
              </span>
            </h2>
          </div>
          <p>
            Không chỉ dạy Robotics – Sata Robo xây dựng thế hệ trẻ tự tin, sáng tạo, gắn với sứ mệnh giáo dục quốc gia và tầm nhìn toàn cầu.
          </p>
          <PubAnh id="41d8957417d5d5794183fc0c6767039d" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-124px", width: "112px", height: "auto"}} sizes="112px" />
        </div>
        <div className="g2">
          <article className="sv a-flip" style={{borderRadius: "24px", padding: "clamp(24px,3vw,36px)", background: "var(--band)", color: "#fff", position: "relative", overflow: "hidden"}}>
            <span className="mono" style={{fontSize: "12px", color: "#ffd3a8"}}>
              Tầm nhìn · Vision
            </span>
            <p style={{margin: "14px 0 0", fontFamily: FF.unbounded, fontWeight: "500", fontSize: "clamp(18px,1.6vw,22px)", lineHeight: "1.5"}}>
              Trở thành đơn vị tiên phong trong lĩnh vực Robotics giáo dục, kiến tạo sân chơi quốc tế và nuôi dưỡng thế hệ trẻ Việt Nam trở thành công dân toàn cầu sáng tạo, nhân văn và tự tin hội nhập.
            </p>
            <PubAnh id="ae64602080af6eeebb18341c8404c4e4" className="float hide-sm" alt="" aria-hidden="true" style={{height: "auto", position: "absolute", right: "16px", bottom: "10px", width: "100px", opacity: ".95"}} sizes="100px" />
          </article>
          <article className="sv d2 a-flip" style={{borderRadius: "24px", padding: "clamp(24px,3vw,36px)", background: "var(--panel)", border: "1px solid var(--line2)", position: "relative", overflow: "hidden"}}>
            <span className="mono" style={{fontSize: "12px", color: "var(--accT)"}}>
              Sứ mệnh · Mission
            </span>
            <p style={{margin: "14px 0 0", fontFamily: FF.unbounded, fontWeight: "500", fontSize: "clamp(18px,1.6vw,22px)", lineHeight: "1.5"}}>
              Mang đến các giải pháp
              {" "}
              <span className="grad">
                học tập, trải nghiệm và thi đấu
              </span>
              {" "}
              Robotics hiện đại, gắn liền với thực tiễn – phát triển tư duy, khơi gợi đam mê sáng tạo và xây dựng thế hệ trẻ có trí tuệ, kỹ năng, bản lĩnh hội nhập quốc tế.
            </p>
          </article>
        </div>
      </div>
    </section>
    <section className="sec">
      <div className="wrap">
        <div className="head2 sv a-mask">
          <div>
            <span className="label mono">
              <b>
                [03]
              </b>
              {" "}
              4 giá trị cốt lõi
            </span>
            <h2>
              Điều chúng tôi
              {" "}
              <span className="grad">
                giữ vững
              </span>
              {" "}
              mỗi ngày
            </h2>
          </div>
          <span></span>
          <PubAnh id="2e4a9309e1a6bfcb633b68ee102428e9" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-124px", width: "112px", height: "auto"}} sizes="112px" />
        </div>
        <div className="g4">
          <article className="card lift sv  a-tilt" style={{padding: "22px", gap: "12px"}}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <span className="ico">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 16.5 5.8 21l2.4-7.3L2 9.2h7.6z"></path>
                </svg>
              </span>
              <span className="mono" style={{fontSize: "28px", color: "var(--line2)"}}>
                01
              </span>
            </div>
            <h3>
              Sáng tạo
            </h3>
            <span className="mono" style={{fontSize: "11px", color: "var(--accT)"}}>
              Innovation
            </span>
            <p style={{margin: "0", color: "var(--muted)", fontSize: "15px"}}>
              Không ngừng đổi mới phương pháp giáo dục và công nghệ học tập.
            </p>
          </article>
          <article className="card lift sv d2 a-tilt" style={{padding: "22px", gap: "12px"}}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <span className="ico">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
                </svg>
              </span>
              <span className="mono" style={{fontSize: "28px", color: "var(--line2)"}}>
                02
              </span>
            </div>
            <h3>
              Gắn kết
            </h3>
            <span className="mono" style={{fontSize: "11px", color: "var(--accT)"}}>
              Connection
            </span>
            <p style={{margin: "0", color: "var(--muted)", fontSize: "15px"}}>
              Xây dựng mối quan hệ bền chặt giữa học sinh, phụ huynh, giáo viên và đối tác giáo dục.
            </p>
          </article>
          <article className="card lift sv d3 a-tilt" style={{padding: "22px", gap: "12px"}}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <span className="ico">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </span>
              <span className="mono" style={{fontSize: "28px", color: "var(--line2)"}}>
                03
              </span>
            </div>
            <h3>
              Chính trực
            </h3>
            <span className="mono" style={{fontSize: "11px", color: "var(--accT)"}}>
              Integrity
            </span>
            <p style={{margin: "0", color: "var(--muted)", fontSize: "15px"}}>
              Cam kết minh bạch và trung thực trong mọi hoạt động.
            </p>
          </article>
          <article className="card lift sv d4 a-tilt" style={{padding: "22px", gap: "12px"}}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <span className="ico">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"></circle>
                  <circle cx="12" cy="12" r="6"></circle>
                  <circle cx="12" cy="12" r="2"></circle>
                </svg>
              </span>
              <span className="mono" style={{fontSize: "28px", color: "var(--line2)"}}>
                04
              </span>
            </div>
            <h3>
              Kỷ luật
            </h3>
            <span className="mono" style={{fontSize: "11px", color: "var(--accT)"}}>
              Discipline
            </span>
            <p style={{margin: "0", color: "var(--muted)", fontSize: "15px"}}>
              Rèn luyện tính tự giác và kiên trì trong học tập và làm việc.
            </p>
          </article>
        </div>
      </div>
    </section>
    <section className="sec gridbg" style={{backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)"}}>
      <div className="wrap">
        <div className="head2 sv a-mask">
          <div>
            <span className="label mono">
              <b>
                [04]
              </b>
              {" "}
              Đội ngũ sáng lập
            </span>
            <h2>
              Những người
              {" "}
              <span className="grad">
                đứng sau
              </span>
              {" "}
              Sata Robo
            </h2>
          </div>
          <span></span>
          <PubAnh id="ebf1d6a859c7f4a485c67c864da4ad4c" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-124px", width: "112px", height: "auto"}} sizes="112px" />
        </div>
        <blockquote className="sv a-blur" style={{margin: "0 0 28px", fontFamily: FF.unbounded, fontWeight: "500", fontSize: "clamp(20px,2vw,28px)", lineHeight: "1.4"}}>
          “AI làm phần lặp lại. Con người làm phần
          {" "}
          <span className="grad">
            tử tế.
          </span>
          ”
          {" "}
          <span style={{display: "block", marginTop: "8px", fontFamily: FF.grotesk, fontSize: "15px", color: "var(--muted)"}}>
            — Ông Hồ Đắc Phúc
          </span>
        </blockquote>
        <div className="g3">
          <article className="card sv  a-deal" style={{padding: "18px", gap: "14px"}}>
            <div style={{aspectRatio: "1/1", borderRadius: "16px", overflow: "hidden"}}>
              <PubAnh id="489df08e34c7798e26f6b4dab7d78f81" alt="Ông Hồ Đắc Phúc" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 12%"}} sizes="(max-width: 860px) 100vw, 340px" />
            </div>
            <div>
              <span className="tag">
                Nhà sáng lập
              </span>
              <h3 style={{marginTop: "10px"}}>
                Ông Hồ Đắc Phúc
              </h3>
              <p style={{margin: "4px 0 0", color: "var(--muted)", fontSize: "14px"}}>
                Founder SataWorld · Sáng lập & CEO Sata Robo
              </p>
            </div>
            <ul style={{margin: "0", paddingLeft: "18px", display: "grid", gap: "6px", fontSize: "14px"}}>
              <li>
                Founder hệ sinh thái SataWorld: 10 cơ sở Satamath, 2 cơ sở Sata Robo
              </li>
              <li>
                Cựu thành viên đội Robocon ĐH Bách khoa Đà Nẵng
              </li>
              <li>
                15 năm vận hành doanh nghiệp, 11 năm ngân hàng
              </li>
              <li>
                Quản trị doanh nghiệp bằng AI (AI-First)
              </li>
            </ul>
          </article>
          <article className="card sv d2 a-deal" style={{padding: "18px", gap: "14px"}}>
            <div style={{aspectRatio: "1/1", borderRadius: "16px", overflow: "hidden"}}>
              <PubAnh id="4209a2aaa97e9e1118e16cc04c820955" alt="Ông Phùng Ngọc Lợi" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 12%"}} sizes="(max-width: 860px) 100vw, 340px" />
            </div>
            <div>
              <span className="tag">
                Đồng sáng lập
              </span>
              <h3 style={{marginTop: "10px"}}>
                Ông Phùng Ngọc Lợi
              </h3>
              <p style={{margin: "4px 0 0", color: "var(--muted)", fontSize: "14px"}}>
                Đồng sáng lập Sata Robo · Sáng lập Satamath
              </p>
            </div>
            <ul style={{margin: "0", paddingLeft: "18px", display: "grid", gap: "6px", fontSize: "14px"}}>
              <li>
                Sáng lập & điều hành Học viện Toán tư duy Quốc tế Satamath
              </li>
              <li>
                Tiên phong đưa 40+ kỳ thi quốc tế về miền Trung
              </li>
              <li>
                Tác giả nhiều bộ sách Toán phát triển tư duy
              </li>
              <li>
                Cố vấn phương pháp học tập cho trẻ 5–15 tuổi
              </li>
            </ul>
          </article>
          <article className="card sv d3 a-deal" style={{padding: "18px", gap: "14px"}}>
            <div style={{aspectRatio: "1/1", borderRadius: "16px", overflow: "hidden"}}>
              <PubAnh id="104fdd55c4c6f6e2e0c60c89f0761366" alt="Ông Nguyễn Khiêm" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 12%"}} sizes="(max-width: 860px) 100vw, 340px" />
            </div>
            <div>
              <span className="tag">
                Đồng sáng lập
              </span>
              <h3 style={{marginTop: "10px"}}>
                Ông Nguyễn Khiêm
              </h3>
              <p style={{margin: "4px 0 0", color: "var(--muted)", fontSize: "14px"}}>
                Đồng sáng lập Sata Robo · Đồng sáng lập SOVA
              </p>
            </div>
            <ul style={{margin: "0", paddingLeft: "18px", display: "grid", gap: "6px", fontSize: "14px"}}>
              <li>
                Giám đốc Chiến lược & Huy động vốn CTCP Công nghệ SOVA
              </li>
              <li>
                15+ năm kết nối đầu tư & tư vấn tài chính doanh nghiệp
              </li>
              <li>
                Kiến trúc hệ thống & tự động hoá
              </li>
              <li>
                Cố vấn M&A, phát triển thương vụ
              </li>
            </ul>
          </article>
        </div>
      </div>
    </section>
    <section className="sec">
      <div className="wrap">
        <div className="head2 sv a-mask">
          <div>
            <span className="label mono">
              <b>
                [05]
              </b>
              {" "}
              Hệ thống cơ sở
            </span>
            <h2>
              {coSo.length} cơ sở tại
              {" "}
              <span className="grad">
                Đà Nẵng
              </span>
            </h2>
          </div>
          <p>
            Phòng Lab Robotics đầy đủ thiết bị, lớp tối đa 12 học viên.
          </p>
          <PubAnh id="faf517459b9a7277f3119a2826f3ac7c" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-124px", width: "112px", height: "auto"}} sizes="112px" />
        </div>
        <div className="g2">
          {coSo.map((loc, i) => {
            const them = THONG_TIN_THEM_CO_SO[loc.code];
            const ten = `Sata Robo ${tenCoSoNgan(loc.name)}`;
            const moTa = loc.note ?? them?.moTa;
            return (
              <article key={loc.id} className={`card lift sv ${i === 1 ? "d2" : ""} a-slideR`} style={{gap: "0"}}>
                {them ? (
                  <div style={{position: "relative", height: "210px", overflow: "hidden"}} className="zoom">
                    <PubAnh id={them.anh} alt={`Lớp học tại ${ten}`} style={{width: "100%", height: "100%", objectFit: "cover"}} sizes="(max-width: 860px) 100vw, 580px" />
                    <span className="mono" style={{position: "absolute", left: "14px", top: "14px", background: "#fe8f2d", color: "#241133", padding: "5px 10px", borderRadius: "8px", fontSize: "12px"}}>
                      {nhanCoSo(loc.code)}
                    </span>
                  </div>
                ) : null}
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
                  <a href={duongDanBanDo(loc.address)} className="btn btn-line" style={{justifySelf: "start", minHeight: "42px"}} target="_blank" rel="noopener noreferrer">
                    Chỉ đường Google Maps
                  </a>
                </div>
              </article>
            );
          })}
        </div>
        <div className="sv a-blur" style={{marginTop: "22px", padding: "18px 20px", borderRadius: "16px", border: "1px dashed var(--line2)", display: "flex", flexWrap: "wrap", gap: "8px 28px", fontSize: "14px", color: "var(--muted)"}}>
          <span>
            <b style={{color: "var(--text)"}}>
              Công ty Cổ phần Công nghệ Giáo dục Sata Robo
            </b>
          </span>
          <span>
            Mã số doanh nghiệp: {SATA_ROBO_CONTACT.businessCode} · {SATA_ROBO_CONTACT.businessCodeIssuer} cấp ngày {SATA_ROBO_CONTACT.businessCodeIssuedAt}
          </span>
          <span>Địa chỉ: {SATA_ROBO_CONTACT.address}</span>
        </div>
      </div>
    </section>
    <section className="sec">
      <div className="wrap">
        <div className="cta-band sv a-iris">
          <div style={{display: "flex", alignItems: "center", gap: "18px"}}>
            <PubAnh id="da847c40d631e0b7a535a73c3172ac50" className="bob" alt="" aria-hidden="true" style={{width: "96px", height: "auto", flexShrink: "0", filter: "drop-shadow(0 12px 16px rgba(0,0,0,.35))"}} sizes="96px" />
            <div>
              <p style={{margin: "0", fontFamily: FF.unbounded, fontWeight: "600", fontSize: "clamp(19px,2vw,26px)", lineHeight: "1.3"}}>
                Đến xem con lắp robot đầu tiên
              </p>
              <p style={{margin: "6px 0 0", color: "#f3e4ff"}}>
                Buổi học thử 1-1 miễn phí · 45 phút đánh giá + 90 phút thực hành cùng giáo viên
              </p>
            </div>
          </div>
          <div style={{display: "flex", flexWrap: "wrap", gap: "10px"}}>
            <Link href="/lien-he?free-trial=true" className="btn btn-acc">
              Đặt buổi học thử miễn phí
            </Link>
            <a href={SATA_ROBO_PHONE.zalo} className="btn" style={{background: "rgba(255,255,255,.12)", color: "#fff", border: "1.5px solid rgba(255,255,255,.4)"}}>
              Chat Zalo
            </a>
          </div>
        </div>
      </div>
    </section>
    </>
  );
}
