import type { CSSProperties } from "react";
import { PubAnh } from "@/components/public/pub-design/pub-anh";

/** [02] Một buổi học 90 phút — CHÉP từ Main.dc.html. */
export function BuoiHocSection() {
  return (
      <section className="sec gridbg" style={{backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)"}}>
        <div className="wrap">
          <div className="head2 sv a-blur">
            <div>
              <span className="label mono">
                <b>
                  [02]
                </b>
                {" "}
                Một buổi học 90 phút
              </span>
              <h2>
                Buổi học Robotics: con không ngồi nghe giảng.
                {" "}
                <span className="grad">
                  Con làm.
                </span>
              </h2>
            </div>
            <p>
              Lắp ráp → lập trình → chạy thử → thuyết trình. Mỗi buổi đều có một sản phẩm chạy được.
            </p>
            <PubAnh id="1f63915100ed3dcdecacdc58c1ce83b3" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "10px", top: "-112px", width: "124px"}} sizes="124px" />
          </div>
          <div className="g4" data-fx-beam="" style={{marginTop: "52px"}}>
            <figure className="card lift sv a-slideR" style={{margin: "0"}}>
              <div className="brk" style={{height: "210px", background: "var(--panel2)", display: "flex", alignItems: "center", justifyContent: "center", padding: "18px"}}>
                <PubAnh id="15212c849add09f4564422b637c3afd5" className="float" alt="Mô hình robot cua Alpha Set" style={{maxHeight: "100%"}} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 290px" />
              </div>
              <figcaption style={{padding: "20px"}}>
                <p className="mono" style={{margin: "0 0 6px", fontSize: "11px", color: "var(--accT)"}}>
                  01 — Lắp ráp
                </p>
                <p style={{margin: "0", fontWeight: "700", fontSize: "17px"}}>
                  Tự lắp robot theo sơ đồ
                </p>
                <p style={{margin: "6px 0 0", fontSize: "14px", color: "var(--muted)"}}>
                  Đọc bản vẽ, chọn chi tiết, dựng mô hình chạy được.
                </p>
              </figcaption>
            </figure>
            <figure className="card lift sv d2 a-slideR a-imgzoom" style={{margin: "0"}}>
              <div className="brk" style={{height: "210px", overflow: "hidden"}}>
                <PubAnh id="85fbe2407f3b02e50e40d7e94d1c1bb3" alt="Giáo viên kèm học viên lập trình" style={{width: "100%", height: "100%", objectFit: "cover"}} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 290px" />
              </div>
              <figcaption style={{padding: "20px"}}>
                <p className="mono" style={{margin: "0 0 6px", fontSize: "11px", color: "var(--accT)"}}>
                  02 — Lập trình
                </p>
                <p style={{margin: "0", fontWeight: "700", fontSize: "17px"}}>
                  Ra lệnh cho robot
                </p>
                <p style={{margin: "6px 0 0", fontSize: "14px", color: "var(--muted)"}}>
                  Giáo viên kèm sát, lớp tối đa 12 bạn.
                </p>
              </figcaption>
            </figure>
            <figure className="card lift sv d3 a-slideR a-imgzoom" style={{margin: "0"}}>
              <div className="brk" style={{height: "210px", overflow: "hidden"}}>
                <PubAnh id="115b2c0af08632a373b177181586bc33" alt="Học viên cầm robot chuẩn bị chạy thử" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 55%"}} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 290px" />
              </div>
              <figcaption style={{padding: "20px"}}>
                <p className="mono" style={{margin: "0 0 6px", fontSize: "11px", color: "var(--accT)"}}>
                  03 — Chạy thử & sửa lỗi
                </p>
                <p style={{margin: "0", fontWeight: "700", fontSize: "17px"}}>
                  Robot chạy sai? Con tự sửa
                </p>
                <p style={{margin: "6px 0 0", fontSize: "14px", color: "var(--muted)"}}>
                  Thử trên sa bàn thật, tìm lỗi, chạy lại.
                </p>
              </figcaption>
            </figure>
            <figure className="card lift sv d4 a-slideR a-imgzoom" style={{margin: "0"}}>
              <div className="brk" style={{height: "210px", overflow: "hidden"}}>
                <PubAnh id="0aeacc0ed1538886eb1414e95b12be57" alt="Học viên khoe robot trong buổi tổng kết học phần" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 60%"}} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 290px" />
              </div>
              <figcaption style={{padding: "20px"}}>
                <p className="mono" style={{margin: "0 0 6px", fontSize: "11px", color: "var(--accT)"}}>
                  04 — Thuyết trình
                </p>
                <p style={{margin: "0", fontWeight: "700", fontSize: "17px"}}>
                  Ba mẹ xem thành quả
                </p>
                <p style={{margin: "6px 0 0", fontSize: "14px", color: "var(--muted)"}}>
                  Cuối mỗi 12 buổi, con trình bày sản phẩm.
                </p>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>
  );
}

