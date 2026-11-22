import { notFound } from "next/navigation";
import { Anh } from "./anh";
import { BieuTuong } from "./bieu-tuong";
import { DangKyHocThuProvider, NutDangKy } from "./dang-ky-hoc-thu";
import { jsonLdKhoa, moTaMetaKhoa, nhanGia, nhanThoiLuong, ghiChuGia, tongBuoiCuaKhoa } from "./khoa-hoc-thuan";
import { dungKhoaKhamPha, layGiaNiemYet, layHocPhan } from "./khoa-hoc-loader";
import { GHI_CHU_HOC_PHI_LIEN_HE, NHAN_HOC_PHI_LIEN_HE } from "@/lib/public/hoc-phi-an";
import { LoTrinhKhamPha } from "./lo-trinh-kham-pha";
import { NOI_DUNG_KHOA } from "./noi-dung-khoa";
import { BanhMi, DauMuc, KhoiCauHoi, KhoiHocPhi, KhoiKeuGoi, KhoiKhoaKhac, type TheKhac } from "./phan-chung";
import { CHU_BIEU_TUONG, CHU_THAN_TRANG, st } from "./st";
import type { HeroKhoa } from "./kieu";
import { JsonLd } from "./json-ld";

const NEN_PHAN_BG2 = "background-color: var(--bg2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line)";
const DELAY = ["", "d2", "d3", "d4"];

function Hero({ hero, ma, lop, thoiLuong }: { hero: HeroKhoa; ma: string; lop: string; thoiLuong: string }) {
  if (hero.kieu === "bp") {
    return (
      <div style={st("position: relative")}>
        <div className="bp">
          <div className="scan" aria-hidden="true" />
          <svg viewBox="0 0 600 440" preserveAspectRatio="none" aria-hidden="true">
            <path className="draw" d="M60 380 H540" />
            <line x1="60" y1="370" x2="60" y2="390" />
            <line x1="540" y1="370" x2="540" y2="390" />
            <path className="draw" d="M560 60 V360" />
            <circle cx="300" cy="200" r="150" style={st("stroke:#93c5fd;stroke-dasharray:4 8;fill:none;opacity:.5")} />
            <path className="draw" d="M120 90 L210 150" />
            <path className="draw" d="M500 300 L410 260" />
          </svg>
          <Anh className="kit" h={hero.anhBo} alt={`Mô hình robot của khoá ${ma}`} priority sizes="(max-width: 860px) 90vw, 520px" />
          <span className="lbl" style={st("left: 6%; top: 7%; max-width: 62%")}>{hero.nhan[0]}</span>
          <span className="lbl" style={st("left: 6%; bottom: 15%")}>{lop.toUpperCase()}</span>
          <span className="lbl" style={st("left: 6%; bottom: 5%")}>{thoiLuong.toUpperCase()}</span>
        </div>
        <Anh className={hero.stickerClass} h={hero.sticker} aria-hidden="true" decoding="async" sizes="120px" style={st(hero.stickerStyle)} />
      </div>
    );
  }
  if (hero.kieu === "scoreb") {
    return (
      <div style={st("position: relative")}>
        <div className="scoreb">
          <Anh h={hero.anh} alt={hero.alt} priority sizes="(max-width: 860px) 90vw, 520px" />
          <div className="lcd">
            <small>THỜI GIAN THI</small>180<i>:</i>00
          </div>
          <div className="bar">
            {hero.thanh.map((t) => (
              <div key={t.l}>
                {t.l.trim()}{" "}
                <span>
                  <b style={st(t.style)} />
                </span>
              </div>
            ))}
          </div>
        </div>
        <Anh className={hero.stickerClass} h={hero.sticker} aria-hidden="true" decoding="async" sizes="120px" style={st(hero.stickerStyle)} />
      </div>
    );
  }
  return (
    <div className="ticket">
      <div className="tk">
        <span className="sh" aria-hidden="true" />
        <span className="mono" style={st("font-size: 11px; letter-spacing: .14em")}>SATA ROBO · GOLDEN TICKET</span>
        <b className="big">
          VÉ VÀNG
          <br />
          CHUNG KẾT
        </b>
        <div className="perf" />
        <div style={st("display: flex; justify-content: space-between; gap: 12px; font-weight: 700")}>
          <span>{thoiLuong}</span>
          <span>Hoàn 100% học phí*</span>
        </div>
        <p style={st("margin: 8px 0 0; font-size: 12px")}>* nếu đi đủ lộ trình mà không vượt vòng loại</p>
      </div>
      <Anh className={hero.stickerClass} h={hero.sticker} aria-hidden="true" decoding="async" sizes="112px" style={st(hero.stickerStyle)} />
    </div>
  );
}

