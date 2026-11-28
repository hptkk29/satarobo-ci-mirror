// @vitest-environment node
/**
 * [ONL-FTD-*] FREE MODE — F1 tiến độ học thử trên server · F2 tự nhận FREE_GRANT theo chính sách · F3 giới hạn cấu hình · F4 nâng cấp giữ tiến độ (Postgres thật).
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG trên cùng khoá. Không tạo quyền học giả để lưu tiến độ (kiểm số dòng OnlEntitlement).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap, docCaiDatHocTap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { docTienDoHocThu, ghiTienDoHocThu, moBaiMienPhi, tuNhanKhoaMienPhi } from "../../lib/elearning-online/hoc-thu-tien-do";
import { doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) process.env.NEXTAUTH_SECRET = "onl-test-only-signing-secret-32-chars-min";

const P = "CI_ONLFTD_";
const NOW = new Date(Date.UTC(2026, 10, 21, 5, 0, 0));
const ngay = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
let n = 0;

type HocThu = { dangKyMienPhi: boolean; gioiHanSoBai: number | null; hanNgay: number | null; toiDaKhoaMienPhi?: number | null };

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-onlftd-" } } });
}

/** Khoá đã phát hành + đang bán: v1, r1, v2 miễn phí (VIDEO/READ/VIDEO) · p1 trả phí. `hocThu` vắng ⇒ không khai chính sách. */
async function dung(hocThu?: HocThu, ban: "ON_SALE" | "NOT_ON_SALE" = "ON_SALE", gia = 1) {
  const t = await taoKhoa(db, { code: `CI-FTD-${Date.now().toString(36).toUpperCase()}-${++n}`, name: `${P}Khoá ${n}`, listPrice: gia, salePrice: gia, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  const c = await themChuong(db, { versionId: t.draftVersionId, title: "C" });
  if (!c.ok) throw new Error("c");
  const b = async (kind: "VIDEO" | "READ", title: string, contentJson: object, extra: object = {}) => {
    const r = await themBai(db, { versionId: t.draftVersionId, chapterId: c.chapterId, kind, title, contentJson, ...extra });
    if (!r.ok) throw new Error(r.thongBao);
    return r.stableId;
  };
  const v1 = await b("VIDEO", "V1", { mediaRef: "online/video/ci/FTD-1.mp4" }, { freePreview: true });
  const r1 = await b("READ", "R1", { body: "x" }, { freePreview: true });
  const v2 = await b("VIDEO", "V2", { mediaRef: "online/video/ci/FTD-2.mp4" }, { freePreview: true });
  const p1 = await b("VIDEO", "P1", { mediaRef: "online/video/ci/FTD-P.mp4" });
  const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" as const, ...(hocThu ? { hocThu } : {}) } });
  if (!l.ok) throw new Error(l.thongBao);
  const xt = await xemTruocPhatHanh(db, t.courseId, null);
  if (!xt.ok) throw new Error("xt");
  const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
  if (!ph.ok) throw new Error(ph.thongBao);
  if (ban === "ON_SALE") await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  return { courseId: t.courseId, v1, r1, v2, p1 };
}

/** `xacMinhSdt`: tài khoản phụ huynh đã xác minh SĐT (mặc định CÓ — điều kiện của Free Mode C11). `phuHuynhId`: dùng CHUNG một phụ huynh cho nhiều con. */
async function hocVien(ten: string, tuyChon: { xacMinhSdt?: boolean; phuHuynhId?: string } = {}) {
  const xacMinh = tuyChon.xacMinhSdt ?? true;
  const phId = tuyChon.phuHuynhId ?? (await db.user.create({ data: { name: `${P}ph-${ten}`, email: `ci-onlftd-${ten}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, role: "PARENT", phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, phoneVerifiedAt: xacMinh ? NOW : null }, select: { id: true } })).id;
  const hv = await db.student.create({ data: { name: `${P}hv-${ten}-${Math.random().toString(36).slice(2, 6)}`, parentUserId: phId }, select: { id: true } });
  return tuyChon.phuHuynhId ? hv.id : hv.id;
}
async function phuHuynhCua(studentId: string) {
  return (await db.student.findUniqueOrThrow({ where: { id: studentId }, select: { parentUserId: true } })).parentUserId!;
}

const KHONG: HocThu = { dangKyMienPhi: false, gioiHanSoBai: null, hanNgay: null };

describe("[ONL-FTD] cài đặt hocThu — logic thuần", () => {
  it("🔴 hocThu TUỲ CHỌN (vắng ⇒ đọc được); giá trị sai bị từ chối (giới hạn 0, hạn âm, khoá lạ); đối chứng: giá trị đúng được nhận", () => {
    const co = caiDatKhoiDauChoBanNhap();
    expect(docCaiDatHocTap(co).ok).toBe(true);
    expect(docCaiDatHocTap({ ...co, hocThu: { dangKyMienPhi: true, gioiHanSoBai: 3, hanNgay: 14 } }).ok).toBe(true);
    expect(docCaiDatHocTap({ ...co, hocThu: { dangKyMienPhi: true, gioiHanSoBai: 3, hanNgay: 14, toiDaKhoaMienPhi: 2 } }).ok).toBe(true);
    expect(docCaiDatHocTap({ ...co, hocThu: { dangKyMienPhi: true, gioiHanSoBai: 3, hanNgay: 14, toiDaKhoaMienPhi: 0 } }).ok, "N=0 bị từ chối").toBe(false);
    expect(docCaiDatHocTap({ ...co, hocThu: { dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null } }).ok).toBe(true);
    for (const sai of [{ dangKyMienPhi: true, gioiHanSoBai: 0, hanNgay: null }, { dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: -1 }, { dangKyMienPhi: "co", gioiHanSoBai: null, hanNgay: null }, { dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null, them: 1 }]) {
      expect(docCaiDatHocTap({ ...co, hocThu: sai }).ok, JSON.stringify(sai)).toBe(false);
    }
  });
});

describe.skipIf(!RUN_DB_TESTS)("[ONL-FTD] Free Mode: tiến độ · tự nhận · giới hạn · nâng cấp (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-FTD-01] 🔴 F1 tiến độ học thử trên server, ĐƠN ĐIỆU, của CHÍNH học viên, KHÔNG tạo quyền học giả", async () => {
    const k = await dung(KHONG);
    const a = await hocVien("a");
    const b = await hocVien("b");
    expect(await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 10, now: NOW })).toEqual({ ok: false, ma: "CHUA_MO_BAI" });
    const mo = await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, now: NOW });
    expect(mo).toMatchObject({ ok: true, tienDo: { status: "IN_PROGRESS", percent: 0 } });
    expect(await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 40, now: NOW })).toMatchObject({ ok: true, tienDo: { percent: 40, status: "IN_PROGRESS" } });
    expect(await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 20, now: NOW })).toMatchObject({ ok: true, tienDo: { percent: 40 } }); // không hạ
    const xong = await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 95, now: ngay(1) });
    expect(xong).toMatchObject({ ok: true, tienDo: { status: "COMPLETED", percent: 95 } });
    const luc = xong.ok ? xong.tienDo.completedAt : null;
    expect(luc).toEqual(ngay(1));
    expect(await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 5, now: ngay(2) })).toMatchObject({ ok: true, tienDo: { status: "COMPLETED", percent: 95, completedAt: luc } }); // không lùi, completedAt đặt MỘT lần
    await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.r1, now: NOW });
    expect(await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.r1, percent: 30, now: NOW })).toMatchObject({ ok: true, tienDo: { status: "IN_PROGRESS", percent: 30 } }); // READ không tự xong theo %
    expect(await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.r1, percent: 30, hoanThanh: true, now: NOW })).toMatchObject({ ok: true, tienDo: { status: "COMPLETED", percent: 100 } });
    expect((await docTienDoHocThu(db, { studentId: a, courseId: k.courseId })).map((x) => x.lessonStableId).sort()).toEqual([k.r1, k.v1].sort());
    expect(await docTienDoHocThu(db, { studentId: b, courseId: k.courseId })).toEqual([]); // học viên khác không thấy
    expect(await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.p1, now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" }); // bài trả phí
    expect(await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 101, now: NOW })).toEqual({ ok: false, ma: "PHAN_TRAM_KHONG_HOP_LE" });
    expect(await moBaiMienPhi(db, { studentId: "", courseId: k.courseId, lessonStableId: k.v1, now: NOW })).toEqual({ ok: false, ma: "CHUA_DANG_NHAP" });
    expect(await db.onlEntitlement.count({ where: { studentId: a } })).toBe(0); // KHÔNG quyền học giả
  });

  it("[ONL-FTD-02] 🔴 F3 giới hạn số bài + hạn ngày do CÀI ĐẶT quyết định (không hard-code), kể cả mở song song; vắng chính sách ⇒ không giới hạn", async () => {
    const k = await dung({ dangKyMienPhi: false, gioiHanSoBai: 2, hanNgay: 7 });
    const a = await hocVien("lim");
    expect((await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, now: NOW })).ok).toBe(true);
    expect((await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.r1, now: ngay(1) })).ok).toBe(true);
    expect(await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v2, now: ngay(2) })).toEqual({ ok: false, ma: "VUOT_GIOI_HAN_BAI" });
    expect((await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, now: ngay(3) })).ok).toBe(true); // mở lại bài đã có không tốn thêm
    expect((await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 50, now: ngay(6) })).ok).toBe(true); // trước hạn
    expect(await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 60, now: ngay(8) })).toEqual({ ok: false, ma: "HET_HAN_HOC_THU" }); // quá 7 ngày từ lần mở đầu
    expect(await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, now: ngay(8) })).toEqual({ ok: false, ma: "HET_HAN_HOC_THU" });
    // mở SONG SONG: giới hạn 2 phải giữ nguyên
    const s = await hocVien("race");
    const kq = await Promise.all([k.v1, k.r1, k.v2, k.v1, k.r1, k.v2].map((l) => moBaiMienPhi(db, { studentId: s, courseId: k.courseId, lessonStableId: l, now: NOW })));
    expect(kq.filter((x) => x.ok).length).toBeGreaterThanOrEqual(2);
    expect((await docTienDoHocThu(db, { studentId: s, courseId: k.courseId })).length).toBe(2);
    // đối chứng: không khai chính sách ⇒ mở cả ba bài miễn phí, không hạn
    const kv = await dung();
    const u = await hocVien("unl");
    for (const l of [kv.v1, kv.r1, kv.v2]) expect((await moBaiMienPhi(db, { studentId: u, courseId: kv.courseId, lessonStableId: l, now: ngay(400) })).ok, l).toBe(true);
  });

  it("[ONL-FTD-03] 🔴 F2 tự nhận FREE_GRANT: giá 0 KHÔNG đủ; cần cờ công bố + backend xác nhận; một lần; không mở lại sau thu hồi; khoá chưa bán không nhận", async () => {
    const khongCo = await dung(KHONG, "ON_SALE", 0); // giá 0 nhưng KHÔNG công bố đăng ký miễn phí
    const a = await hocVien("claim");
    expect(await tuNhanKhoaMienPhi(db, { studentId: a, courseId: khongCo.courseId, duDieuKien: true, idempotencyKey: "ftd-claim-0001", now: NOW })).toEqual({ ok: false, ma: "KHONG_DANG_KY_MIEN_PHI" });
    const k = await dung({ dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null });
    expect(await tuNhanKhoaMienPhi(db, { studentId: a, courseId: k.courseId, duDieuKien: false, idempotencyKey: "ftd-claim-0002", now: NOW })).toEqual({ ok: false, ma: "KHONG_DU_DIEU_KIEN" });
    expect(await tuNhanKhoaMienPhi(db, { studentId: "", courseId: k.courseId, duDieuKien: true, idempotencyKey: "ftd-claim-0003", now: NOW })).toEqual({ ok: false, ma: "CHUA_DANG_NHAP" });
    const ok = await tuNhanKhoaMienPhi(db, { studentId: a, courseId: k.courseId, duDieuKien: true, idempotencyKey: "ftd-claim-0004", now: NOW });
    expect(ok.ok).toBe(true);
    expect((await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: a, courseId: k.courseId } } })).source).toBe("FREE_GRANT");
    const lai = await tuNhanKhoaMienPhi(db, { studentId: a, courseId: k.courseId, duDieuKien: true, idempotencyKey: "ftd-claim-0004", now: NOW }); // cùng khoá ⇒ lời gọi lại hợp lệ
    expect(lai).toMatchObject({ ok: true, ketQua: { daXuLyTruocDo: true } });
    expect(await db.onlEntitlementEvent.count({ where: { entitlement: { studentId: a, courseId: k.courseId } } })).toBe(1);
    expect(await tuNhanKhoaMienPhi(db, { studentId: a, courseId: k.courseId, duDieuKien: true, idempotencyKey: "ftd-claim-0005", now: NOW })).toEqual({ ok: false, ma: "DA_TUNG_CO_QUYEN" });
    // đã bị Admin thu hồi ⇒ KHÔNG tự nhận lại
    await thuHoiQuyenHoc(db, { studentId: a, courseId: k.courseId, reason: "Thu hồi thử nghiệm chính sách Free", idempotencyKey: "ftd-revoke-0001", now: ngay(1), actorUserId: "admin-1" });
    expect(await tuNhanKhoaMienPhi(db, { studentId: a, courseId: k.courseId, duDieuKien: true, idempotencyKey: "ftd-claim-0006", now: ngay(2) })).toEqual({ ok: false, ma: "DA_TUNG_CO_QUYEN" });
    const chuaBan = await dung({ dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null }, "NOT_ON_SALE");
    expect(await tuNhanKhoaMienPhi(db, { studentId: await hocVien("claim2"), courseId: chuaBan.courseId, duDieuKien: true, idempotencyKey: "ftd-claim-0007", now: NOW })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
  });

  it("[ONL-FTD-06] 🔴 C11 tự nhận: PHẢI có SĐT phụ huynh đã xác minh; chưa xác minh bị từ chối, xác minh rồi được (đối chứng); phụ huynh không có (học viên mồ côi) cũng bị từ chối", async () => {
    const k = await dung({ dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null });
    const chua = await hocVien("sdt-chua", { xacMinhSdt: false });
    expect(await tuNhanKhoaMienPhi(db, { studentId: chua, courseId: k.courseId, duDieuKien: true, idempotencyKey: "ftd-sdt-0001", now: NOW })).toEqual({ ok: false, ma: "CHUA_XAC_MINH_SDT" });
    expect(await db.onlEntitlement.count({ where: { studentId: chua } }), "bị từ chối ⇒ không cấp gì").toBe(0);
    const moco = await db.student.create({ data: { name: `${P}hv-moco` }, select: { id: true } });
    expect(await tuNhanKhoaMienPhi(db, { studentId: moco.id, courseId: k.courseId, duDieuKien: true, idempotencyKey: "ftd-sdt-0002", now: NOW })).toEqual({ ok: false, ma: "CHUA_XAC_MINH_SDT" });
    const co = await hocVien("sdt-co");
    expect((await tuNhanKhoaMienPhi(db, { studentId: co, courseId: k.courseId, duDieuKien: true, idempotencyKey: "ftd-sdt-0003", now: NOW })).ok).toBe(true);
    // SĐT được xác minh SAU đó ⇒ lần nhận kế tiếp của đúng học viên "chưa" được nhận
    await db.user.update({ where: { id: await phuHuynhCua(chua) }, data: { phoneVerifiedAt: NOW } });
    expect((await tuNhanKhoaMienPhi(db, { studentId: chua, courseId: k.courseId, duDieuKien: true, idempotencyKey: "ftd-sdt-0004", now: NOW })).ok).toBe(true);
  });

  it("[ONL-FTD-07] 🔴 C11 tối đa N khoá miễn phí ĐANG HOẠT ĐỘNG theo SĐT (cấu hình hocThu.toiDaKhoaMienPhi, không hard-code): hết hạn / thu hồi thì nhả chỗ; khoá mua tiền không tính; vắng cấu hình ⇒ không giới hạn", async () => {
    const mo = async (n: number | null) => dung({ dangKyMienPhi: true, gioiHanSoBai: null, hanNgay: null, toiDaKhoaMienPhi: n });
    const [k1, k2, k3] = [await mo(2), await mo(2), await mo(2)];
    const a = await hocVien("cap-a");
    const ph = await phuHuynhCua(a);
    const be = await hocVien("cap-be", { phuHuynhId: ph }); // CÙNG phụ huynh = CÙNG SĐT
    const nhan = (s: string, c: string, key: string, now = NOW) => tuNhanKhoaMienPhi(db, { studentId: s, courseId: c, duDieuKien: true, idempotencyKey: key, now });
    expect((await nhan(a, k1.courseId, "ftd-cap-0001")).ok).toBe(true);
    expect((await nhan(be, k2.courseId, "ftd-cap-0002")).ok).toBe(true); // 2/2 — người con khác của CÙNG phụ huynh cũng tính
    expect(await nhan(a, k3.courseId, "ftd-cap-0003")).toEqual({ ok: false, ma: "VUOT_SO_KHOA_MIEN_PHI" });
    expect(await db.onlEntitlement.count({ where: { studentId: a, courseId: k3.courseId } }), "bị từ chối ⇒ không cấp").toBe(0);
    // phụ huynh KHÁC không bị ảnh hưởng (đối chứng dương)
    expect((await nhan(await hocVien("cap-khac"), k3.courseId, "ftd-cap-0004")).ok).toBe(true);
    // thu hồi một khoá ⇒ nhả chỗ
    await thuHoiQuyenHoc(db, { studentId: a, courseId: k1.courseId, reason: "Nhả chỗ thử giới hạn Free", idempotencyKey: "ftd-cap-rv-0001", now: ngay(1), actorUserId: "admin-1" });
    expect((await nhan(a, k3.courseId, "ftd-cap-0005", ngay(2))).ok).toBe(true);
    // khoá MUA TIỀN không tính vào N: cấp PURCHASE một khoá thứ tư rồi vẫn bị chặn đúng ở N (2 miễn phí đang hoạt động)
    const k4 = await mo(2);
    const tra = await dung(undefined, "ON_SALE", 500000);
    expect((await capQuyenHoc(db, { studentId: be, courseId: tra.courseId, loai: "MUA", idempotencyKey: "ftd-cap-buy-0001", now: NOW })).ok).toBe(true);
    expect(await nhan(be, k4.courseId, "ftd-cap-0006", ngay(2))).toEqual({ ok: false, ma: "VUOT_SO_KHOA_MIEN_PHI" });
    // 🔴 khoá MUA tiền KHÔNG tính vào N: phụ huynh khác mua 2 khoá có phí (≥ N=2) vẫn tự nhận được khoá miễn phí đầu tiên
    const mua = await hocVien("cap-mua");
    for (const [i, g] of [await dung(undefined, "ON_SALE", 500000), await dung(undefined, "ON_SALE", 600000)].entries()) expect((await capQuyenHoc(db, { studentId: mua, courseId: g.courseId, loai: "MUA", idempotencyKey: `ftd-cap-mua-${i}000`, now: NOW })).ok).toBe(true);
    expect((await nhan(mua, (await mo(2)).courseId, "ftd-cap-0008")).ok, "mua 2 khoá có phí ≠ 2 khoá miễn phí").toBe(true);
    // hết hạn ⇒ nhả chỗ (khoá 12 tháng ⇒ sau 400 ngày cả hai quyền Free đã hết hạn)
    expect((await nhan(be, k4.courseId, "ftd-cap-0007", ngay(400))).ok).toBe(true);
    // vắng cấu hình ⇒ không giới hạn
    const tuDo = [await mo(null), await mo(null), await mo(null)];
    const c = await hocVien("cap-tudo");
    for (const [i, kk] of tuDo.entries()) expect((await nhan(c, kk.courseId, `ftd-cap-tu-${i}000`)).ok, String(i)).toBe(true);
  });

  it("[ONL-FTD-04] 🔴 F4 nâng cấp: mua khoá THẬT ⇒ tiến độ học thử chuyển sang quyền học, không ghi trùng, không hạ, không tạo lượt thi/điểm; gọi lại không nhân đôi", async () => {
    const k = await dung(KHONG);
    const a = await hocVien("up");
    await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, now: NOW });
    await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 100, now: ngay(1) });
    await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.r1, now: NOW });
    await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.r1, percent: 30, now: ngay(1) });
    const mua = await capQuyenHoc(db, { studentId: a, courseId: k.courseId, loai: "MUA", now: ngay(2), idempotencyKey: "ftd-buy-0001", orderId: "don-ftd-1" });
    if (!mua.ok) throw new Error(mua.thongBao);
    const tdo = await db.onlLessonProgress.findMany({ where: { entitlementId: mua.entitlementId }, orderBy: { lessonStableId: "asc" } });
    const theo = (l: string) => tdo.find((x) => x.lessonStableId === l);
    expect(theo(k.v1)).toMatchObject({ status: "COMPLETED", percent: 100, completedVersionNumber: 1 });
    expect(theo(k.r1)).toMatchObject({ status: "IN_PROGRESS", percent: 30, completedAt: null });
    expect(tdo.length).toBe(2); // chỉ hai bài đã học thử
    expect(tdo.every((x) => x.bestScore === null)).toBe(true); // không điểm
    expect(await db.onlAttempt.count({ where: { entitlementId: mua.entitlementId } })).toBe(0); // không lượt thi
    const free = await db.onlFreeLessonProgress.findMany({ where: { studentId: a, courseId: k.courseId } });
    expect(free.every((x) => x.transferredEntitlementId === mua.entitlementId && x.transferredAt !== null)).toBe(true);
    // gọi lại (gia hạn / cùng khoá idempotency) KHÔNG nhân đôi, KHÔNG đổi
    await capQuyenHoc(db, { studentId: a, courseId: k.courseId, loai: "MUA", now: ngay(3), idempotencyKey: "ftd-buy-0001", orderId: "don-ftd-1" });
    expect(await db.onlLessonProgress.count({ where: { entitlementId: mua.entitlementId } })).toBe(2);
    // tiến độ có phí sau đó cao hơn ⇒ thu hồi + mở lại KHÔNG hạ xuống mức học thử cũ
    await db.onlLessonProgress.update({ where: { entitlementId_lessonStableId: { entitlementId: mua.entitlementId, lessonStableId: k.r1 } }, data: { status: "COMPLETED", percent: 100, completedAt: ngay(4) } });
    await thuHoiQuyenHoc(db, { studentId: a, courseId: k.courseId, reason: "Thu hồi thử nghiệm nâng cấp", idempotencyKey: "ftd-revoke-0002", now: ngay(5), actorUserId: "admin-1" });
    const lai = await capQuyenHoc(db, { studentId: a, courseId: k.courseId, loai: "MUA", now: ngay(6), idempotencyKey: "ftd-buy-0002", orderId: "don-ftd-2" });
    expect(lai.ok).toBe(true);
    expect(await db.onlLessonProgress.findUniqueOrThrow({ where: { entitlementId_lessonStableId: { entitlementId: mua.entitlementId, lessonStableId: k.r1 } } })).toMatchObject({ status: "COMPLETED", percent: 100 });
    // bài đã bị gỡ khỏi bản đang chạy ⇒ bỏ qua, không chuyển
    const b = await hocVien("gone");
    await db.onlFreeLessonProgress.create({ data: { studentId: b, courseId: k.courseId, lessonStableId: "bai-da-go", status: "COMPLETED", percent: 100, firstAccessAt: NOW, completedAt: NOW } });
    const muaB = await capQuyenHoc(db, { studentId: b, courseId: k.courseId, loai: "MUA", now: ngay(2), idempotencyKey: "ftd-buy-0003", orderId: "don-ftd-3" });
    if (!muaB.ok) throw new Error(muaB.thongBao);
    expect(await db.onlLessonProgress.count({ where: { entitlementId: muaB.entitlementId } })).toBe(0);
    expect((await db.onlFreeLessonProgress.findFirstOrThrow({ where: { studentId: b } })).transferredEntitlementId).toBeNull();
  });

  it("[ONL-FTD-04b] 🔴 F4 giữ phần TỐT HƠN: quyền cũ đã hết hạn có tiến độ có phí cao; học thử lại ở mức thấp rồi mua lại ⇒ tiến độ có phí KHÔNG bị hạ, dòng học thử vẫn được đánh dấu đã chuyển", async () => {
    const k = await dung(KHONG);
    const a = await hocVien("keep");
    const mua = await capQuyenHoc(db, { studentId: a, courseId: k.courseId, loai: "MUA", now: ngay(0), idempotencyKey: "ftd-buy-0010", orderId: "don-ftd-10" });
    if (!mua.ok) throw new Error(mua.thongBao);
    await db.onlLessonProgress.create({ data: { entitlementId: mua.entitlementId, lessonStableId: k.r1, status: "COMPLETED", percent: 100, completedAt: ngay(1), completedVersionNumber: 1 } });
    const hetHan = mua.hetHan!;
    const sau = new Date(hetHan.getTime() + 5 * 86_400_000); // quyền đã HẾT HẠN ⇒ được học thử lại
    expect((await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.r1, now: sau })).ok).toBe(true);
    expect((await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.r1, percent: 30, now: sau })).ok).toBe(true);
    const lai = await capQuyenHoc(db, { studentId: a, courseId: k.courseId, loai: "MUA", now: new Date(sau.getTime() + 86_400_000), idempotencyKey: "ftd-buy-0011", orderId: "don-ftd-11" });
    expect(lai.ok).toBe(true);
    expect(await db.onlLessonProgress.findUniqueOrThrow({ where: { entitlementId_lessonStableId: { entitlementId: mua.entitlementId, lessonStableId: k.r1 } } })).toMatchObject({ status: "COMPLETED", percent: 100 });
    expect((await db.onlFreeLessonProgress.findFirstOrThrow({ where: { studentId: a, lessonStableId: k.r1 } })).transferredEntitlementId).toBe(mua.entitlementId);
    expect(await db.onlLessonProgress.count({ where: { entitlementId: mua.entitlementId } })).toBe(1); // không ghi trùng
  });

  it("[ONL-FTD-05] 🔴 khi ĐÃ có quyền học hiệu lực: mở/ghi bài miễn phí ⇒ DA_CO_QUYEN_HOC (A chuyển sang API học có phí; không ghi tiến độ học thử trùng); đối chứng: trước khi có quyền thì ghi được", async () => {
    const k = await dung(KHONG);
    const a = await hocVien("both");
    expect((await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, now: NOW })).ok).toBe(true);
    const mua = await capQuyenHoc(db, { studentId: a, courseId: k.courseId, loai: "MUA", now: ngay(1), idempotencyKey: "ftd-buy-0004", orderId: "don-ftd-4" });
    expect(mua.ok).toBe(true);
    expect(await moBaiMienPhi(db, { studentId: a, courseId: k.courseId, lessonStableId: k.r1, now: ngay(1) })).toEqual({ ok: false, ma: "DA_CO_QUYEN_HOC" });
    expect(await ghiTienDoHocThu(db, { studentId: a, courseId: k.courseId, lessonStableId: k.v1, percent: 50, now: ngay(1) })).toEqual({ ok: false, ma: "DA_CO_QUYEN_HOC" });
  });
});
