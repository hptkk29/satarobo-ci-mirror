// tests/finance/quyen-hoc-dich-vu.test.ts — TẦNG GHI/ĐỌC quyền học (lib/entitlements/dich-vu.ts) trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts)
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// Đo những thứ test thuần KHÔNG chứng minh được: khoá dòng + khoá advisory dưới đua, idempotent, cổng
// công tắc đứng TRƯỚC phép ghi, và CACHE `consumedSessions` luôn bằng sổ cái sau mọi chuỗi thao tác.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { tinhGiaTheoMoc } from "@/lib/pricing/tinh-gia-theo-moc";
import {
  LoiQuyenHoc,
  capQuyenHoc,
  docQuyenHocDangMo,
  dongBangQuyenHoc,
  ghiNhanBai,
  huyGhiNhanBai,
  moBangQuyenHoc,
  timQuyenHocChoBai,
  xepLop,
  type PhuThuoc,
} from "@/lib/entitlements/dich-vu";

if (!RUN_DB_TESTS) console.warn(`[QHD-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-qhd-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const HV = `${T}hv`;
const KHOA = `${T}khoa`;
const NGUOI = { id: `${T}nguoi`, name: "Người thử" };
const BAT: PhuThuoc = { batChoCoSo: async () => true };
const TAT: PhuThuoc = { batChoCoSo: async () => false };
const NOW = new Date("2026-10-08T03:00:00Z");

async function don() {
  await db.studyEntitlementUsage.deleteMany({ where: { entitlementId: { startsWith: T } } });
  await db.studyEntitlement.deleteMany({ where: { id: { startsWith: T } } });
  // Cascade xoá luôn sổ cái. Xoá theo TIỀN TỐ học viên: id quyền học là cuid, không mang tiền tố fixture.
  await db.studyEntitlement.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { module: "entitlements", actorId: NGUOI.id } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}
async function dung() {
  await don();
  for (const id of [CS1, CS2]) await db.center.create({ data: { id, name: id, slug: id, address: "x" } });
}

let dem = 0;
const gia = (soBuoi: number, thuTuCon = 1) => tinhGiaTheoMoc({ gia48: 10_560_000, soBuoi, thuTuCon });
function capInput(o: Partial<Parameters<typeof capQuyenHoc>[0]> = {}, soBuoi = 12) {
  const k = ++dem;
  return {
    studentId: HV,
    courseId: KHOA,
    orderId: `${T}don-${k}`,
    orderItemId: `${T}dong-${k}`,
    centerId: CS1,
    gia: gia(soBuoi),
    pricingSnapshot: { gia48: 10_560_000 },
    actor: NGUOI,
    ...o,
  };
}
async function capVaXep(soBuoi: number, baiKeTiep: number, o: { graceSessionsGranted?: number; cauHinh?: Parameters<typeof xepLop>[0]["cauHinh"] } = {}) {
  const { quyenHoc } = await capQuyenHoc(capInput({}, soBuoi), BAT);
  const r = await xepLop(
    { entitlementId: quyenHoc.id, enrollmentId: `${T}gd`, classId: `${T}lop`, baiKeTiepCuaLop: baiKeTiep, graceSessionsGranted: o.graceSessionsGranted ?? 0, cauHinh: o.cauHinh, actor: NGUOI, now: NOW },
    BAT,
  );
  return r.quyenHoc;
}
const ghi = (id: string, lessonOrder: number, extra: Partial<Parameters<typeof ghiNhanBai>[0]> = {}) =>
  ghiNhanBai({ entitlementId: id, lessonOrder, nguon: "CLASS", actor: NGUOI, now: NOW, ...extra }, BAT);
const doc = (id: string) => db.studyEntitlement.findUniqueOrThrow({ where: { id } });
const bangLoi = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => (e instanceof LoiQuyenHoc ? e.ma : `KHAC:${String(e)}`));

function actorCoSo(centerId: string): Actor {
  return {
    userId: NGUOI.id, isSuperAdmin: false, isHoLevel: false, orgRoles: [],
    permissions: [{ action: "entitlements:view", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_MANAGER", centerScope: [centerId] }],
    visibleCenterIds: [centerId], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe.skipIf(!RUN_DB_TESTS)("[QHD-01] công tắc TẮT: mọi phép GHI từ chối và KHÔNG ghi gì", () => {
  beforeEach(dung);
  afterAll(don);

  it("cấp quyền học khi tắt ⇒ TAT, 0 dòng, 0 audit", async () => {
    expect(await bangLoi(capQuyenHoc(capInput(), TAT))).toBe("TAT");
    expect(await db.studyEntitlement.count({ where: { studentId: HV } })).toBe(0);
    expect(await db.auditLog.count({ where: { module: "entitlements", actorId: NGUOI.id } })).toBe(0);
  });

  it("đối chứng dương: cùng đầu vào khi BẬT thì cấp được", async () => {
    expect(await bangLoi(capQuyenHoc(capInput(), BAT))).toBeNull();
  });

  it("xếp lớp / ghi bài / huỷ bài / bảo lưu / mở băng khi tắt ⇒ TAT và dòng không đổi", async () => {
    const e = await capVaXep(12, 15);
    const truoc = await doc(e.id);
    expect(await bangLoi(xepLop({ entitlementId: e.id, enrollmentId: "x", classId: "x", baiKeTiepCuaLop: 1, actor: NGUOI, now: NOW }, TAT))).toBe("TAT");
    expect(await bangLoi(ghiNhanBai({ entitlementId: e.id, lessonOrder: 14, nguon: "CLASS", actor: NGUOI, now: NOW }, TAT))).toBe("TAT");
    expect(await bangLoi(huyGhiNhanBai({ entitlementId: e.id, lessonOrder: 14, lyDo: "x", actor: NGUOI, now: NOW }, TAT))).toBe("TAT");
    expect(await bangLoi(dongBangQuyenHoc({ entitlementId: e.id, reserveId: "r", frozenUntil: new Date("2027-01-01"), actor: NGUOI, now: NOW }, TAT))).toBe("TAT");
    expect(await bangLoi(moBangQuyenHoc({ entitlementId: e.id, actor: NGUOI, now: NOW }, TAT))).toBe("TAT");
    expect(await doc(e.id)).toEqual(truoc);
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHD-02] cấp quyền học — idempotent theo dòng đơn", () => {
  beforeEach(dung);
  afterAll(don);

  it("cấp hai lần cùng orderItemId ⇒ lần hai trả lại dòng cũ (daCo), chỉ MỘT dòng, MỘT audit", async () => {
    const vao = capInput();
    const a = await capQuyenHoc(vao, BAT);
    const b = await capQuyenHoc(vao, BAT);
    expect([a.daCo, b.daCo]).toEqual([false, true]);
    expect(b.quyenHoc.id).toBe(a.quyenHoc.id);
    expect(await db.studyEntitlement.count({ where: { orderItemId: vao.orderItemId } })).toBe(1);
    expect(await db.auditLog.count({ where: { module: "entitlements", entityId: a.quyenHoc.id, action: "CREATE" } })).toBe(1);
  });

  it("5 lượt cấp ĐỒNG THỜI cùng orderItemId ⇒ đúng MỘT dòng", async () => {
    const vao = capInput();
    const kq = await Promise.all(Array.from({ length: 5 }, () => capQuyenHoc(vao, BAT)));
    expect(new Set(kq.map((k) => k.quyenHoc.id)).size).toBe(1);
    expect(kq.filter((k) => !k.daCo)).toHaveLength(1);
    expect(await db.studyEntitlement.count({ where: { orderItemId: vao.orderItemId } })).toBe(1);
  });

  it("quyền học cũ VOIDED thì cấp lại được dòng mới", async () => {
    const vao = capInput();
    const a = await capQuyenHoc(vao, BAT);
    await db.studyEntitlement.update({ where: { id: a.quyenHoc.id }, data: { status: "VOIDED" } });
    const b = await capQuyenHoc(vao, BAT);
    expect(b.daCo).toBe(false);
    expect(b.quyenHoc.id).not.toBe(a.quyenHoc.id);
  });

  it("ghi đúng số liệu giá + trạng thái đầu + loại mua", async () => {
    const { quyenHoc } = await capQuyenHoc(capInput({}, 24), BAT);
    expect(quyenHoc).toMatchObject({ purchaseKind: "MILESTONE", purchaseSessions: 24, listAmount: 5_280_000, discountAmount: 264_000, netAmount: 5_016_000, status: "AWAITING_PLACEMENT", startLessonOrder: null });
  });

  it("kết quả giá không nhất quán ⇒ DAU_VAO và không ghi", async () => {
    const hong = { ...gia(12), thanhTien: 1 };
    expect(await bangLoi(capQuyenHoc(capInput({ gia: hong }), BAT))).toBe("DAU_VAO");
    expect(await db.studyEntitlement.count({ where: { studentId: HV } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHD-03] xếp lớp — chốt phạm vi bài", () => {
  beforeEach(dung);
  afterAll(don);

  // 12/10/2026 — ĐẢO NGỮ NGHĨA theo quyết định chủ dự án (docs/thu-hoc-phi-pham-vi/XEP-LOP.md): gói KHÔNG trọn bắt đầu ĐÚNG ở bài kế tiếp của lớp,
  // bỏ qua toàn bộ bài trước, KHÔNG học vượt (trước: neo đầu học phần 13–24, BA §9b nghĩa I). Lý lẽ của hai ca vẫn là "phạm vi chốt đúng 12 bài,
  // skippedSessions đếm bài bỏ qua TRONG phạm vi" — chỉ số cụ thể đổi.
  it("mua 12, lớp ở bài 15 ⇒ 15–26 (bài kế tiếp của lớp LÀ bài đầu), ACTIVE, không bỏ bài trong phạm vi", async () => {
    const e = await capVaXep(12, 15);
    expect(e).toMatchObject({ status: "ACTIVE", startLessonOrder: 15, endLessonOrder: 26, skippedSessions: 0, enrollmentId: `${T}gd` });
    expect(e.scopeLockedAt).toEqual(NOW);
  });

  it("mua 12, lớp ở bài 20 ⇒ 20–31, skippedSessions = 0 (14 bài trước bỏ qua NGOÀI phạm vi, không đếm); phạm vi vẫn đúng 12 bài", async () => {
    const e = await capVaXep(12, 20);
    expect(e).toMatchObject({ startLessonOrder: 20, endLessonOrder: 31, skippedSessions: 0 });
  });

  it("mua TRỌN 48, lớp ở bài 8 (đã dạy 7 > trần 6) ⇒ 1–48, [21/10] vào từ buổi kế tiếp: cả 7 bài đã qua bỏ qua (skipped = 7, không bù, không xin duyệt)", async () => {
    const e = await capVaXep(48, 8);
    expect(e).toMatchObject({ startLessonOrder: 1, endLessonOrder: 48, skippedSessions: 7 });
  });

  it("xếp lớp lần hai ⇒ TRANG_THAI và dòng KHÔNG đổi", async () => {
    const e = await capVaXep(12, 15);
    const truoc = await doc(e.id);
    expect(await bangLoi(xepLop({ entitlementId: e.id, enrollmentId: "khac", classId: "khac", baiKeTiepCuaLop: 30, actor: NGUOI, now: NOW }, BAT))).toBe("TRANG_THAI");
    expect(await doc(e.id)).toEqual(truoc);
  });

  it("phạm vi vượt giáo trình (mua 36 ở bài 25) ném và KHÔNG ghi gì", async () => {
    const { quyenHoc } = await capQuyenHoc(capInput({}, 36), BAT);
    const loi = await xepLop({ entitlementId: quyenHoc.id, enrollmentId: "x", classId: "x", baiKeTiepCuaLop: 25, actor: NGUOI, now: NOW }, BAT).catch((e: unknown) => String(e));
    expect(loi).toMatch(/vượt giáo trình/);
    expect((await doc(quyenHoc.id)).status).toBe("AWAITING_PLACEMENT");
  });

  it("quyền học không tồn tại ⇒ KHONG_TIM_THAY", async () => {
    expect(await bangLoi(xepLop({ entitlementId: `${T}khong-co`, enrollmentId: "x", classId: "x", baiKeTiepCuaLop: 1, actor: NGUOI, now: NOW }, BAT))).toBe("KHONG_TIM_THAY");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHD-04] ghi nhận bài đã học", () => {
  beforeEach(dung);
  afterAll(don);

  it("ghi bài trong phạm vi ⇒ tiêu thụ 1, còn 11; ghi lại cùng bài ⇒ DA_CO, không đếm đôi", async () => {
    const e = await capVaXep(12, 13);
    expect(await ghi(e.id, 13)).toMatchObject({ ghi: true, loai: "TIEU_THU", daTieuThu: 1, conLai: 11 });
    expect(await ghi(e.id, 13)).toEqual({ ghi: false, lyDo: "DA_CO" });
    expect((await doc(e.id)).consumedSessions).toBe(1);
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(1);
  });

  it("bài ngoài phạm vi và bài bị bỏ qua bị từ chối — không ghi dòng nào", async () => {
    const e = await capVaXep(48, 8); // 1–48, bỏ bài 1 (gói trọn vào trễ quá trần)
    expect(await ghi(e.id, 49)).toEqual({ ghi: false, lyDo: "NGOAI_PHAM_VI" });
    expect(await ghi(e.id, 1)).toEqual({ ghi: false, lyDo: "BO_QUA" });
    expect(await ghi(e.id, 99)).toEqual({ ghi: false, lyDo: "NGOAI_PHAM_VI" });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(0);
  });

  it("5 lượt ghi ĐỒNG THỜI cùng một bài ⇒ đúng MỘT dòng sổ cái, đếm 1", async () => {
    const e = await capVaXep(12, 13);
    await Promise.all(Array.from({ length: 5 }, () => ghi(e.id, 14)));
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(1);
    expect((await doc(e.id)).consumedSessions).toBe(1);
  });

  it("học đủ 12 bài ⇒ EXHAUSTED; có ân hạn thì ghi graceStartedAt", async () => {
    const e = await capVaXep(12, 13, { graceSessionsGranted: 2 });
    let cuoi;
    for (let b = 13; b <= 24; b++) cuoi = await ghi(e.id, b);
    expect(cuoi).toMatchObject({ ghi: true, trangThai: "EXHAUSTED", conLai: 0 });
    const d = await doc(e.id);
    expect(d.status).toBe("EXHAUSTED");
    expect(d.graceStartedAt).toEqual(NOW);
    expect(d.consumedSessions).toBe(12);
  });

  it("gói có bỏ qua 1 bài: học đủ 11 bài còn lại là hết (không đòi bài bị bỏ)", async () => {
    const e = await capVaXep(48, 8); // 1–48, bỏ bài 1 ⇒ còn 47 bài
    for (let b = 2; b <= 48; b++) await ghi(e.id, b);
    expect((await doc(e.id)).status).toBe("EXHAUSTED");
  });

  it("ân hạn: bài 25, 26 ghi nguồn GRACE, KHÔNG vào consumed; dùng hết ân hạn ⇒ SEAT_HOLD + giữ chỗ 14 ngày; bài 27 bị từ chối", async () => {
    const e = await capVaXep(12, 13, { graceSessionsGranted: 2 });
    for (let b = 13; b <= 24; b++) await ghi(e.id, b);
    expect(await ghi(e.id, 25)).toMatchObject({ ghi: true, loai: "AN_HAN", trangThai: "EXHAUSTED", daTieuThu: 12 });
    expect(await ghi(e.id, 26)).toMatchObject({ ghi: true, loai: "AN_HAN", trangThai: "SEAT_HOLD" });
    const d = await doc(e.id);
    expect(d).toMatchObject({ consumedSessions: 12, graceSessionsUsed: 2, status: "SEAT_HOLD" });
    expect(d.seatHoldUntil).toEqual(new Date(NOW.getTime() + 14 * 24 * 3600 * 1000));
    expect(await ghi(e.id, 27)).toEqual({ ghi: false, lyDo: "KHONG_NHAN_BAI" });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id, source: "GRACE" } })).toBe(2);
  });

  it("bài trong dải ân hạn khi quyền CHƯA hết ⇒ CHUA_HET_QUYEN, không ghi", async () => {
    const e = await capVaXep(12, 13); // chưa học buổi nào: còn nhiều buổi
    const khoiPhuc = await db.studyEntitlement.update({ where: { id: e.id }, data: { graceSessionsGranted: 2 } });
    expect(khoiPhuc.status).toBe("ACTIVE");
    expect(await ghi(e.id, 25)).toEqual({ ghi: false, lyDo: "CHUA_HET_QUYEN" });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(0);
  });

  it("quyền học chưa xếp lớp / đang bảo lưu KHÔNG nhận bài (trả kết quả, không ném)", async () => {
    const { quyenHoc } = await capQuyenHoc(capInput({}, 12), BAT);
    expect(await ghi(quyenHoc.id, 13)).toEqual({ ghi: false, lyDo: "KHONG_NHAN_BAI" });
    const e = await capVaXep(12, 13);
    await dongBangQuyenHoc({ entitlementId: e.id, reserveId: "r1", frozenUntil: new Date("2027-01-01"), actor: NGUOI, now: NOW }, BAT);
    expect(await ghi(e.id, 13)).toEqual({ ghi: false, lyDo: "KHONG_NHAN_BAI" });
  });

  it("mỗi lần ghi để lại audit module=entitlements", async () => {
    const e = await capVaXep(12, 13);
    await ghi(e.id, 13);
    expect(await db.auditLog.count({ where: { module: "entitlements", entityId: e.id, action: "CONSUME" } })).toBe(1);
    expect(await db.auditLog.count({ where: { module: "entitlements", entityId: e.id, action: "PLACE" } })).toBe(1);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHD-05] huỷ ghi nhận (điểm danh bị sửa)", () => {
  beforeEach(dung);
  afterAll(don);

  it("vô hiệu một bài ⇒ consumed giảm; ghi lại cùng bài BẬT LẠI dòng cũ, không chèn dòng mới", async () => {
    const e = await capVaXep(12, 13);
    await ghi(e.id, 14);
    await ghi(e.id, 15);
    expect(await huyGhiNhanBai({ entitlementId: e.id, lessonOrder: 14, lyDo: "điểm danh sửa thành vắng", actor: NGUOI, now: NOW }, BAT)).toMatchObject({ daHuy: true });
    expect((await doc(e.id)).consumedSessions).toBe(1);
    expect(await ghi(e.id, 14, { nguon: "MAKEUP" })).toMatchObject({ ghi: true, loai: "TIEU_THU", daTieuThu: 2 });
    const dong = await db.studyEntitlementUsage.findMany({ where: { entitlementId: e.id, lessonOrder: 14 } });
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ source: "MAKEUP", voidedAt: null, voidReason: null });
  });

  it("huỷ bài không có dòng, hoặc đã huỷ rồi ⇒ daHuy=false và không ghi audit mới", async () => {
    const e = await capVaXep(12, 13);
    await ghi(e.id, 14);
    const vao = { entitlementId: e.id, lessonOrder: 14, lyDo: "sửa", actor: NGUOI, now: NOW };
    expect((await huyGhiNhanBai({ ...vao, lessonOrder: 20 }, BAT)).daHuy).toBe(false);
    expect((await huyGhiNhanBai(vao, BAT)).daHuy).toBe(true);
    expect((await huyGhiNhanBai(vao, BAT)).daHuy).toBe(false);
    expect(await db.auditLog.count({ where: { module: "entitlements", entityId: e.id, action: "USAGE_VOID" } })).toBe(1);
  });

  it("EXHAUSTED mà sổ cái giảm ⇒ MỞ LẠI về ACTIVE (còn buổi thì không được kẹt ở hết buổi)", async () => {
    const e = await capVaXep(12, 13, { graceSessionsGranted: 2 });
    for (let b = 13; b <= 24; b++) await ghi(e.id, b);
    expect((await doc(e.id)).status).toBe("EXHAUSTED");
    expect(await huyGhiNhanBai({ entitlementId: e.id, lessonOrder: 20, lyDo: "sửa", actor: NGUOI, now: NOW }, BAT)).toEqual({ daHuy: true, trangThai: "ACTIVE" });
    expect(await doc(e.id)).toMatchObject({ status: "ACTIVE", consumedSessions: 11, graceStartedAt: null });
  });

  it("thiếu lý do ⇒ DAU_VAO và không đổi gì", async () => {
    const e = await capVaXep(12, 13);
    await ghi(e.id, 14);
    expect(await bangLoi(huyGhiNhanBai({ entitlementId: e.id, lessonOrder: 14, lyDo: "  ", actor: NGUOI, now: NOW }, BAT))).toBe("DAU_VAO");
    expect((await doc(e.id)).consumedSessions).toBe(1);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHD-06] bảo lưu / phục học", () => {
  beforeEach(dung);
  afterAll(don);

  it("ACTIVE → FROZEN → ACTIVE: lưu trạng thái trước, xoá dấu vết khi mở băng", async () => {
    const e = await capVaXep(12, 13);
    const den = new Date("2027-01-01T00:00:00Z");
    const f = await dongBangQuyenHoc({ entitlementId: e.id, reserveId: "r1", frozenUntil: den, actor: NGUOI, now: NOW }, BAT);
    expect(f).toMatchObject({ status: "FROZEN", statusBeforeFreeze: "ACTIVE", frozenReserveId: "r1" });
    expect(f.frozenUntil).toEqual(den);
    const m = await moBangQuyenHoc({ entitlementId: e.id, actor: NGUOI, now: NOW }, BAT);
    expect(m).toMatchObject({ status: "ACTIVE", statusBeforeFreeze: null, frozenAt: null, frozenUntil: null, frozenReserveId: null });
  });

  it("chưa xếp lớp mà bảo lưu ⇒ phục học quay về AWAITING_PLACEMENT", async () => {
    const { quyenHoc } = await capQuyenHoc(capInput({}, 12), BAT);
    await dongBangQuyenHoc({ entitlementId: quyenHoc.id, reserveId: "r", frozenUntil: new Date("2027-01-01"), actor: NGUOI, now: NOW }, BAT);
    expect((await moBangQuyenHoc({ entitlementId: quyenHoc.id, actor: NGUOI, now: NOW }, BAT)).status).toBe("AWAITING_PLACEMENT");
  });

  it("EXHAUSTED không bảo lưu được (MM-20) và dòng không đổi; ngày kết thúc quá khứ ⇒ DAU_VAO", async () => {
    const e = await capVaXep(12, 13);
    for (let b = 13; b <= 24; b++) await ghi(e.id, b);
    const truoc = await doc(e.id);
    expect(await bangLoi(dongBangQuyenHoc({ entitlementId: e.id, reserveId: "r", frozenUntil: new Date("2027-01-01"), actor: NGUOI, now: NOW }, BAT))).toBe("TRANG_THAI");
    // Câu từ chối phải NÓI RÕ là không bảo lưu được (không phải câu chung của máy trạng thái) — người dùng đọc nó.
    const thongDiep = await dongBangQuyenHoc({ entitlementId: e.id, reserveId: "r", frozenUntil: new Date("2027-01-01"), actor: NGUOI, now: NOW }, BAT).catch((x: unknown) => String((x as Error).message));
    expect(thongDiep).toMatch(/không bảo lưu được/);
    expect(await doc(e.id)).toEqual(truoc);
    const e2 = await capVaXep(12, 13);
    expect(await bangLoi(dongBangQuyenHoc({ entitlementId: e2.id, reserveId: "r", frozenUntil: new Date("2026-01-01"), actor: NGUOI, now: NOW }, BAT))).toBe("DAU_VAO");
  });

  it("mở băng quyền học không đang bảo lưu ⇒ TRANG_THAI", async () => {
    const e = await capVaXep(12, 13);
    expect(await bangLoi(moBangQuyenHoc({ entitlementId: e.id, actor: NGUOI, now: NOW }, BAT))).toBe("TRANG_THAI");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHD-07] cache consumedSessions luôn bằng sổ cái", () => {
  beforeEach(dung);
  afterAll(don);

  it("sau chuỗi ngẫu nhiên (cố định hạt giống) ghi / huỷ / ghi lại / đua, cache = số dòng còn hiệu lực không phải ân hạn", async () => {
    const e = await capVaXep(24, 13, { graceSessionsGranted: 2 });
    let h = 12345;
    const rnd = () => ((h = (h * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 80; i++) {
      const bai = 13 + Math.floor(rnd() * 26); // 13..38: gồm cả dải ân hạn 37–38 và ngoài phạm vi
      const r = rnd();
      if (r < 0.6) await ghi(e.id, bai, { nguon: rnd() < 0.5 ? "CLASS" : "MAKEUP" });
      else if (r < 0.85) await huyGhiNhanBai({ entitlementId: e.id, lessonOrder: bai, lyDo: "thử", actor: NGUOI, now: NOW }, BAT);
      else await Promise.all([ghi(e.id, bai), ghi(e.id, bai), huyGhiNhanBai({ entitlementId: e.id, lessonOrder: bai, lyDo: "đua", actor: NGUOI, now: NOW }, BAT)]);
      const d = await doc(e.id);
      const dong = await db.studyEntitlementUsage.findMany({ where: { entitlementId: e.id } });
      const hieuLuc = dong.filter((x) => x.voidedAt === null);
      expect({ i, c: d.consumedSessions }).toEqual({ i, c: hieuLuc.filter((x) => x.source !== "GRACE").length });
      expect({ i, g: d.graceSessionsUsed }).toEqual({ i, g: hieuLuc.filter((x) => x.source === "GRACE").length });
      expect(d.consumedSessions + d.skippedSessions).toBeLessThanOrEqual(d.purchaseSessions);
    }
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHD-08] đọc qua scopedDb", () => {
  beforeEach(dung);
  afterAll(don);

  it("actor CS1 chỉ thấy quyền học CS1 (đối chứng dương: thấy của mình)", async () => {
    const a = await capQuyenHoc(capInput({ centerId: CS1 }), BAT);
    await capQuyenHoc(capInput({ centerId: CS2 }), BAT);
    const ds = await docQuyenHocDangMo(scopedDb(actorCoSo(CS1)), HV);
    expect(ds.map((x) => x.id)).toEqual([a.quyenHoc.id]);
  });

  it("lọc theo học viên: quyền học của học viên KHÁC trong cùng cơ sở không lọt vào danh sách", async () => {
    const mine = await capQuyenHoc(capInput({ centerId: CS1 }), BAT);
    await capQuyenHoc(capInput({ centerId: CS1, studentId: `${T}hv-khac` }), BAT);
    const ds = await docQuyenHocDangMo(scopedDb(actorCoSo(CS1)), HV);
    expect(ds.map((x) => x.id)).toEqual([mine.quyenHoc.id]);
    expect((await docQuyenHocDangMo(scopedDb(actorCoSo(CS1)), `${T}hv-khac`)).length).toBe(1);
  });

  it("timQuyenHocChoBai: bài trong phạm vi, trong dải ân hạn, ngoài phạm vi, và quyền chưa xếp lớp", async () => {
    const e = await capVaXep(12, 13, { graceSessionsGranted: 2 });
    await capQuyenHoc(capInput({}, 12), BAT); // chưa xếp lớp: không tham gia
    const c = scopedDb(actorCoSo(CS1));
    const q = { studentId: HV, courseId: KHOA };
    expect((await timQuyenHocChoBai(c, { ...q, lessonOrder: 13 }))?.id).toBe(e.id);
    expect((await timQuyenHocChoBai(c, { ...q, lessonOrder: 24 }))?.id).toBe(e.id);
    expect((await timQuyenHocChoBai(c, { ...q, lessonOrder: 26 }))?.id).toBe(e.id);
    expect(await timQuyenHocChoBai(c, { ...q, lessonOrder: 27 })).toBeNull();
    expect(await timQuyenHocChoBai(c, { ...q, lessonOrder: 12 })).toBeNull();
  });
});
