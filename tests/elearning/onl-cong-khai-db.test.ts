// @vitest-environment node
/**
 * [ONL-CK-*] E-learning ONLINE — API đọc danh mục CÔNG KHAI (Postgres thật): chỉ trường công khai · không lộ nội dung trả phí · trạng thái bán hiệu lực · lớp HTTP.
 */
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { banDuocLucNay, docBaiHocThu, docChiTietCongKhai, docKhoaCongKhai } from "../../lib/elearning-online/danh-muc-cong-khai";
import { xuLyChiTiet, xuLyDanhSach, xuLyHocThu } from "../../lib/elearning-online/cong-khai-http";
import { datTienQuyet, doiTrangThaiBan, luuDanhMuc, luuTruKhoa, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { suaBai, themBai, themChuong, suaChuong } from "../../lib/elearning-online/noi-dung";
import { phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLC_";
const NOW = new Date(Date.UTC(2026, 10, 19, 5, 0, 0));
let n = 0;
async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
}

type K = { courseId: string; slug: string; v: string; videoThu: string; docThu: string; docTraPhi: string; bai: string };

/** Khoá đã PHÁT HÀNH có: chương 1 {video học thử, đọc học thử, đọc trả phí, bài ẩn}, chương ẨN {đọc}. Trạng thái bán đặt theo `ban`. */
async function khoa(ban: "ON_SALE" | "NOT_ON_SALE" | "PAUSED" | "SCHEDULED", o: { ten?: string; thuTu?: number; danhMucId?: string; opens?: Date | null } = {}): Promise<K> {
  const t = await taoKhoa(db, { code: `CI-ONLC-${Date.now().toString(36).toUpperCase()}-${++n}`, name: o.ten ?? `${P}Khoá ${n}`, listPrice: 900_000, salePrice: 700_000, validityMonths: 6, renewalEnabled: false, categoryId: o.danhMucId ?? null, shortDescription: `mô tả ngắn ${n}` }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const c1 = await themChuong(db, { versionId: t.draftVersionId, title: "Chương 1" });
  const cAn = await themChuong(db, { versionId: t.draftVersionId, title: "Chương ẩn" });
  if (!c1.ok || !cAn.ok) throw new Error("chuong");
  const b = async (c: string, kind: "VIDEO" | "READ", title: string, nd: object, extra: object = {}) => {
    const r = await themBai(db, { versionId: t.draftVersionId, chapterId: c, kind, title, contentJson: nd, ...extra });
    if (!r.ok) throw new Error(r.thongBao);
    return r;
  };
  const videoThu = await b(c1.chapterId, "VIDEO", "Video học thử", { mediaRef: "online/video/ci/m-secret-1.mp4" }, { freePreview: true, durationSec: 120 });
  const docThu = await b(c1.chapterId, "READ", "Đọc học thử", { body: "NOI-DUNG-HOC-THU" }, { freePreview: true });
  const docTraPhi = await b(c1.chapterId, "READ", "Đọc trả phí", { body: "TRA-PHI-BI-MAT" }, { durationSec: 60 });
  const an = await b(c1.chapterId, "READ", "Bài ẩn", { body: "AN-BI-MAT" }, { freePreview: true });
  await suaBai(db, { lessonId: an.lessonId, hidden: true });
  await b(cAn.chapterId, "READ", "Bài trong chương ẩn", { body: "CHUONG-AN-BI-MAT" }, { freePreview: true });
  await suaChuong(db, { chapterId: cAn.chapterId, hidden: true });
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error(xt.thongBao);
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph.ok) throw new Error(ph.thongBao);
  if (ban !== "NOT_ON_SALE") {
    // đặt thẳng trạng thái để dựng cả tình huống hẹn giờ quá khứ/thiếu ngày
    await db.onlCourse.update({ where: { id: t.courseId }, data: { saleStatus: ban, saleOpensAt: o.opens ?? null, ...(o.thuTu !== undefined ? { displayOrder: o.thuTu } : {}) } });
  } else if (o.thuTu !== undefined) await db.onlCourse.update({ where: { id: t.courseId }, data: { displayOrder: o.thuTu } });
  return { courseId: t.courseId, slug: t.slug, v: ph.versionId, videoThu: videoThu.stableId, docThu: docThu.stableId, docTraPhi: docTraPhi.stableId, bai: an.stableId };
}

describe("[ONL-CK] logic thuần", () => {
  it("🔴 `banDuocLucNay`: đang bán ⇒ có; hẹn giờ ĐÃ tới giờ ⇒ có; hẹn giờ CHƯA tới / thiếu ngày ⇒ không; chưa bán/tạm ngừng ⇒ không", () => {
    const qua = new Date(NOW.getTime() - 1000);
    const toi = new Date(NOW.getTime() + 1000);
    expect(banDuocLucNay("ON_SALE", null, NOW)).toBe(true);
    expect(banDuocLucNay("SCHEDULED", qua, NOW)).toBe(true);
    expect(banDuocLucNay("SCHEDULED", NOW, NOW)).toBe(true); // đúng giờ
    expect(banDuocLucNay("SCHEDULED", toi, NOW)).toBe(false);
    expect(banDuocLucNay("SCHEDULED", null, NOW)).toBe(false);
    expect(banDuocLucNay("NOT_ON_SALE", qua, NOW)).toBe(false);
    expect(banDuocLucNay("PAUSED", qua, NOW)).toBe(false);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-CK] danh mục công khai (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-CK-01] 🔴 danh sách CHỈ có khoá đang bán / hẹn giờ (hiệu lực); nháp, chưa bán, tạm ngừng, lưu trữ, hẹn giờ thiếu ngày KHÔNG thấy; thứ tự theo STT", async () => {
    const qua = new Date(NOW.getTime() - 86_400_000);
    const toi = new Date(NOW.getTime() + 86_400_000);
    const a = await khoa("ON_SALE", { ten: `${P}A`, thuTu: 2 });
    const f = await khoa("SCHEDULED", { ten: `${P}F-sap-mo`, thuTu: 3, opens: toi });
    const g = await khoa("SCHEDULED", { ten: `${P}G-da-mo`, thuTu: 1, opens: qua });
    const b = await khoa("NOT_ON_SALE", { ten: `${P}B-chua-ban` });
    const c = await khoa("PAUSED", { ten: `${P}C-tam-ngung` });
    const h = await khoa("SCHEDULED", { ten: `${P}H-thieu-ngay`, opens: null });
    const e = await khoa("ON_SALE", { ten: `${P}E-luu-tru` });
    await db.onlCourse.update({ where: { id: e.courseId }, data: { deletedAt: NOW } });
    const chuaPH = await taoKhoa(db, { code: `CI-ONLC-NHAP-${Date.now().toString(36).toUpperCase()}`, name: `${P}D-nhap`, listPrice: 1, salePrice: 1, validityMonths: 1, renewalEnabled: false }, null);
    if (!chuaPH.ok) throw new Error("d");

    const r = await docKhoaCongKhai(db, { q: P }, NOW);
    expect(r.khoa.map((k) => [k.slug, k.banTrangThai])).toEqual([
      [g.slug, "ON_SALE"], // hẹn giờ đã tới giờ ⇒ hiệu lực đang bán
      [a.slug, "ON_SALE"],
      [f.slug, "SCHEDULED"],
    ]);
    expect(r.tong).toBe(3);
    expect(r.khoa[2]!.moBanLuc).toBe(toi.toISOString());
    expect(r.khoa[0]!.moBanLuc).toBeNull();
    for (const x of [b, c, h, e]) expect(r.khoa.some((k) => k.slug === x.slug), x.slug).toBe(false);
  });

  it("[ONL-CK-02] 🔴 KHÔNG BAO GIỜ lộ nội dung trả phí: thân bài, khoá media, id đánh giá, bài ẩn, chương ẩn — ở danh sách LẪN chi tiết", async () => {
    const a = await khoa("ON_SALE", { ten: `${P}Lộ` });
    const ds = JSON.stringify(await docKhoaCongKhai(db, { q: `${P}Lộ` }, NOW));
    const ct = JSON.stringify(await docChiTietCongKhai(db, a.slug, NOW));
    for (const s of [ds, ct]) {
      for (const cam of ["online/video/ci/m-secret-1.mp4", "m-secret", "TRA-PHI-BI-MAT", "NOI-DUNG-HOC-THU", "AN-BI-MAT", "CHUONG-AN-BI-MAT", "contentJson", "mediaRef", "assessmentId", "Bài ẩn", "Chương ẩn", "Bài trong chương ẩn"]) {
        expect(s.includes(cam), `lộ "${cam}"`).toBe(false);
      }
    }
    expect(ct).toContain("Video học thử"); // đối chứng dương: mục lục vẫn có tiêu đề bài hiển thị
    expect(ct).toContain("Đọc trả phí");
  });

  it("[ONL-CK-03] chi tiết: mục lục chỉ bài HIỂN THỊ (kèm cờ học thử); số bài/thời lượng đếm bài hiển thị; tiên quyết hiện khi bật; khoá không công khai ⇒ null", async () => {
    const a = await khoa("ON_SALE", { ten: `${P}Chi tiết` });
    const tq = await khoa("ON_SALE", { ten: `${P}Tiên quyết` });
    expect(await datTienQuyet(db, { courseId: a.courseId, mode: "REQUIRED", prerequisiteCourseId: tq.courseId })).toEqual({ ok: true });
    const ct = await docChiTietCongKhai(db, a.slug, NOW);
    expect(ct?.chuong).toHaveLength(1); // chương ẩn không có
    expect(ct?.chuong[0]!.bai.map((b) => [b.title, b.hocThu])).toEqual([["Video học thử", true], ["Đọc học thử", true], ["Đọc trả phí", false]]);
    expect(ct).toMatchObject({ soBai: 3, tongThoiLuongGiay: 180, tienQuyet: { slug: tq.slug, cheDo: "REQUIRED" }, listPrice: 900_000, salePrice: 700_000, validityMonths: 6 });
    const chua = await khoa("NOT_ON_SALE", { ten: `${P}Chưa bán 2` });
    expect(await docChiTietCongKhai(db, chua.slug, NOW)).toBeNull();
    expect(await docChiTietCongKhai(db, "khong-co-khoa-nay", NOW)).toBeNull();
    // lưu trữ ⇒ biến mất (khoá không có học viên)
    const e = await khoa("ON_SALE", { ten: `${P}Sẽ lưu trữ` });
    expect(await luuTruKhoa(db, e.courseId, NOW)).toEqual({ ok: true });
    expect(await docChiTietCongKhai(db, e.slug, NOW)).toBeNull();
  });

  it("[ONL-CK-04] 🔴 bài HỌC THỬ: bài đọc trả thân; VIDEO không trả nguồn; bài trả phí / bài ẩn / bài trong chương ẩn / khoá không công khai ⇒ null (cùng câu trả lời)", async () => {
    const a = await khoa("ON_SALE", { ten: `${P}Học thử` });
    expect(await docBaiHocThu(db, a.slug, a.docThu)).toMatchObject({ title: "Đọc học thử", noiDung: { loai: "READ", body: "NOI-DUNG-HOC-THU" } });
    const v = await docBaiHocThu(db, a.slug, a.videoThu);
    expect(v?.noiDung).toEqual({ loai: "VIDEO", dangPhat: false, lyDo: "KHO_VIDEO_CHUA_MO" });
    expect(JSON.stringify(v)).not.toContain("m-secret");
    expect(await docBaiHocThu(db, a.slug, a.docTraPhi)).toBeNull();
    expect(await docBaiHocThu(db, a.slug, a.bai)).toBeNull(); // bài ẩn dù đánh dấu học thử
    expect(await docBaiHocThu(db, a.slug, "khong-co")).toBeNull();
    const chua = await khoa("NOT_ON_SALE", { ten: `${P}Chưa bán 3` });
    expect(await docBaiHocThu(db, chua.slug, chua.docThu)).toBeNull(); // bài học thử của khoá CHƯA bán cũng không ra
  });

  it("[ONL-CK-05] lọc: theo danh mục (cha gồm cả khoá của con), theo từ khoá; phân trang giữ tổng; coTrang ≤ 50 do schema", async () => {
    const cha = await luuDanhMuc(db, { name: `${P}Cha` });
    if (!cha.ok) throw new Error("cha");
    const con = await luuDanhMuc(db, { name: `${P}Con`, parentId: cha.id });
    if (!con.ok) throw new Error("con");
    const kCon = await khoa("ON_SALE", { ten: `${P}pg-Trong con`, danhMucId: con.id, thuTu: 0 });
    const kCha = await khoa("ON_SALE", { ten: `${P}pg-Trong cha`, danhMucId: cha.id, thuTu: 1 });
    const kNgoai = await khoa("ON_SALE", { ten: `${P}pg-Ngoài danh mục`, thuTu: 2 });
    const slugCha = (await db.onlCategory.findUniqueOrThrow({ where: { id: cha.id } })).slug;
    const slugCon = (await db.onlCategory.findUniqueOrThrow({ where: { id: con.id } })).slug;
    expect((await docKhoaCongKhai(db, { dm: slugCha }, NOW)).khoa.map((k) => k.slug)).toEqual([kCon.slug, kCha.slug]);
    expect((await docKhoaCongKhai(db, { dm: slugCon }, NOW)).khoa.map((k) => k.slug)).toEqual([kCon.slug]);
    expect((await docKhoaCongKhai(db, { dm: "khong-co" }, NOW)).tong).toBe(0);
    expect((await docKhoaCongKhai(db, { q: "pg-ngoài danh mục" }, NOW)).khoa.map((k) => k.slug)).toEqual([kNgoai.slug]);
    const t1 = await docKhoaCongKhai(db, { q: `${P}pg-`, trang: 1, coTrang: 2 }, NOW);
    const t2 = await docKhoaCongKhai(db, { q: `${P}pg-`, trang: 2, coTrang: 2 }, NOW);
    expect(t1.khoa.map((k) => k.slug)).toEqual([kCon.slug, kCha.slug]);
    expect(t2.khoa.map((k) => k.slug)).toEqual([kNgoai.slug]);
    expect([t1.tong, t2.tong]).toEqual([3, 3]); // tổng không đổi theo trang
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-CK] lớp HTTP + cổng mua (Postgres thật)", () => {
  const cu = process.env.ELEARNING_ONLINE_ENABLED;
  beforeAll(don, 120_000);
  afterAll(async () => {
    process.env.ELEARNING_ONLINE_ENABLED = cu;
    await don();
  }, 120_000);
  beforeEach(() => {
    process.env.ELEARNING_ONLINE_ENABLED = "true";
  });
  afterEach(() => {
    process.env.ELEARNING_ONLINE_ENABLED = cu;
  });

  it("[ONL-CK-06] 🔴 cờ TẮT ⇒ 404 trống ở cả ba đường (kể cả khoá có thật); cờ BẬT ⇒ 200 + cache công khai; đối chứng dương", async () => {
    const a = await khoa("ON_SALE", { ten: `${P}HTTP` });
    process.env.ELEARNING_ONLINE_ENABLED = "false";
    for (const r of [await xuLyDanhSach(new URL("http://x/api?q=" + P), NOW), await xuLyChiTiet(a.slug, NOW), await xuLyHocThu(a.slug, a.docThu)]) {
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("");
    }
    process.env.ELEARNING_ONLINE_ENABLED = "true";
    const ds = await xuLyDanhSach(new URL("http://x/api?q=" + encodeURIComponent(P)), NOW);
    expect(ds.status).toBe(200);
    expect(ds.headers.get("cache-control")).toContain("s-maxage=60");
    expect((await ds.json()).data.khoa.some((k: { slug: string }) => k.slug === a.slug)).toBe(true);
    expect((await xuLyChiTiet(a.slug, NOW)).status).toBe(200);
    expect((await xuLyHocThu(a.slug, a.docThu)).status).toBe(200);
  });

  it("[ONL-CK-07] 404/400 thống nhất: bài trả phí và khoá lạ cùng một câu; tham số sai ⇒ 400; slug lạ ký tự ⇒ 404 không chạm DB; 404 không cache", async () => {
    const a = await khoa("ON_SALE", { ten: `${P}HTTP2` });
    const traPhi = await xuLyHocThu(a.slug, a.docTraPhi);
    const khongCo = await xuLyHocThu("khoa-khong-co", "abc");
    expect(traPhi.status).toBe(404);
    expect(await traPhi.json()).toEqual(await khongCo.json());
    expect(traPhi.headers.get("cache-control")).toBe("no-store");
    const sai = await xuLyDanhSach(new URL("http://x/api?coTrang=500"), NOW);
    expect(sai.status).toBe(400);
    expect((await sai.json()).error.code).toBe("THAM_SO_KHONG_HOP_LE");
    expect((await xuLyDanhSach(new URL("http://x/api?lạ=1"), NOW)).status).toBe(400); // schema strict
    expect((await xuLyChiTiet("../../etc/passwd", NOW)).status).toBe(404);
    expect((await xuLyHocThu(a.slug, "../x")).status).toBe(404);
  });

  it("[ONL-CK-08] 🔴 cổng MUA dùng CÙNG hàm trạng thái bán hiệu lực: hẹn giờ đã tới giờ ⇒ cấp được; chưa tới / thiếu ngày / tạm ngừng / chưa bán ⇒ KHOA_KHONG_DANG_BAN", async () => {
    const hv = await db.student.create({ data: { name: `${P}hv-mua` }, select: { id: true } });
    const qua = new Date(NOW.getTime() - 3_600_000);
    const toi = new Date(NOW.getTime() + 3_600_000);
    let k = 0;
    const mua = async (ban: "ON_SALE" | "NOT_ON_SALE" | "PAUSED" | "SCHEDULED", opens: Date | null) => {
      const c = await khoa(ban, { ten: `${P}mua-${++k}`, opens });
      return capQuyenHoc(db, { studentId: hv.id, courseId: c.courseId, loai: "MUA", now: NOW, idempotencyKey: `${P}mua-${k}-${Math.random().toString(36).slice(2, 8)}` });
    };
    expect((await mua("ON_SALE", null)).ok).toBe(true);
    expect((await mua("SCHEDULED", qua)).ok).toBe(true);
    for (const [ban, opens] of [["SCHEDULED", toi], ["SCHEDULED", null], ["PAUSED", null], ["NOT_ON_SALE", null]] as const) {
      expect(await mua(ban, opens), `${ban}/${opens}`).toMatchObject({ ok: false, ma: "KHOA_KHONG_DANG_BAN" });
    }
    void doiTrangThaiBan;
  });
});
