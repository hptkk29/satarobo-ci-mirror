import Link from "next/link";
import { getPromotions } from "@/lib/promotions";
import { getTestimonials } from "@/lib/testimonials";
import { getGifts, getInternalAwards, getCommitments } from "@/lib/marketing-policy";
import { testimonials as testimonialsTinh } from "@/components/legacy-laptrinhrobot/_data/testimonials";
import courseOnline from "@/components/legacy-luyenthirobosim/_data/courses";
import { PROGRAM_END_LABEL, TOTAL_GIFT_VALUE } from "@/lib/uu-dai";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { Anh } from "./anh";
import { BieuTuong } from "./bieu-tuong";
import { DangKyHocThuProvider, NutDangKy } from "./dang-ky-hoc-thu";
import { DanhSachKhoa, type TheHienThi } from "./danh-sach-khoa";
import { JsonLd } from "./json-ld";
import { dungKhoaKhamPha, layBangGia, TAT_CA_SLUG_KHOA } from "./khoa-hoc-loader";
import { giaTheDanhSach, jsonLdDanhSach } from "./khoa-hoc-thuan";
import { LinhVat3D } from "./linh-vat-3d";
import { LoTrinhKhamPha } from "./lo-trinh-kham-pha";
import { CAU_HOI_DANH_SACH, DANH_SACH_THE, TAB_DANH_SACH } from "./noi-dung-khoa";
import { BanhMi, DauMuc, KhoiCauHoi, KhoiKeuGoi } from "./phan-chung";
import { CHU_BIEU_TUONG, CHU_MUI_TEN, CHU_THAN_TRANG, st } from "./st";

const NEN_PHAN_BG2 = "background-color: var(--bg2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line)";

const BUOC_ODAMPCA = [
  ["01 · O", "Quan sát", ""],
  ["02 · D", "Xác định vấn đề", "d2"],
  ["03 · A", "Phân tích", "d3"],
  ["04 · M", "Thiết kế giải pháp", "d4"],
  ["05 · P", "Thực hành", "d4"],
  ["06 · C", "Kiểm thử", "d4"],
  ["07 · A", "Cải tiến", "d4"],
] as const;

const NGUYEN_TAC = [
  { ico: "I2", t: "Học theo dự án (PBL)", d: "Giải bài toán thực tế, làm ra mô hình chạy được sau mỗi chủ đề.", dl: "" },
  { ico: "I5", t: "Học để thành thạo (Mastery)", d: "Con thành thạo rồi mới lên bài mới – không ai bị bỏ lại phía sau.", dl: "d2" },
  { ico: "I0", t: "Lớp nhỏ, kèm sát", d: "Tối đa 12 học viên – giáo viên biết tên và điểm mạnh của từng con.", dl: "d3" },
] as const;

/** "37.200.000đ" → "37,2tr". Không đọc được số thì giữ nguyên chuỗi. */
export function rutGonTrieu(chuoi: string): string {
  const so = Number(chuoi.replace(/[^\d]/g, ""));
  if (!Number.isFinite(so) || so <= 0) return chuoi;
  return `${(so / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")}tr`;
}

async function chonCamNhan() {
  const db = await getTestimonials("laptrinhrobot");
  const tuDb = db.map((r) => ({ noiDung: r.content, ten: r.name, vaiTro: r.role }));
  const tinh = testimonialsTinh.map((r) => ({ noiDung: r.content, ten: r.name, vaiTro: r.role }));
  // Bản thiết kế dùng lời của anh Trường Sơn (một cảm nhận THẬT của repo, được viết gọn lại ở artifact). Ưu tiên đúng
  // người đó ở cả DB lẫn dữ liệu tĩnh; không có thì lấy lời đầu danh sách DB, rồi đầu danh sách tĩnh. Không bịa lời mới.
  const chon = [...tuDb, ...tinh].find((x) => /Trường Sơn/.test(x.ten)) ?? tuDb[0] ?? tinh[0];
  if (!chon) return null;
  return { ...chon, noiDung: chon.noiDung.replace(/^["“]|["”]$/g, "") };
}

