import Link from "next/link";
import { getGifts } from "@/lib/marketing-policy";
import { TOTAL_GIFT_VALUE } from "@/lib/uu-dai";
import courseOnline from "@/components/legacy-luyenthirobosim/_data/courses";
import { dinhDangTien } from "@/lib/gia-cong-khai";
import { Anh } from "./anh";
import { BieuTuong } from "./bieu-tuong";
import { DangKyHocThuProvider, NutDangKy } from "./dang-ky-hoc-thu";
import { JsonLd } from "./json-ld";
import { BASE_URL, giaThangTuNam, nhanGia } from "./khoa-hoc-thuan";
import { layGiaNiemYet } from "./khoa-hoc-loader";
import { GHI_CHU_HOC_PHI_LIEN_HE } from "@/lib/public/hoc-phi-an";
import { THU_TU_KHOA_NAM, NOI_DUNG_KHOA } from "./noi-dung-khoa";
import { BanhMi, DauMuc, KhoiCauHoi, KhoiHocPhi, KhoiKeuGoi, KhoiKhoaKhac } from "./phan-chung";
import { CHU_BIEU_TUONG, CHU_THAN_TRANG, st } from "./st";

const NEN_PHAN_BG2 = "background-color: var(--bg2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line)";
const DELAY = ["", "d2", "d3", "d4"];

const CAU_HOI_LAP_TRINH: [string, string][] = [
  ["Con chưa biết gì về robot có học được không?", "Được. Giáo viên đánh giá đầu vào trong buổi học thử 1-1 và xếp con vào cấp độ phù hợp."],
  ["Mỗi lớp có bao nhiêu học viên?", "Lớp nhỏ, tối đa 12 học viên để giáo viên theo sát từng bạn."],
  ["Ba mẹ theo dõi việc học của con thế nào?", "Giáo viên gửi nhận xét sau mỗi buổi; cuối mỗi 12 buổi con thuyết trình sản phẩm trước ba mẹ."],
  ["Học phí có trả góp được không?", "Có. Khoá chuyên sâu 48 buổi hỗ trợ trả góp theo tháng – tư vấn viên gửi phương án chi tiết."],
  ["Nếu học thử không hợp thì sao?", "Buổi học thử 1-1 hoàn toàn miễn phí. Sau buổi học đầu tiên, nếu ba mẹ không hài lòng, Sata Robo hoàn 100% học phí."],
];

const CAU_HOI_ONLINE: [string, string][] = [
  ["Cần biết lập trình trước không?", "Không cần – xem video là làm theo được."],
  ["Lớp 5 chọn R1 hay R2?", "Chọn R1, theo bảng đề vòng loại."],
  ["Đổi bảng được không?", "Được, miễn phí trong 7 ngày đầu."],
  ["Có cần mua robot thật không?", "Không. Chỉ cần laptop cài RoboSim."],
  ["Học theo lịch cố định không?", "Không. Video xem bất cứ lúc nào, khuyến nghị 2–3 buổi/tuần."],
];

const CAM_KET_LAP_TRINH = [
  "Lớp nhỏ, tối đa 12 học viên",
  "Hoàn 100% học phí nếu không hài lòng sau buổi đầu",
  "Nhận xét sau mỗi buổi học",
  "Demo sản phẩm cho ba mẹ mỗi 12 buổi",
  "Trả góp 0% cho khoá 48 buổi",
  "Học phí niêm yết rõ ràng, đã gồm VAT",
];

const PHUONG_PHAP = [
  { tag: "ODAMPCA", d: "Quan sát → Xác định → Phân tích → Thiết kế → Thực hành → Kiểm thử → Cải tiến.", dl: "" },
  { tag: "Học theo dự án (PBL)", d: "Mỗi buổi là một dự án có câu chuyện và sản phẩm thật.", dl: "d2" },
  { tag: "Mastery Learning", d: "Vững kiến thức nền trước khi lên cấp tiếp theo.", dl: "d3" },
];

