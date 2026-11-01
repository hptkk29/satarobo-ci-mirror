// tests/finance/quyen-hoc-trong-tx.test.ts — CÁC HÀM *TrongTx của tầng ghi quyền học (lib/entitlements/dich-vu.ts)
// trên POSTGRES THẬT: nhúng được vào transaction của NGƯỜI GỌI (tiền · điểm danh · xếp lớp · bảo lưu).
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts)
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Chạy được MỘT MÌNH (luật 18).
//
// Thứ cần chứng minh mà test thuần KHÔNG chứng minh được:
//   1. người gọi cuộn ngược ⇒ KHÔNG còn dòng quyền học / sổ cái / audit / cache nào (cùng số phận);
//   2. cờ tắt ⇒ cùng lỗi `TAT` như vỏ cũ, và không ghi gì;
//   3. N lượt đồng thời, mỗi lượt giữ MỘT transaction của riêng mình, KHÔNG treo nhau (không kết nối thứ hai);
//   4. cờ đọc cho cơ sở A không mở cửa cho quyền học của cơ sở B.
//
// Hành vi của các vỏ cũ đã được chứng minh ở `quyen-hoc-dich-vu.test.ts` (chạy NGUYÊN VĂN, không sửa).
//
// 💡 Ca đồng thời mạnh nhất khi cỡ bể nhỏ: `DATABASE_URL='…?connection_limit=3'`. Với bể mặc định (cpu×2+1)
// nó vẫn đúng nhưng yếu hơn; khi ấy lưới `[DVU-PIN-02b]`/`[DVU-PIN-03]` mới là chốt chặn chính.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Prisma, StudyEntitlement } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { tinhGiaTheoMoc } from "@/lib/pricing/tinh-gia-theo-moc";
import { LOI_PHAM_VI_TAT } from "@/lib/entitlements/feature";
import {
  LoiQuyenHoc,
  capNhatHanBangTrongTx,
  capQuyenHoc,
  capQuyenHocTrongTx,
  chuanBiCapQuyenHoc,
  docCoPhamVi,
  docQuyenHocTheoHocVien,
  dongBangQuyenHocTrongTx,
  dungQuyenHocTrongTx,
  ghiNhanBaiTrongTx,
  huyGhiNhanBaiTrongTx,
  moBangQuyenHocTrongTx,
  xepLop,
  xepLopTrongTx,
  type CapQuyenHocInput,
  type CoPhamVi,
  type PhuThuoc,
} from "@/lib/entitlements/dich-vu";

