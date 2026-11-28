import type { TestimonialView } from "@/lib/testimonials";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { chonPhanHoiTrangChu } from "./home-thuan";

const TRE = ["", " d2", " d3", " d4"] as const;

/**
 * [05] Phụ huynh nói. Đầu mục + lưới `g4 swipe` + thẻ `card lift sv a-deal` CHÉP từ Main.dc.html; nội dung CHỈ là
 * phản hồi THẬT từ DB (`getTestimonials("home")`). Artifact chỉ có ô giữ chỗ "[Ảnh phản hồi]" — không dựng thẻ giả:
 * rỗng ⇒ ẩn cả khối. (Chưa có ảnh phản hồi thật ⇒ hiện chữ, xem báo cáo.)
 */
export function PhanHoiSection({ danhSach }: { danhSach: readonly TestimonialView[] }) {
  const the = chonPhanHoiTrangChu(danhSach);
  if (the.length === 0) return null;
  return (
      <section className="sec" style={{position: "relative"}}>
        <div className="wrap">
          <div className="head2 sv a-blur">
            <div>
              <span className="label mono">
                <b>
                  [05]
                </b>
                {" "}
                Phụ huynh nói
              </span>
              <h2>
                Phản hồi
                {" "}
                <span className="grad">
                  thật
                </span>
                {" "}
                từ ba mẹ
              </h2>
            </div>
            <PubAnh id="a527dcf965ca43bb78a02cd34fdb0cba" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-150px", width: "140px"}} sizes="140px" />
          </div>
          <div className="g4 swipe">
            {the.map((t, i) => (
              <figure key={`${t.name}-${i}`} className={`card lift sv${TRE[i % TRE.length]} a-deal`} style={{margin: "0", padding: "14px", gap: "12px"}}>
                <blockquote style={{margin: "0", flexGrow: 1, borderRadius: "10px", background: "var(--panel2)", border: "1px solid var(--line)", padding: "16px", fontSize: "14px", lineHeight: "1.6", color: "var(--text)"}}>
                  <span aria-hidden="true" className="mono" style={{display: "block", fontSize: "28px", lineHeight: "1", color: "var(--accT)"}}>
                    “
                  </span>
                  {t.content}
                </blockquote>
                <figcaption style={{display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13px", color: "var(--muted)"}}>
                  <span>
                    <strong style={{color: "var(--text)"}}>{t.name}</strong>
                    {t.role ? ` · ${t.role}` : ""}
                  </span>
                  {t.location ? (
                    <span className="mono" style={{fontSize: "11px", color: "var(--accT)", whiteSpace: "nowrap"}}>
                      {t.location}
                    </span>
                  ) : null}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>
  );
}