/** Trang /khoa-hoc: danh sách thẻ, bộ khám phá lộ trình, phương pháp, thi đấu, ưu đãi, hỏi đáp. */
export async function TrangDanhSach() {
  const [bangGia, khuyenMai, giaiNoiBo, qua, camKet, camNhan] = await Promise.all([
    layBangGia(),
    getPromotions("laptrinhrobot"),
    getInternalAwards(),
    getGifts(),
    getCommitments(),
    chonCamNhan(),
  ]);
  const giaCuaThe = { ...bangGia, ...layGiaOnline() };
  const the: TheHienThi[] = DANH_SACH_THE.map((t) => {
    const g = giaTheDanhSach(t, giaCuaThe);
    return { ...t, giaSo: g.so, giaDonVi: g.donVi };
  });
  const khamPha = TAT_CA_SLUG_KHOA.map((s) => dungKhoaKhamPha(s, bangGia[s] ?? null));
  const uuDai = [...khuyenMai.primary.map((p) => ({ k: p.id, big: p.highlight, t: p.title, d: p.description })), ...khuyenMai.secondary.map((p) => ({ k: p.id, big: p.highlight, t: p.title, d: p.description }))];
  const duocGiai = giaiNoiBo.prizes;
  const cauQuocGia = camKet.filter((c) => c.id === 3 || c.id === 5);

  return (
    <DangKyHocThuProvider khoaSlug={null} khoaTen="Khoá học Sata Robo">
      <JsonLd
        data={jsonLdDanhSach(
          DANH_SACH_THE.filter((t) => t.cat !== "online").map((t) => ({ name: `${t.code} – ${t.name}`, description: t.b.join("; ") })),
        )}
      />
      <div id="noi-dung" style={{ fontFamily: CHU_THAN_TRANG }}>
        <header className="subhero gridbg">
          <div className="glow" aria-hidden="true" style={st("width: 720px; height: 720px; right: -160px; top: -200px")} />
          <div className="wrap subhero-grid">
            <div className="load2">
              <BanhMi mucCuoi="Khoá học" />
              <span className="label mono">
                <b style={{ fontFamily: CHU_BIEU_TUONG }}>●</b> Khoá học Robotics &amp; STEM · Đà Nẵng
              </span>
              <h1>
                Khoá học Robotics cho trẻ <span className="grad">
                  lớp 1 <span style={{ fontFamily: CHU_MUI_TEN }}>→</span> lớp 8
                </span>
              </h1>
              <p className="lead">“Học để phát triển tư duy là đương nhiên, nhưng phải gắn liền với thi đấu.” Lộ trình rõ ràng từ nhập môn đến AI &amp; IoT, cùng các khoá luyện thi Robotics.</p>
              <div className="chips">
                <span className="chip">
                  Hoàn <b>100%</b> nếu buổi đầu không phù hợp
                </span>
                <span className="chip">
                  <b>≤12</b> học viên / lớp
                </span>
                <span className="chip">
                  Trả góp <b>0%</b>
                </span>
                <span className="chip">Lab Robotics đầy đủ</span>
              </div>
              <div style={st("display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px")}>
                <NutDangKy className="btn btn-acc">
                  Đặt buổi học thử 1-1 miễn phí
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 17L17 7M8 7h9v9" />
                  </svg>
                </NutDangKy>
                <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" className="btn btn-line">
                  Chat Zalo
                </a>
              </div>
            </div>
            <div className="hero-art load3">
              <div className="ring-photo">
                <Anh h="444bae85d36170392c4e4c131e845d0e" alt="Học viên lắp robot" priority sizes="(max-width: 860px) 80vw, 480px" />
              </div>
              <div className="kitf" style={st("left: -2%; top: 8%")}>
                <Anh h="a666ac3e1e338d2186c3c7704b0fa511" sizes="120px" />
                <b>Alpha Set</b>
                <small>Sata3</small>
              </div>
              <div className="kitf" style={st("right: -2%; top: 30%; animation-delay: -1.6s")}>
                <Anh h="dbdef77fa2d35499f574fa1ec71acf88" sizes="120px" />
                <b>Beta Set</b>
                <small>Sata4·6</small>
              </div>
              <div className="kitf" style={st("left: 4%; bottom: 2%; animation-delay: -3s")}>
                <Anh h="0f72f010d69f5bd7650a9e5a4f2a072a" sizes="120px" />
                <b>Intel Set</b>
                <small>Sata5·7</small>
              </div>
              <LinhVat3D
                style={st("left: 62%; right: -6%; top: 58%; bottom: -8%")}
                poster={{ id: "09822f256fe47024e33331af8e3a0ea5", alt: "Linh vật 3D Sata Robo", sizes: "(max-width: 860px) 40vw, 160px", className: "float", style: st("position: absolute; left: 50%; top: 50%; translate: -50% -50%; height: auto; z-index: 3; width: 70%") }}
              />
            </div>
          </div>
        </header>

        <section id="danh-sach" className="sec">
          <div className="wrap">
            <DauMuc
              stt="01"
              nhan="Chọn khoá phù hợp"
              tieuDe={<>Tất cả khoá học <span className="grad">Robotics</span></>}
              phu={<p>Lọc theo nhu cầu: học chuyên sâu cả năm, luyện thi offline hoặc học online.</p>}
              sticker="fe4be01fb9d5892165c884ae5d265246"
            />
            <DanhSachKhoa tabs={TAB_DANH_SACH} the={the} />
          </div>
        </section>

        <section id="lo-trinh" className="sec">
          <div className="wrap">
            <div className="ex-head sv a-mask">
              <span className="label mono">
                <b>[02]</b> Lộ trình đào tạo
              </span>
              <h2>
                Lộ trình học Robotics tại <span className="grad">Sata Robo</span>
              </h2>
              <p>Ba mẹ chọn khoá luyện thi Robotics 2026 hoặc lộ trình chuyên sâu 48 buổi theo lớp của con – bấm vào từng học phần để xem con học gì mỗi buổi.</p>
            </div>
            <LoTrinhKhamPha khoa={khamPha} che="danh-sach" />
          </div>
        </section>

        <section className="sec">
          <div className="wrap">
            <DauMuc
              stt="03"
              nhan="Phương pháp ODAMPCA"
              tieuDe={<>7 bước của <span className="grad">một kỹ sư nhí</span></>}
              phu={<p>Mỗi bài học đi trọn chu trình: quan sát, xác định vấn đề, phân tích, thiết kế giải pháp, thực hành, kiểm thử và cải tiến.</p>}
              sticker="a8d293a9efc52ad97026bd2d0dc02db2"
            />
            <div className="steps">
              {BUOC_ODAMPCA.map(([n, t, dl]) => (
                <div key={n} className={`step sv ${dl} a-pop`}>
                  <span className="n">{n}</span>
                  <p style={st("margin: 6px 0 0; font-weight: 700")}>{t}</p>
                </div>
              ))}
            </div>
            <div className="g3" style={st("margin-top: 16px")}>
              {NGUYEN_TAC.map((n) => (
                <div key={n.t} className={`card sv ${n.dl} a-tilt`} style={st("padding: 20px; gap: 8px")}>
                  <span className="ico">
                    <BieuTuong ma={n.ico} size={20} />
                  </span>
                  <h3>{n.t}</h3>
                  <p style={st("margin: 0; color: var(--muted); font-size: 15px")}>{n.d}</p>
                </div>
              ))}
            </div>
            <p className="sv a-blur" style={st("margin: 26px 0 0; text-align: center; font-family: 'Unbounded', sans-serif; font-weight: 500; font-size: clamp(18px,1.8vw,24px)")}>
              Con không học để đối phó. Con học để <span className="grad">thật sự hiểu</span> và <span className="grad">thật sự làm được.</span>
            </p>
          </div>
        </section>

        <section className="sec gridbg" style={st(NEN_PHAN_BG2)}>
          <div className="wrap">
            <DauMuc stt="04" nhan="Thi đấu & giải thưởng" tieuDe={<>Học xong là <span className="grad">ra sân đấu</span></>} sticker="5b2733eebd8a2725fab2afb4c936fd4b" />
            <div className="g2" style={st("align-items: start")}>
              <div className="card sv a-flip" style={st("padding: 22px; gap: 14px")}>
                <div style={st("display: flex; justify-content: space-between; align-items: flex-start; gap: 10px")}>
                  <div>
                    <span className="tag">Giải nội bộ hàng tháng</span>
                    <h3 style={st("margin-top: 10px")}>Sata Robo Championship</h3>
                  </div>
                  <div style={st("text-align: right")}>
                    <div className="num-big grad">{rutGonTrieu(giaiNoiBo.totalValue)}</div>
                    <span className="mono" style={st("font-size: 11px; color: var(--muted)")}>
                      tổng giải / năm
                    </span>
                  </div>
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Hạng</th>
                      <th>Giải thưởng mỗi tháng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {duocGiai.map((g) => (
                      <tr key={String(g.rank)}>
                        <td>
                          {g.icon} {g.name}
                        </td>
                        <td>{g.reward}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={st("margin: 0; color: var(--muted); font-size: 14px")}>
                  {giaiNoiBo.perYear} kỳ thi mỗi năm · {giaiNoiBo.perEvent} giải thưởng mỗi kỳ.
                </p>
              </div>
              <div className="card sv d2 a-flip" style={st("gap: 0")}>
                <div className="zoom" style={st("height: 220px; overflow: hidden")}>
                  <Anh h="3baf3bfe1445c597a9ac1cf30f4ef9b3" alt="Lễ trao giải Cuộc thi Sáng tạo Robotics TP Đà Nẵng" loading="lazy" sizes="(max-width: 860px) 90vw, 560px" style={st("width: 100%; height: 100%; object-fit: cover")} />
                </div>
                <div style={st("padding: 22px; display: grid; gap: 10px")}>
                  <span className="tag" style={st("justify-self: start")}>
                    Cấp quốc gia
                  </span>
                  <h3>Cuộc thi Sáng tạo Robotics</h3>
                  <p style={st("margin: 0; color: var(--muted); font-size: 15px")}>
                    Do Thành Đoàn tổ chức. Vòng loại thi trực tuyến trên RoboSim, sau đó là chung kết khu vực và cơ hội tiến tới WRC – World Robot Championship.
                  </p>
                  <ul style={st("margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 14px")}>
                    {cauQuocGia.map((c) => (
                      <li key={c.id}>{c.title}</li>
                    ))}
                    <li>Sata Robo phối hợp tổ chức cuộc thi cấp TP Đà Nẵng</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec">
          <div className="wrap">
            <DauMuc stt="05" nhan="Ưu đãi" tieuDe={<>Ưu đãi <span className="grad">khai trương</span></>} sticker="da847c40d631e0b7a535a73c3172ac50" />
            <div className="uu-dai-grid">
              {uuDai.map((u, i) => (
                <div key={u.k} className={`card sv ${["", "d2", "d3", "d4"][i % 4]} a-deal`} style={st("padding: 18px; gap: 6px")}>
                  <span className="num-big grad" style={{ fontSize: u.big.length > 10 ? 20 : 30 }}>
                    {u.big}
                  </span>
                  <strong>{u.t}</strong>
                  <span style={st("color: var(--muted); font-size: 14px")}>{u.d}</span>
                </div>
              ))}
            </div>
            <div className="sv a-iris gift-band" style={st("margin-top: 18px; border-radius: 24px; background: var(--band); color: #fff; padding: clamp(22px,3vw,34px); display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: center")}>
              <Anh className="float" h="09822f256fe47024e33331af8e3a0ea5" aria-hidden="true" decoding="async" sizes="170px" style={st("height: auto; width: clamp(110px,14vw,170px)")} />
              <div>
                <span className="mono" style={st("font-size: 12px; color: #ffd3a8")}>
                  Quà tặng khai trương
                </span>
                <p style={st("margin: 6px 0 12px; font-family: 'Unbounded', sans-serif; font-weight: 600; font-size: clamp(20px,2.2vw,28px)")}>Bộ quà trị giá {TOTAL_GIFT_VALUE}</p>
                <ul style={st("margin: 0; padding: 0; list-style: none")}>
                  {qua.map((q) => (
                    <li key={q.id} style={st("display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.18)")}>
                      <span>{q.title}</span>
                      <b>{q.value}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mono" style={st("margin: 12px 0 0; font-size: 11px; color: var(--muted)")}>
              Ưu đãi áp dụng đến hết {PROGRAM_END_LABEL}.
            </p>
          </div>
        </section>

        {camNhan && (
          <section className="sec" style={st("padding-top: 0")}>
            <div className="wrap" style={st("max-width: 900px")}>
              <figure className="sv a-blur" style={st("margin: 0; text-align: center; padding: clamp(24px,4vw,40px); border-radius: 24px; border: 1px solid var(--line2); background: var(--panel)")}>
                <p style={st("margin: 0; color: #f5c344; font-size: 22px; letter-spacing: 4px")} aria-label="5 sao">
                  ★★★★★
                </p>
                <blockquote style={st("margin: 14px 0 0; font-family: 'Unbounded', sans-serif; font-weight: 500; font-size: clamp(17px,1.7vw,22px); line-height: 1.55")}>“{camNhan.noiDung}”</blockquote>
                <figcaption style={st("margin-top: 14px; color: var(--muted)")}>
                  {camNhan.ten} · {camNhan.vaiTro}
                </figcaption>
              </figure>
            </div>
          </section>
        )}

        <KhoiCauHoi stt="06" tenKhoa="khoá học" faqs={CAU_HOI_DANH_SACH} />
        <KhoiKeuGoi
          tieuDe="Chưa biết con hợp khoá nào?"
          phu="Buổi học thử 1-1 miễn phí có 45 phút đánh giá đầu vào – giáo viên sẽ gợi ý lộ trình phù hợp."
          anh="42d4d66e4311582de0d03b3122bb7b04"
        />
        <p className="wrap" style={st("margin: 0; padding-bottom: 8px; text-align: center; font-size: 13px; color: var(--muted)")}>
          Tìm hiểu thêm: <Link href="/khoa-hoc/laptrinhrobot">Lập trình Robot – lộ trình 5 năm</Link> · <Link href="/khoa-hoc/luyenthirobosim">Luyện thi RoboSim online</Link>
        </p>
      </div>
    </DangKyHocThuProvider>
  );
}

/** Học phí khoá online (SataWorld): thấp nhất trong các bảng đang bán — đọc từ dữ liệu bảng R1/R2. */
function layGiaOnline(): Record<string, number> {
  const gia = courseOnline.map((c) => Number(c.salePrice.replace(/[^\d]/g, ""))).filter((v) => v > 0);
  return gia.length ? { luyenthirobosim: Math.min(...gia) } : {};
}
