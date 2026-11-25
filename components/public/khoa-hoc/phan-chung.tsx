import Link from "next/link";
import type { ReactNode } from "react";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { NHAN_HOC_PHI_LIEN_HE } from "@/lib/public/hoc-phi-an";
import { Anh } from "./anh";
import { NutDangKy } from "./dang-ky-hoc-thu";
import { FaqAccordion } from "./faq-accordion";
import { st } from "./st";

/** Khối dùng chung của các trang khoá học (đầu mục, FAQ, khoá khác, kêu gọi hành động). */

const STICKER_MAC_DINH = "right: 0; top: -124px; width: 112px; height: auto";

type DauMucProps = {
  stt: string;
  nhan: string;
  /** Tiêu đề h2; truyền sẵn `<span className="grad">` cho phần nhấn. */
  tieuDe: ReactNode;
  phu?: ReactNode;
  sticker?: string;
  stickerStyle?: string;
  hieuUng?: "a-mask" | "a-blur";
};

export function DauMuc({ stt, nhan, tieuDe, phu, sticker, stickerStyle, hieuUng = "a-mask" }: DauMucProps) {
  return (
    <div className={`head2 sv ${hieuUng}`}>
      <div>
        <span className="label mono">
          <b>[{stt}]</b> {nhan}
        </span>
        <h2>{tieuDe}</h2>
      </div>
      {phu ?? <span />}
      {sticker && <Anh className="sticker bob hide-sm" h={sticker} aria-hidden="true" loading="lazy" sizes="112px" style={st(stickerStyle ?? STICKER_MAC_DINH)} />}
    </div>
  );
}

export function BanhMi({ mucCuoi, giuaTen }: { mucCuoi: string; giuaTen?: boolean }) {
  return (
    <nav className="crumb" aria-label="Breadcrumb">
      <Link href="/">Trang chủ</Link>
      <span aria-hidden="true">/</span>
      {giuaTen ? (
        <>
          <Link href="/khoa-hoc">Khoá học</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{mucCuoi}</span>
        </>
      ) : (
        <span aria-current="page">{mucCuoi}</span>
      )}
    </nav>
  );
}

const NEN_PHAN_CAU_HOI = "background-color: var(--bg2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line)";

export function KhoiCauHoi({ stt, tenKhoa, faqs }: { stt: string; tenKhoa: ReactNode; faqs: readonly (readonly [string, string])[] }) {
  return (
    <section className="sec gridbg" style={st(NEN_PHAN_CAU_HOI)}>
      <div className="wrap" style={st("max-width: 920px")}>
        <div className="sv a-pop" style={st("text-align: center; margin-bottom: 36px; position: relative")}>
          <span className="label mono">
            <b>[{stt}]</b> Ba mẹ thường hỏi
          </span>
          <h2>
            Câu hỏi về <span className="grad">{tenKhoa}</span>
          </h2>
          <Anh className="sticker bob hide-sm" h="933e29639ed926731a405c5e0289c62d" aria-hidden="true" loading="lazy" sizes="120px" style={st("right: -40px; top: -50px; width: 120px; height: auto")} />
        </div>
        <FaqAccordion faqs={faqs} />
      </div>
    </section>
  );
}

export type TheKhac = { href: string; anh: string; tag: string; ten: string; meta: string };