/** [03] 5 cam kết bằng văn bản (quỹ đạo quanh linh vật do `fx.js` vẽ phần động). */
export function CamKetSection() {
  return (
      <section className="sec">
        <div className="wrap">
          <div className="two sv a-iris" style={{borderRadius: "26px", background: "var(--band)", color: "#ffffff", overflow: "hidden", position: "relative"}}>
            <div className="gridbg" style={{position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center", minHeight: "440px", paddingTop: "60px", "--grid": "rgba(255,255,255,.07)"} as CSSProperties}>
              <div aria-hidden="true" style={{position: "absolute", top: "50px", width: "340px", height: "340px", maxWidth: "80%", borderRadius: "999px", background: "radial-gradient(closest-side, rgba(254,143,45,0.55), rgba(254,143,45,0) 70%)"}}></div>
              <div className="fx-orbit" aria-hidden="true" style={{left: "50%", bottom: "198px"}}>
                <span className="o-ring" style={{width: "clamp(260px,60vw,360px)", height: "clamp(260px,60vw,360px)"}}></span>
                <span className="o-ring" style={{width: "clamp(300px,80vw,470px)", height: "clamp(300px,80vw,470px)", borderColor: "rgba(79,209,181,.3)"}}></span>
                <span className="orb" style={{"--a": "20deg", "--r": "clamp(130px,30vw,180px)", "--d": "26s"} as CSSProperties}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"></path>
                    <circle cx="12" cy="12" r="7"></circle>
                  </svg>
                </span>
                <span className="orb" style={{"--a": "200deg", "--r": "clamp(130px,30vw,180px)", "--d": "26s"} as CSSProperties}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 7l-5 5 5 5M16 7l5 5-5 5"></path>
                  </svg>
                </span>
                <span className="orb rev" style={{"--a": "110deg", "--r": "clamp(150px,40vw,235px)", "--d": "34s"} as CSSProperties}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="6" width="12" height="12" rx="2"></rect>
                    <rect x="9.5" y="9.5" width="5" height="5" rx="1"></rect>
                    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"></path>
                  </svg>
                </span>
                <span className="orb rev" style={{"--a": "250deg", "--r": "clamp(150px,40vw,235px)", "--d": "34s"} as CSSProperties}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"></path>
                  </svg>
                </span>
                <span className="orb rev" style={{"--a": "340deg", "--r": "clamp(150px,40vw,235px)", "--d": "34s"} as CSSProperties}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="6" width="13" height="12" rx="2"></rect>
                    <path d="M16 10l5-3v10l-5-3"></path>
                  </svg>
                </span>
              </div>
              <PubAnh id="4654d2414b16d64b44567f9a56690865" className="float" alt="Linh vật Sata Robo ôm trái tim" style={{position: "relative", width: "260px", maxWidth: "70%", marginBottom: "30px", filter: "drop-shadow(0 20px 30px rgba(0,0,0,.4))"}} sizes="260px" />
              <p className="mono" style={{position: "absolute", top: "24px", left: "28px", margin: "0", fontSize: "12px", color: "#ffd3a8"}}>
                <b style={{color: "#fff"}}>
                  [03]
                </b>
                {" "}
                Cam kết bằng văn bản
              </p>
            </div>
            <div style={{padding: "clamp(28px,4vw,48px)", display: "flex", flexDirection: "column", gap: "16px"}}>
              <h2 style={{marginBottom: "6px"}}>
                5 cam kết với ba mẹ
              </h2>
              <div className="sv a-slideL" style={{display: "flex", gap: "14px", alignItems: "flex-start"}}>
                <span className="mono" style={{flexShrink: "0", width: "40px", height: "40px", borderRadius: "10px", background: "#fe8f2d", color: "#241133", display: "flex", alignItems: "center", justifyContent: "center"}}>
                  01
                </span>
                <p style={{margin: "7px 0 0"}}>
                  <strong>
                    Hoàn 100% học phí
                  </strong>
                  {" "}
                  nếu con không thích sau buổi đầu.
                </p>
              </div>
              <div className="sv d2 a-slideL" style={{display: "flex", gap: "14px", alignItems: "flex-start"}}>
                <span className="mono" style={{flexShrink: "0", width: "40px", height: "40px", borderRadius: "10px", background: "rgba(254,143,45,.25)", border: "1px solid #fe8f2d", display: "flex", alignItems: "center", justifyContent: "center"}}>
                  02
                </span>
                <p style={{margin: "7px 0 0"}}>
                  <strong>
                    Lớp tối đa 12 học viên
                  </strong>
                  {" "}
                  — kèm sát từng bạn.
                </p>
              </div>
              <div className="sv d3 a-slideL" style={{display: "flex", gap: "14px", alignItems: "flex-start"}}>
                <span className="mono" style={{flexShrink: "0", width: "40px", height: "40px", borderRadius: "10px", background: "rgba(254,143,45,.25)", border: "1px solid #fe8f2d", display: "flex", alignItems: "center", justifyContent: "center"}}>
                  03
                </span>
                <p style={{margin: "7px 0 0"}}>
                  <strong>
                    Học đúng, thi đúng
                  </strong>
                  {" "}
                  trên RoboSim.
                </p>
              </div>
              <div className="sv d4 a-slideL" style={{display: "flex", gap: "14px", alignItems: "flex-start"}}>
                <span className="mono" style={{flexShrink: "0", width: "40px", height: "40px", borderRadius: "10px", background: "rgba(254,143,45,.25)", border: "1px solid #fe8f2d", display: "flex", alignItems: "center", justifyContent: "center"}}>
                  04
                </span>
                <p style={{margin: "7px 0 0"}}>
                  <strong>
                    Thuyết trình cuối mỗi học phần
                  </strong>
                  , có ghi hình.
                </p>
              </div>
              <div className="sv d4 a-slideL" style={{display: "flex", gap: "14px", alignItems: "flex-start"}}>
                <span className="mono" style={{flexShrink: "0", width: "40px", height: "40px", borderRadius: "10px", background: "rgba(254,143,45,.25)", border: "1px solid #fe8f2d", display: "flex", alignItems: "center", justifyContent: "center"}}>
                  05
                </span>
                <p style={{margin: "7px 0 0"}}>
                  <strong>
                    Hỗ trợ 3.000.000đ
                  </strong>
                  {" "}
                  lệ phí thi cấp Quốc gia.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
  );
}