/** Trang chi tiết MỘT khoá (Sata1–8, Combo): bố cục chung, nội dung theo `NOI_DUNG_KHOA[slug]`, học phí từ DB. */
export async function TrangKhoa({ slug }: { slug: string }) {
  const nd = NOI_DUNG_KHOA[slug];
  if (!nd) notFound();
  const t = nd.trang;
  const gia = await layGiaNiemYet(slug);
  const hocPhan = layHocPhan(nd);
  const tong = tongBuoiCuaKhoa(hocPhan);
  const nh = gia ? nhanGia(nd.loai, gia) : null;
  const thoiLuong = nhanThoiLuong(tong);
  const khamPha = dungKhoaKhamPha(slug, gia);

  // Khoá liền kề: giá lấy cùng nguồn để thẻ không in số khác trang riêng của khoá đó.
  const slugKhac = t.khac.map((k) => k.slug).filter((s) => s !== "laptrinhrobot" && s !== "luyenthirobosim");
  const giaKhac = Object.fromEntries(await Promise.all(slugKhac.map(async (s) => [s, await layGiaNiemYet(s)] as const)));
  const giaThapNhat = await layGiaThapNhatNam();
  const khac: TheKhac[] = t.khac.map((k) => {
    if (k.slug === "laptrinhrobot") {
      return {
        href: `/khoa-hoc/${k.slug}`,
        anh: k.img,
        tag: k.tag,
        ten: "Lộ trình 5 năm",
        meta: giaThapNhat ? `Lớp 1–8 · từ ${giaThapNhat}` : "Lớp 1–8",
      };
    }
    if (k.slug === "luyenthirobosim") {
      return { href: `/khoa-hoc/${k.slug}`, anh: k.img, tag: k.tag, ten: "Luyện thi RoboSim Bảng R1 & R2", meta: "R1: lớp 3–5 · R2: lớp 6–9" };
    }
    const kh = NOI_DUNG_KHOA[k.slug];
    const g = giaKhac[k.slug];
    const gNgan = kh && g ? nhanGia(kh.loai, g).ngan : null;
    return {
      href: `/khoa-hoc/${k.slug}`,
      anh: k.img,
      tag: k.tag,
      ten: kh?.ten ?? k.slug,
      meta: [kh?.lop, gNgan].filter(Boolean).join(" · "),
    };
  });

  const dan = moTaMetaKhoa(nd, tong, nh?.ngan ?? "liên hệ trung tâm");
  const tenH1 = nd.loai === "combo" ? "Combo Sata1 + Sata2" : nd.ma;

  return (
    <DangKyHocThuProvider khoaSlug={slug} khoaTen={`${nd.ma} – ${nd.ten}`}>
      <JsonLd data={jsonLdKhoa(nd, gia, dan)} />
      <div id="noi-dung" style={{ fontFamily: CHU_THAN_TRANG }}>
        <header className="subhero gridbg">
          <div className="glow" aria-hidden="true" style={st(`width: 720px; height: 720px; right: -160px; top: -200px; background: radial-gradient(circle, ${t.glow}, transparent 65%)`)} />
          <div className="wrap subhero-grid">
            <div className="load2">
              <BanhMi mucCuoi={tenH1} giuaTen />
              <span className="label mono">
                <b style={{ color: nd.mau, fontFamily: CHU_BIEU_TUONG }}>●</b> {t.nhan}
              </span>
              <h1>
                {t.h1Truoc}
                <span className="grad">{t.h1Nhan}</span>
              </h1>
              <p className="lead">{t.dan}</p>
              <div className="chips">
                <span className="chip">
                  <b>{t.chips[0]}</b>
                </span>
                <span className="chip">{t.chips[1]}</span>
                <span className="chip">{t.chips[2]}</span>
              </div>
              <div style={st("display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px")}>
                <NutDangKy className="btn btn-acc">Đặt buổi học thử 1-1</NutDangKy>
                <a href="#hoc-phi" className="btn btn-line">
                  {nh ? `Học phí ${nh.ngan}` : "Hỏi học phí"}
                </a>
              </div>
            </div>
            <div className="hero-art load3">
              <Hero hero={t.hero} ma={nd.ma} lop={nd.lop} thoiLuong={thoiLuong} />
            </div>
          </div>
        </header>

        <div className="wrap" style={st("margin-top: -10px; position: relative; z-index: 2")}>
          <div className="facts5">
            {[t.chips[0], thoiLuong, "90 phút", nh?.ngan ?? NHAN_HOC_PHI_LIEN_HE].map((v, i) => (
              <div key={t.facts[i].nhan} className={`fact sv ${DELAY[i]} a-pop`}>
                <BieuTuong ma={t.facts[i].icon} />
                <small>{t.facts[i].nhan}</small>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </div>

        <section className="sec">
          <div className="wrap">
            <DauMuc stt="01" nhan="Sau khoá học" tieuDe={<>Con nhận được <span className="grad">gì?</span></>} />
            <div className="g4">
              {t.nhanDuoc.map((c, i) => (
                <article key={c.tieuDe} className={`card lift sv ${DELAY[i]} a-flip`} style={st("padding: 22px; gap: 10px")}>
                  <span className="ico" style={{ color: nd.mau }}>
                    <BieuTuong ma={c.icon} size={22} />
                  </span>
                  <h3>{c.tieuDe}</h3>
                  <p style={st("margin: 0; color: var(--muted)")}>{c.moTa}</p>
                </article>
              ))}
            </div>
            {t.kyNangTrang.length > 0 && (
              <>
                <h3 className="sv a-mask" style={st("margin: 44px 0 16px")}>
                  {t.kyNangTrang.length} kỹ năng cốt lõi
                </h3>
                <div className="g4">
                  {t.kyNangTrang.map((k, i) => (
                    <div key={k} className={`skill sv ${DELAY[i % 4]} a-pop`}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      {k}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section id="chuong-trinh" className="sec gridbg" style={st(NEN_PHAN_BG2)}>
          <div className="wrap">
            <DauMuc
              stt="02"
              nhan="Chương trình học"
              tieuDe={<>Lộ trình <span className="grad">{tong} buổi</span></>}
              phu={<p>Bấm từng học phần để xem con học gì trong mỗi buổi.</p>}
              sticker="87e9462c8a5ae12b7e41aa3b68ced3cc"
              hieuUng="a-blur"
            />
            <LoTrinhKhamPha khoa={[khamPha]} che="trang-khoa" />
          </div>
        </section>

        <KhoiHocPhi
          stt="03"
          tenKhoa={nd.loai === "combo" ? "Combo Sata1 + Sata2" : nd.ma}
          nen={t.nenGia}
          gia={nh}
          ghiChu={gia ? ghiChuGia(slug, nd.loai, gia) : GHI_CHU_HOC_PHI_LIEN_HE}
          diem={t.diemGia}
        />

        <KhoiCauHoi stt="04" tenKhoa={nd.loai === "combo" ? "Combo Sata1 + Sata2" : nd.ma} faqs={t.faqs} />
        <KhoiKhoaKhac stt="05" muc={khac} />
        <KhoiKeuGoi tieuDe="Cho con thử một buổi nhé!" phu="Buổi học thử 1-1 miễn phí – Sata Robo gọi lại trong 30 phút." />
      </div>
    </DangKyHocThuProvider>
  );
}

/** "880.000đ/tháng" — học phí tháng thấp nhất của nhóm Sata3–7 (thẻ "Lập trình Robot" ở phần khoá khác). */
async function layGiaThapNhatNam(): Promise<string | null> {
  const slugs = ["sata3", "sata4", "sata5", "sata6", "sata7"] as const;
  const gia = (await Promise.all(slugs.map((s) => layGiaNiemYet(s)))).filter((g): g is number => !!g);
  if (gia.length === 0) return null;
  return nhanGia("nam", Math.min(...gia)).ngan;
}

