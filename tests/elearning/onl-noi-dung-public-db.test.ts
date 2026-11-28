// @vitest-environment node
/**
 * [NDP-DB-*] QoMkt — "Nội dung public" của một khoá cho người chỉ-đọc (Postgres thật): chỉ bài HỌC THỬ của bản ĐANG CHẠY; không lộ bài trả phí, bài ẩn, bản nháp, nội dung bài.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { docNoiDungPublicCuaKhoa } from "../../lib/elearning-online/doc";
import { taoKhoa, doiTrangThaiBan } from "../../lib/elearning-online/khoa-hoc";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { moBanNhap, suaBai, themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_NDP_";
const NOW = new Date(Date.UTC(2026, 10, 21, 5, 0, 0));

describe.skipIf(!RUN_DB_TESTS)("NDP-DB · nội dung public cho người chỉ-đọc", () => {
  beforeAll(() => donBangOnl(db), 120_000);
  afterAll(() => donBangOnl(db), 120_000);

  it("[NDP-DB-01] khoá CHƯA phát hành ⇒ daPhatHanh=false, không bài học thử; khoá không tồn tại / đã lưu trữ ⇒ null", async () => {
    const t = await taoKhoa(db, { code: `CI-NDP-A-${Date.now().toString(36).toUpperCase()}`, name: `${P}A`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
    if (!t.ok) throw new Error(t.thongBao);
    expect(await docNoiDungPublicCuaKhoa(t.courseId)).toMatchObject({ daPhatHanh: false, hocThu: [] });
    expect(await docNoiDungPublicCuaKhoa("khong-co")).toBeNull();
    await db.onlCourse.update({ where: { id: t.courseId }, data: { deletedAt: new Date() } });
    expect(await docNoiDungPublicCuaKhoa(t.courseId)).toBeNull();
  });

  it("[NDP-DB-02] khoá ĐÃ phát hành: CHỈ bài học thử, không ẩn, không trả phí; không rò nội dung/mô tả bài; bản NHÁP mới không lọt ra", async () => {
    const t = await taoKhoa(db, { code: `CI-NDP-B-${Date.now().toString(36).toUpperCase()}`, name: `${P}B`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
    if (!t.ok) throw new Error(t.thongBao);
    const cid = t.courseId;
    await db.onlCourse.update({ where: { id: cid }, data: { shortDescription: "Mô tả ngắn", fullDescription: "Giới thiệu đầy đủ" } });
    const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
    if (!ch.ok) throw new Error("chuong");
    const bai = async (title: string, o: { freePreview?: boolean }) => {
      const r = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title, contentJson: { body: `BI-MAT-${title}` }, ...o });
      if (!r.ok) throw new Error(r.thongBao);
      return r;
    };
    await bai("Học thử 1", { freePreview: true });
    await bai("Trả phí", {});
    const an = await bai("Học thử nhưng ẩn", { freePreview: true });
    await suaBai(db, { lessonId: an.lessonId, hidden: true });
    const cd = caiDatKhoiDauChoBanNhap();
    const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: cd });
    if (!l.ok) throw new Error(l.thongBao);
    const xt = await xemTruocPhatHanh(db, cid, null);
    if (!xt.ok) throw new Error(xt.thongBao);
    const ph = await phatHanh(db, { courseId: cid, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    if (!ph.ok) throw new Error(ph.thongBao);
    await doiTrangThaiBan(db, { courseId: cid, saleStatus: "ON_SALE" });

    const nd = await docNoiDungPublicCuaKhoa(cid);
    expect(nd).toMatchObject({ daPhatHanh: true, shortDescription: "Mô tả ngắn", fullDescription: "Giới thiệu đầy đủ" });
    expect(nd!.hocThu.map((b) => b.title)).toEqual(["Học thử 1"]); // dương: có bài học thử; âm: không "Trả phí", không bài ẩn
    expect(JSON.stringify(nd), "không rò nội dung bài").not.toContain("BI-MAT");

    // mở bản NHÁP mới và thêm bài học thử ở bản nháp ⇒ KHÔNG hiện (chỉ bản đang chạy)
    const nhap = await moBanNhap(db, cid, null);
    if (!nhap.ok) throw new Error(nhap.thongBao);
    const ch2 = await themChuong(db, { versionId: nhap.versionId, title: "C-nhap" });
    if (!ch2.ok) throw new Error("chuong2");
    await themBai(db, { versionId: nhap.versionId, chapterId: ch2.chapterId, kind: "READ", title: "Chỉ ở bản nháp", contentJson: { body: "x" }, freePreview: true });
    expect((await docNoiDungPublicCuaKhoa(cid))!.hocThu.map((b) => b.title)).not.toContain("Chỉ ở bản nháp");
  });
});
