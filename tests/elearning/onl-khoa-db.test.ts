// @vitest-environment node
/**
 * [ONL-KH-*] [ONL-ND-*] [ONL-PHD-*] E-learning ONLINE — khoá · nội dung · phát hành (Postgres thật).
 * Dọn bằng `donBangOnl` (xem `_onl-don.ts`); học viên thử dọn theo tiền tố tên.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { capQuyenHoc, kiemTraTruyCapNoiDungDb } from "../../lib/elearning-online/quyen-hoc-db";
import { danhSachKhoa, datTienQuyet, doiTrangThaiBan, luuDanhMuc, luuTruKhoa, sapXepKhoa, suaKhoa, taoKhoa, xoaDanhMuc, type TaoKhoaInput } from "../../lib/elearning-online/khoa-hoc";
import { datBoCuc, docCayNoiDung, moBanNhap, suaBai, themBai, themChuong, xoaBai } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLK_";
const NOW = new Date(Date.UTC(2026, 10, 19, 5, 0, 0));
let n = 0;
const ma = () => `CI-ONLK-${Date.now().toString(36).toUpperCase()}-${++n}`;
const khoaMau = (o: Partial<TaoKhoaInput> = {}): TaoKhoaInput => ({
  code: ma(), name: `${P}Khoá ${n}`, listPrice: 890_000, salePrice: 790_000, validityMonths: 12, renewalEnabled: false, ...o,
});
let key = 0;
const khoaKey = (t: string) => `${P}${t}-${++key}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
}

/** Dựng khoá có 2 chương × 2 bài (bài 3 bắt buộc) ở bản nháp, chưa phát hành. */
async function dungKhoaNhap(o: Partial<TaoKhoaInput> = {}) {
  const t = await taoKhoa(db, khoaMau(o), null);
  if (!t.ok) throw new Error(t.thongBao);
  const c1 = await themChuong(db, { versionId: t.draftVersionId, title: "Chương 1" });
  const c2 = await themChuong(db, { versionId: t.draftVersionId, title: "Chương 2" });
  if (!c1.ok || !c2.ok) throw new Error("chuong");
  const b = async (c: string, tt: string) => {
    const r = await themBai(db, { versionId: t.draftVersionId, chapterId: c, kind: "VIDEO", title: tt, contentJson: { mediaRef: `online/video/ci/m-${tt.replace(/[^A-Za-z0-9]/g, "-")}.mp4` } });
    if (!r.ok) throw new Error(r.thongBao);
    return r;
  };
  const b1 = await b(c1.chapterId, "B1");
  const b2 = await b(c1.chapterId, "B2");
  const b3 = await b(c2.chapterId, "B3");
  return { ...t, c1, c2, b1, b2, b3 };
}
/** Id của bài trong BẢN `versionId` theo stableId (id khác nhau giữa các bản, stableId giữ nguyên). */
const idBai = async (versionId: string, stableId: string) => (await db.onlLesson.findUniqueOrThrow({ where: { versionId_stableId: { versionId, stableId } }, select: { id: true } })).id;
const caiDat = (o: object = {}) => ({ ...caiDatKhoiDauChoBanNhap(), ...o });

