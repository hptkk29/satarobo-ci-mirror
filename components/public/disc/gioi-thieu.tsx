import type { CSSProperties } from "react";
import Link from "next/link";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { FF } from "@/components/public/pub-fonts";
import type { DongBoCauHoi } from "./bo-cau-hoi";
import { HoiDapDisc } from "./hoi-dap-disc";
import { ThuMotCau } from "./thu-mot-cau";
import "@/app/(public)/pub-design/disc.css";

// Trang giới thiệu DISC CÔNG KHAI — CHÉP từ artifact "Disc" (CSS: app/(public)/pub-design/disc.css + chung.css).
// Server component. Khác artifact có chủ ý: bảng "Bộ câu hỏi" (số câu, thang trả lời, ai trả lời) ĐỌC TỪ ĐỘNG CƠ thay vì gõ cứng —
// không có động cơ thì không vẽ bảng (không dựng số liệu giả); ô "Thử một câu" dùng nhãn thang của bộ ba/mẹ (cũng từ động cơ).
export function GioiThieuDisc({
  moBai,
  boCauHoi,
  thangThu,
}: {
  /** true ⇒ nút "Bắt đầu khám phá" dẫn tới /disc/bat-dau; false ⇒ khoá nút + nói thật "đang hoàn thiện". */
  moBai: boolean;
  /** null ⇒ động cơ chưa sẵn sàng: không vẽ bảng. */
  boCauHoi: DongBoCauHoi[] | null;
  /** Nhãn các mức của bộ ba/mẹ cho ô "Thử một câu"; null ⇒ ẩn ô đó. */
  thangThu: string[] | null;
}) {
  const dongBai = !moBai;
  const soCauPhuHuynh = boCauHoi?.[boCauHoi.length - 1]?.soCau ?? 0;
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
                Khám phá DISC
              </span>
            </nav>
            <span className="label mono">
              <b>
                ●
              </b>
              {" "}Miễn phí · Dành cho cả gia đình
            </span>
            <h1>
              Hiểu cách mỗi người trong nhà{" "}
              <span className="grad">
                phản ứng, giao tiếp và học hỏi
              </span>
            </h1>
            <p className="lead">
              DISC là công cụ giúp ba mẹ nhận ra xu hướng hành vi của mình và của con, để trò chuyện và đồng hành hợp nhịp hơn. Đây không phải chẩn đoán tâm lý, cũng không đo thông minh hay năng lực.
            </p>
            <div className="chips">
              <span className="chip">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 6v6l4 2"></path>
                </svg>
                {" "}Khoảng{" "}
                <b>
                  15–20 phút
                </b>
              </span>
              <span className="chip">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
                </svg>
                {" "}Ba/mẹ{" "}
                <b>
                  +
                </b>
                {" "}một bé
              </span>
              <span className="chip">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2"></rect>
                  <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
                </svg>
                {" "}Không cần đăng nhập
              </span>
            </div>
            <div style={{display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "26px"}}>
              {moBai && (
      <>
                <Link href="/disc/bat-dau" data-to="/disc/bat-dau" className="btn btn-acc">
                  Bắt đầu khám phá
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 17L17 7M8 7h9v9"></path>
                  </svg>
                </Link>
              </>
      )}
              {" "}
              {dongBai && (
      <>
                <button type="button" className="btn btn-acc" disabled aria-describedby="disc-chua-san-sang">
                  Bắt đầu khám phá
                </button>
              </>
      )}
              {" "}
              <Link href="/kich-hoat?disc=1" data-to="/kich-hoat?disc=1" className="btn btn-line">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="7.5" cy="15.5" r="4.5"></circle>
                  <path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"></path>
                </svg>
                {" "}Nhận kết quả bằng mã
              </Link>
            </div>
            {dongBai && (
      <>
              <p id="disc-chua-san-sang" className="dclosed">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 12l-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9M17.6 15L22 10.6M20 12.6l-6.5-6.5a4 4 0 0 0-5.7 0L6 7.9"></path>
                </svg>
                {" "}Bài khám phá đang được hoàn thiện, sẽ mở sớm.
              </p>
            </>
      )}
          </div>
          <div className="hero-art load3">
            <div className="glow" aria-hidden="true" style={{width: "460px", height: "460px", left: "50%", top: "50%", margin: "-230px 0 0 -230px"}}></div>
            <div className="dw">
              <svg viewBox="0 0 400 400" aria-hidden="true" focusable="false">
                <circle className="ring" cx="200" cy="200" r="194"></circle>
                <circle className="ring2" cx="200" cy="200" r="184"></circle>
                <g className="dseg sD">
                  <path d="M26.1 193.3A174 174 0 0 1 193.3 26.1L196.2 100.1A100 100 0 0 0 100.1 196.2Z" fill="var(--fD)"></path>
                  <text x="103.1" y="103.1">
                    D
                  </text>
                </g>
                <g className="dseg sI">
                  <path d="M206.7 26.1A174 174 0 0 1 373.9 193.3L299.9 196.2A100 100 0 0 0 203.8 100.1Z" fill="var(--fI)"></path>
                  <text x="296.9" y="103.1">
                    I
                  </text>
                </g>
                <g className="dseg sS">
                  <path d="M373.9 206.7A174 174 0 0 1 206.7 373.9L203.8 299.9A100 100 0 0 0 299.9 203.8Z" fill="var(--fS)"></path>
                  <text x="296.9" y="296.9">
                    S
                  </text>
                </g>
                <g className="dseg sC">
                  <path d="M193.3 373.9A174 174 0 0 1 26.1 206.7L100.1 203.8A100 100 0 0 0 196.2 299.9Z" fill="var(--fC)"></path>
                  <text x="103.1" y="296.9">
                    C
                  </text>
                </g>
                <circle className="core" cx="200" cy="200" r="88"></circle>
                <text className="t1" x="200" y="204">
                  DISC
                </text>
                <text className="t2" x="200" y="230">
                  4 NHÓM HÀNH VI
                </text>
              </svg>
            </div>
            <div className="dpose pD" aria-hidden="true">
              <PubAnh id="3d425f2a2c063a1916225676ca19f4f4" alt="" sizes="(max-width: 860px) 90vw, 480px" />
              <span className="dchip cD" style={{"--f": "var(--fD)"} as CSSProperties}>
                <b>
                  D
                </b>
                Rô Xung Phong
              </span>
            </div>
            <div className="dpose pI" aria-hidden="true">
              <PubAnh id="21be53cabd4ac017cdbde87433593cfb" alt="" sizes="(max-width: 860px) 90vw, 480px" />
              <span className="dchip cI" style={{"--f": "var(--fI)"} as CSSProperties}>
                <b>
                  I
                </b>
                Rô Kể Chuyện
              </span>
            </div>
            <div className="dpose pS" aria-hidden="true">
              <PubAnh id="2e4a9309e1a6bfcb633b68ee102428e9" alt="" sizes="(max-width: 860px) 90vw, 480px" />
              <span className="dchip cS" style={{"--f": "var(--fS)"} as CSSProperties}>
                <b>
                  S
                </b>
                Rô Giữ Nhịp
              </span>
            </div>
            <div className="dpose pC" aria-hidden="true">
              <PubAnh id="7e643cba294434d8258e05d15f9c242c" alt="" sizes="(max-width: 860px) 90vw, 480px" />
              <span className="dchip cC" style={{"--f": "var(--fC)"} as CSSProperties}>
                <b>
                  C
                </b>
                Rô Tỉ Mỉ
              </span>
            </div>
          </div>
        </div>
      </header>
      <section className="sec" aria-labelledby="disc-cach-lam">
        <div className="wrap">
          <div className="head2 sv a-mask">
            <div>
              <span className="label mono">
                <b>
                  [01]
                </b>
                {" "}Cách làm
              </span>
              <h2 id="disc-cach-lam">
                Ba bước,{" "}
                <span className="grad">
                  khoảng 15–20 phút
                </span>
              </h2>
            </div>
            <p>
              Ba/mẹ làm bài của mình trước, rồi tới bài của con. Mỗi màn hình một câu, bấm chọn là xong.
            </p>
            <PubAnh id="41d8957417d5d5794183fc0c6767039d" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-124px", width: "112px", height: "auto"}} sizes="112px" />
          </div>
          <ol className="g3" data-fx-beam="" style={{margin: "52px 0 0", padding: "0", listStyle: "none"}}>
            <li className="card lift sv  a-slideR" style={{padding: "22px", gap: "10px"}}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start"}}>
                <span className="ico">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
                  </svg>
                </span>
                <PubAnh id="677f6b6846ebf7628e125173d5ab78eb" alt="" aria-hidden="true" style={{width: "auto", height: "86px", margin: "-20px -4px -8px 0", filter: "drop-shadow(0 10px 12px rgba(0,0,0,.25))"}} sizes="(max-width: 860px) 90vw, 480px" />
              </div>
              <p className="mono" style={{margin: "0", fontSize: "11px", color: "var(--accT)"}}>
                01 — Bước 1
              </p>
              <h3 style={{margin: "0", fontSize: "20px"}}>
                Nhà mình
              </h3>
              <p style={{margin: "0", color: "var(--muted)", fontSize: "15px", lineHeight: "1.6"}}>
                Cho chúng tôi biết ba/mẹ và con là ai: tên gọi, năm sinh và lớp. Để chọn đúng bộ câu hỏi theo độ tuổi.
              </p>
            </li>
            <li className="card lift sv d2 a-slideR" style={{padding: "22px", gap: "10px"}}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start"}}>
                <span className="ico">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="8" y="2" width="8" height="4" rx="1"></rect>
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                    <path d="M9 12h6M9 16h4"></path>
                  </svg>
                </span>
                <PubAnh id="a8d293a9efc52ad97026bd2d0dc02db2" alt="" aria-hidden="true" style={{width: "auto", height: "86px", margin: "-20px -4px -8px 0", filter: "drop-shadow(0 10px 12px rgba(0,0,0,.25))"}} sizes="(max-width: 860px) 90vw, 480px" />
              </div>
              <p className="mono" style={{margin: "0", fontSize: "11px", color: "var(--accT)"}}>
                02 — Bước 2
              </p>
              <h3 style={{margin: "0", fontSize: "20px"}}>
                Làm bài
              </h3>
              <p style={{margin: "0", color: "var(--muted)", fontSize: "15px", lineHeight: "1.6"}}>
                Mỗi người một bài phù hợp. Bé nhỏ do người lớn quan sát và trả lời hộ — không bắt trẻ nhỏ tự đánh giá.
              </p>
            </li>
            <li className="card lift sv d3 a-slideR" style={{padding: "22px", gap: "10px"}}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start"}}>
                <span className="ico">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 3v18h18"></path>
                    <path d="M8 16v-5M13 16V8M18 16v-9"></path>
                  </svg>
                </span>
                <PubAnh id="214f70bfc7cb9a92126b0a2e6207c48a" alt="" aria-hidden="true" style={{width: "auto", height: "86px", margin: "-20px -4px -8px 0", filter: "drop-shadow(0 10px 12px rgba(0,0,0,.25))"}} sizes="(max-width: 860px) 90vw, 480px" />
              </div>
              <p className="mono" style={{margin: "0", fontSize: "11px", color: "var(--accT)"}}>
                03 — Bước 3
              </p>
              <h3 style={{margin: "0", fontSize: "20px"}}>
                Đọc kết quả
              </h3>
              <p style={{margin: "0", color: "var(--muted)", fontSize: "15px", lineHeight: "1.6"}}>
                Mỗi người một bản kết quả: điểm bốn nhóm D–I–S–C và nhóm nổi trội nhất, kèm vài lưu ý trung tính. Lưu lại để xem sau.
              </p>
            </li>
          </ol>
        </div>
      </section>
      <section className="sec gridbg" style={{backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)"}}>
        <div className="wrap">
          <div className="head2 sv a-mask">
            <div>
              <span className="label mono">
                <b>
                  [02]
                </b>
                {" "}Bốn nhóm hành vi
              </span>
              <h2>
                Bốn chữ{" "}
                <span className="grad">
                  D-I-S-C
                </span>
                {" "}nghĩa là gì
              </h2>
            </div>
            <p>
              Mỗi nhóm có một bạn Rô đại diện, để cả bé nhỏ cũng đọc được kết quả của mình.
            </p>
          </div>
          <div className="dgrid">
            <article className="card lift dcard sv  a-pop" style={{"--f": "var(--fD)", "--c": "var(--dD)"} as CSSProperties}>
              <div className="top">
                <span className="dlet cD" aria-hidden="true">
                  D
                </span>
                <PubAnh id="3d425f2a2c063a1916225676ca19f4f4" alt="" aria-hidden="true" sizes="(max-width: 860px) 90vw, 480px" />
              </div>
              <div>
                <span className="en">
                  D · Dominance
                </span>
                <h3>
                  <span>
                    Chủ động
                  </span>
                  {" "}· Rô Xung Phong
                </h3>
              </div>
              <p style={{margin: "0", color: "var(--muted)", fontSize: "15px", lineHeight: "1.55"}}>
                Chủ động, quyết đoán, hướng tới kết quả.
              </p>
              <div className="sign">
                <small>
                  Ở trẻ thường thấy
                </small>
                Bày cách chơi, đòi tự làm, thích thắng
              </div>
            </article>
            <article className="card lift dcard sv d2 a-pop" style={{"--f": "var(--fI)", "--c": "var(--dI)"} as CSSProperties}>
              <div className="top">
                <span className="dlet cI" aria-hidden="true">
                  I
                </span>
                <PubAnh id="21be53cabd4ac017cdbde87433593cfb" alt="" aria-hidden="true" sizes="(max-width: 860px) 90vw, 480px" />
              </div>
              <div>
                <span className="en">
                  I · Influence
                </span>
                <h3>
                  <span>
                    Ảnh hưởng
                  </span>
                  {" "}· Rô Kể Chuyện
                </h3>
              </div>
              <p style={{margin: "0", color: "var(--muted)", fontSize: "15px", lineHeight: "1.55"}}>
                Ảnh hưởng, kết nối, truyền cảm hứng.
              </p>
              <div className="sign">
                <small>
                  Ở trẻ thường thấy
                </small>
                Kể chuyện, kết bạn nhanh, thích được chú ý
              </div>
            </article>
            <article className="card lift dcard sv d3 a-pop" style={{"--f": "var(--fS)", "--c": "var(--dS)"} as CSSProperties}>
              <div className="top">
                <span className="dlet cS" aria-hidden="true">
                  S
                </span>
                <PubAnh id="2e4a9309e1a6bfcb633b68ee102428e9" alt="" aria-hidden="true" sizes="(max-width: 860px) 90vw, 480px" />
              </div>
              <div>
                <span className="en">
                  S · Steadiness
                </span>
                <h3>
                  <span>
                    Ổn định
                  </span>
                  {" "}· Rô Giữ Nhịp
                </h3>
              </div>
              <p style={{margin: "0", color: "var(--muted)", fontSize: "15px", lineHeight: "1.55"}}>
                Kiên định, bền bỉ, giữ nhịp ổn định.
              </p>
              <div className="sign">
                <small>
                  Ở trẻ thường thấy
                </small>
                Nhường bạn, thích nếp quen, chờ được lâu
              </div>
            </article>
            <article className="card lift dcard sv d4 a-pop" style={{"--f": "var(--fC)", "--c": "var(--dC)"} as CSSProperties}>
              <div className="top">
                <span className="dlet cC" aria-hidden="true">
                  C
                </span>
                <PubAnh id="7e643cba294434d8258e05d15f9c242c" alt="" aria-hidden="true" sizes="(max-width: 860px) 90vw, 480px" />
              </div>
              <div>
                <span className="en">
                  C · Conscientiousness
                </span>
                <h3>
                  <span>
                    Cẩn trọng
                  </span>
                  {" "}· Rô Tỉ Mỉ
                </h3>
              </div>
              <p style={{margin: "0", color: "var(--muted)", fontSize: "15px", lineHeight: "1.55"}}>
                Cẩn trọng, theo nguyên tắc, chú ý chi tiết.
              </p>
              <div className="sign">
                <small>
                  Ở trẻ thường thấy
                </small>
                Làm theo hướng dẫn, soát lại, hỏi vì sao
              </div>
            </article>
          </div>
          <p className="dfoot">
            Bốn nhóm này mô tả cách hành xử, không xếp hạng con người. Mô hình do nhà tâm lý học W.M. Marston mô tả lần đầu năm 1928.
          </p>
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
                {" "}Đọc kết quả
              </span>
              <h2>
                Đọc bốn con số{" "}
                <span className="grad">
                  này thế nào
                </span>
              </h2>
            </div>
            <p>
              Kết quả nói rõ mình đo gì, không đo gì — để ba mẹ dùng đúng chỗ.
            </p>
            <PubAnh id="7e643cba294434d8258e05d15f9c242c" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-124px", width: "112px", height: "auto"}} sizes="112px" />
          </div>
          <div className="dread">
            <ul className="dlist">
              <li className="sv  a-slideL">
                <span className="ico">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="6"></circle>
                    <circle cx="12" cy="12" r="2"></circle>
                  </svg>
                </span>
                <span>
                  DISC đo{" "}
                  <strong>
                    thiên hướng hành vi
                  </strong>
                  {" "}— nghiêng về cách làm nào — chứ không đo giỏi hay dốt, và cũng không mô tả trọn vẹn một con người.
                </span>
              </li>
              <li className="sv d2 a-slideL">
                <span className="ico">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
                  </svg>
                </span>
                <span>
                  Không có nhóm nào tốt hơn nhóm nào. Mỗi người là pha trộn của cả bốn nhóm, chỉ khác nhau ở chỗ nhóm nào đậm hơn.
                </span>
              </li>
              <li className="sv d3 a-slideL">
                <span className="ico">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 3v18h18"></path>
                    <path d="M8 16v-5M13 16V8M18 16v-9"></path>
                  </svg>
                </span>
                <span>
                  Bốn con số so với{" "}
                  <strong>
                    nhau
                  </strong>
                  {" "}trong chính hồ sơ này. Chúng không phải phần trăm, và không so với bất kỳ ai khác.
                </span>
              </li>
              <li className="sv d4 a-slideL">
                <span className="ico">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                    <path d="M16 2v4M8 2v4M3 10h18"></path>
                  </svg>
                </span>
                <span>
                  Đây là ảnh chụp của khoảng hai tuần gần đây, không phải một kết luận. Trẻ đang lớn thì hồ sơ còn đổi — làm lại sau vài tháng thường cho hình ảnh rõ hơn.
                </span>
              </li>
              <li className="sv d4 a-slideL no">
                <span className="ico">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"></path>
                  </svg>
                </span>
                <span>
                  Dùng đúng: để mở một cuộc trò chuyện. Dùng sai: để dán một cái nhãn.
                </span>
              </li>
            </ul>
            <div className="card drep sv d2 a-pop">
              <div className="hd">
                <div>
                  <span className="tag dtag">
                    Ví dụ minh hoạ
                  </span>
                  <p style={{margin: "8px 0 0", fontWeight: "800", fontSize: "18px"}}>
                    Kết quả của bé · Lớp 4
                  </p>
                </div>
                <PubAnh id="b09f648ab11d0579d24805fe838e0900" alt="" aria-hidden="true" style={{width: "70px", height: "auto", filter: "drop-shadow(0 10px 12px rgba(0,0,0,.25))"}} sizes="70px" />
              </div>
              <p className="dhedge">
                Đây là gợi ý để trò chuyện với con, không phải kết luận về con.
              </p>
              <div className="dbar" style={{"--f": "var(--fD)"} as CSSProperties}>
                <span className="lb">
                  <span className="dchip cD" style={{"--f": "var(--fD)", boxShadow: "none", padding: "0", border: "0", background: "none"} as CSSProperties}>
                    <b>
                      D
                    </b>
                  </span>
                  Rô Xung Phong
                </span>
                <span className="tr">
                  <i style={{width: "62%"}}></i>
                </span>
              </div>
              <div className="dbar" style={{"--f": "var(--fI)"} as CSSProperties}>
                <span className="lb">
                  <span className="dchip cI" style={{"--f": "var(--fI)", boxShadow: "none", padding: "0", border: "0", background: "none"} as CSSProperties}>
                    <b>
                      I
                    </b>
                  </span>
                  Rô Kể Chuyện
                </span>
                <span className="tr">
                  <i style={{width: "86%"}}></i>
                </span>
              </div>
              <div className="dbar" style={{"--f": "var(--fS)"} as CSSProperties}>
                <span className="lb">
                  <span className="dchip cS" style={{"--f": "var(--fS)", boxShadow: "none", padding: "0", border: "0", background: "none"} as CSSProperties}>
                    <b>
                      S
                    </b>
                  </span>
                  Rô Giữ Nhịp
                </span>
                <span className="tr">
                  <i style={{width: "48%"}}></i>
                </span>
              </div>
              <div className="dbar" style={{"--f": "var(--fC)"} as CSSProperties}>
                <span className="lb">
                  <span className="dchip cC" style={{"--f": "var(--fC)", boxShadow: "none", padding: "0", border: "0", background: "none"} as CSSProperties}>
                    <b>
                      C
                    </b>
                  </span>
                  Rô Tỉ Mỉ
                </span>
                <span className="tr">
                  <i style={{width: "30%"}}></i>
                </span>
              </div>
              <div>
                <p className="mono" style={{margin: "0 0 8px", fontSize: "11px", color: "var(--muted)"}}>
                  ĐỌC TRONG 30 GIÂY
                </p>
                <div className="d30">
                  <div>
                    <small>
                      Nổi nhất
                    </small>
                    Rô Kể Chuyện · Ảnh hưởng
                  </div>
                  <div>
                    <small>
                      Nhẹ nhất
                    </small>
                    Rô Tỉ Mỉ · Cẩn trọng
                  </div>
                  <div>
                    <small>
                      Làm ngay
                    </small>
                    Một gợi ý trò chuyện cho tuần này
                  </div>
                </div>
              </div>
              <p style={{margin: "0", fontSize: "12px", color: "var(--muted)"}}>
                Bộ câu hỏi do SATA ROBO biên soạn theo mô hình DISC. Số liệu trên chỉ để minh hoạ cách đọc.
              </p>
            </div>
          </div>
        </div>
      </section>
      {boCauHoi && boCauHoi.length > 0 && (
      <section className="sec" style={{paddingTop: "0"}}>
        <div className="wrap">
          <div className="head2 sv a-mask">
            <div>
              <span className="label mono">
                <b>
                  [04]
                </b>
                {" "}Bộ câu hỏi
              </span>
              <h2>
                Mỗi người một bài{" "}
                <span className="grad">
                  hợp độ tuổi
                </span>
              </h2>
            </div>
            <p>
              Lớp của con tự tính từ năm sinh theo năm học; con học lệch lớp thì ba mẹ chọn lại.
            </p>
          </div>
          <div className="dset">
            <div className="card sv a-pop" style={{padding: "10px 14px"}}>
              <div className="dtbl-wrap">
                <table className="tbl dtbl">
                  <thead>
                    <tr>
                      <th scope="col">
                        Ai
                      </th>
                      <th scope="col">
                        Người trả lời
                      </th>
                      <th scope="col">
                        Số câu
                      </th>
                      <th scope="col">
                        Cách chọn
                      </th>
                    </tr>
                  </thead>
                  <tbody>{boCauHoi.map((d) => <DongBoCauHoiHang key={d.nhan} d={d} />)}</tbody>
                </table>
              </div>
              <p className="dnote vi" style={{margin: "6px 6px 12px"}}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 16v-4M12 8h.01"></path>
                </svg>
                <span>
                  <strong>
                    Bé còn nhỏ nên ba/mẹ sẽ quan sát và trả lời hộ.
                  </strong>
                  {" "}Chúng tôi không bắt trẻ nhỏ tự đánh giá bản thân. Bạn chỉ cần trả lời theo những gì thường thấy ở bé trong sinh hoạt hằng ngày.
                </span>
              </p>
            </div>
            {thangThu && <ThuMotCau thang={thangThu} soCau={soCauPhuHuynh} />}
          </div>
        </div>
      </section>
      )}
      <section className="sec" style={{paddingTop: "0"}} aria-labelledby="disc-du-lieu">
        <div className="wrap" style={{maxWidth: "1000px"}}>
          <div className="dpriv sv a-pop">
            <span className="ico" style={{width: "52px", height: "52px"}}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
            </span>
            <div style={{minWidth: "0"}}>
              <span className="label mono">
                <b>
                  [05]
                </b>
                {" "}Quyền riêng tư
              </span>
              <h2 id="disc-du-lieu" style={{marginTop: "8px"}}>
                Thông tin của gia đình được dùng thế nào
              </h2>
              <p style={{margin: "10px 0 0", color: "var(--muted)", lineHeight: "1.65"}}>
                Tên và năm sinh chỉ dùng để chọn bộ câu hỏi đúng độ tuổi và viết kết quả cho đúng người. Trước khi lưu, chúng tôi sẽ nói rõ dữ liệu nào được lưu, lưu bao lâu và bạn có thể yêu cầu xoá ra sao. Bạn không cần đăng nhập để làm bài. Xem thêm{" "}
                <Link href="/chinh-sach-bao-mat" data-to="/chinh-sach-bao-mat" style={{fontWeight: "700", color: "var(--purT)"}}>
                  chính sách bảo mật
                </Link>
                .
              </p>
              <div className="dfacts">
                <div>
                  <span className="ico">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10"></circle>
                      <path d="M12 6v6l4 2"></path>
                    </svg>
                  </span>
                  <span>
                    Bài làm tạm chỉ nằm{" "}
                    <b>
                      trong tab này
                    </b>
                    , tự mất sau 2 giờ và không giữ họ tên.
                  </span>
                </div>
                <div>
                  <span className="ico">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"></path>
                    </svg>
                  </span>
                  <span>
                    Chỉ hỏi số điện thoại ở bước cuối, khi bạn muốn{" "}
                    <b>
                      lưu và xem lại
                    </b>
                    .
                  </span>
                </div>
                <div>
                  <span className="ico">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                    </svg>
                  </span>
                  <span>
                    Bài chưa nhận về tài khoản được giữ tối đa{" "}
                    <b>
                      90 ngày
                    </b>
                    .
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="sec gridbg" style={{backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)"}}>
        <div className="wrap" style={{maxWidth: "920px"}}>
          <div className="sv a-pop" style={{textAlign: "center", marginBottom: "36px", position: "relative"}}>
            <span className="label mono">
              <b>
                [06]
              </b>
              {" "}Ba mẹ thường hỏi
            </span>
            <h2>
              Câu hỏi về{" "}
              <span className="grad">
                Khám phá DISC
              </span>
            </h2>
            <PubAnh id="933e29639ed926731a405c5e0289c62d" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "-40px", top: "-50px", width: "120px", height: "auto"}} sizes="120px" />
          </div>
          <HoiDapDisc />
        </div>
      </section>
      <section className="sec">
        <div className="wrap">
          <div className="cta-band sv a-iris">
            <div style={{display: "flex", alignItems: "center", gap: "18px"}}>
              <PubAnh id="2e4a9309e1a6bfcb633b68ee102428e9" className="bob" alt="" aria-hidden="true" style={{width: "96px", height: "auto", flexShrink: "0", filter: "drop-shadow(0 12px 16px rgba(0,0,0,.35))"}} sizes="96px" />
              <div>
                <p style={{margin: "0", fontFamily: FF.unbounded, fontWeight: "600", fontSize: "clamp(19px,2vw,26px)", lineHeight: "1.3"}}>
                  Dành 15–20 phút cho cả nhà hôm nay
                </p>
                <p style={{margin: "6px 0 0", color: "#f3e4ff"}}>
                  Hiểu nhau hơn để trò chuyện và đồng hành hợp nhịp. Miễn phí, không cần đăng nhập.
                </p>
              </div>
            </div>
            <div style={{display: "flex", flexWrap: "wrap", gap: "10px"}}>
              {moBai && (
      <>
                <Link href="/disc/bat-dau" data-to="/disc/bat-dau" className="btn btn-acc">
                  Bắt đầu khám phá
                </Link>
              </>
      )}
              {dongBai && (
      <>
                <button type="button" className="btn btn-acc" disabled>
                  Sắp mở
                </button>
              </>
      )}
              <Link href="/kich-hoat?disc=1" data-to="/kich-hoat?disc=1" className="btn" style={{background: "rgba(255,255,255,.12)", color: "#fff", border: "1.5px solid rgba(255,255,255,.4)"}}>
                Nhận kết quả
              </Link>
            </div>
          </div>
        </div>
      </section>
        
    </>
  );
}

function DongBoCauHoiHang({ d }: { d: DongBoCauHoi }) {
  return (
    <tr>
      <td>
        <strong>{d.nhan}</strong>
      </td>
      <td>
        <span className={d.nguoiLonTraLoiHo ? "who" : "who self"}>{d.nguoiLonTraLoiHo ? "Ba/mẹ trả lời hộ" : "Tự làm"}</span>
      </td>
      <td>
        <span className="n">{d.soCau}</span> <small style={{ display: "inline" }}>câu</small>
      </td>
      <td>
        {d.soMuc} mức
        {d.coMat ? (
          <>
            {" "}
            có mặt cười{" "}
            <span className="dfaces" aria-hidden="true">
              🙁😐😀
            </span>
          </>
        ) : null}
        {d.nhanThang ? <small>{d.nhanThang}</small> : null}
      </td>
    </tr>
  );
}