export function KhoiKhoaKhac({ stt, muc }: { stt: string; muc: TheKhac[] }) {
  return (
    <section className="sec">
      <div className="wrap">
        <DauMuc stt={stt} nhan="Khoá học khác" tieuDe={<>Lộ trình <span className="grad">tiếp theo</span></>} sticker="fe4be01fb9d5892165c884ae5d265246" />
        <div className="g3">
          {muc.map((m, i) => (
            <Link key={m.href} href={m.href} className={`news-card sv ${i === 0 ? "" : `d${i + 1}`} a-deal`}>
              <span className="thumb" style={st("background: var(--panel2); display: flex; align-items: center; justify-content: center")}>
                <Anh h={m.anh} loading="lazy" sizes="(max-width: 860px) 90vw, 360px" style={st("object-fit: contain; padding: 14px")} />
              </span>
              <span style={st("padding: 16px; display: grid; gap: 6px")}>
                <span className="tag" style={st("justify-self: start")}>
                  {m.tag}
                </span>
                <strong style={st("font-family: 'Unbounded', sans-serif; font-weight: 600; font-size: 17px")}>{m.ten}</strong>
                <span style={st("color: var(--muted); font-size: 14px")}>{m.meta}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

type CtaProps = { tieuDe: string; phu: string; anh?: string };

export function KhoiKeuGoi({ tieuDe, phu, anh = "da847c40d631e0b7a535a73c3172ac50" }: CtaProps) {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="cta-band sv a-iris">
          <div style={st("display: flex; align-items: center; gap: 18px")}>
            <Anh className="bob" h={anh} aria-hidden="true" loading="lazy" sizes="96px" style={st("width: 96px; height: auto; flex-shrink: 0; filter: drop-shadow(0 12px 16px rgba(0,0,0,.35))")} />
            <div>
              <p style={st("margin: 0; font-family: 'Unbounded', sans-serif; font-weight: 600; font-size: clamp(19px,2vw,26px); line-height: 1.3")}>{tieuDe}</p>
              <p style={st("margin: 6px 0 0; color: #f3e4ff")}>{phu}</p>
            </div>
          </div>
          <div style={st("display: flex; flex-wrap: wrap; gap: 10px")}>
            <NutDangKy className="btn btn-acc">Đặt buổi học thử miễn phí</NutDangKy>
            <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" className="btn" style={st("background: rgba(255,255,255,.12); color: #fff; border: 1.5px solid rgba(255,255,255,.4)")}>
              Chat Zalo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

type KhoiGiaProps = {
  stt: string;
  tenKhoa: string;
  nen: string;
  gia: { so: string; donVi: string } | null;
  ghiChu: string;
  diem: readonly string[];
  /** Tiền tố trước số tiền ("từ "). */
  tienTo?: string;
  /** Khối phụ bên phải, dưới câu dẫn (vd quà tặng). */
  phuPhai?: ReactNode;
};

/** Khối học phí: hộp giá + tiêu đề "Đầu tư rõ ràng, minh bạch". Không có giá ⇒ hộp chỉ mời tư vấn (không bịa số). */
export function KhoiHocPhi({ stt, tenKhoa, nen, gia, ghiChu, diem, tienTo, phuPhai }: KhoiGiaProps) {
  return (
    <section id="hoc-phi" className="sec">
      <div className="wrap">
        <div className="g2" style={st("align-items: center; gap: 40px")}>
          <div className="price-box sv a-iris" style={st(`background: ${nen}`)}>
            <span className="tag">Học phí {tenKhoa}</span>
            {gia ? (
              <p
                style={st("margin: 12px 0 0; font-family: 'Unbounded', sans-serif; font-weight: 700; font-size: clamp(32px,3.6vw,48px)")}
                className="grad"
              >
                {tienTo}
                {gia.so}
                <span style={st("font-size: .45em; -webkit-text-fill-color: var(--muted)")}>{gia.donVi}</span>
              </p>
            ) : (
              <p style={st("margin: 12px 0 0; font-family: 'Unbounded', sans-serif; font-weight: 700; font-size: clamp(24px,2.6vw,34px)")} className="grad">
                {NHAN_HOC_PHI_LIEN_HE}
              </p>
            )}
            <p style={st("margin: 4px 0 18px; color: var(--muted)")}>{ghiChu}</p>
            <ul style={st("margin: 0 0 20px; padding-left: 20px; display: grid; gap: 6px")}>
              {diem.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <div style={st("display: flex; flex-wrap: wrap; gap: 10px")}>
              <NutDangKy className="btn btn-acc">Học thử 1-1 miễn phí</NutDangKy>
              <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" className="btn btn-line">
                Hỏi qua Zalo
              </a>
              {/* Không in giá ⇒ đưa số hotline ra ngay cạnh, ba mẹ gọi hỏi giá một chạm. */}
              {!gia && (
                <a href={`tel:${SATA_ROBO_PHONE.tho}`} className="btn btn-line">
                  Gọi {SATA_ROBO_PHONE.hien}
                </a>
              )}
            </div>
          </div>
          <div>
            <DauMuc stt={stt} nhan="Học phí" tieuDe={<>Đầu tư rõ ràng, <span className="grad">minh bạch</span></>} sticker="09822f256fe47024e33331af8e3a0ea5" />
            <p style={st("margin: 0; color: var(--muted)")}>
              Ba mẹ chưa chắc con hợp? Đặt buổi học thử 1-1: giáo viên đánh giá năng lực và gợi ý lộ trình. Sata Robo gọi lại trong <b style={st("color: var(--text)")}>30 phút</b>.
            </p>
            {phuPhai}
          </div>
        </div>
      </div>
    </section>
  );
}