describe.skipIf(!RUN_DB_TESTS)("[ONL-KH] khoá học (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-KH-01] tạo khoá ⇒ có BẢN NHÁP số 1 với cài đặt hợp lệ, chưa bán, chưa phát hành; mã trùng bị từ chối; slug trùng tự thêm hậu tố", async () => {
    const a = await taoKhoa(db, khoaMau({ name: `${P}Lập trình Robot cho bé` }), "u1");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.slug).toBe("ci-onlk-lap-trinh-robot-cho-be");
    const khoa = await db.onlCourse.findUniqueOrThrow({ where: { id: a.courseId } });
    expect(khoa).toMatchObject({ saleStatus: "NOT_ON_SALE", publishedVersionId: null, createdByUserId: "u1" });
    const ban = await db.onlCourseVersion.findUniqueOrThrow({ where: { id: a.draftVersionId } });
    expect(ban).toMatchObject({ number: 1, status: "DRAFT", progressPolicy: null });
    expect(ban.settingsJson).toEqual(caiDatKhoiDauChoBanNhap());
    // trùng mã
    const trung = await taoKhoa(db, khoaMau({ code: khoa.code }), null);
    expect(trung).toMatchObject({ ok: false, ma: "MA_TRUNG" });
    // trùng tên ⇒ slug thứ hai có hậu tố
    const b = await taoKhoa(db, khoaMau({ name: `${P}Lập trình Robot cho bé` }), null);
    expect(b.ok && b.slug).toBe("ci-onlk-lap-trinh-robot-cho-be-2");
  });

  it("[ONL-KH-02] không mở bán khoá chưa phát hành; sau phát hành mở bán được; sửa giá KHÔNG đổi hạn của quyền đã cấp", async () => {
    const k = await dungKhoaNhap({ validityMonths: 12 });
    expect(await doiTrangThaiBan(db, { courseId: k.courseId, saleStatus: "ON_SALE" })).toMatchObject({ ok: false, ma: "DANG_BAN_CAN_BAN_PHAT_HANH" });
    const xt = await xemTruocPhatHanh(db, k.courseId, null);
    expect(xt.ok).toBe(true);
    if (!xt.ok) return;
    const ph = await phatHanh(db, { courseId: k.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, "u1", NOW);
    expect(ph.ok).toBe(true);
    expect(await doiTrangThaiBan(db, { courseId: k.courseId, saleStatus: "ON_SALE" })).toMatchObject({ ok: true, truoc: "NOT_ON_SALE", sau: "ON_SALE" });
    const hv = await db.student.create({ data: { name: `${P}HV1` }, select: { id: true } });
    const cap = await capQuyenHoc(db, { studentId: hv.id, courseId: k.courseId, loai: "MUA", now: NOW, idempotencyKey: khoaKey("c") });
    expect(cap.ok && cap.hetHan?.toISOString()).toBe("2027-11-19T16:59:59.999Z");
    // đổi thời hạn của KHOÁ sang 3 tháng và giá
    const sua = await suaKhoa(db, { courseId: k.courseId, name: `${P}Đổi tên`, listPrice: 1_000_000, salePrice: 900_000, validityMonths: 3, renewalEnabled: false });
    expect(sua.ok).toBe(true);
    const q = await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: hv.id, courseId: k.courseId } } });
    expect(q.expiresAt?.toISOString()).toBe("2027-11-19T16:59:59.999Z"); // quyền đã cấp giữ nguyên hạn
    expect(q.validityMonthsSnapshot).toBe(12);
  });

  it("[ONL-KH-03] khoá tiên quyết: không tự trỏ chính mình, không vòng A→B→A", async () => {
    const a = await taoKhoa(db, khoaMau(), null);
    const b = await taoKhoa(db, khoaMau(), null);
    if (!a.ok || !b.ok) throw new Error("tao");
    expect(await datTienQuyet(db, { courseId: a.courseId, mode: "REQUIRED", prerequisiteCourseId: a.courseId })).toMatchObject({ ok: false, ma: "TIEN_QUYET_TU_THAN" });
    expect(await datTienQuyet(db, { courseId: b.courseId, mode: "REQUIRED", prerequisiteCourseId: a.courseId })).toMatchObject({ ok: true });
    expect(await datTienQuyet(db, { courseId: a.courseId, mode: "RECOMMENDED", prerequisiteCourseId: b.courseId })).toMatchObject({ ok: false, ma: "TIEN_QUYET_VONG" });
  });

  it("[ONL-KH-04] lưu trữ khoá: được khi chưa có học viên; BỊ TỪ CHỐI khi đã có quyền học (lịch sử phải còn trỏ được)", async () => {
    const k = await dungKhoaNhap();
    const hv = await db.student.create({ data: { name: `${P}HV2` }, select: { id: true } });
    const xt = await xemTruocPhatHanh(db, k.courseId, null);
    if (!xt.ok) throw new Error("xt");
    await phatHanh(db, { courseId: k.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    await capQuyenHoc(db, { studentId: hv.id, courseId: k.courseId, loai: "CAP_MIEN_PHI", now: NOW, idempotencyKey: khoaKey("g") });
    expect(await luuTruKhoa(db, k.courseId, NOW)).toMatchObject({ ok: false, ma: "KHOA_DA_CO_HOC_VIEN" });
    const trong = await taoKhoa(db, khoaMau(), null);
    if (!trong.ok) throw new Error("t");
    expect(await luuTruKhoa(db, trong.courseId, NOW)).toEqual({ ok: true });
    const ds = await danhSachKhoa(db, { q: P });
    expect(ds.dong.some((d) => d.id === trong.courseId)).toBe(false); // đã lưu trữ ⇒ không còn trong danh sách
    expect(ds.dong.find((d) => d.id === k.courseId)).toMatchObject({ daPhatHanh: true, soBaiBanChay: 3, soHocVienConQuyen: 1 });
  });

  it("[ONL-KH-05] danh mục 2 cấp; không vòng; xoá khi còn khoá bị từ chối; STT hiển thị đổi đúng thứ tự", async () => {
    const cha = await luuDanhMuc(db, { name: `${P}Cha` });
    if (!cha.ok) throw new Error("cha");
    const con = await luuDanhMuc(db, { name: `${P}Con`, parentId: cha.id });
    if (!con.ok) throw new Error("con");
    expect(await luuDanhMuc(db, { name: `${P}Chau`, parentId: con.id })).toMatchObject({ ok: false, ma: "DANH_MUC_CAP_QUA_SAU" });
    expect(await luuDanhMuc(db, { id: cha.id, name: `${P}Cha`, parentId: cha.id })).toMatchObject({ ok: false, ma: "DANH_MUC_VONG" }); // không đặt danh mục làm cha của chính nó
    const k1 = await taoKhoa(db, khoaMau({ categoryId: con.id }), null);
    const k2 = await taoKhoa(db, khoaMau(), null);
    if (!k1.ok || !k2.ok) throw new Error("k");
    expect(await xoaDanhMuc(db, con.id)).toMatchObject({ ok: false, ma: "DANH_MUC_CON_KHOA" });
    expect(await xoaDanhMuc(db, cha.id)).toMatchObject({ ok: false, ma: "DANH_MUC_CON_KHOA" });
    expect(await sapXepKhoa(db, [k2.courseId, k1.courseId])).toMatchObject({ ok: true });
    const ds = await danhSachKhoa(db, { q: P });
    const ids = ds.dong.map((d) => d.id);
    expect(ids.indexOf(k2.courseId)).toBeLessThan(ids.indexOf(k1.courseId));
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-ND] soạn nội dung (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-ND-01] nội dung bài: URL công khai bị từ chối; chỉ MỘT bài thi cuối; sai kiểu nội dung bị từ chối", async () => {
    const k = await dungKhoaNhap();
    expect(await themBai(db, { versionId: k.draftVersionId, chapterId: k.c1.chapterId, kind: "VIDEO", title: "x", contentJson: { mediaRef: "https://cdn.example.com/v.mp4" } })).toMatchObject({ ok: false, ma: "NOI_DUNG_KHONG_HOP_LE" });
    expect(await themBai(db, { versionId: k.draftVersionId, chapterId: k.c1.chapterId, kind: "VIDEO", title: "x", contentJson: { body: "sai kiểu" } })).toMatchObject({ ok: false, ma: "NOI_DUNG_KHONG_HOP_LE" });
    expect(await themBai(db, { versionId: k.draftVersionId, chapterId: k.c2.chapterId, kind: "FINAL_EXAM", title: "Thi" })).toMatchObject({ ok: true });
    expect(await themBai(db, { versionId: k.draftVersionId, chapterId: k.c2.chapterId, kind: "FINAL_EXAM", title: "Thi 2" })).toMatchObject({ ok: false, ma: "NHIEU_BAI_THI_CUOI" });
  });

  it("[ONL-ND-02] kéo thả: bố cục phải phủ ĐÚNG tập chương/bài; đúng thì đổi thứ tự và chuyển bài giữa chương; thiếu/thừa bị từ chối", async () => {
    const k = await dungKhoaNhap();
    const sai = await datBoCuc(db, { versionId: k.draftVersionId, chuong: [{ chapterId: k.c1.chapterId, lessonIds: [k.b1.lessonId] }, { chapterId: k.c2.chapterId, lessonIds: [k.b3.lessonId] }] });
    expect(sai).toMatchObject({ ok: false, ma: "THU_TU_KHONG_KHOP" }); // thiếu b2
    const ok = await datBoCuc(db, {
      versionId: k.draftVersionId,
      chuong: [
        { chapterId: k.c2.chapterId, lessonIds: [k.b3.lessonId, k.b2.lessonId] },
        { chapterId: k.c1.chapterId, lessonIds: [k.b1.lessonId] },
      ],
    });
    expect(ok.ok).toBe(true);
    const cay = await docCayNoiDung(db, k.draftVersionId);
    expect(cay?.chapters.map((c) => c.title)).toEqual(["Chương 2", "Chương 1"]);
    expect(cay?.chapters[0]!.lessons.map((b) => b.title)).toEqual(["B3", "B2"]);
    // stableId không đổi khi chuyển chương
    expect(cay?.chapters[0]!.lessons.find((b) => b.title === "B2")!.stableId).toBe(k.b2.stableId);
  });

  it("[ONL-ND-03] 🔴 bản ĐÃ PHÁT HÀNH bất biến: sửa/thêm/xoá bài, đổi cài đặt đều bị từ chối; mở nháp mới SAO CHÉP giữ stableId", async () => {
    const k = await dungKhoaNhap();
    const xt = await xemTruocPhatHanh(db, k.courseId, null);
    if (!xt.ok) throw new Error("xt");
    const ph = await phatHanh(db, { courseId: k.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    expect(ph.ok).toBe(true);
    expect(await suaBai(db, { lessonId: k.b1.lessonId, title: "đổi" })).toMatchObject({ ok: false, ma: "BAN_KHONG_PHAI_NHAP" });
    expect(await xoaBai(db, k.b1.lessonId)).toMatchObject({ ok: false, ma: "BAN_KHONG_PHAI_NHAP" });
    expect(await themBai(db, { versionId: k.draftVersionId, chapterId: k.c1.chapterId, kind: "READ", title: "x", contentJson: { body: "x" } })).toMatchObject({ ok: false, ma: "BAN_KHONG_PHAI_NHAP" });
    expect(await luuCaiDat(db, { versionId: k.draftVersionId, caiDat: caiDat() })).toMatchObject({ ok: false, ma: "BAN_KHONG_PHAI_NHAP" });
    const nhap = await moBanNhap(db, k.courseId, null);
    expect(nhap).toMatchObject({ ok: true, number: 2, moiTao: true });
    if (!nhap.ok) return;
    const cay = await docCayNoiDung(db, nhap.versionId);
    expect(cay?.chapters.flatMap((c) => c.lessons.map((b) => b.stableId)).sort()).toEqual([k.b1.stableId, k.b2.stableId, k.b3.stableId].sort());
    expect(await moBanNhap(db, k.courseId, null)).toMatchObject({ ok: true, number: 2, moiTao: false }); // gọi lại ⇒ cùng bản nháp
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-PHD] phát hành phiên bản (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  /** Phát hành bản 1, cấp quyền cho 1 học viên và cho họ hoàn thành `baiXong`; trả về mọi thứ + nháp bản 2 đã mở. */
  async function chuanBi(baiXong: ("b1" | "b2" | "b3")[]) {
    const k = await dungKhoaNhap();
    const xt = await xemTruocPhatHanh(db, k.courseId, null);
    if (!xt.ok) throw new Error("xt");
    const ph = await phatHanh(db, { courseId: k.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    if (!ph.ok) throw new Error(ph.thongBao);
    await doiTrangThaiBan(db, { courseId: k.courseId, saleStatus: "ON_SALE" });
    const hv = await db.student.create({ data: { name: `${P}HV-${++n}` }, select: { id: true } });
    const cap = await capQuyenHoc(db, { studentId: hv.id, courseId: k.courseId, loai: "MUA", now: NOW, idempotencyKey: khoaKey("m") });
    if (!cap.ok) throw new Error(cap.thongBao);
    for (const b of baiXong) {
      await db.onlLessonProgress.create({ data: { entitlementId: cap.entitlementId, lessonStableId: k[b].stableId, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1, bestScore: 88 } });
    }
    const nhap = await moBanNhap(db, k.courseId, null);
    if (!nhap.ok) throw new Error(nhap.thongBao);
    return { k, hv, entitlementId: cap.entitlementId, nhap };
  }

  it("[ONL-PHD-01] 🔴 thiếu chính sách từ bản 2 ⇒ từ chối (KHÔNG mặc định giữ tiến độ); bản không đạt chất lượng (rỗng) ⇒ từ chối", async () => {
    const { k, nhap } = await chuanBi(["b1"]);
    await themChuong(db, { versionId: nhap.versionId, title: "Chương mới" });
    const thieu = await xemTruocPhatHanh(db, k.courseId, null);
    expect(thieu.ok).toBe(true); // xem trước không chính sách vẫn được (chưa có tác động)
    const xt = thieu.ok ? thieu.xemTruoc : null;
    expect(xt?.tacDong).toBeNull();
    const r = await phatHanh(db, { courseId: k.courseId, dauVet: xt!.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    expect(r).toMatchObject({ ok: false, ma: "THIEU_CHINH_SACH" });
    // bản mới rỗng bài hiển thị ⇒ chất lượng LỖI
    const rong = await dungKhoaNhap();
    const x2 = await xemTruocPhatHanh(db, rong.courseId, null);
    if (!x2.ok) throw new Error("x2");
    await db.onlLesson.deleteMany({ where: { versionId: rong.draftVersionId } });
    const x3 = await xemTruocPhatHanh(db, rong.courseId, null);
    if (!x3.ok) throw new Error("x3");
    expect(x3.xemTruoc.chatLuong.some((c) => c.muc === "LOI")).toBe(true);
    expect(await phatHanh(db, { courseId: rong.courseId, dauVet: x3.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW)).toMatchObject({ ok: false, ma: "CHUA_DAT_CONG_CHAT_LUONG" });
  });

  it("[ONL-PHD-02] 🔴 RELEARN_SELECTED: chỉ bài ĐÃ SỬA mà người học đã xong bị đặt lại; điểm tốt nhất, quyền học, bản cũ SUPERSEDED / bản mới PUBLISHED đúng", async () => {
    const { k, entitlementId, nhap } = await chuanBi(["b1", "b2"]);
    await suaBai(db, { lessonId: await idBai(nhap.versionId, k.b1.stableId), contentJson: { mediaRef: "online/video/ci/m-B1-moi.mp4" } }); // SỬA b1
    const cs = { loai: "RELEARN_SELECTED" as const, baiHocLai: [k.b1.stableId, k.b2.stableId] }; // b2 KHÔNG sửa ⇒ bị bỏ qua
    const xt = await xemTruocPhatHanh(db, k.courseId, cs);
    if (!xt.ok) throw new Error("xt");
    expect(xt.xemTruoc.soSanh?.sua).toEqual([k.b1.stableId]);
    expect(xt.xemTruoc.tacDong).toMatchObject({ soHocVien: 1, soPhaiHocLai: 1, matChungNhan: 0 });
    const r = await phatHanh(db, { courseId: k.courseId, chinhSach: cs, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, "u9", NOW);
    expect(r).toMatchObject({ ok: true, number: 2, soTienDoDatLai: 1 });
    const tb1 = await db.onlLessonProgress.findUniqueOrThrow({ where: { entitlementId_lessonStableId: { entitlementId, lessonStableId: k.b1.stableId } } });
    const tb2 = await db.onlLessonProgress.findUniqueOrThrow({ where: { entitlementId_lessonStableId: { entitlementId, lessonStableId: k.b2.stableId } } });
    expect(tb1).toMatchObject({ status: "NOT_STARTED", percent: 0, completedAt: null, bestScore: 88 }); // điểm giữ nguyên
    expect(tb2).toMatchObject({ status: "COMPLETED", percent: 100 }); // bài không sửa giữ nguyên
    const [cu, moi, khoa, quyen] = await Promise.all([
      db.onlCourseVersion.findFirstOrThrow({ where: { courseId: k.courseId, number: 1 } }),
      db.onlCourseVersion.findUniqueOrThrow({ where: { id: nhap.versionId } }),
      db.onlCourse.findUniqueOrThrow({ where: { id: k.courseId } }),
      db.onlEntitlement.findUniqueOrThrow({ where: { id: entitlementId } }),
    ]);
    expect(cu.status).toBe("SUPERSEDED");
    expect(moi).toMatchObject({ status: "PUBLISHED", progressPolicy: "RELEARN_SELECTED", publishedByUserId: "u9" });
    expect(moi.publishedAt?.toISOString()).toBe(NOW.toISOString());
    expect((moi.impactJson as { soPhaiHocLai: number }).soPhaiHocLai).toBe(1);
    expect(khoa.publishedVersionId).toBe(nhap.versionId);
    expect(quyen.status).toBe("ACTIVE");
  });

  it("[ONL-PHD-03] 🔴 KEEP_PROGRESS không đặt lại gì; ADD_NEW_ONLY không đụng bài cũ kể cả bài sửa; RESET_BY_SCOPE chỉ nhóm được chọn", async () => {
    // KEEP
    const a = await chuanBi(["b1", "b3"]);
    expect(await suaBai(db, { lessonId: await idBai(a.nhap.versionId, a.k.b1.stableId), contentJson: { mediaRef: "online/video/ci/doi.mp4" } })).toEqual({ ok: true });
    const xa = await xemTruocPhatHanh(db, a.k.courseId, { loai: "KEEP_PROGRESS" });
    if (!xa.ok) throw new Error("xa");
    const ra = await phatHanh(db, { courseId: a.k.courseId, chinhSach: { loai: "KEEP_PROGRESS" }, dauVet: xa.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    expect(ra).toMatchObject({ ok: true, soTienDoDatLai: 0 });
    expect(await db.onlLessonProgress.count({ where: { entitlementId: a.entitlementId, status: "COMPLETED" } })).toBe(2);
    // RESET theo chương 2 nhưng nhóm chọn KHÔNG gồm người này ⇒ không ai bị đặt lại
    const b = await chuanBi(["b1", "b3"]);
    const csNhomKhac = { loai: "RESET_BY_SCOPE" as const, chuongStableIds: [b.k.c2.stableId], entitlementIds: ["khong-co-nguoi-nay"] };
    const xb = await xemTruocPhatHanh(db, b.k.courseId, csNhomKhac);
    if (!xb.ok) throw new Error("xb");
    const rb = await phatHanh(db, { courseId: b.k.courseId, chinhSach: csNhomKhac, dauVet: xb.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    expect(rb).toMatchObject({ ok: true, soTienDoDatLai: 0 });
    // RESET theo chương 2, nhóm chọn GỒM người này ⇒ chỉ b3 (chương 2) bị đặt lại
    const c = await chuanBi(["b1", "b3"]);
    const cs = { loai: "RESET_BY_SCOPE" as const, chuongStableIds: [c.k.c2.stableId], entitlementIds: [c.entitlementId] };
    const xc = await xemTruocPhatHanh(db, c.k.courseId, cs);
    if (!xc.ok) throw new Error("xc");
    const rc = await phatHanh(db, { courseId: c.k.courseId, chinhSach: cs, dauVet: xc.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    expect(rc).toMatchObject({ ok: true, soTienDoDatLai: 1 });
    const con = await db.onlLessonProgress.findMany({ where: { entitlementId: c.entitlementId, status: "COMPLETED" }, select: { lessonStableId: true } });
    expect(con.map((x) => x.lessonStableId)).toEqual([c.k.b1.stableId]);
  });

  it("[ONL-PHD-04] 🔴 dấu vết xem trước lệch (có học viên mới xong thêm bài sau khi xem trước) ⇒ TAC_DONG_DA_THAY_DOI; cũng lệch nếu sai xác nhận (zod)", async () => {
    const { k, entitlementId, nhap } = await chuanBi(["b1"]);
    expect(await suaBai(db, { lessonId: await idBai(nhap.versionId, k.b2.stableId), contentJson: { mediaRef: "online/video/ci/m2-moi.mp4" } })).toEqual({ ok: true });
    const cs = { loai: "RELEARN_SELECTED" as const, baiHocLai: [k.b2.stableId] };
    const xt = await xemTruocPhatHanh(db, k.courseId, cs);
    if (!xt.ok) throw new Error("xt");
    // sau khi xem trước, học viên xong b2 ⇒ con số tác động đổi
    await db.onlLessonProgress.create({ data: { entitlementId, lessonStableId: k.b2.stableId, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1 } });
    const r = await phatHanh(db, { courseId: k.courseId, chinhSach: cs, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    expect(r).toMatchObject({ ok: false, ma: "TAC_DONG_DA_THAY_DOI" });
    // chưa ghi gì: bản nháp vẫn là nháp, bản chạy vẫn là bản 1
    expect((await db.onlCourse.findUniqueOrThrow({ where: { id: k.courseId } })).publishedVersionId).not.toBeNull();
    expect(await db.onlCourseVersion.count({ where: { courseId: k.courseId, status: "DRAFT" } })).toBe(1);
    // xem trước lại ⇒ phát hành được, và lần này b2 bị đặt lại
    const xt2 = await xemTruocPhatHanh(db, k.courseId, cs);
    if (!xt2.ok) throw new Error("xt2");
    expect(await phatHanh(db, { courseId: k.courseId, chinhSach: cs, dauVet: xt2.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW)).toMatchObject({ ok: true, soTienDoDatLai: 1 });
  });

  it("[ONL-PHD-05] 🔴 hai lượt phát hành SONG SONG: đúng MỘT thắng, lượt kia thấy không còn bản nháp; sau đó chỉ có MỘT bản PUBLISHED", async () => {
    const { k } = await chuanBi(["b1"]);
    const cs = { loai: "KEEP_PROGRESS" as const };
    const xt = await xemTruocPhatHanh(db, k.courseId, cs);
    if (!xt.ok) throw new Error("xt");
    const input = { courseId: k.courseId, chinhSach: cs, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" as const };
    const [a, b] = await Promise.all([phatHanh(db, input, "a", NOW), phatHanh(db, input, "b", NOW)]);
    const ketQua = [a, b].map((r) => (r.ok ? "OK" : r.ma)).sort();
    expect(ketQua).toEqual(["KHONG_CO_BAN_NHAP", "OK"]);
    expect(await db.onlCourseVersion.count({ where: { courseId: k.courseId, status: "PUBLISHED" } })).toBe(1);
    const khoa = await db.onlCourse.findUniqueOrThrow({ where: { id: k.courseId } });
    const chay = await db.onlCourseVersion.findFirstOrThrow({ where: { courseId: k.courseId, status: "PUBLISHED" } });
    expect(khoa.publishedVersionId).toBe(chay.id);
  });

  it("[ONL-PHD-06] sau phát hành học viên vào bản MỚI qua cổng truy cập (bài mới vào được); bài ẩn ở bản mới vẫn đóng với người chưa học", async () => {
    const { k, hv, nhap } = await chuanBi(["b1"]);
    await luuCaiDat(db, { versionId: nhap.versionId, caiDat: caiDat({ moBaiTiepTheo: "MO_HET" }) });
    const moi = await themBai(db, { versionId: nhap.versionId, chapterId: (await db.onlChapter.findFirstOrThrow({ where: { versionId: nhap.versionId }, orderBy: { orderIndex: "asc" } })).id, kind: "READ", title: "Bài mới", contentJson: { body: "x" } });
    if (!moi.ok) throw new Error("moi");
    const cs = { loai: "ADD_NEW_ONLY" as const };
    const xt = await xemTruocPhatHanh(db, k.courseId, cs);
    if (!xt.ok) throw new Error("xt");
    await phatHanh(db, { courseId: k.courseId, chinhSach: cs, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    // cài đặt MO_HET để thử cổng riêng (thứ tự mở bài kiểm ở lát tiến độ)
    expect(await kiemTraTruyCapNoiDungDb(db, { studentId: hv.id, courseId: k.courseId, lessonStableId: moi.stableId, now: NOW })).toEqual({ ok: true });
  });
});