/** Tên ngắn của bốn món quà trên thẻ (đúng chữ của thiết kế); món lạ giữ nguyên tên trong repo. Giá trị lấy từ repo. */
function tenQuaNgan(q: { id: number; title: string; value: string }): string {
  const ngan: Record<number, string> = { 1: "Đồng phục Sata Robo", 2: "Bộ đề luyện RoboSim", 3: "E-book STEM", 4: `Voucher thiết bị ${q.value}` };
  return ngan[q.id] ?? q.title;
}

const CHIEU_CAO_BAC = [46, 58, 70, 82, 94];

/** /khoa-hoc/laptrinhrobot — trang tổng quan lộ trình 5 năm (Sata3 → Sata7). */
export async function TrangLapTrinhRobot() {
  const [gia, qua] = await Promise.all([
    Promise.all(THU_TU_KHOA_NAM.map(async (s) => [s, await layGiaNiemYet(s)] as const)),
    getGifts(),
  ]);
  const giaTheo = Object.fromEntries(gia);
  const so = gia.map(([, g]) => g).filter((g): g is number => !!g).map(giaThangTuNam);
  const thap = so.length ? Math.min(...so) : null;
  const cao = so.length ? Math.max(...so) : null;
  const gTuThang = thap ? `${dinhDangTien(thap)}/tháng` : null;
  const gKhoac = thap ? { so: dinhDangTien(thap), donVi: "/tháng" } : null;
  const ghiChu = thap && cao ? `Sata3 → Sata7: ${dinhDangTien(thap)} – ${dinhDangTien(cao)}/tháng · 4 buổi/tháng · đã gồm VAT · trả góp 0%` : GHI_CHU_HOC_PHI_LIEN_HE;
  const gSata1 = await layGiaNiemYet("sata1");
  const gCombo = await layGiaNiemYet("combo-sata1-sata2");
  const gOnline = layGiaThapNhatOnline();
  const url = `${BASE_URL}/khoa-hoc/laptrinhrobot`;
  const dan = "Một lộ trình 5 năm cho con từ 6 đến 13 tuổi: mỗi năm một cấp độ, từ lắp ráp cơ khí đến robot dùng trí tuệ nhân tạo – học tại 2 cơ sở ở Đà Nẵng.";
  const nhanNam = THU_TU_KHOA_NAM.map((s) => NOI_DUNG_KHOA[s]);

  return (
    <DangKyHocThuProvider khoaSlug="laptrinhrobot" khoaTen="Lập trình Robot – Lộ trình 5 năm">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "EducationalOrganization", "@id": `${BASE_URL}/#org`, name: "Sata Robo", url: `${BASE_URL}/` },
            {
              "@type": "Course",
              name: "Lập trình Robot – Lộ trình 5 năm",
              description: dan,
              provider: { "@id": `${BASE_URL}/#org` },
              inLanguage: "vi-VN",
              educationalLevel: "Lớp 1–8",
              hasCourseInstance: { "@type": "CourseInstance", courseMode: "onsite" },
            },
            {
              "@type": "FAQPage",
              mainEntity: CAU_HOI_LAP_TRINH.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Trang chủ", item: `${BASE_URL}/` },
                { "@type": "ListItem", position: 2, name: "Khoá học", item: `${BASE_URL}/khoa-hoc` },
                { "@type": "ListItem", position: 3, name: "Lập trình Robot", item: url },
              ],
            },
          ],
        }}
      />
      <div id="noi-dung" style={{ fontFamily: CHU_THAN_TRANG }}>
        <header className="subhero gridbg">
          <div className="glow" aria-hidden="true" style={st("width: 720px; height: 720px; right: -160px; top: -200px; background: radial-gradient(circle, #fe8f2d55, transparent 65%)")} />
          <div className="wrap subhero-grid">
            <div className="load2">
              <BanhMi mucCuoi="Lập trình Robot" giuaTen />
              <span className="label mono">
                <b style={{ color: "#fe8f2d", fontFamily: CHU_BIEU_TUONG }}>●</b> Alpha · Beta · Storm · AI
              </span>
              <h1>
                Lập trình Robot – <span className="grad">Lộ trình 5 năm</span>
              </h1>
              <p className="lead">{dan}</p>
              <div className="chips">
                <span className="chip">
                  <b>Lớp 1–8</b>
                </span>
                <span className="chip">48 buổi/năm · 72 giờ/năm</span>
                <span className="chip">90 phút/buổi</span>
              </div>
              <div style={st("display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px")}>
                <NutDangKy className="btn btn-acc">Đặt buổi học thử 1-1</NutDangKy>
                <a href="#hoc-phi" className="btn btn-line">
                  {gTuThang ? `Học phí từ ${gTuThang}` : "Xem học phí"}
                </a>
              </div>
            </div>
            <div className="hero-art load3">
              <div className="stairs">
                {nhanNam.map((k, i) => (
                  <Link key={k.slug} href={`/khoa-hoc/${k.slug}`} style={st(`height: ${CHIEU_CAO_BAC[i]}%; animation-delay: ${(i * 0.12).toFixed(2)}s`)}>
                    <Anh h={k.anhBo} aria-hidden="true" sizes="120px" />
                    <b>{k.ma}</b>
                    <small>{k.lop}</small>
                  </Link>
                ))}
                <Anh className="float" h="677f6b6846ebf7628e125173d5ab78eb" aria-hidden="true" decoding="async" sizes="120px" style={st("height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); left: 0; top: 0; width: 120px; z-index: 4")} />
              </div>
            </div>
          </div>
        </header>

        <div className="wrap" style={st("margin-top: -10px; position: relative; z-index: 2")}>
          <div className="facts5">
            {[
              ["I0", "Đối tượng", "Lớp 1–8"],
              ["I1", "Thời lượng", "48 buổi/năm · 72 giờ/năm"],
              ["I2", "Mỗi buổi", "90 phút"],
              ["I3", "Học phí", gTuThang ? `từ ${gTuThang}` : "Liên hệ tư vấn"],
            ].map(([ic, l, v], i) => (
              <div key={l} className={`fact sv ${DELAY[i]} a-pop`}>
                <BieuTuong ma={ic} />
                <small>{l}</small>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </div>

        <section className="sec gridbg" style={st(NEN_PHAN_BG2)}>
          <div className="wrap">
            <DauMuc
              stt="01"
              nhan="Chương trình học"
              tieuDe={<>5 năm, <span className="grad">5 cấp độ</span></>}
              phu={<p>Mỗi năm 48 buổi · 72 giờ – giáo viên xếp cấp độ sau buổi đánh giá đầu vào.</p>}
              sticker="87e9462c8a5ae12b7e41aa3b68ced3cc"
              hieuUng="a-blur"
            />
            <div className="cur-grid" style={st("display: grid; grid-template-columns: minmax(0,1.5fr) minmax(0,1fr); gap: 36px; align-items: start")}>
              <div>
                <div style={st("display: grid; gap: 12px")}>
                  {nhanNam.map((k) => {
                    const g = giaTheo[k.slug];
                    return (
                      <Link key={k.slug} href={`/khoa-hoc/${k.slug}`} className="job" style={st("grid-template-columns: 90px minmax(0,1fr) auto")}>
                        <Anh h={k.anhBo} aria-hidden="true" sizes="90px" style={st("width: 90px; height: 64px; object-fit: contain")} />
                        <span>
                          <h3 style={st("font-size: 17px")}>
                            {k.ma} – {k.ten}
                          </h3>
                          <span className="meta">
                            <span className="tag">{k.lop}</span>
                            <span className="chip" style={st("padding: 3px 10px; font-size: 12px")}>
                              {k.trang.nhan}
                            </span>
                          </span>
                        </span>
                        <span className="go">
                          {g && <b>{nhanGia("nam", g).ngan}</b>}
                          <small>Xem chi tiết →</small>
                        </span>
                      </Link>
                    );
                  })}
                </div>
                <h3 className="sv a-mask" style={st("margin: 40px 0 14px")}>
                  Phương pháp giảng dạy
                </h3>
                <div className="g3">
                  {PHUONG_PHAP.map((p) => (
                    <div key={p.tag} className={`card sv ${p.dl} a-flip`} style={st("padding: 20px; gap: 8px")}>
                      <span className="tag" style={st("align-self: flex-start")}>
                        {p.tag}
                      </span>
                      <p style={st("margin: 0; color: var(--muted)")}>{p.d}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sv a-tilt" style={st("position: sticky; top: 100px; display: grid; gap: 14px")}>
                <div className="ph" style={st("position: relative; height: 300px; rotate: -2deg")}>
                  <Anh h="817119f3691f9cd172643974d8b5d84c" alt="Học viên Sata Robo" loading="lazy" sizes="(max-width: 860px) 90vw, 440px" />
                </div>
                <div className="card" style={st("padding: 20px; gap: 10px")}>
                  <b>Cam kết minh bạch</b>
                  <ul style={st("margin: 0; padding-left: 20px; display: grid; gap: 6px; font-size: 14px")}>
                    {CAM_KET_LAP_TRINH.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <KhoiHocPhi
          stt="02"
          tenKhoa="Lập trình Robot"
          nen="linear-gradient(140deg, #fe8f2d33, rgba(254,143,45,.14))"
          gia={gKhoac}
          tienTo="từ "
          ghiChu={ghiChu}
          diem={[gKhoac ? "Học phí niêm yết, đã gồm VAT" : "Học phí đã gồm VAT", "Trả góp 0% cho khoá 48 buổi", `Quà tặng trị giá ${TOTAL_GIFT_VALUE}`, "Hoàn tiền nếu không hài lòng sau buổi đầu"]}
          phuPhai={
            <div className="g4" style={st("margin-top: 22px")}>
              {qua.map((q, i) => (
                <div key={q.id} className={`skill sv ${DELAY[i % 4]} a-pop`}>
                  <span>🎁</span>
                  {tenQuaNgan(q)}
                </div>
              ))}
            </div>
          }
        />

        <KhoiCauHoi stt="03" tenKhoa="Lập trình Robot" faqs={CAU_HOI_LAP_TRINH} />
        <KhoiKhoaKhac
          stt="04"
          muc={[
            { href: "/khoa-hoc/sata1", anh: "bb38a24d4c4cbde40ee43774b5002179", tag: "Gợi ý · Sata1", ten: "Robosim Master", meta: `Lớp 3–8${gSata1 ? ` · ${nhanGia("luyen-thi", gSata1).ngan}` : ""}` },
            { href: "/khoa-hoc/combo-sata1-sata2", anh: "3d425f2a2c063a1916225676ca19f4f4", tag: "Gợi ý · Combo Sata1 + Sata2", ten: "Full lộ trình luyện thi", meta: `Lớp 3–8${gCombo ? ` · ${nhanGia("combo", gCombo).ngan}` : ""}` },
            { href: "/khoa-hoc/luyenthirobosim", anh: "b09f648ab11d0579d24805fe838e0900", tag: "Gợi ý · Online · SataWorld", ten: "Luyện thi RoboSim Bảng R1 & R2", meta: `R1: lớp 3–5 · R2: lớp 6–9${gOnline ? ` · ${gOnline}/bảng` : ""}` },
          ]}
        />
        <KhoiKeuGoi tieuDe="Cho con thử một buổi nhé!" phu="Buổi học thử 1-1 miễn phí – Sata Robo gọi lại trong 30 phút." />
      </div>
    </DangKyHocThuProvider>
  );
}

function layGiaThapNhatOnline(): string | null {
  const gia = courseOnline.map((c) => Number(c.salePrice.replace(/[^\d]/g, ""))).filter((v) => v > 0);
  return gia.length ? dinhDangTien(Math.min(...gia)) : null;
}

/** /khoa-hoc/luyenthirobosim — luyện thi RoboSim online (SataWorld), hai bảng R1/R2. */
export async function TrangLuyenThiOnline() {
  const [gSata8, gCombo] = await Promise.all([layGiaNiemYet("sata8"), layGiaNiemYet("combo-sata1-sata2")]);
  const gOnline = layGiaThapNhatOnline();
  const url = `${BASE_URL}/khoa-hoc/luyenthirobosim`;
  const dan = "Học online mọi lúc: 18 buổi video kèm thực hành trên RoboSim, đi từ nền tảng đến giải đề thật và phản xạ 180 phút – không cần mua robot.";
  const bang = courseOnline;
  const mauDemSo = (c: string) => Number(c.replace(/[^\d]/g, ""));
  const giamTheoBang = (goc: string, ban: string) => Math.round((1 - mauDemSo(ban) / mauDemSo(goc)) * 100);

  return (
    <DangKyHocThuProvider khoaSlug="luyenthirobosim" khoaTen="Online · SataWorld – Luyện thi RoboSim Bảng R1 & R2">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "EducationalOrganization", "@id": `${BASE_URL}/#org`, name: "Sata Robo", url: `${BASE_URL}/` },
            {
              "@type": "Course",
              name: "Online · SataWorld – Luyện thi RoboSim Bảng R1 & R2",
              description: dan,
              provider: { "@id": `${BASE_URL}/#org` },
              inLanguage: "vi-VN",
              educationalLevel: "R1: lớp 3–5 · R2: lớp 6–9",
              ...(gOnline
                ? { offers: { "@type": "Offer", price: String(mauDemSo(gOnline)), priceCurrency: "VND", category: "Paid", url } }
                : {}),
              hasCourseInstance: { "@type": "CourseInstance", courseMode: "online" },
            },
            {
              "@type": "FAQPage",
              mainEntity: CAU_HOI_ONLINE.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Trang chủ", item: `${BASE_URL}/` },
                { "@type": "ListItem", position: 2, name: "Khoá học", item: `${BASE_URL}/khoa-hoc` },
                { "@type": "ListItem", position: 3, name: "Online · SataWorld", item: url },
              ],
            },
          ],
        }}
      />
      <div id="noi-dung" style={{ fontFamily: CHU_THAN_TRANG }}>
        <header className="subhero gridbg">
          <div className="glow" aria-hidden="true" style={st("width: 720px; height: 720px; right: -160px; top: -200px; background: radial-gradient(circle, #4fd1b555, transparent 65%)")} />
          <div className="wrap subhero-grid">
            <div className="load2">
              <BanhMi mucCuoi="Online · SataWorld" giuaTen />
              <span className="label mono">
                <b style={{ color: "#4fd1b5", fontFamily: CHU_BIEU_TUONG }}>●</b> Laptop + RoboSim
              </span>
              <h1>
                Online · SataWorld – <span className="grad">Luyện thi RoboSim Bảng R1 &amp; R2</span>
              </h1>
              <p className="lead">{dan}</p>
              <div className="chips">
                <span className="chip">
                  <b>R1: lớp 3–5 · R2: lớp 6–9</b>
                </span>
                <span className="chip">18 buổi · 9 giờ</span>
                <span className="chip">30 phút/buổi</span>
              </div>
              <div style={st("display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px")}>
                <NutDangKy className="btn btn-acc">Đặt buổi học thử 1-1</NutDangKy>
                <a href="#hoc-phi" className="btn btn-line">
                  {gOnline ? `Học phí ${gOnline}/bảng` : "Xem học phí"}
                </a>
              </div>
            </div>
            <div className="hero-art load3">
              <div className="laptop">
                <div className="scr">
                  <Anh h="659c303937fe76b0d2be11b04c59889e" alt="Bài giảng video luyện thi RoboSim" priority sizes="(max-width: 860px) 80vw, 480px" />
                  <span className="play" aria-hidden="true" />
                  <span className="prog">
                    <b />
                  </span>
                  <span className="mono" style={st("position: absolute; left: 12px; top: 10px; font-size: 11px; color: #fff; background: rgba(0,0,0,.6); padding: 3px 8px; border-radius: 6px")}>
                    Buổi 07 / 18 · 15:00
                  </span>
                </div>
                <div className="base" />
                <span className="perk" style={st("left: 0; top: 6%")}>
                  Học <b>mọi lúc</b>
                </span>
                <span className="perk" style={st("right: 0; bottom: 18%")}>
                  <b>781</b>/800 điểm R1
                </span>
                <Anh className="float" h="b09f648ab11d0579d24805fe838e0900" aria-hidden="true" decoding="async" sizes="120px" style={st("height: auto; position: absolute; z-index: 3; filter: drop-shadow(0 16px 20px rgba(0,0,0,.35)); left: -4%; bottom: -2%; width: 120px; z-index: 4")} />
              </div>
            </div>
          </div>
        </header>

        <div className="wrap" style={st("margin-top: -10px; position: relative; z-index: 2")}>
          <div className="facts5">
            {[
              ["I0", "Đối tượng", "R1: lớp 3–5 · R2: lớp 6–9"],
              ["I1", "Thời lượng", "18 buổi · 9 giờ"],
              ["I2", "Mỗi buổi", "30 phút"],
              ["I3", "Học phí", gOnline ? `${gOnline}/bảng` : "Liên hệ tư vấn"],
            ].map(([ic, l, v], i) => (
              <div key={l} className={`fact sv ${DELAY[i]} a-pop`}>
                <BieuTuong ma={ic} />
                <small>{l}</small>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </div>

        <section className="sec gridbg" style={st(NEN_PHAN_BG2)}>
          <div className="wrap">
            <DauMuc
              stt="01"
              nhan="Chương trình học"
              tieuDe={<>3 chặng, <span className="grad">18 buổi</span></>}
              phu={<p>Mỗi buổi 30 phút: 15 phút video + 15 phút thực hành trên RoboSim.</p>}
              sticker="87e9462c8a5ae12b7e41aa3b68ced3cc"
              hieuUng="a-blur"
            />
            <div className="cur-grid" style={st("display: grid; grid-template-columns: minmax(0,1.5fr) minmax(0,1fr); gap: 36px; align-items: start")}>
              <div>
                <div style={st("display: grid; gap: 16px")}>
                  {[
                    ["1", "Chặng 1 · Buổi 1–5", "Làm quen & ôn nền", "Ôn kiến thức nền, dùng RoboSim, phân tích cấu trúc đề và luật chấm.", "a-slideR"],
                    ["2", "Chặng 2 · Buổi 6–14", "Thực hành giải đề thật", "Giải từng câu đề vòng loại – so sánh cách thường và cách tối ưu.", "d2 a-slideR"],
                    ["3", "Chặng 3 · Buổi 15–18", "Tối ưu & phản xạ 180 phút", "Tối ưu di chuyển, lập trình và luyện giải đề đúng 180 phút.", "d3 a-slideR"],
                  ].map(([n, tag, t, d, cls]) => (
                    <div key={n} className={`phase sv ${cls}`}>
                      <span className="pn">{n}</span>
                      <span className="tag">{tag}</span>
                      <h3 style={st("margin: 8px 0 6px")}>{t}</h3>
                      <p style={st("margin: 0; color: var(--muted)")}>{d}</p>
                    </div>
                  ))}
                </div>
                <div className="g3" style={st("margin-top: 22px")}>
                  {[
                    ["781/800", "Điểm R1 của học viên"],
                    ["856/900", "Điểm R2 của học viên"],
                    ["100%", "Học viên Sata Robo vượt vòng loại"],
                  ].map(([so, nhan], i) => (
                    <div key={nhan} className={`fact sv ${DELAY[i]} a-pop`} style={st("text-align: center")}>
                      <b className="grad" style={st("font: 700 30px 'Unbounded', sans-serif")}>
                        {so}
                      </b>
                      <small style={st("text-transform: none; letter-spacing: 0")}>{nhan}</small>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sv a-tilt" style={st("position: sticky; top: 100px; display: grid; gap: 14px")}>
                <div className="card" style={st("padding: 22px; gap: 12px")}>
                  <span className="tag" style={st("align-self: flex-start")}>
                    Học được ngay
                  </span>
                  <ul style={st("margin: 0; padding-left: 20px; display: grid; gap: 8px")}>
                    <li>Video hướng dẫn chi tiết từng bước</li>
                    <li>Truy cập RoboSim không giới hạn</li>
                    <li>Học theo lịch tự do, tua lại thoải mái</li>
                    <li>Đổi bảng miễn phí trong 7 ngày</li>
                  </ul>
                </div>
                <Anh className="bob" h="214f70bfc7cb9a92126b0a2e6207c48a" aria-hidden="true" decoding="async" sizes="140px" style={st("height: auto; width: 140px; margin: 10px auto 0; display: block; position: relative")} />
              </div>
            </div>
          </div>
        </section>

        <section id="hoc-phi" className="sec">
          <div className="wrap">
            <DauMuc
              stt="02"
              nhan="Học phí"
              tieuDe={<>Chọn bảng <span className="grad">phù hợp</span></>}
              phu={<p>Lớp 5 chọn R1. Đổi bảng miễn phí trong 7 ngày đầu.</p>}
              sticker="09822f256fe47024e33331af8e3a0ea5"
            />
            <div className="g2" style={st("max-width: 860px")}>
              {bang.map((b, i) => (
                <div key={b.id} className={`plan sv ${i === 0 ? "" : "d2"} a-tilt`}>
                  <span className="off">-{giamTheoBang(b.originalPrice, b.salePrice)}%</span>
                  <span className="tag" style={st("justify-self: start")}>
                    Bảng {b.level}
                  </span>
                  <b style={st("font-size: 18px")}>{b.level === "R1" ? "Tiểu học · lớp 3–5" : "THCS · lớp 6–9"}</b>
                  <span>
                    <s>{b.originalPrice}</s>
                  </span>
                  <b className="grad" style={st("font: 700 40px 'Unbounded', sans-serif")}>
                    {b.salePrice}
                  </b>
                  <NutDangKy className="btn btn-acc" style={{ marginTop: 8 }}>
                    Đăng ký {b.level}
                  </NutDangKy>
                </div>
              ))}
            </div>
          </div>
        </section>

        <KhoiCauHoi stt="03" tenKhoa="Online · SataWorld" faqs={CAU_HOI_ONLINE} />
        <KhoiKhoaKhac
          stt="04"
          muc={[
            { href: "/khoa-hoc/laptrinhrobot", anh: "368d0fd5444dc86f2fdc53229baed55b", tag: "Gợi ý · Lập trình Robot", ten: "Lộ trình 5 năm", meta: "Lớp 1–8" },
            { href: "/khoa-hoc/combo-sata1-sata2", anh: "3d425f2a2c063a1916225676ca19f4f4", tag: "Gợi ý · Combo Sata1 + Sata2", ten: "Full lộ trình luyện thi", meta: `Lớp 3–8${gCombo ? ` · ${nhanGia("combo", gCombo).ngan}` : ""}` },
            { href: "/khoa-hoc/sata8", anh: "5b2733eebd8a2725fab2afb4c936fd4b", tag: "Gợi ý · Sata8", ten: "Vé vàng chung kết", meta: `Đã có nền tảng RoboSim${gSata8 ? ` · ${nhanGia("ve-vang", gSata8).ngan}` : ""}` },
          ]}
        />
        <KhoiKeuGoi tieuDe="Cho con thử một buổi nhé!" phu="Buổi học thử 1-1 miễn phí – Sata Robo gọi lại trong 30 phút." />
      </div>
    </DangKyHocThuProvider>
  );
}
