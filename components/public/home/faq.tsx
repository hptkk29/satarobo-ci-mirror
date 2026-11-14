"use client";

import { useState } from "react";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { doiCauMo, type CauHoi } from "./home-thuan";

/** [06] Câu hỏi thường gặp — CHÉP từ Main.dc.html (accordion mở một câu mỗi lần, mặc định mở câu đầu như artifact). */
export function FaqSection({ cauHoi }: { cauHoi: readonly CauHoi[] }) {
  const [dangMo, setDangMo] = useState(0);
  return (
      <section className="sec gridbg" style={{backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)"}}>
        <div className="wrap" style={{maxWidth: "920px"}}>
          <div className="sv a-pop" style={{textAlign: "center", marginBottom: "36px", position: "relative"}}>
            <span className="label mono">
              <b>
                [06]
              </b>
              {" "}
              Ba mẹ thường hỏi
            </span>
            <h2>
              Câu hỏi thường gặp về
              {" "}
              <span className="grad">
                học Robotics
              </span>
            </h2>
            <PubAnh id="9f9fc46f4d98a517919047b487b3055f" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "-40px", top: "-40px", width: "120px"}} sizes="120px" />
          </div>
          <div style={{display: "flex", flexDirection: "column", gap: "10px"}}>
            {cauHoi.map((f, i) => {
              const mo = dangMo === i;
              return (
                <div key={f.q} className="sv a-acc" style={{background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "14px"}}>
                  <button type="button" onClick={() => setDangMo((hienTai) => doiCauMo(hienTai, i))} aria-expanded={mo} aria-controls={`faq-tl-${i}`} style={{width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left", background: "transparent", border: "0", padding: "16px 18px", font: "inherit", fontWeight: "700", color: "var(--text)", cursor: "pointer", minHeight: "56px"}}>
                    <span style={{flexGrow: "1"}}>
                      {f.q}
                    </span>
                    <span aria-hidden="true" style={{width: "30px", height: "30px", flexShrink: "0", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700", background: mo ? "#fe8f2d" : "var(--chip)", color: mo ? "#241133" : "var(--purT)"}}>
                      {mo ? "−" : "+"}
                    </span>
                  </button>
                  {/* Luôn có trong HTML (công cụ tìm kiếm đọc được); chỉ ẩn bằng `hidden` khi đóng. */}
                  <p id={`faq-tl-${i}`} hidden={!mo} style={{margin: "0", padding: "0 18px 16px", color: "var(--muted)"}}>
                    {f.a}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
  );
}
