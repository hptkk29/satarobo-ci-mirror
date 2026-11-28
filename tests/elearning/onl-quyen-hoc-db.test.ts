// @vitest-environment node
/**
 * [ONL-DB-*] E-learning ONLINE — quyền học (Postgres thật): cấp · gia hạn · mua lại · thu hồi · cổng truy cập · ràng buộc DB.
 *
 * ⚠️ AN TOÀN DB: KHÔNG `resetDb()`; dọn bằng `donBangOnl` (xoá cả cụm bảng Onl*, chỉ trên DB thử) ở beforeAll VÀ afterAll. Sổ sự kiện là BẤT BIẾN (trigger chặn DELETE theo hàng) nên dọn
 * bằng TRUNCATE (không kích hoạt trigger hàng), KHÔNG dùng `session_replication_role = replica`. Chỉ chạy được trên DB thử.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { capQuyenHoc, kiemTraTruyCapNoiDungDb, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { vnParts } from "../../lib/time/vn";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONL_";
const HOC_VIEN = `${P}HV`;
const NOW = new Date(Date.UTC(2026, 10, 19, 5, 0, 0)); // 12:00 VN 19/11/2026
const NGAY = (d: Date | null) => {
  if (!d) return null;
  const p = vnParts(d);
  return `${p.day}/${p.month + 1}/${p.year}`;
};
let dem = 0;
const khoaKey = (t: string) => `${P}${t}-${++dem}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
}

type KhoaThu = { id: string; versionId: string; baiA: string; baiB: string };
let seq = 0;
async function dungKhoa(o: { thang: number | null; choGiaHan: boolean; banDang?: "ON_SALE" | "NOT_ON_SALE"; caiDat?: unknown }): Promise<KhoaThu> {
  const n = ++seq;
  const code = `CI-ONL-${Date.now().toString(36).toUpperCase()}-${n}`;
  const khoa = await db.onlCourse.create({
    data: {
      code,
      slug: code.toLowerCase(),
      name: `${P}Khoá ${n}`,
      validityMonths: o.thang,
      renewalEnabled: o.choGiaHan,
      saleStatus: o.banDang ?? "ON_SALE",
      listPrice: 890_000,
      salePrice: 890_000,
    },
    select: { id: true },
  });
  const ban = await db.onlCourseVersion.create({
    data: { courseId: khoa.id, number: 1, status: "PUBLISHED", publishedAt: NOW, settingsJson: (o.caiDat ?? { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" }) as object },
    select: { id: true },
  });
  const ch = await db.onlChapter.create({ data: { versionId: ban.id, stableId: `ch-${n}`, title: "Chương 1", orderIndex: 0 }, select: { id: true } });
  const bai = (s: string, i: number) =>
    db.onlLesson.create({ data: { versionId: ban.id, chapterId: ch.id, stableId: `${s}-${n}`, kind: "VIDEO", title: `Bài ${s}`, orderIndex: i }, select: { id: true } });
  await bai("a", 0);
  await bai("b", 1);
  await db.onlCourse.update({ where: { id: khoa.id }, data: { publishedVersionId: ban.id } });
  return { id: khoa.id, versionId: ban.id, baiA: `a-${n}`, baiB: `b-${n}` };
}
const taoHocVien = (ten: string) => db.student.create({ data: { name: `${HOC_VIEN}-${ten}` }, select: { id: true } });
const vaoDuoc = (studentId: string, k: KhoaThu, lessonStableId: string, now = NOW) => kiemTraTruyCapNoiDungDb(db, { studentId, courseId: k.id, lessonStableId, now });
const cap = (studentId: string, courseId: string, loai: "MUA" | "CAP_MIEN_PHI" | "GIA_HAN", now = NOW, key = khoaKey("cap")) =>
  capQuyenHoc(db, { studentId, courseId, loai, now, idempotencyKey: key });

describe.skipIf(!RUN_DB_TESTS)("[ONL-DB] quyền học Online (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-DB-01] mua mới tạo ĐÚNG MỘT dòng quyền + một sự kiện GRANTED; hạn = hết ngày 19/11/2027; gọi lại cùng khoá ⇒ KHÔNG cấp thêm", async () => {
    const k = await dungKhoa({ thang: 12, choGiaHan: false });
    const hv = await taoHocVien("01");
    const key = khoaKey("mua");
    const r1 = await capQuyenHoc(db, { studentId: hv.id, courseId: k.id, loai: "MUA", now: NOW, idempotencyKey: key, orderId: "order-x" });
    expect(r1).toMatchObject({ ok: true, daXuLyTruocDo: false, hanhDong: "TAO_MOI" });
    if (!r1.ok) return;
    expect(NGAY(r1.hetHan)).toBe("19/11/2027");
    const r2 = await capQuyenHoc(db, { studentId: hv.id, courseId: k.id, loai: "MUA", now: NOW, idempotencyKey: key, orderId: "order-x" });
    expect(r2).toMatchObject({ ok: true, daXuLyTruocDo: true, entitlementId: r1.entitlementId });
    expect(await db.onlEntitlement.count({ where: { studentId: hv.id, courseId: k.id } })).toBe(1);
    const ev = await db.onlEntitlementEvent.findMany({ where: { entitlementId: r1.entitlementId } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "GRANTED", source: "PURCHASE", orderId: "order-x", monthsAdded: 12 });
  });

  it("🔴 [ONL-DB-02] HAI lần mua SONG SONG khác khoá idempotency cho cùng (con × khoá): chỉ MỘT dòng quyền; lượt còn lại bị luật chặn (khoá không cho gia hạn)", async () => {
    const k = await dungKhoa({ thang: 12, choGiaHan: false });
    const hv = await taoHocVien("02");
    const [a, b] = await Promise.all([cap(hv.id, k.id, "MUA"), cap(hv.id, k.id, "MUA")]);
    const oks = [a, b].filter((x) => x.ok);
    expect(oks).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ ma: "KHOA_KHONG_CHO_GIA_HAN" });
    expect(await db.onlEntitlement.count({ where: { studentId: hv.id, courseId: k.id } })).toBe(1);
    const q = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id, courseId: k.id }, select: { id: true } });
    expect(await db.onlEntitlementEvent.count({ where: { entitlementId: q.id } })).toBe(1);
  });

  it("🔴 [ONL-DB-03] HAI lần gọi SONG SONG CÙNG khoá idempotency (webhook trùng) ⇒ cả hai ok, một sự kiện, một quyền", async () => {
    const k = await dungKhoa({ thang: 12, choGiaHan: true });
    const hv = await taoHocVien("03");
    const key = khoaKey("webhook");
    const [a, b] = await Promise.all([cap(hv.id, k.id, "MUA", NOW, key), cap(hv.id, k.id, "MUA", NOW, key)]);
    expect(a.ok && b.ok).toBe(true);
    const q = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id, courseId: k.id }, select: { id: true } });
    expect(await db.onlEntitlementEvent.count({ where: { entitlementId: q.id } })).toBe(1);
  });

  it("[ONL-DB-04] gia hạn khi còn hạn cộng từ HẠN HIỆN TẠI; sự kiện RENEWED ghi hạn trước/sau + số tháng", async () => {
    const k = await dungKhoa({ thang: 6, choGiaHan: true });
    const hv = await taoHocVien("04");
    const a = await cap(hv.id, k.id, "MUA");
    const b = await cap(hv.id, k.id, "MUA", new Date(NOW.getTime() + 20 * 86_400_000));
    expect(b).toMatchObject({ ok: true, hanhDong: "GIA_HAN" });
    if (!a.ok || !b.ok) return;
    expect(NGAY(a.hetHan)).toBe("19/5/2027");
    expect(NGAY(b.hetHan)).toBe("19/11/2027"); // 6 tháng nữa TỪ hạn hiện tại, không từ ngày gia hạn
    const ev = await db.onlEntitlementEvent.findMany({ where: { entitlementId: a.entitlementId }, orderBy: { createdAt: "asc" } });
    expect(ev.map((e) => e.kind)).toEqual(["GRANTED", "RENEWED"]);
    expect(ev[1]).toMatchObject({ monthsAdded: 6, fromExpiresAt: a.hetHan, toExpiresAt: b.hetHan });
  });

  it("🔴 [ONL-DB-05] thu hồi: lý do <10 ký tự bị từ chối (chưa ghi); thu hồi ⇒ cổng chặn NGAY; thu hồi lần hai bị từ chối; TIẾN ĐỘ GIỮ NGUYÊN", async () => {
    const k = await dungKhoa({ thang: 12, choGiaHan: false });
    const hv = await taoHocVien("05");
    const a = await cap(hv.id, k.id, "MUA");
    if (!a.ok) throw new Error("cấp thất bại");
    await db.onlLessonProgress.create({ data: { entitlementId: a.entitlementId, lessonStableId: k.baiA, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1 } });
    expect(await vaoDuoc(hv.id, k, k.baiB)).toEqual({ ok: true }); // đối chứng dương

    expect(await thuHoiQuyenHoc(db, { studentId: hv.id, courseId: k.id, reason: "ngắn", idempotencyKey: khoaKey("th"), now: NOW })).toMatchObject({ ok: false, ma: "LY_DO_QUA_NGAN" });
    expect(await vaoDuoc(hv.id, k, k.baiB)).toEqual({ ok: true }); // từ chối chưa đổi gì

    const th = await thuHoiQuyenHoc(db, { studentId: hv.id, courseId: k.id, reason: "Hoàn tiền theo yêu cầu phụ huynh", idempotencyKey: khoaKey("th"), now: NOW, actorUserId: "u-admin" });
    expect(th).toMatchObject({ ok: true, daXuLyTruocDo: false });
    expect(await vaoDuoc(hv.id, k, k.baiB)).toEqual({ ok: false, ma: "DA_THU_HOI" });
    expect(await thuHoiQuyenHoc(db, { studentId: hv.id, courseId: k.id, reason: "Thu hồi lần hai không hợp lệ", idempotencyKey: khoaKey("th"), now: NOW })).toMatchObject({ ok: false, ma: "DA_THU_HOI" });

    expect(await db.onlLessonProgress.count({ where: { entitlementId: a.entitlementId } })).toBe(1); // lịch sử/điểm KHÔNG bị xoá
    const q = await db.onlEntitlement.findUniqueOrThrow({ where: { id: a.entitlementId } });
    expect(q).toMatchObject({ status: "REVOKED", revokedByUserId: "u-admin" });
  });

  it("🔴 [ONL-DB-06] mở lại sau thu hồi (cấp miễn phí) dùng CHÍNH dòng quyền cũ: tiến độ còn, hạn tính từ hôm nay, cổng mở lại", async () => {
    const k = await dungKhoa({ thang: 12, choGiaHan: false });
    const hv = await taoHocVien("06");
    const a = await cap(hv.id, k.id, "MUA");
    if (!a.ok) throw new Error("cấp thất bại");
    await db.onlLessonProgress.create({ data: { entitlementId: a.entitlementId, lessonStableId: k.baiA, status: "IN_PROGRESS", percent: 40 } });
    await thuHoiQuyenHoc(db, { studentId: hv.id, courseId: k.id, reason: "Nhập nhầm đơn hàng của phụ huynh", idempotencyKey: khoaKey("th"), now: NOW });
    const ngayMo = new Date(NOW.getTime() + 3 * 86_400_000);
    const r = await cap(hv.id, k.id, "CAP_MIEN_PHI", ngayMo);
    expect(r).toMatchObject({ ok: true, hanhDong: "MO_LAI_SAU_THU_HOI", entitlementId: a.entitlementId });
    if (r.ok) expect(NGAY(r.hetHan)).toBe("22/11/2027");
    const q = await db.onlEntitlement.findUniqueOrThrow({ where: { id: a.entitlementId } });
    expect(q).toMatchObject({ status: "ACTIVE", revokedAt: null, revokedReason: null, source: "FREE_GRANT" });
    expect(await db.onlLessonProgress.count({ where: { entitlementId: a.entitlementId } })).toBe(1);
    expect(await vaoDuoc(hv.id, k, k.baiB, ngayMo)).toEqual({ ok: true });
    const kinds = (await db.onlEntitlementEvent.findMany({ where: { entitlementId: a.entitlementId }, orderBy: { createdAt: "asc" } })).map((e) => e.kind);
    expect(kinds).toEqual(["GRANTED", "REVOKED", "REOPENED_AFTER_REVOKE"]);
  });

  it("🔴 [ONL-DB-07] hết hạn rồi mua lại: cổng chặn HET_HAN khi quá hạn; mua lại giữ CHÍNH dòng + tiến độ; hạn tính từ ngày mua", async () => {
    const k = await dungKhoa({ thang: 3, choGiaHan: false });
    const hv = await taoHocVien("07");
    const a = await cap(hv.id, k.id, "MUA");
    if (!a.ok) throw new Error("cấp thất bại");
    await db.onlLessonProgress.create({ data: { entitlementId: a.entitlementId, lessonStableId: k.baiA, status: "IN_PROGRESS", percent: 60 } });
    const sau = new Date(Date.UTC(2027, 2, 1, 5, 0, 0)); // 01/03/2027: quá hạn 19/02/2027
    expect(await vaoDuoc(hv.id, k, k.baiB, sau)).toEqual({ ok: false, ma: "HET_HAN" });
    const r = await cap(hv.id, k.id, "MUA", sau);
    expect(r).toMatchObject({ ok: true, hanhDong: "MO_LAI_SAU_HET_HAN", entitlementId: a.entitlementId });
    if (r.ok) expect(NGAY(r.hetHan)).toBe("1/6/2027");
    expect(await vaoDuoc(hv.id, k, k.baiB, sau)).toEqual({ ok: true });
    expect(await db.onlLessonProgress.count({ where: { entitlementId: a.entitlementId } })).toBe(1);
  });

  it("[ONL-DB-08] khoá TRỌN ĐỜI: mua/cấp trùng bị từ chối, DB không thêm dòng/sự kiện", async () => {
    const k = await dungKhoa({ thang: null, choGiaHan: true });
    const hv = await taoHocVien("08");
    const a = await cap(hv.id, k.id, "MUA");
    expect(a).toMatchObject({ ok: true, hetHan: null });
    if (!a.ok) return;
    for (const loai of ["MUA", "CAP_MIEN_PHI"] as const) expect(await cap(hv.id, k.id, loai)).toMatchObject({ ok: false, ma: "DA_TRON_DOI" });
    expect(await db.onlEntitlementEvent.count({ where: { entitlementId: a.entitlementId } })).toBe(1);
  });

  it("🔴 [ONL-DB-09] mua khoá KHÔNG đang bán bị từ chối; quản trị cấp miễn phí vẫn được (đối chứng dương); khoá/học viên không tồn tại có mã riêng", async () => {
    const k = await dungKhoa({ thang: 12, choGiaHan: false, banDang: "NOT_ON_SALE" });
    const hv = await taoHocVien("09");
    expect(await cap(hv.id, k.id, "MUA")).toMatchObject({ ok: false, ma: "KHOA_KHONG_DANG_BAN" });
    expect(await db.onlEntitlement.count({ where: { courseId: k.id } })).toBe(0);
    expect(await cap(hv.id, k.id, "CAP_MIEN_PHI")).toMatchObject({ ok: true });
    expect(await cap(hv.id, "khong-co-khoa", "MUA")).toMatchObject({ ok: false, ma: "KHOA_KHONG_TON_TAI" });
    const k2 = await dungKhoa({ thang: 12, choGiaHan: false });
    expect(await cap("khong-co-hv", k2.id, "MUA")).toMatchObject({ ok: false, ma: "HOC_VIEN_KHONG_TON_TAI" });
  });

  it("🔴 [ONL-DB-10] CHÍNH SÁCH 'không cho xem lại bài đã qua': BẬT ⇒ bài đã xong bị chặn, bài khác vẫn vào; TẮT ⇒ vào được; cài đặt HỎNG ⇒ ĐÓNG", async () => {
    const bat = { ...caiDatKhoiDauChoBanNhap(), khongChoXemLaiBaiDaQua: true };
    const kBat = await dungKhoa({ thang: 12, choGiaHan: false, caiDat: bat });
    const kTat = await dungKhoa({ thang: 12, choGiaHan: false, caiDat: { ...bat, khongChoXemLaiBaiDaQua: false } });
    const kHong = await dungKhoa({ thang: 12, choGiaHan: false, caiDat: { khongChoXemLaiBaiDaQua: false } }); // thiếu khoá bắt buộc
    const hv = await taoHocVien("10");
    for (const k of [kBat, kTat, kHong]) {
      const a = await cap(hv.id, k.id, "MUA");
      if (!a.ok) throw new Error("cấp thất bại");
      await db.onlLessonProgress.create({ data: { entitlementId: a.entitlementId, lessonStableId: k.baiA, status: "COMPLETED", percent: 100, completedAt: NOW, completedVersionNumber: 1 } });
    }
    expect(await vaoDuoc(hv.id, kBat, kBat.baiA)).toEqual({ ok: false, ma: "DA_HOAN_THANH_KHONG_XEM_LAI" });
    expect(await vaoDuoc(hv.id, kBat, kBat.baiB)).toEqual({ ok: true });
    expect(await vaoDuoc(hv.id, kTat, kTat.baiA)).toEqual({ ok: true });
    expect(await vaoDuoc(hv.id, kHong, kHong.baiA)).toEqual({ ok: false, ma: "CAI_DAT_KHONG_HOP_LE" });
  });

  it("🔴 [ONL-DB-11] cách ly: quyền của con A KHÔNG mở nội dung cho con B (cùng khoá); chưa phát hành ⇒ KHOA_CHUA_PHAT_HANH; bài lạ ⇒ BAI_KHONG_TON_TAI", async () => {
    const k = await dungKhoa({ thang: 12, choGiaHan: false });
    const a = await taoHocVien("11a");
    const b = await taoHocVien("11b");
    await cap(a.id, k.id, "MUA");
    expect(await vaoDuoc(a.id, k, k.baiA)).toEqual({ ok: true });
    expect(await vaoDuoc(b.id, k, k.baiA)).toEqual({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await vaoDuoc(a.id, k, "bai-la")).toEqual({ ok: false, ma: "BAI_KHONG_TON_TAI" });
    await db.onlCourse.update({ where: { id: k.id }, data: { publishedVersionId: null } });
    expect(await vaoDuoc(a.id, k, k.baiA)).toEqual({ ok: false, ma: "KHOA_CHUA_PHAT_HANH" });
  });

  it("🔴 [ONL-DB-12] RÀNG BUỘC DB (kể cả SQL tay): sổ sự kiện chỉ-thêm; quyền trùng (học viên × khoá) bị khoá; giá bán > giá niêm yết bị CHECK; hai bản nháp cùng khoá bị khoá; mã khoá chữ thường bị CHECK", async () => {
    const k = await dungKhoa({ thang: 12, choGiaHan: false });
    const hv = await taoHocVien("12");
    const a = await cap(hv.id, k.id, "MUA");
    if (!a.ok) throw new Error("cấp thất bại");
    const ev = await db.onlEntitlementEvent.findFirstOrThrow({ where: { entitlementId: a.entitlementId } });
    await expect(db.onlEntitlementEvent.update({ where: { id: ev.id }, data: { reason: "sửa lén" } })).rejects.toThrow();
    await expect(db.onlEntitlementEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
    await expect(db.onlEntitlement.create({ data: { studentId: hv.id, courseId: k.id, source: "PURCHASE", startsAt: NOW, anchorDay: 19 } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.onlCourse.update({ where: { id: k.id }, data: { salePrice: 1_000_000 } })).rejects.toThrow();
    await db.onlCourseVersion.create({ data: { courseId: k.id, number: 2, status: "DRAFT", settingsJson: {} } });
    await expect(db.onlCourseVersion.create({ data: { courseId: k.id, number: 3, status: "DRAFT", settingsJson: {} } })).rejects.toThrow();
    await expect(db.onlCourse.create({ data: { code: "ci-onl-thuong", slug: `ci-onl-thuong-${Date.now()}`, name: `${P}x` } })).rejects.toThrow();
    // Thu hồi mà thiếu lý do ≥10 ký tự bị CHECK chặn ngay ở DB:
    await expect(db.onlEntitlement.update({ where: { id: a.entitlementId }, data: { status: "REVOKED", revokedAt: NOW, revokedReason: "ngắn" } })).rejects.toThrow();
  });
});