if (!RUN_DB_TESTS) console.warn(`[QHT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-qht-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const HV = `${T}hv`;
const HV_KHAC = `${T}hv-khac`;
const HV_TRONG = `${T}hv-trong`;
const KHOA = `${T}khoa`;
const KHOA_KHAC = `${T}khoa-khac`;
const NGUOI = { id: `${T}nguoi`, name: "Người thử" };
const BAT: PhuThuoc = { batChoCoSo: async () => true };
const NOW = new Date("2026-10-08T03:00:00Z");
const HAN = new Date("2027-01-17T00:00:00Z");

const coBat = (centerId: string = CS1): CoPhamVi => ({ centerId, bat: true });
const coTat = (centerId: string = CS1): CoPhamVi => ({ centerId, bat: false });

class NguoiGoiHuy extends Error {}

/** Mô phỏng NGƯỜI GỌI: mở transaction của mình, làm việc, rồi bị cuộn ngược vì một lý do khác. */
async function roiHuy(fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<void> {
  await expect(
    db.$transaction(async (tx) => {
      await fn(tx);
      throw new NguoiGoiHuy("bước sau của người gọi hỏng");
    }),
  ).rejects.toBeInstanceOf(NguoiGoiHuy);
}

async function don() {
  await db.studyEntitlementUsage.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studyEntitlement.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studyEntitlement.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { OR: [{ module: "entitlements", actorId: NGUOI.id }, { module: "qht-danh-dau" }] } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}
async function dung() {
  await don();
  for (const id of [CS1, CS2]) await db.center.create({ data: { id, name: id, slug: id, address: "x" } });
}

let dem = 0;
// Giá lẻ, không tròn: 10.560.000 là giá 48 buổi thật; mốc 12/24 ra số lẻ sau giảm.
const gia = (soBuoi: number) => tinhGiaTheoMoc({ gia48: 10_560_000, soBuoi, thuTuCon: 1 });
function capInput(o: Partial<CapQuyenHocInput> = {}, soBuoi = 12): CapQuyenHocInput {
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

/** Cách NGƯỜI GỌI ĐÚNG cấp quyền học: đọc cờ + orgUnitId TRƯỚC, rồi mở transaction của riêng mình. */
async function capNgoai(vao: CapQuyenHocInput, o: { co?: CoPhamVi } = {}) {
  const { co, orgUnitId } = await chuanBiCapQuyenHoc(vao.centerId, BAT);
  return await db.$transaction((tx) => capQuyenHocTrongTx(tx, vao, o.co ?? co, orgUnitId));
}

async function capDuoc(o: Partial<CapQuyenHocInput> = {}, soBuoi = 12): Promise<StudyEntitlement> {
  return (await capNgoai(capInput(o, soBuoi))).quyenHoc;
}
/** Cấp + xếp lớp (qua vỏ cũ, đã được chứng minh ở bộ kia) để có quyền học ACTIVE. */
async function capVaXep(soBuoi = 12, baiKeTiep = 13): Promise<StudyEntitlement> {
  const e = await capDuoc({}, soBuoi);
  return (await xepLop({ entitlementId: e.id, enrollmentId: `${T}gd`, classId: `${T}lop`, baiKeTiepCuaLop: baiKeTiep, actor: NGUOI, now: NOW }, BAT)).quyenHoc;
}
const doc = (id: string) => db.studyEntitlement.findUniqueOrThrow({ where: { id } });
const demAudit = (entityId: string, action?: string) =>
  db.auditLog.count({ where: { module: "entitlements", entityId, ...(action ? { action } : {}) } });
const bangLoi = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => (e instanceof LoiQuyenHoc ? e.ma : `KHAC:${String(e)}`));

describe.skipIf(!RUN_DB_TESTS)("[QHT-01] capQuyenHocTrongTx — cùng số phận với transaction của người gọi", () => {
  beforeEach(dung);
  afterAll(don);

  it("người gọi CUỘN NGƯỢC sau khi cấp ⇒ không còn dòng quyền học, không còn audit", async () => {
    const vao = capInput();
    const { co, orgUnitId } = await chuanBiCapQuyenHoc(vao.centerId, BAT);
    await roiHuy((tx) => capQuyenHocTrongTx(tx, vao, co, orgUnitId));
    expect(await db.studyEntitlement.count({ where: { orderItemId: vao.orderItemId } })).toBe(0);
    expect(await db.auditLog.count({ where: { module: "entitlements", actorId: NGUOI.id } })).toBe(0);
  });

  it("người gọi COMMIT ⇒ đúng một dòng + một audit; số liệu y hệt vỏ cũ", async () => {
    const vao = capInput({}, 24);
    const r = await capNgoai(vao);
    expect(r.daCo).toBe(false);
    expect(r.quyenHoc).toMatchObject({ purchaseKind: "MILESTONE", purchaseSessions: 24, listAmount: 5_280_000, discountAmount: 264_000, netAmount: 5_016_000, status: "AWAITING_PLACEMENT", startLessonOrder: null });
    expect(await demAudit(r.quyenHoc.id, "CREATE")).toBe(1);
  });

  it("idempotent: gọi hai lần cùng orderItemId (cùng transaction, rồi transaction khác) ⇒ MỘT dòng, MỘT audit", async () => {
    const vao = capInput();
    const { co, orgUnitId } = await chuanBiCapQuyenHoc(vao.centerId, BAT);
    const [a, b] = await db.$transaction(async (tx) => [
      await capQuyenHocTrongTx(tx, vao, co, orgUnitId),
      await capQuyenHocTrongTx(tx, vao, co, orgUnitId),
    ]);
    expect([a.daCo, b.daCo]).toEqual([false, true]);
    expect(b.quyenHoc.id).toBe(a.quyenHoc.id);
    const c = await capNgoai(vao);
    expect(c.daCo).toBe(true);
    expect(c.quyenHoc.id).toBe(a.quyenHoc.id);
    expect(await db.studyEntitlement.count({ where: { orderItemId: vao.orderItemId } })).toBe(1);
    expect(await demAudit(a.quyenHoc.id, "CREATE")).toBe(1);
  });

  it("dòng cũ VOIDED thì cấp lại được dòng mới trong transaction của người gọi", async () => {
    const vao = capInput();
    const a = (await capNgoai(vao)).quyenHoc;
    await db.studyEntitlement.update({ where: { id: a.id }, data: { status: "VOIDED" } });
    const b = await capNgoai(vao);
    expect(b.daCo).toBe(false);
    expect(b.quyenHoc.id).not.toBe(a.id);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHT-02] cờ TẮT ⇒ cùng lỗi TAT như vỏ cũ, và không ghi gì", () => {
  beforeEach(dung);
  afterAll(don);

  it("cấp: bản TrongTx và vỏ cũ ném CÙNG mã + CÙNG câu; 0 dòng, 0 audit", async () => {
    const vao = capInput();
    const loiTrong = await capNgoai(vao, { co: coTat() }).catch((e: unknown) => e);
    const loiVo = await capQuyenHoc(capInput(), { batChoCoSo: async () => false }).catch((e: unknown) => e);
    expect(loiTrong).toBeInstanceOf(LoiQuyenHoc);
    expect(loiVo).toBeInstanceOf(LoiQuyenHoc);
    expect((loiTrong as LoiQuyenHoc).ma).toBe("TAT");
    expect((loiVo as LoiQuyenHoc).ma).toBe("TAT");
    expect((loiTrong as LoiQuyenHoc).message).toBe(LOI_PHAM_VI_TAT);
    expect((loiVo as LoiQuyenHoc).message).toBe(LOI_PHAM_VI_TAT);
    expect(await db.studyEntitlement.count({ where: { studentId: HV } })).toBe(0);
    expect(await db.auditLog.count({ where: { module: "entitlements", actorId: NGUOI.id } })).toBe(0);
  });

  it("đối chứng dương: cùng đầu vào, cờ BẬT ⇒ cấp được", async () => {
    expect(await bangLoi(capNgoai(capInput()))).toBeNull();
  });

  it("xếp / bảo lưu / mở băng / dời hạn khi tắt ⇒ TAT và dòng KHÔNG đổi; từ chối là throw nên phép ghi trước đó của người gọi cũng cuộn", async () => {
    const e = await capVaXep(12, 13);
    const truoc = await doc(e.id);
    const chay = (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      bangLoi(
        db.$transaction(async (tx) => {
          // Phép ghi RIÊNG của người gọi, đứng trước: phải biến mất cùng lỗi.
          await tx.auditLog.create({ data: { actorName: "x", module: "qht-danh-dau", entityType: "x", entityId: e.id, action: "X", changedFields: [] } });
          await fn(tx);
        }),
      );
    expect(await chay((tx) => xepLopTrongTx(tx, { entitlementId: e.id, enrollmentId: "x", classId: "x", baiKeTiepCuaLop: 1, actor: NGUOI, now: NOW }, coTat()))).toBe("TAT");
    expect(await chay((tx) => dongBangQuyenHocTrongTx(tx, { entitlementId: e.id, reserveId: "r", frozenUntil: HAN, actor: NGUOI, now: NOW }, coTat()))).toBe("TAT");
    expect(await chay((tx) => moBangQuyenHocTrongTx(tx, { entitlementId: e.id, actor: NGUOI, now: NOW }, coTat()))).toBe("TAT");
    expect(await chay((tx) => capNhatHanBangTrongTx(tx, { entitlementId: e.id, reserveId: "r", frozenUntil: HAN, actor: NGUOI, now: NOW }, coTat()))).toBe("TAT");
    expect(await doc(e.id)).toEqual(truoc);
    expect(await db.auditLog.count({ where: { module: "qht-danh-dau" } })).toBe(0);
  });

  it("ghi / huỷ nhận bài khi tắt ⇒ KẾT QUẢ 'TAT' (không ném, không đọc DB: id không tồn tại vẫn không báo KHONG_TIM_THAY)", async () => {
    const ma = `${T}khong-co-that`;
    const g = await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: ma, lessonOrder: 14, nguon: "CLASS", actor: NGUOI, now: NOW }, coTat()));
    expect(g).toEqual({ ghi: false, lyDo: "TAT" });
    const h = await db.$transaction((tx) => huyGhiNhanBaiTrongTx(tx, { entitlementId: ma, lessonOrder: 14, lyDo: "sửa điểm danh", actor: NGUOI, now: NOW }, coTat()));
    expect(h).toEqual({ daHuy: false, trangThai: null, lyDo: "TAT" });
    // Đối chứng dương: cờ BẬT mà id không có ⇒ ném KHONG_TIM_THAY (chứng minh nhánh tắt thật sự bỏ qua việc đọc).
    expect(await bangLoi(db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: ma, lessonOrder: 14, nguon: "CLASS", actor: NGUOI, now: NOW }, coBat())))).toBe("KHONG_TIM_THAY");
  });

  it("huỷ nhận bài thiếu lý do ⇒ DAU_VAO kể cả khi cờ tắt (lỗi lập trình không bị cờ che)", async () => {
    expect(await bangLoi(db.$transaction((tx) => huyGhiNhanBaiTrongTx(tx, { entitlementId: "x", lessonOrder: 1, lyDo: "  ", actor: NGUOI, now: NOW }, coTat())))).toBe("DAU_VAO");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHT-03] cờ đọc cho cơ sở nào thì chỉ ghi được quyền học của cơ sở đó", () => {
  beforeEach(dung);
  afterAll(don);

  it("cờ CS2 + quyền học CS1 ⇒ DAU_VAO ở MỌI hàm ghi, và dòng không đổi", async () => {
    const e = await capVaXep(12, 13);
    const truoc = await doc(e.id);
    const sai = coBat(CS2);
    const chay = (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => bangLoi(db.$transaction(fn));
    expect(await bangLoi(capNgoai(capInput(), { co: sai }))).toBe("DAU_VAO");
    expect(await chay((tx) => xepLopTrongTx(tx, { entitlementId: e.id, enrollmentId: "x", classId: "x", baiKeTiepCuaLop: 1, actor: NGUOI, now: NOW }, sai))).toBe("DAU_VAO");
    expect(await chay((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: 13, nguon: "CLASS", actor: NGUOI, now: NOW }, sai))).toBe("DAU_VAO");
    expect(await chay((tx) => huyGhiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: 13, lyDo: "x", actor: NGUOI, now: NOW }, sai))).toBe("DAU_VAO");
    expect(await chay((tx) => dongBangQuyenHocTrongTx(tx, { entitlementId: e.id, reserveId: "r", frozenUntil: HAN, actor: NGUOI, now: NOW }, sai))).toBe("DAU_VAO");
    expect(await chay((tx) => moBangQuyenHocTrongTx(tx, { entitlementId: e.id, actor: NGUOI, now: NOW }, sai))).toBe("DAU_VAO");
    expect(await chay((tx) => capNhatHanBangTrongTx(tx, { entitlementId: e.id, reserveId: "r", frozenUntil: HAN, actor: NGUOI, now: NOW }, sai))).toBe("DAU_VAO");
    expect(await doc(e.id)).toEqual(truoc);
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHT-04] xepLopTrongTx", () => {
  beforeEach(dung);
  afterAll(don);

  const vaoXep = (id: string) => ({ entitlementId: id, enrollmentId: `${T}gd`, classId: `${T}lop`, baiKeTiepCuaLop: 15, actor: NGUOI, now: NOW });

  it("người gọi cuộn ngược ⇒ quyền học VẪN chưa xếp lớp, không có audit PLACE", async () => {
    const e = await capDuoc();
    await roiHuy((tx) => xepLopTrongTx(tx, vaoXep(e.id), coBat()));
    const sau = await doc(e.id);
    expect(sau).toMatchObject({ status: "AWAITING_PLACEMENT", startLessonOrder: null, endLessonOrder: null, enrollmentId: null });
    expect(await demAudit(e.id, "PLACE")).toBe(0);
  });

  // 12/10/2026 — ĐẢO NGỮ NGHĨA theo quyết định chủ dự án (XEP-LOP.md): gói KHÔNG trọn bắt đầu ĐÚNG ở bài kế tiếp của lớp (trước: neo đầu học phần,
  // 13–24 + học vượt 2 bài). Lý lẽ của ca — người gọi commit thì quyền học ACTIVE + đúng MỘT audit PLACE — giữ nguyên.
  it("người gọi commit ⇒ mua 12, lớp ở bài 15 ⇒ 15–26 (bài kế tiếp là bài đầu, không học vượt), ACTIVE, đúng MỘT audit", async () => {
    const e = await capDuoc();
    const r = await db.$transaction((tx) => xepLopTrongTx(tx, vaoXep(e.id), coBat()));
    expect(r.quyenHoc).toMatchObject({ status: "ACTIVE", startLessonOrder: 15, endLessonOrder: 26, skippedSessions: 0 });
    expect(r.phamVi).toMatchObject({ catchupMode: "NONE", requiredCatchupLessons: [], lessonsBeforeStart: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] });
    expect(await demAudit(e.id, "PLACE")).toBe(1);
  });

  it("xếp lần hai ⇒ TRANG_THAI và dòng không đổi (cổng đứng trước phép ghi đầu tiên)", async () => {
    const e = await capDuoc();
    await db.$transaction((tx) => xepLopTrongTx(tx, vaoXep(e.id), coBat()));
    const truoc = await doc(e.id);
    expect(await bangLoi(db.$transaction((tx) => xepLopTrongTx(tx, vaoXep(e.id), coBat())))).toBe("TRANG_THAI");
    expect(await doc(e.id)).toEqual(truoc);
    expect(await demAudit(e.id, "PLACE")).toBe(1);
  });

  it("quyền học không tồn tại ⇒ KHONG_TIM_THAY", async () => {
    expect(await bangLoi(db.$transaction((tx) => xepLopTrongTx(tx, vaoXep(`${T}khong-co`), coBat())))).toBe("KHONG_TIM_THAY");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHT-05] ghiNhanBaiTrongTx / huyGhiNhanBaiTrongTx — cùng số phận với điểm danh của người gọi", () => {
  beforeEach(dung);
  afterAll(don);

  const ghi = (tx: Prisma.TransactionClient, id: string, lessonOrder: number) =>
    ghiNhanBaiTrongTx(tx, { entitlementId: id, lessonOrder, nguon: "CLASS", actor: NGUOI, now: NOW }, coBat());

  it("điểm danh của người gọi hỏng SAU khi ghi bài ⇒ không dòng sổ cái, cache consumedSessions về 0, không audit", async () => {
    const e = await capVaXep(12, 13);
    await roiHuy(async (tx) => {
      const r = await ghi(tx, e.id, 14);
      expect(r).toMatchObject({ ghi: true, daTieuThu: 1, conLai: 11 });
    });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(0);
    expect((await doc(e.id)).consumedSessions).toBe(0);
    expect(await demAudit(e.id, "CONSUME")).toBe(0);
  });

  it("commit ⇒ một dòng sổ cái + cache = 1; ghi lại cùng bài ⇒ DA_CO, không đếm đôi", async () => {
    const e = await capVaXep(12, 13);
    const r1 = await db.$transaction((tx) => ghi(tx, e.id, 14));
    const r2 = await db.$transaction((tx) => ghi(tx, e.id, 14));
    expect(r1).toMatchObject({ ghi: true, loai: "TIEU_THU", daTieuThu: 1, conLai: 11 });
    expect(r2).toEqual({ ghi: false, lyDo: "DA_CO" });
    expect((await doc(e.id)).consumedSessions).toBe(1);
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(1);
  });

  it("bài ngoài phạm vi / quyền chưa xếp lớp ⇒ KẾT QUẢ từ chối (không ném), chưa ghi gì", async () => {
    const chuaXep = await capDuoc();
    expect(await db.$transaction((tx) => ghi(tx, chuaXep.id, 14))).toEqual({ ghi: false, lyDo: "KHONG_NHAN_BAI" });
    const e = await capVaXep(12, 13);
    expect(await db.$transaction((tx) => ghi(tx, e.id, 30))).toMatchObject({ ghi: false, lyDo: "NGOAI_PHAM_VI" });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: { in: [chuaXep.id, e.id] } } })).toBe(0);
  });

  it("huỷ nhận bài cuộn ngược theo người gọi: dòng sổ cái VẪN còn hiệu lực, cache giữ nguyên; commit thì consumed giảm", async () => {
    const e = await capVaXep(12, 13);
    await db.$transaction((tx) => ghi(tx, e.id, 14));
    await db.$transaction((tx) => ghi(tx, e.id, 15));
    const huy = (tx: Prisma.TransactionClient) =>
      huyGhiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: 14, lyDo: "sửa điểm danh vắng", actor: NGUOI, now: NOW }, coBat());
    await roiHuy(async (tx) => {
      expect(await huy(tx)).toMatchObject({ daHuy: true });
    });
    expect((await doc(e.id)).consumedSessions).toBe(2);
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id, voidedAt: null } })).toBe(2);
    expect(await db.$transaction(huy)).toMatchObject({ daHuy: true, trangThai: "ACTIVE" });
    expect((await doc(e.id)).consumedSessions).toBe(1);
    // Huỷ lần hai ⇒ không có gì để huỷ, không audit mới.
    expect(await db.$transaction(huy)).toMatchObject({ daHuy: false });
    expect(await demAudit(e.id, "USAGE_VOID")).toBe(1);
  });

  it("học đủ 12 bài ⇒ EXHAUSTED; huỷ một bài ⇒ MỞ LẠI về ACTIVE (y hệt vỏ cũ)", async () => {
    const e = await capVaXep(12, 13);
    for (let b = 13; b <= 24; b++) await db.$transaction((tx) => ghi(tx, e.id, b));
    expect((await doc(e.id)).status).toBe("EXHAUSTED");
    const r = await db.$transaction((tx) => huyGhiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: 24, lyDo: "sửa điểm danh", actor: NGUOI, now: NOW }, coBat()));
    expect(r).toMatchObject({ daHuy: true, trangThai: "ACTIVE" });
  });

  it("12 lượt ghi ĐỒNG THỜI các bài khác nhau, mỗi lượt một transaction riêng ⇒ đủ 12 dòng, cache = 12, không treo", async () => {
    const e = await capVaXep(12, 13);
    const kq = await Promise.all(Array.from({ length: 12 }, (_, i) => db.$transaction((tx) => ghi(tx, e.id, 13 + i))));
    expect(kq.filter((k) => k.ghi)).toHaveLength(12);
    const sau = await doc(e.id);
    expect(sau.consumedSessions).toBe(12);
    expect(sau.status).toBe("EXHAUSTED");
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id, voidedAt: null } })).toBe(12);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHT-06] đồng thời — mỗi lượt giữ MỘT transaction, không cần kết nối thứ hai (cỡ bể)", () => {
  beforeEach(dung);
  afterAll(don);

  it("12 lượt cấp ĐỒNG THỜI cho 12 dòng đơn khác nhau ⇒ đủ 12 dòng, không treo", async () => {
    const ds = await Promise.all(Array.from({ length: 12 }, () => capNgoai(capInput())));
    expect(ds.filter((d) => !d.daCo)).toHaveLength(12);
    expect(await db.studyEntitlement.count({ where: { studentId: HV } })).toBe(12);
  });

  it("12 lượt cấp ĐỒNG THỜI cùng một orderItemId ⇒ đúng MỘT dòng, MỘT audit", async () => {
    const vao = capInput();
    const ds = await Promise.all(Array.from({ length: 12 }, () => capNgoai(vao)));
    expect(new Set(ds.map((d) => d.quyenHoc.id)).size).toBe(1);
    expect(ds.filter((d) => !d.daCo)).toHaveLength(1);
    expect(await db.studyEntitlement.count({ where: { orderItemId: vao.orderItemId } })).toBe(1);
    expect(await demAudit(ds[0].quyenHoc.id, "CREATE")).toBe(1);
  });

  it("đọc cờ ngoài transaction cho kết quả đúng theo cơ sở (đối chứng: cùng hàm, hai cờ khác nhau)", async () => {
    const dep: PhuThuoc = { batChoCoSo: async (c) => c === CS1 };
    expect(await docCoPhamVi(CS1, dep)).toEqual({ centerId: CS1, bat: true });
    expect(await docCoPhamVi(CS2, dep)).toEqual({ centerId: CS2, bat: false });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHT-07] dungQuyenHocTrongTx — đóng quyền học (dừng học / huỷ hoàn)", () => {
  beforeEach(dung);
  afterAll(don);

  const dungVao = (id: string, lyDo = "dừng học theo đơn") => ({ entitlementId: id, lyDo, actor: NGUOI, now: NOW });

  it("chưa xếp lớp ⇒ HUY_HOAN → VOIDED, nhả orderItemId để cấp lại được", async () => {
    const vao = capInput();
    const e = (await capNgoai(vao)).quyenHoc;
    const r = await db.$transaction((tx) => dungQuyenHocTrongTx(tx, dungVao(e.id)));
    expect(r.suKien).toBe("HUY_HOAN");
    expect(r.quyenHoc).toMatchObject({ status: "VOIDED", effectiveTo: null });
    expect(await demAudit(e.id, "VOID")).toBe(1);
    const lai = await capNgoai(vao);
    expect(lai.daCo).toBe(false);
    expect(lai.quyenHoc.id).not.toBe(e.id);
  });

  it("ACTIVE ⇒ DUNG_HOC → STOPPED, effectiveTo = now, audit STOP mang lý do", async () => {
    const e = await capVaXep(12, 13);
    const r = await db.$transaction((tx) => dungQuyenHocTrongTx(tx, dungVao(e.id)));
    expect(r.suKien).toBe("DUNG_HOC");
    expect(r.quyenHoc).toMatchObject({ status: "STOPPED" });
    expect(r.quyenHoc.effectiveTo?.toISOString()).toBe(NOW.toISOString());
    const a = await db.auditLog.findFirstOrThrow({ where: { module: "entitlements", entityId: e.id, action: "STOP" } });
    expect(a.reason).toBe("dừng học theo đơn");
  });

  it("FROZEN và EXHAUSTED cũng dừng được (không phụ thuộc cờ: hàm không nhận cờ)", async () => {
    const dong = await capVaXep(12, 13);
    await db.studyEntitlement.update({ where: { id: dong.id }, data: { status: "FROZEN", statusBeforeFreeze: "ACTIVE", frozenReserveId: "r", frozenUntil: HAN } });
    expect((await db.$transaction((tx) => dungQuyenHocTrongTx(tx, dungVao(dong.id)))).quyenHoc.status).toBe("STOPPED");
    const het = await capVaXep(12, 13);
    await db.studyEntitlement.update({ where: { id: het.id }, data: { status: "EXHAUSTED" } });
    expect((await db.$transaction((tx) => dungQuyenHocTrongTx(tx, dungVao(het.id)))).quyenHoc.status).toBe("STOPPED");
  });

  it("SEAT_HOLD và quyền đã đóng ⇒ TRANG_THAI, dòng KHÔNG đổi (máy trạng thái chưa có cạnh — ghim hành vi)", async () => {
    const giu = await capVaXep(12, 13);
    await db.studyEntitlement.update({ where: { id: giu.id }, data: { status: "SEAT_HOLD" } });
    const truoc = await doc(giu.id);
    expect(await bangLoi(db.$transaction((tx) => dungQuyenHocTrongTx(tx, dungVao(giu.id))))).toBe("TRANG_THAI");
    expect(await doc(giu.id)).toEqual(truoc);
    const xong = await capVaXep(12, 13);
    await db.$transaction((tx) => dungQuyenHocTrongTx(tx, dungVao(xong.id)));
    expect(await bangLoi(db.$transaction((tx) => dungQuyenHocTrongTx(tx, dungVao(xong.id))))).toBe("TRANG_THAI");
    expect(await demAudit(xong.id, "STOP")).toBe(1);
  });

  it("thiếu lý do ⇒ DAU_VAO; không tồn tại ⇒ KHONG_TIM_THAY; người gọi cuộn ngược ⇒ quyền học VẪN ACTIVE", async () => {
    const e = await capVaXep(12, 13);
    expect(await bangLoi(db.$transaction((tx) => dungQuyenHocTrongTx(tx, dungVao(e.id, "   "))))).toBe("DAU_VAO");
    expect(await bangLoi(db.$transaction((tx) => dungQuyenHocTrongTx(tx, dungVao(`${T}khong-co`))))).toBe("KHONG_TIM_THAY");
    await roiHuy((tx) => dungQuyenHocTrongTx(tx, dungVao(e.id)));
    expect(await doc(e.id)).toMatchObject({ status: "ACTIVE", effectiveTo: null });
    expect(await demAudit(e.id, "STOP")).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHT-08] bảo lưu — dongBang / moBang / capNhatHan TrongTx", () => {
  beforeEach(dung);
  afterAll(don);

  const bang = (tx: Prisma.TransactionClient, id: string, reserveId = "bl-1", frozenUntil = HAN) =>
    dongBangQuyenHocTrongTx(tx, { entitlementId: id, reserveId, frozenUntil, actor: NGUOI, now: NOW }, coBat());
  const mo = (tx: Prisma.TransactionClient, id: string) => moBangQuyenHocTrongTx(tx, { entitlementId: id, actor: NGUOI, now: NOW }, coBat());
  const gia_han = (tx: Prisma.TransactionClient, id: string, reserveId: string, frozenUntil: Date, now = NOW) =>
    capNhatHanBangTrongTx(tx, { entitlementId: id, reserveId, frozenUntil, actor: NGUOI, now }, coBat());

  it("đóng băng → mở băng cùng transaction người gọi; cuộn ngược thì không dấu vết", async () => {
    const e = await capVaXep(12, 13);
    await roiHuy((tx) => bang(tx, e.id));
    expect(await doc(e.id)).toMatchObject({ status: "ACTIVE", frozenReserveId: null, frozenUntil: null });
    const f = await db.$transaction((tx) => bang(tx, e.id));
    expect(f).toMatchObject({ status: "FROZEN", statusBeforeFreeze: "ACTIVE", frozenReserveId: "bl-1" });
    expect(f.frozenUntil?.toISOString()).toBe(HAN.toISOString());
    await roiHuy((tx) => mo(tx, e.id));
    expect((await doc(e.id)).status).toBe("FROZEN");
    const u = await db.$transaction((tx) => mo(tx, e.id));
    expect(u).toMatchObject({ status: "ACTIVE", statusBeforeFreeze: null, frozenAt: null, frozenUntil: null, frozenReserveId: null });
  });

  it("chưa xếp lớp ⇒ phục học quay về AWAITING_PLACEMENT; ngày kết thúc ở quá khứ ⇒ DAU_VAO; EXHAUSTED không bảo lưu được", async () => {
    const e = await capDuoc();
    await db.$transaction((tx) => bang(tx, e.id));
    expect((await db.$transaction((tx) => mo(tx, e.id))).status).toBe("AWAITING_PLACEMENT");
    expect(await bangLoi(db.$transaction((tx) => bang(tx, e.id, "bl-2", new Date("2026-10-01T00:00:00Z"))))).toBe("DAU_VAO");
    const het = await capVaXep(12, 13);
    await db.studyEntitlement.update({ where: { id: het.id }, data: { status: "EXHAUSTED" } });
    expect(await bangLoi(db.$transaction((tx) => bang(tx, het.id)))).toBe("TRANG_THAI");
    expect(await bangLoi(db.$transaction((tx) => mo(tx, het.id)))).toBe("TRANG_THAI");
  });

  it("dời hạn: đúng hồ sơ ⇒ frozenUntil đổi; hồ sơ khác ⇒ DAU_VAO; không đóng băng ⇒ TRANG_THAI; ngày quá khứ ⇒ DAU_VAO; cuộn ngược ⇒ giữ hạn cũ", async () => {
    const e = await capVaXep(12, 13);
    expect(await bangLoi(db.$transaction((tx) => gia_han(tx, e.id, "bl-1", HAN)))).toBe("TRANG_THAI");
    await db.$transaction((tx) => bang(tx, e.id));
    const moi = new Date("2027-02-17T00:00:00Z");
    await roiHuy((tx) => gia_han(tx, e.id, "bl-1", moi));
    expect((await doc(e.id)).frozenUntil?.toISOString()).toBe(HAN.toISOString());
    expect(await bangLoi(db.$transaction((tx) => gia_han(tx, e.id, "bl-khac", moi)))).toBe("DAU_VAO");
    expect(await bangLoi(db.$transaction((tx) => gia_han(tx, e.id, "bl-1", new Date("2026-10-01T00:00:00Z"))))).toBe("DAU_VAO");
    const r = await db.$transaction((tx) => gia_han(tx, e.id, "bl-1", moi));
    expect(r.frozenUntil?.toISOString()).toBe(moi.toISOString());
    expect(r).toMatchObject({ status: "FROZEN", frozenReserveId: "bl-1" });
    expect(await demAudit(e.id, "FREEZE_EXTEND")).toBe(1);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHT-09] docQuyenHocTheoHocVien — đọc theo lô, mọi trạng thái trừ VOIDED", () => {
  beforeEach(dung);
  afterAll(don);

  it("MỘT câu cho nhiều học viên; có mặt đủ mọi id được hỏi; VOIDED bị loại; COMPLETED/EXPIRED/STOPPED vẫn có (khác LEGACY)", async () => {
    const a1 = await capDuoc({ studentId: HV });
    const a2 = await capDuoc({ studentId: HV });
    const a3 = await capDuoc({ studentId: HV });
    const a4 = await capDuoc({ studentId: HV });
    const a5 = await capDuoc({ studentId: HV });
    await db.studyEntitlement.update({ where: { id: a2.id }, data: { status: "VOIDED" } });
    await db.studyEntitlement.update({ where: { id: a3.id }, data: { status: "COMPLETED" } });
    await db.studyEntitlement.update({ where: { id: a4.id }, data: { status: "EXPIRED" } });
    await db.studyEntitlement.update({ where: { id: a5.id }, data: { status: "STOPPED" } });
    const b1 = await capDuoc({ studentId: HV_KHAC });

    let soCau = 0;
    const client = { studyEntitlement: { findMany: (args: Prisma.StudyEntitlementFindManyArgs) => { soCau++; return db.studyEntitlement.findMany(args); } } };
    const ra = await docQuyenHocTheoHocVien(client, [HV, HV_KHAC, HV_TRONG, HV], KHOA);
    expect(soCau).toBe(1);
    expect([...ra.keys()].sort()).toEqual([HV, HV_KHAC, HV_TRONG].sort());
    expect(ra.get(HV)?.map((e) => e.id).sort()).toEqual([a1.id, a3.id, a4.id, a5.id].sort());
    expect(ra.get(HV_KHAC)?.map((e) => e.id)).toEqual([b1.id]);
    expect(ra.get(HV_TRONG)).toEqual([]);
  });

  it("lọc theo khoá; courseId = null ⇒ mọi khoá; danh sách rỗng ⇒ Map rỗng và KHÔNG truy vấn", async () => {
    const dung1 = await capDuoc({ studentId: HV, courseId: KHOA });
    const khac = await capDuoc({ studentId: HV, courseId: KHOA_KHAC });
    expect((await docQuyenHocTheoHocVien(db, [HV], KHOA)).get(HV)?.map((e) => e.id)).toEqual([dung1.id]);
    expect((await docQuyenHocTheoHocVien(db, [HV], null)).get(HV)?.map((e) => e.id).sort()).toEqual([dung1.id, khac.id].sort());
    let soCau = 0;
    const client = { studyEntitlement: { findMany: () => { soCau++; return Promise.resolve([] as StudyEntitlement[]); } } };
    const rong = await docQuyenHocTheoHocVien(client, [], KHOA);
    expect(rong.size).toBe(0);
    expect(soCau).toBe(0);
  });

  it("đi qua scopedDb: actor CS1 chỉ thấy quyền học của CS1 (đối chứng dương: thấy của mình)", async () => {
    const cs1 = await capDuoc({ studentId: HV, centerId: CS1 });
    await capDuoc({ studentId: HV, centerId: CS2 });
    const actor = {
      userId: NGUOI.id, isSuperAdmin: false, isHoLevel: false, orgRoles: [],
      permissions: [{ action: "entitlements:view", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_MANAGER", centerScope: [CS1] }],
      visibleCenterIds: [CS1], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
    } as unknown as Actor;
    const ra = await docQuyenHocTheoHocVien(scopedDb(actor), [HV], KHOA);
    expect(ra.get(HV)?.map((e) => e.id)).toEqual([cs1.id]);
  });
});

// ── LƯỚI BỔ SUNG SAU LƯỢT CẤY ĐỘC LẬP ────────────────────────────────────────────────────────────────────────
// Sáu phép cấy ban đầu cho XANH (lưới không chạm tới): biên `frozenUntil == now` · biên `soBuoi == 0` · audit
// ghi bằng KẾT NỐI GỐC thay vì `tx` · ngưỡng mở lại `conLai >= 0` (EXHAUSTED mở lại khi bài ân hạn bị huỷ) ·
// `voidReason` bị bỏ. Các ca dưới đây khoá từng chỗ; mỗi ca đều đã cấy lại lỗi tương ứng và thấy ĐỎ.
describe.skipIf(!RUN_DB_TESTS)("[QHT-10] biên + audit theo người gọi + ân hạn", () => {
  beforeEach(dung);
  afterAll(don);

  it("[QHT-10a] ngày kết thúc bảo lưu == now ⇒ DAU_VAO (đúng biên), now + 1ms thì được; dời hạn cùng luật", async () => {
    const e = await capVaXep(12, 13);
    const bang = (frozenUntil: Date) => (tx: Prisma.TransactionClient) =>
      dongBangQuyenHocTrongTx(tx, { entitlementId: e.id, reserveId: "bl-1", frozenUntil, actor: NGUOI, now: NOW }, coBat());
    expect(await bangLoi(db.$transaction(bang(NOW)))).toBe("DAU_VAO");
    expect((await doc(e.id)).status).toBe("ACTIVE");
    expect(await bangLoi(db.$transaction(bang(new Date(NOW.getTime() + 1))))).toBeNull();
    const giaHan = (frozenUntil: Date) => (tx: Prisma.TransactionClient) =>
      capNhatHanBangTrongTx(tx, { entitlementId: e.id, reserveId: "bl-1", frozenUntil, actor: NGUOI, now: NOW }, coBat());
    expect(await bangLoi(db.$transaction(giaHan(NOW)))).toBe("DAU_VAO");
    expect(await bangLoi(db.$transaction(giaHan(new Date(NOW.getTime() + 2))))).toBeNull();
  });

  it("[QHT-10b] giá: số buổi 0 / âm / lẻ ⇒ DAU_VAO; lệch một đồng ⇒ DAU_VAO; số buổi 1 là biên HỢP LỆ; không ghi gì khi từ chối", async () => {
    const goc = gia(12);
    for (const soBuoi of [0, -1, 1.5]) {
      expect(await bangLoi(capNgoai(capInput({ gia: { ...goc, soBuoi } })))).toBe("DAU_VAO");
    }
    expect(await bangLoi(capNgoai(capInput({ gia: { ...goc, thanhTien: goc.thanhTien + 1 } })))).toBe("DAU_VAO");
    expect(await db.studyEntitlement.count({ where: { studentId: HV } })).toBe(0);
    expect(await bangLoi(capNgoai(capInput({ gia: { ...goc, soBuoi: 1 } })))).toBeNull();
  });

  it("[QHT-10c] MỌI hàm ghi: audit cuộn ngược cùng người gọi (audit ghi bằng kết nối gốc sẽ sống sót và ca này đỏ)", async () => {
    const demTatCa = () => db.auditLog.count({ where: { module: "entitlements", actorId: NGUOI.id } });
    const khong = async (viec: string, fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const truoc = await demTatCa();
      await roiHuy(fn);
      expect({ viec, sau: await demTatCa() }).toEqual({ viec, sau: truoc });
    };
    // cấp · xếp
    const vao = capInput();
    const { co, orgUnitId } = await chuanBiCapQuyenHoc(vao.centerId, BAT);
    await khong("cap", (tx) => capQuyenHocTrongTx(tx, vao, co, orgUnitId));
    const chuaXep = await capDuoc();
    await khong("xep", (tx) => xepLopTrongTx(tx, { entitlementId: chuaXep.id, enrollmentId: `${T}gd`, classId: `${T}lop`, baiKeTiepCuaLop: 13, actor: NGUOI, now: NOW }, coBat()));
    await khong("dung-huy-hoan", (tx) => dungQuyenHocTrongTx(tx, { entitlementId: chuaXep.id, lyDo: "huỷ", actor: NGUOI, now: NOW }));
    // ghi · huỷ nhận bài · đóng băng · dừng
    const e = await capVaXep(12, 13);
    await khong("ghi", (tx) => ghiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: 13, nguon: "CLASS", actor: NGUOI, now: NOW }, coBat()));
    await db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: 13, nguon: "CLASS", actor: NGUOI, now: NOW }, coBat()));
    await khong("huy", (tx) => huyGhiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: 13, lyDo: "sửa", actor: NGUOI, now: NOW }, coBat()));
    await khong("dong-bang", (tx) => dongBangQuyenHocTrongTx(tx, { entitlementId: e.id, reserveId: "bl-1", frozenUntil: HAN, actor: NGUOI, now: NOW }, coBat()));
    await khong("dung", (tx) => dungQuyenHocTrongTx(tx, { entitlementId: e.id, lyDo: "dừng", actor: NGUOI, now: NOW }));
    // mở băng · dời hạn (cần quyền học đang FROZEN, đã commit)
    await db.$transaction((tx) => dongBangQuyenHocTrongTx(tx, { entitlementId: e.id, reserveId: "bl-1", frozenUntil: HAN, actor: NGUOI, now: NOW }, coBat()));
    await khong("mo-bang", (tx) => moBangQuyenHocTrongTx(tx, { entitlementId: e.id, actor: NGUOI, now: NOW }, coBat()));
    await khong("gia-han", (tx) => capNhatHanBangTrongTx(tx, { entitlementId: e.id, reserveId: "bl-1", frozenUntil: new Date("2027-03-01T00:00:00Z"), actor: NGUOI, now: NOW }, coBat()));
  });

  it("[QHT-10d] ân hạn: huỷ bài ÂN HẠN của quyền EXHAUSTED ⇒ vẫn EXHAUSTED (còn 0 buổi); dòng sổ cái mang lý do + thời điểm huỷ", async () => {
    const cap = await capDuoc();
    const e = (
      await xepLop({ entitlementId: cap.id, enrollmentId: `${T}gd`, classId: `${T}lop`, baiKeTiepCuaLop: 13, graceSessionsGranted: 2, actor: NGUOI, now: NOW }, BAT)
    ).quyenHoc;
    const ghi = (b: number) => db.$transaction((tx) => ghiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: b, nguon: "CLASS", actor: NGUOI, now: NOW }, coBat()));
    for (let b = 13; b <= 24; b++) await ghi(b);
    expect((await doc(e.id)).status).toBe("EXHAUSTED");
    expect(await ghi(25)).toMatchObject({ ghi: true, loai: "AN_HAN", trangThai: "EXHAUSTED" });
    const luc = new Date("2026-10-09T05:00:00Z");
    const r = await db.$transaction((tx) => huyGhiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: 25, lyDo: "điểm danh nhầm", actor: NGUOI, now: luc }, coBat()));
    expect(r).toMatchObject({ daHuy: true, trangThai: "EXHAUSTED" });
    const sau = await doc(e.id);
    expect(sau).toMatchObject({ status: "EXHAUSTED", consumedSessions: 12, graceSessionsUsed: 0 });
    const dong = await db.studyEntitlementUsage.findUniqueOrThrow({ where: { entitlementId_lessonOrder: { entitlementId: e.id, lessonOrder: 25 } } });
    expect(dong.voidReason).toBe("điểm danh nhầm");
    expect(dong.voidedAt?.toISOString()).toBe(luc.toISOString());
    // Đối chứng dương: huỷ một bài THƯỜNG (trả lại một buổi) thì MỞ LẠI.
    expect(await db.$transaction((tx) => huyGhiNhanBaiTrongTx(tx, { entitlementId: e.id, lessonOrder: 24, lyDo: "sửa", actor: NGUOI, now: luc }, coBat()))).toMatchObject({ daHuy: true, trangThai: "ACTIVE" });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHT-11] docQuyenHocTheoHocVien — thứ tự trả về", () => {
  beforeEach(dung);
  afterAll(don);

  it("[QHT-11a] theo startLessonOrder TĂNG DẦN, chưa xếp lớp (null) xếp CUỐI; cùng bài bắt đầu thì theo thời điểm tạo", async () => {
    const chuaXep = await capDuoc({ studentId: HV });
    const muon = await capDuoc({ studentId: HV });
    const som = await capDuoc({ studentId: HV });
    const cungBai = await capDuoc({ studentId: HV });
    await db.studyEntitlement.update({ where: { id: muon.id }, data: { startLessonOrder: 25, endLessonOrder: 36 } });
    await db.studyEntitlement.update({ where: { id: som.id }, data: { startLessonOrder: 13, endLessonOrder: 24 } });
    await db.studyEntitlement.update({ where: { id: cungBai.id }, data: { startLessonOrder: 13, endLessonOrder: 24 } });
    const ra = await docQuyenHocTheoHocVien(db, [HV], KHOA);
    expect(ra.get(HV)?.map((e) => e.id)).toEqual([som.id, cungBai.id, muon.id, chuaXep.id]);
  });
});
