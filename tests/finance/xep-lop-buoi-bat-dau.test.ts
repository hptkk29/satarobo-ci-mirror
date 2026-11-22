// tests/finance/xep-lop-buoi-bat-dau.test.ts — XẾP LỚP → BUỔI BẮT ĐẦU CỦA HỌC VIÊN, trên POSTGRES THẬT. Mã ca: [XL-DB-xx].
//
// Chạy:  DATABASE_URL=…/satarobo_test_xep DIRECT_URL=$DATABASE_URL TEST_DATABASE_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/xep-lop-buoi-bat-dau.test.ts
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng đơn + lớp của mình (chạy MỘT MÌNH vẫn xanh — luật 18).
// Đồng hồ truyền vào (luật 19). Số tiền lẻ nghìn, không tròn triệu.
//
// Đo: sau khi tiền xác nhận đủ + dòng đơn đã có ghi danh, `hichCapQuyenHocChoDon` (cấp quyền → chốt phạm vi bài) ghi ĐÚNG:
//   · gói trọn [luật chốt 21/10/2026]: start=1,end=48; đã dạy 1..n (n=6) ⇒ CATCH_UP, mọi bài đã qua thành nhu cầu bù MIỄN PHÍ (nguon HOC_VUOT); >n ⇒ bỏ HẾT bài đã qua, không bù, không xin duyệt;
//   · gói không trọn: start = bài kế tiếp của lớp, bỏ qua mọi bài trước, KHÔNG học vượt;
//   · không đủ điều kiện (chưa Student / chưa quyền hợp lệ / lớp không suy được bài) ⇒ KHÔNG xếp thật, quyền học giữ AWAITING_PLACEMENT, có dòng chờ;
//   · không tiêu thụ buổi nào (`StudyEntitlementUsage` luôn 0); idempotent + 5 lượt đồng thời; cờ TẮT ⇒ không ghi gì.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { hichCapQuyenHocChoDon } from "@/lib/entitlements/hich";
import { xetXepLopChoDon } from "@/lib/entitlements/xep-lop-tu-don";
import { xetCapQuyenHocChoDon } from "@/lib/entitlements/cap-tu-don";
import { docBaiKeTiepCuaLop } from "@/lib/entitlements/bai-ke-tiep-db";
import { layUngVienLop } from "@/lib/bao-luu/phuc-hoc-db";
import { convertLeadV2 } from "@/lib/crm/convert-lead-v2";
import { docDuLieuChuyenDoi } from "@/lib/orders/chuyen-doi-don";
import { doiBuoiBatDauCuaDon } from "@/lib/orders/hoc-vuot-chuyen-doi";
import { xetTheoBuoiBatDau } from "@/lib/lms/xep-lop-theo-buoi-bat-dau";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { docPhamViDong, metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";
import { veMetadataConLead } from "@/lib/orders/hoc-vien-dong-don";

if (!RUN_DB_TESTS) console.warn(`[XL-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const T = "fx-xl-";
const KHOA = `${T}khoa`;
const KHOA_2 = `${T}khoa-2`;
const KE_TOAN = `${T}ke-toan`;
const SDT = "0905123456";
const GIA48 = 10_560_000;
/** Giữa trưa VN chủ nhật 11/10/2026 (03:00Z). Mốc "đầu ngày VN" = 10/10 17:00Z. */
const NOW = new Date("2026-10-11T03:00:00Z");
const NGAY = 24 * 60 * 60 * 1000;
const DA_XAC_NHAN = "CONFIRMED" as const;

const BOI_CANH: BoiCanhDon = {
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: NOW,
  coKeHoachDot: false,
};
/** Giá THỰC thu của bé thứ nhất theo mốc (Bảng A/B, PL02): 12 → 2.640.000 · 24 → 5.016.000 · 48 → 8.976.000. */
const GIA_THEO_MOC: Record<number, number> = { 12: 2_640_000, 24: 5_016_000, 48: 8_976_000 };

function metadataScope(soBuoi: 12 | 24 | 48, courseId: string, leadChildId: string | null): { md: Record<string, unknown>; tien: number } {
  const tien = GIA_THEO_MOC[soBuoi]!;
  const dongVao: DongVao = {
    loai: "COURSE_ENROLLMENT",
    tenDong: "Sata 3",
    soLuong: 1,
    donGiaKhach: tien,
    soKhoanGiam: 0,
    laLopNhom: true,
    tongSoBuoiKhoa: 48,
    soBuoiMua: soBuoi,
    gia48: GIA48,
    conKhoa: "con-a",
  };
  const kq = keHoachDon([dongVao], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId, soBuoi }, courseId);
  if (kq.kieu !== "SCOPE" || !md) throw new Error(`fixture: planner không ra SCOPE cho ${soBuoi} buổi (${JSON.stringify(kq).slice(0, 200)})`);
  expect(docPhamViDong(md)?.thanhTien).toBe(tien);
  return { md: veMetadataConLead(md, leadChildId) ?? md, tien };
}

let CS1 = "";
let OU1 = "";
let dem = 0;

// ── LỚP: `daDay` buổi đã dạy (bài 1..daDay) + `conLai` buổi sắp tới (bài daDay+1..) ──────────────────────────────────────
interface LopFx {
  id: string;
  courseId?: string;
  daDay: number;
  conLai?: number;
  /** Chỉ số (0-based) các buổi ĐÃ DẠY bị huỷ. */
  huyDaDay?: number[];
}
const ngayDaDay = (daDay: number, i: number) => new Date(NOW.getTime() - (daDay - i + 1) * NGAY); //  ≥ 2 ngày trước ⇒ chắc chắn < đầu ngày VN của NOW
const ngaySapToi = (j: number) => new Date(NOW.getTime() + (j + 1) * NGAY);

async function dungLop(l: LopFx): Promise<void> {
  await db.class.create({ data: { id: l.id, name: `${T}${l.id}`, courseId: l.courseId ?? KHOA, centerId: CS1, status: "ACTIVE", maxStudents: 12 } });
  const tong = l.daDay + (l.conLai ?? 12);
  for (let i = 0; i < tong; i++) {
    const plan = await db.classSessionPlan.create({ data: { id: `${l.id}-p${i}`, classId: l.id, seq: i + 1, order: i } });
    const quaRoi = i < l.daDay;
    await db.classSession.create({
      data: {
        id: `${l.id}-s${i}`,
        classId: l.id,
        centerId: CS1,
        planId: plan.id,
        date: quaRoi ? ngayDaDay(l.daDay, i) : ngaySapToi(i - l.daDay),
        status: quaRoi && (l.huyDaDay ?? []).includes(i) ? "CANCELLED" : quaRoi ? "COMPLETED" : "SCHEDULED",
      },
    });
  }
}

// ── ĐƠN ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface DongFx {
  id: string;
  soBuoi?: 12 | 24 | 48;
  courseId?: string;
  studentId?: string | null;
  enrollmentId?: string | null;
  leadChildId?: string | null;
}
async function dungDon(id: string, dong: DongFx[], o: { leadId?: string | null } = {}): Promise<number[]> {
  const mds = dong.map((d) => metadataScope(d.soBuoi ?? 48, d.courseId ?? KHOA, d.leadChildId ?? null));
  const tong = mds.reduce((s, m) => s + m.tien, 0);
  await db.order.create({
    data: {
      id,
      code: `ORD-2699-XL-${++dem}-${id.slice(-6)}`,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: `${T}khach`,
      customerPhone: SDT,
      totalAmount: tong,
      subtotal: tong,
      centerId: CS1,
      leadId: o.leadId ?? null,
    },
  });
  for (const [i, d] of dong.entries()) {
    await db.orderItem.create({
      data: {
        id: d.id,
        orderId: id,
        type: "COURSE_ENROLLMENT",
        itemName: "Sata 3",
        quantity: 1,
        unitPrice: mds[i]!.tien,
        totalPrice: mds[i]!.tien,
        discountAmount: 0,
        studentId: d.studentId === undefined ? null : d.studentId,
        enrollmentId: d.enrollmentId ?? null,
        status: "ACTIVE",
        metadata: mds[i]!.md as Prisma.InputJsonValue,
      },
    });
  }
  return mds.map((m) => m.tien);
}
const thu = (orderId: string, orderItemId: string, amount: number) =>
  db.payment.create({
    data: { orderId, orderItemId, amount, method: "cash", paidDate: NOW, saleStatus: "RECORDED", accountantStatus: DA_XAC_NHAN, centerId: CS1 },
  });

async function dungHocVien(id: string, ten: string): Promise<string> {
  await db.student.create({ data: { id, name: `${T}${ten}`, centerId: CS1, status: "ACTIVE" } });
  return id;
}
async function ghiDanh(id: string, studentId: string, classId: string, o: { courseId?: string; leadChildId?: string | null; status?: "STUDYING" | "WITHDREW" } = {}) {
  await db.enrollment.create({ data: { id, studentId, classId, courseId: o.courseId ?? KHOA, centerId: CS1, status: o.status ?? "STUDYING", leadChildId: o.leadChildId ?? null } });
  return id;
}

async function datCo(orgUnitId: string, bat: boolean | null) {
  if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } });
  else {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } },
      create: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
      update: { valueJson: bat },
    });
  }
  clearSettingsCache();
}

async function donDep() {
  const don = await db.order.findMany({ where: { id: { startsWith: T } }, select: { id: true } });
  const ids = don.map((d) => d.id);
  await db.studyEntitlementXuLy.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { orderId: { startsWith: T } }] } });
  await db.studyEntitlementUsage.deleteMany({ where: { entitlement: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } } });
  await db.studyEntitlement.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { studentId: { startsWith: T } }] } });
  await db.auditLog.deleteMany({
    where: { OR: [{ actorName: { startsWith: "Hệ thống — cấp quyền học" } }, { actorName: { startsWith: "Hệ thống — xếp lớp" } }, { entityType: "Order", entityId: { in: ids } }] },
  });
  await db.makeupNeed.deleteMany({ where: { OR: [{ studentId: { startsWith: T } }, { classId: { startsWith: T } }] } });
  await db.receipt.deleteMany({ where: { payment: { orderId: { in: ids } } } });
  await db.payment.updateMany({ where: { orderId: { in: ids } }, data: { adjustmentOfId: null } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  await db.enrollment.deleteMany({ where: { OR: [{ id: { startsWith: T } }, { classId: { startsWith: T } }] } });
  // Học viên do `convertLeadV2` tạo mang id cuid, chỉ có TÊN mang tiền tố.
  const hvConvert = await db.student.findMany({ where: { OR: [{ id: { startsWith: T } }, { name: { startsWith: T } }] }, select: { id: true, parentUserId: true } });
  const hvIds = hvConvert.map((h) => h.id);
  await db.studentConsent.deleteMany({ where: { studentId: { in: hvIds } } });
  await db.auditLog.deleteMany({ where: { entityType: "Student", entityId: { in: hvIds } } });
  await db.student.deleteMany({ where: { id: { in: hvIds } } });
  await db.user.deleteMany({ where: { id: { in: hvConvert.map((h) => h.parentUserId).filter((x): x is string => Boolean(x)) }, name: { startsWith: T } } });
  await db.classSession.deleteMany({ where: { classId: { startsWith: T } } });
  await db.classSessionPlan.deleteMany({ where: { classId: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: T } } });
  await db.leadChild.deleteMany({ where: { lead: { parentName: { startsWith: T } } } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: T } } });
}

const quyenCua = (orderId: string) => db.studyEntitlement.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const choCua = (orderId: string, loai: "CHO_XEP_LOP" | "CHO_CHUYEN_DOI" | "CHO_DUYET_HOC_VUOT" = "CHO_XEP_LOP") => db.studyEntitlementXuLy.findMany({ where: { orderId, loai }, orderBy: { createdAt: "asc" } });
const nhuCauBu = (studentId: string) => db.makeupNeed.findMany({ where: { studentId }, orderBy: { createdAt: "asc" } });
const demHang = async () => ({
  quyen: await db.studyEntitlement.count(),
  cho: await db.studyEntitlementXuLy.count(),
  nhuCau: await db.makeupNeed.count(),
  usage: await db.studyEntitlementUsage.count(),
  audit: await db.auditLog.count({ where: { module: "entitlements" } }),
});
const r6 = (lop: string) => [0, 1, 2, 3, 4, 5].map((i) => `${lop}-s${i}`).sort();
const r = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Một dòng đơn: lớp + học viên + ghi danh (gắn thẳng vào dòng đơn) + đơn + tiền đủ (trừ khi `chuaDuTien`). */
async function dungDayDu(tenCa: string, o: { soBuoi?: 12 | 24 | 48; daDay: number; conLai?: number; huyDaDay?: number[]; chuaDuTien?: boolean }) {
  const lop = `${T}lop-${tenCa}`;
  await dungLop({ id: lop, daDay: o.daDay, conLai: o.conLai, huyDaDay: o.huyDaDay });
  const hv = await dungHocVien(`${T}hv-${tenCa}`, tenCa);
  const gd = await ghiDanh(`${T}gd-${tenCa}`, hv, lop);
  const don = `${T}don-${tenCa}`;
  const item = `${T}item-${tenCa}`;
  const [tien] = await dungDon(don, [{ id: item, soBuoi: o.soBuoi ?? 48, studentId: hv, enrollmentId: gd }]);
  if (!o.chuaDuTien) await thu(don, item, tien!);
  return { lop, hv, gd, don, item, tien: tien! };
}

describe.skipIf(!RUN_DB_TESTS)("[XL-DB] xếp lớp → buổi bắt đầu — Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const [id, ten] of [[KHOA, "Sata 3 (fixture XL)"], [KHOA_2, "Sata 4 (fixture XL)"]] as const) {
      await db.course.upsert({ where: { id }, create: { id, name: ten, slug: id, price: GIA48, totalSessions: 48 }, update: { price: GIA48, totalSessions: 48 } });
    }
  });
  beforeEach(async () => {
    await donDep();
    await datCo(OU1, true);
  });
  afterAll(async () => {
    await donDep();
    await datCo(OU1, null);
    await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA_2] } } });
  });

  // ═══ 1 · GÓI TRỌN ═════════════════════════════════════════════════════════════════════════════════════════════════
  it("[XL-DB-01] GÓI TRỌN vào lớp TỪ ĐẦU (chưa dạy buổi nào): start=1,end=48, không bù, quyền học ACTIVE, ghi danh gắn, sổ tiêu thụ = 0", async () => {
    const c = await dungDayDu("01", { daDay: 0 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q, ...thua] = await quyenCua(c.don);
    expect(thua).toHaveLength(0);
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48, skippedSessions: 0, enrollmentId: c.gd, classId: c.lop, consumedSessions: 0, purchaseSessions: 48 });
    expect(q!.scopeLockedAt?.toISOString()).toBe(NOW.toISOString());
    const xep = (q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop;
    expect(xep).toMatchObject({ baiKeTiepCuaLop: 1, catchupMode: "NONE", requiredCatchupLessons: [], freeMakeupLessons: [], skippedLessons: [] });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: q!.id } }), "xếp lớp KHÔNG tiêu thụ buổi nào").toBe(0);
    expect(await nhuCauBu(c.hv)).toHaveLength(0);
    expect(await choCua(c.don), "đủ điều kiện ⇒ không có dòng chờ").toHaveLength(0);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.gd } })).buoiBatDau, "start=1 ⇒ NULL (đủ khoá)").toBeNull();
  });

  it("[XL-DB-02] GÓI TRỌN, lớp đã dạy 4 bài (≤ trần n=6): CATCH_UP — KHÔNG còn vùng FREE_MAKEUP của gói trọn; cả 4 bài thành nhu cầu bù MIỄN PHÍ (nguon HOC_VUOT), không dòng chờ, không dòng xin duyệt", async () => {
    const c = await dungDayDu("02", { daDay: 4 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48, skippedSessions: 0, freeMakeupSessions: 0 });
    // [21/10/2026, chủ dự án chốt] `lateEntryMaxLessons` (4) KHÔNG còn được đọc cho gói trọn: đã dạy 4 là CATCH_UP như đã dạy 5, 6 — mọi bài đã qua thành nhu cầu bù.
    expect((q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ baiKeTiepCuaLop: 5, catchupMode: "CATCH_UP", freeMakeupLessons: [], requiredCatchupLessons: [1, 2, 3, 4], skippedLessons: [] });
    const nc = await nhuCauBu(c.hv);
    expect(nc.map((n) => n.missedSessionId).sort()).toEqual(r(0, 3).map((i) => `${c.lop}-s${i}`).sort());
    // Bù MIỄN PHÍ: nhãn nguồn HOC_VUOT là thứ làm `laDongMienPhi` đúng (đo qua màn Học bù ở chinh-sach-p5 [P5-DB-40]).
    for (const n of nc) expect(n).toMatchObject({ sourceType: "ORDER_CONVERSION", nguon: "HOC_VUOT", status: "PENDING" });
    expect(await choCua(c.don), "đủ điều kiện ⇒ không dòng CHO_XEP_LOP").toHaveLength(0);
    expect(await choCua(c.don, "CHO_DUYET_HOC_VUOT"), "xếp lớp KHÔNG tạo dòng xin duyệt học vượt").toHaveLength(0);
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: q!.id } }), "xếp lớp KHÔNG tiêu thụ buổi nào").toBe(0);
  });

  it("[XL-DB-03] GÓI TRỌN, lớp đã dạy 5 và 6 bài (≤ trần): CATCH_UP — mọi bài đã qua thành nhu cầu học vượt MIỄN PHÍ (ORDER_CONVERSION, nguon HOC_VUOT, đúng buổi đã dạy của bài đó)", async () => {
    const c5 = await dungDayDu("03a", { daDay: 5 });
    const c6 = await dungDayDu("03b", { daDay: 6 });
    await hichCapQuyenHocChoDon(c5.don, "KE_TOAN_XAC_NHAN", NOW);
    await hichCapQuyenHocChoDon(c6.don, "KE_TOAN_XAC_NHAN", NOW);

    for (const [c, daDay] of [[c5, 5], [c6, 6]] as const) {
      const [q] = await quyenCua(c.don);
      expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48, skippedSessions: 0 });
      expect((q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ catchupMode: "CATCH_UP", requiredCatchupLessons: r(1, daDay) });
      // Học vượt (CATCH_UP) KHÔNG tiêu thụ quyền học: bài học vượt đi qua MakeupNeed miễn phí, KHÔNG qua sổ `StudyEntitlementUsage` — ghi một dòng CATCH_UP ở đây là trừ buổi của gói.
      expect(await db.studyEntitlementUsage.count({ where: { entitlementId: q!.id } }), `D=${daDay}: bài học vượt không được đếm vào sổ tiêu thụ`).toBe(0);
      const nc = await nhuCauBu(c.hv);
      expect(nc).toHaveLength(daDay);
      // Mỗi nhu cầu trỏ ĐÚNG buổi đã dạy mang bài đó (buổi i ⇒ bài i+1), nguồn ORDER_CONVERSION + nhãn HOC_VUOT (miễn phí), chưa bù (PENDING), không điểm danh gốc.
      expect(nc.map((n) => n.missedSessionId).sort()).toEqual(r(0, daDay - 1).map((i) => `${c.lop}-s${i}`).sort());
      for (const n of nc) expect(n).toMatchObject({ sourceType: "ORDER_CONVERSION", nguon: "HOC_VUOT", status: "PENDING", originalAttendanceId: null, studentId: c.hv, classId: c.lop, centerId: CS1 });
    }
  });

  it("[XL-DB-04] GÓI TRỌN, lớp đã dạy 7 và 9 bài (> trần 6): OVER_CAP_SKIPPED — bỏ TẤT CẢ bài đã qua (skippedSessions = D), KHÔNG nhu cầu bù, KHÔNG dòng xin duyệt; vào học từ buổi kế tiếp", async () => {
    const c7 = await dungDayDu("04a", { daDay: 7 });
    const c9 = await dungDayDu("04b", { daDay: 9 });
    await hichCapQuyenHocChoDon(c7.don, "KE_TOAN_XAC_NHAN", NOW);
    await hichCapQuyenHocChoDon(c9.don, "KE_TOAN_XAC_NHAN", NOW);

    // [21/10/2026, chủ dự án chốt] không còn "giữ 6 bài gần nhất": vượt n thì bỏ HẾT, phụ huynh muốn bù thì QLCS tạo case.
    for (const [c, daDay] of [[c7, 7], [c9, 9]] as const) {
      const [q] = await quyenCua(c.don);
      expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48, skippedSessions: daDay, freeMakeupSessions: 0 });
      expect((q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ catchupMode: "OVER_CAP_SKIPPED", skippedLessons: r(1, daDay), requiredCatchupLessons: [], catchupSessions: [] });
      expect(await nhuCauBu(c.hv), `D=${daDay}: vượt trần ⇒ không bù gì`).toHaveLength(0);
      expect(await db.studyEntitlementUsage.count({ where: { entitlementId: q!.id } }), `D=${daDay}: bài bỏ qua KHÔNG vào sổ tiêu thụ`).toBe(0);
      expect(await choCua(c.don, "CHO_DUYET_HOC_VUOT"), `D=${daDay}: xếp lớp KHÔNG tạo dòng xin duyệt`).toHaveLength(0);
      expect(await choCua(c.don), `D=${daDay}: không dòng CHO_XEP_LOP`).toHaveLength(0);
    }
  });

  // ═══ 2 · GÓI KHÔNG TRỌN ══════════════════════════════════════════════════════════════════════════════════════════
  it("[XL-DB-05] GÓI 12 BUỔI, lớp đã dạy 8 bài: bắt đầu ĐÚNG bài kế tiếp (9–20), bỏ qua 8 bài trước, KHÔNG học vượt, skippedSessions=0, buoiBatDau (cache cho đường đọc cũ)=9", async () => {
    const c = await dungDayDu("05", { soBuoi: 12, daDay: 8 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 9, endLessonOrder: 20, skippedSessions: 0, purchaseSessions: 12, enrollmentId: c.gd, classId: c.lop });
    expect(q!.endLessonOrder! - q!.startLessonOrder! + 1, "INV: end − start + 1 = purchaseSessions").toBe(12);
    expect((q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ catchupMode: "NONE", lessonsBeforeStart: r(1, 8), requiredCatchupLessons: [], skippedLessons: [] });
    expect(await nhuCauBu(c.hv), "gói không trọn không sinh học vượt").toHaveLength(0);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.gd } })).buoiBatDau).toBe(9);
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: q!.id } })).toBe(0);
  });

  it("[XL-DB-37] SALE CHỌN BUỔI BẮT ĐẦU [28/10/2026]: ghi danh PENDING mang buoiBatDau = 13, gói 24 buổi, lớp đã dạy 20 bài ⇒ start = 13 (KHÔNG phải bài kế tiếp 21), end = 36, KHÔNG tự sinh nhu cầu bù / bỏ qua, ghi danh được kích hoạt; ĐỐI CHỨNG: không ai chọn (NULL) ⇒ bài kế tiếp 21–44; chọn nhưng ghi danh không còn PENDING ⇒ bỏ qua giá trị đó", async () => {
    const c = await dungDayDu("37", { soBuoi: 24, daDay: 20 });
    await db.enrollment.update({ where: { id: c.gd }, data: { status: "PENDING", buoiBatDau: 13 } });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 13, endLessonOrder: 36, skippedSessions: 0, freeMakeupSessions: 0, purchaseSessions: 24, enrollmentId: c.gd });
    expect(q!.endLessonOrder! - q!.startLessonOrder! + 1, "INV: end − start + 1 = purchaseSessions").toBe(24);
    expect((q!.configSnapshot as { xepLop: Record<string, unknown> }).xepLop).toMatchObject({ catchupMode: "NONE", lessonsBeforeStart: r(1, 12), requiredCatchupLessons: [], skippedLessons: [] });
    expect(await nhuCauBu(c.hv), "bài 13..20 đi theo YÊU CẦU học vượt bù của màn Chuyển đổi, không tự sinh ở quyền học").toHaveLength(0);
    const gd = await db.enrollment.findUniqueOrThrow({ where: { id: c.gd } });
    expect(gd.buoiBatDau).toBe(13);
    expect(gd.status).not.toBe("PENDING");

    // Đối chứng 1: PENDING nhưng KHÔNG ai chọn (NULL — đường convertLeadV2 / bulk) ⇒ luật cũ, bài kế tiếp của lớp.
    const k = await dungDayDu("37b", { soBuoi: 24, daDay: 20 });
    await db.enrollment.update({ where: { id: k.gd }, data: { status: "PENDING", buoiBatDau: null } });
    await hichCapQuyenHocChoDon(k.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(k.don))[0]).toMatchObject({ status: "ACTIVE", startLessonOrder: 21, endLessonOrder: 44 });

    // Đối chứng 2: buoiBatDau có nhưng ghi danh KHÔNG còn PENDING (ghi danh cũ, `buoiBatDau` là cache của đường khác) ⇒ không tin.
    const m = await dungDayDu("37c", { soBuoi: 24, daDay: 20 });
    await db.enrollment.update({ where: { id: m.gd }, data: { status: "STUDYING", buoiBatDau: 13 } });
    await hichCapQuyenHocChoDon(m.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(m.don))[0]).toMatchObject({ status: "ACTIVE", startLessonOrder: 21, endLessonOrder: 44 });
  });

  it("[XL-DB-38] BUỔI BẮT ĐẦU SALE CHỌN ĐẨY PHẠM VI VƯỢT GIÁO TRÌNH (24 buổi, S = 30 ⇒ 30–53) ⇒ KHÔNG xếp thật: quyền học GIỮ AWAITING_PLACEMENT + dòng chờ CHO_XEP_LOP, không ném", async () => {
    const c = await dungDayDu("38", { soBuoi: 24, daDay: 2 });
    await db.enrollment.update({ where: { id: c.gd }, data: { status: "PENDING", buoiBatDau: 30 } });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "AWAITING_PLACEMENT", enrollmentId: null });
    expect(await db.studyEntitlementXuLy.count({ where: { orderItemId: c.item, loai: "CHO_XEP_LOP", trangThai: "OPEN" } })).toBe(1);
  });

  it("[XL-DB-39] ĐƠN HỌC BỔNG 100% [28/10/2026]: KHÔNG có Payment nào mà vẫn cấp quyền học + chốt phạm vi theo buổi Sale chọn; cron đối soát KHÔNG đánh dấu chiều ngược; ĐỐI CHỨNG: đơn KHÔNG học bổng, không tiền ⇒ không cấp", async () => {
    const c = await dungDayDu("39", { soBuoi: 24, daDay: 20, chuaDuTien: true });
    await db.enrollment.update({ where: { id: c.gd }, data: { status: "PENDING", buoiBatDau: 13 } });
    await hichCapQuyenHocChoDon(c.don, "CHUYEN_DOI", NOW);
    expect(await quyenCua(c.don), "đối chứng: chưa học bổng + chưa tiền ⇒ không quyền học").toHaveLength(0);

    await db.order.update({ where: { id: c.don }, data: { hocBong100: true, hocBongAt: NOW, hocBongLyDo: "Học bổng fixture XL-DB-39" } });
    await hichCapQuyenHocChoDon(c.don, "CHUYEN_DOI", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 13, endLessonOrder: 36, enrollmentId: c.gd });
    expect(await db.payment.count({ where: { orderId: c.don } }), "KHÔNG tạo Payment giả").toBe(0);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.gd } })).status).not.toBe("PENDING");

    // Chiều ngược: cron đối soát chạy lại ⇒ không coi là "tiền không còn đủ".
    await xetCapQuyenHocChoDon(c.don, "DOI_SOAT_DEM", new Date(NOW.getTime() + 3 * 3600_000), "CHI_GHI_NHAN");
    expect(await db.studyEntitlementXuLy.count({ where: { orderId: c.don, loai: { in: ["CAN_THU_HOI", "TREO_DUYET_TAY"] }, trangThai: "OPEN" } })).toBe(0);
    expect((await quyenCua(c.don))[0]!.status).toBe("ACTIVE");
  });

  it("[XL-DB-40] ADMIN ĐỔI BUỔI BẮT ĐẦU của dòng phạm vi mua KHÔNG trọn [28/10/2026]: quyền học + ghi danh đổi CÙNG lúc (13–36 → 5–28); quyền đã tiêu thụ buổi ⇒ TỪ CHỐI, không đổi gì; mua TRỌN ⇒ từ chối", async () => {
    const c = await dungDayDu("40", { soBuoi: 24, daDay: 2 });
    await db.enrollment.update({ where: { id: c.gd }, data: { status: "PENDING", buoiBatDau: 13 } });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(c.don))[0]).toMatchObject({ status: "ACTIVE", startLessonOrder: 13, endLessonOrder: 36 });

    const nguoi = { id: null, name: "Admin fixture XL-DB-40" };
    // Đã tiêu thụ buổi ⇒ từ chối, mọi thứ nguyên.
    await db.studyEntitlement.updateMany({ where: { orderId: c.don }, data: { consumedSessions: 1 } });
    expect(await doiBuoiBatDauCuaDon({ orderId: c.don, enrollmentId: c.gd, buoiBatDauMoi: 5, lyDo: "Phụ huynh xin dời buổi bắt đầu" }, nguoi, NOW)).toMatchObject({ ok: false });
    expect((await quyenCua(c.don))[0]).toMatchObject({ startLessonOrder: 13, endLessonOrder: 36 });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.gd } })).buoiBatDau).toBe(13);
    await db.studyEntitlement.updateMany({ where: { orderId: c.don }, data: { consumedSessions: 0 } });

    // Chưa tiêu thụ ⇒ đổi cả hai. Buổi 26 ⇒ 26–49 vượt giáo trình ⇒ từ chối.
    expect(await doiBuoiBatDauCuaDon({ orderId: c.don, enrollmentId: c.gd, buoiBatDauMoi: 26, lyDo: "Thử vượt giáo trình" }, nguoi, NOW)).toMatchObject({ ok: false });
    expect(await doiBuoiBatDauCuaDon({ orderId: c.don, enrollmentId: c.gd, buoiBatDauMoi: 5, lyDo: "Phụ huynh xin dời buổi bắt đầu" }, nguoi, NOW)).toMatchObject({ ok: true, buoiBatDau: 5 });
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ startLessonOrder: 5, endLessonOrder: 28, purchaseSessions: 24 });
    expect(q!.endLessonOrder! - q!.startLessonOrder! + 1, "INV: end − start + 1 = purchaseSessions").toBe(24);
    expect((q!.configSnapshot as { xepLop: { lessonsBeforeStart: number[] } }).xepLop.lessonsBeforeStart).toEqual(r(1, 4));
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.gd } })).buoiBatDau).toBe(5);

    // Dòng phạm vi mua TRỌN 48 ⇒ không đổi được.
    const tron = await dungDayDu("40t", { soBuoi: 48, daDay: 0 });
    await hichCapQuyenHocChoDon(tron.don, "KE_TOAN_XAC_NHAN", NOW);
    expect(await doiBuoiBatDauCuaDon({ orderId: tron.don, enrollmentId: tron.gd, buoiBatDauMoi: 2, lyDo: "Thử đổi gói trọn" }, nguoi, NOW)).toMatchObject({ ok: false });
  });

  it("[XL-DB-41] TRẦN THEO KHOÁ [28/10/2026]: gói TRỌN, lớp đã dạy 5 bài — mức cơ sở 6 ⇒ CATCH_UP (5 nhu cầu bù miễn phí); khoá đặt trần 3 ⇒ OVER_CAP_SKIPPED (bỏ 5 bài, không bù); khoá đặt trần 8 ⇒ lại CATCH_UP", async () => {
    try {
      const a = await dungDayDu("41a", { daDay: 5 });
      await hichCapQuyenHocChoDon(a.don, "KE_TOAN_XAC_NHAN", NOW);
      expect((await quyenCua(a.don))[0]).toMatchObject({ status: "ACTIVE", skippedSessions: 0 });
      expect(await nhuCauBu(a.hv)).toHaveLength(5);

      await db.course.update({ where: { id: KHOA }, data: { catchUpMaxSessions: 3 } });
      const b = await dungDayDu("41b", { daDay: 5 });
      await hichCapQuyenHocChoDon(b.don, "KE_TOAN_XAC_NHAN", NOW);
      expect((await quyenCua(b.don))[0]).toMatchObject({ status: "ACTIVE", skippedSessions: 5 });
      expect(await nhuCauBu(b.hv)).toHaveLength(0);

      await db.course.update({ where: { id: KHOA }, data: { catchUpMaxSessions: 8 } });
      const c = await dungDayDu("41c", { daDay: 7 }); // 7 > mức cơ sở 6 nhưng ≤ mức khoá 8
      await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
      expect((await quyenCua(c.don))[0]).toMatchObject({ status: "ACTIVE", skippedSessions: 0 });
      expect(await nhuCauBu(c.hv)).toHaveLength(7);
    } finally {
      await db.course.update({ where: { id: KHOA }, data: { catchUpMaxSessions: null } });
    }
  });

  it("[XL-DB-06] GÓI 24 BUỔI vào lớp từ đầu: 1–24; lớp đã dạy 30 ⇒ 31–54 VƯỢT giáo trình ⇒ KHÔNG xếp thật, quyền học GIỮ AWAITING_PLACEMENT, có dòng chờ CHO_XEP_LOP nói rõ", async () => {
    const dau = await dungDayDu("06a", { soBuoi: 24, daDay: 0 });
    await hichCapQuyenHocChoDon(dau.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(dau.don))[0]).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 24 });

    const vuot = await dungDayDu("06b", { soBuoi: 24, daDay: 30, conLai: 10 });
    await hichCapQuyenHocChoDon(vuot.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(vuot.don);
    expect(q).toMatchObject({ status: "AWAITING_PLACEMENT", startLessonOrder: null, endLessonOrder: null, enrollmentId: null, classId: null });
    const [cho, ...thua] = await choCua(vuot.don);
    expect(thua).toHaveLength(0);
    expect(cho).toMatchObject({ loai: "CHO_XEP_LOP", trangThai: "OPEN", orderItemId: vuot.item, entitlementId: q!.id, studentId: vuot.hv });
    expect(cho!.lyDo).toMatch(/vượt giáo trình/);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: vuot.gd } })).buoiBatDau, "không xếp thật ⇒ không đụng ghi danh").toBeNull();
  });

  it("[XL-DB-07] LỚP KHÔNG SUY ĐƯỢC BÀI KẾ TIẾP (hết buổi / buổi sớm nhất chưa ghim giáo trình) ⇒ KHÔNG ĐOÁN: giữ AWAITING_PLACEMENT + dòng chờ; sửa lớp rồi hích lại ⇒ tự xếp và ĐÓNG dòng chờ", async () => {
    const c = await dungDayDu("07", { soBuoi: 12, daDay: 6, conLai: 0 }); //  hết buổi sắp tới
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(c.don))[0]).toMatchObject({ status: "AWAITING_PLACEMENT" });
    expect((await choCua(c.don))[0]).toMatchObject({ trangThai: "OPEN" });
    expect((await choCua(c.don))[0]!.lyDo).toMatch(/Không suy được bài kế tiếp/);

    // Lớp có thêm buổi sắp tới ⇒ bài kế tiếp = 7 ⇒ gói 12 buổi bắt đầu ở 7.
    const plan = await db.classSessionPlan.create({ data: { id: `${c.lop}-pn`, classId: c.lop, seq: 7, order: 6 } });
    await db.classSession.create({ data: { id: `${c.lop}-sn`, classId: c.lop, centerId: CS1, planId: plan.id, date: ngaySapToi(0), status: "SCHEDULED" } });
    await hichCapQuyenHocChoDon(c.don, "CHUYEN_DOI", NOW);
    expect((await quyenCua(c.don))[0]).toMatchObject({ status: "ACTIVE", startLessonOrder: 7, endLessonOrder: 18 });
    expect((await choCua(c.don))[0]).toMatchObject({ trangThai: "DA_XU_LY", entitlementId: (await quyenCua(c.don))[0]!.id });
  });

  // ═══ 3 · ĐIỀU KIỆN ═══════════════════════════════════════════════════════════════════════════════════════════════
  it("[XL-DB-08] KHÁCH MỚI CHƯA CÓ STUDENT (CHO_CHUYEN_DOI): KHÔNG xếp lớp thật, KHÔNG quyền học active, KHÔNG dòng CHO_XEP_LOP — chỉ dòng chờ chuyển đổi của #655", async () => {
    const lop = `${T}lop-08`;
    await dungLop({ id: lop, daDay: 0 });
    const lead = await db.lead.create({ data: { parentName: `${T}khach-08`, phone: SDT, centerId: CS1 }, select: { id: true } });
    const con = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-08` }, select: { id: true } });
    const don = `${T}don-08`;
    const item = `${T}item-08`;
    const [tien] = await dungDon(don, [{ id: item, studentId: null, leadChildId: con.id }], { leadId: lead.id });
    await thu(don, item, tien!);
    const truoc = await demHang();
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);
    expect(await quyenCua(don)).toHaveLength(0);
    expect((await choCua(don, "CHO_CHUYEN_DOI"))[0]).toMatchObject({ trangThai: "OPEN" });
    expect(await choCua(don)).toHaveLength(0);
    const sau = await demHang();
    expect({ ...sau, cho: sau.cho - 1 }, "ngoài đúng MỘT dòng chờ chuyển đổi, không ghi gì").toEqual(truoc);
  });

  it("[XL-DB-09] CÓ STUDENT + GHI DANH nhưng CHƯA CÓ QUYỀN HỢP LỆ (tiền chưa đủ): KHÔNG active, có dòng CHO_XEP_LOP; tiền đủ ⇒ hích tự cấp + chốt phạm vi + ĐÓNG dòng chờ", async () => {
    const c = await dungDayDu("09", { soBuoi: 12, daDay: 3, chuaDuTien: true });
    await hichCapQuyenHocChoDon(c.don, "CHUYEN_DOI", NOW);
    expect(await quyenCua(c.don)).toHaveLength(0);
    const [cho] = await choCua(c.don);
    expect(cho).toMatchObject({ trangThai: "OPEN", orderItemId: c.item, studentId: null });
    expect(cho!.lyDo).toMatch(/chưa có quyền học hợp lệ/);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.gd } })).buoiBatDau).toBeNull();

    await thu(c.don, c.item, c.tien);
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(c.don))[0]).toMatchObject({ status: "ACTIVE", startLessonOrder: 4, endLessonOrder: 15 });
    expect((await choCua(c.don))[0]).toMatchObject({ trangThai: "DA_XU_LY" });
  });

  it("[XL-DB-10] GHI DANH MƠ HỒ (con lead khớp HAI ghi danh còn sống cùng khoá) ⇒ KHÔNG đoán: không xếp, dòng CHO_XEP_LOP nêu số ghi danh; ghi danh thừa rút đi ⇒ tự xếp", async () => {
    const lop = `${T}lop-10`;
    await dungLop({ id: lop, daDay: 2 });
    const lead = await db.lead.create({ data: { parentName: `${T}khach-10`, phone: SDT, centerId: CS1 }, select: { id: true } });
    const con = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-10` }, select: { id: true } });
    const hv = await dungHocVien(`${T}hv-10`, "10");
    const lop2 = `${T}lop-10b`;
    await dungLop({ id: lop2, daDay: 2 });
    await ghiDanh(`${T}gd-10a`, hv, lop, { leadChildId: con.id });
    await ghiDanh(`${T}gd-10b`, hv, lop2, { leadChildId: con.id });
    const don = `${T}don-10`;
    const item = `${T}item-10`;
    const [tien] = await dungDon(don, [{ id: item, studentId: hv, leadChildId: con.id }], { leadId: lead.id });
    await thu(don, item, tien!);
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(don))[0]).toMatchObject({ status: "AWAITING_PLACEMENT" });
    expect((await choCua(don))[0]!.lyDo).toMatch(/khớp 2 ghi danh/);

    await db.enrollment.update({ where: { id: `${T}gd-10b` }, data: { status: "WITHDREW" } });
    await hichCapQuyenHocChoDon(don, "CHUYEN_DOI", NOW);
    expect((await quyenCua(don))[0]).toMatchObject({ status: "ACTIVE", enrollmentId: `${T}gd-10a`, startLessonOrder: 1, endLessonOrder: 48 });
    expect((await choCua(don))[0]).toMatchObject({ trangThai: "DA_XU_LY" });
  });

  it("[XL-DB-11] ĐA CON / ĐA KHOÁ ghép theo leadChildId, KHÔNG theo tên hay thứ tự: bé A (lớp X, 12 buổi, đã dạy 5) và bé B (khoá khác, lớp Y, 48 buổi, đã dạy 6) mỗi bé một phạm vi riêng", async () => {
    const lopX = `${T}lop-11x`;
    const lopY = `${T}lop-11y`;
    await dungLop({ id: lopX, daDay: 5 });
    await dungLop({ id: lopY, daDay: 6, courseId: KHOA_2 });
    const lead = await db.lead.create({ data: { parentName: `${T}khach-11`, phone: SDT, centerId: CS1 }, select: { id: true } });
    const conA = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-11a` }, select: { id: true } });
    const conB = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-11b` }, select: { id: true } });
    const hvA = await dungHocVien(`${T}hv-11a`, "11a");
    const hvB = await dungHocVien(`${T}hv-11b`, "11b");
    // Ghi danh tạo theo thứ tự NGƯỢC với thứ tự dòng đơn: ghép phải theo cầu nối con, không theo thứ tự.
    await ghiDanh(`${T}gd-11b`, hvB, lopY, { courseId: KHOA_2, leadChildId: conB.id });
    await ghiDanh(`${T}gd-11a`, hvA, lopX, { courseId: KHOA, leadChildId: conA.id });
    const don = `${T}don-11`;
    const [tienA, tienB] = await dungDon(
      don,
      [
        { id: `${T}item-11a`, soBuoi: 12, courseId: KHOA, studentId: hvA, leadChildId: conA.id },
        { id: `${T}item-11b`, soBuoi: 48, courseId: KHOA_2, studentId: hvB, leadChildId: conB.id },
      ],
      { leadId: lead.id },
    );
    await thu(don, `${T}item-11a`, tienA!);
    await thu(don, `${T}item-11b`, tienB!);
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);

    const quyen = await quyenCua(don);
    expect(quyen).toHaveLength(2);
    const a = quyen.find((q) => q.studentId === hvA)!;
    const b = quyen.find((q) => q.studentId === hvB)!;
    expect(a).toMatchObject({ courseId: KHOA, classId: lopX, enrollmentId: `${T}gd-11a`, startLessonOrder: 6, endLessonOrder: 17, status: "ACTIVE" });
    expect(b).toMatchObject({ courseId: KHOA_2, classId: lopY, enrollmentId: `${T}gd-11b`, startLessonOrder: 1, endLessonOrder: 48, status: "ACTIVE" });
    expect(await nhuCauBu(hvA), "bé A gói không trọn ⇒ không học vượt").toHaveLength(0);
    expect(await nhuCauBu(hvB), "bé B gói trọn, đã dạy 6 ⇒ học vượt 6 bài").toHaveLength(6);
    expect((await nhuCauBu(hvB)).every((n) => n.classId === lopY && n.courseId === KHOA_2)).toBe(true);
  });

  it("[XL-DB-36] HAI BÉ CÙNG KHOÁ, HAI LỚP KHÁC NHAU, tiền CHƯA đủ: mỗi dòng chỉ thấy ghi danh của CHÍNH con mình ⇒ CẢ HAI đều có dòng CHO_XEP_LOP 'chưa có quyền học hợp lệ' (không bé nào bị MƠ HỒ vì ghi danh của bé kia)", async () => {
    // Ghi danh của cả lead được đọc MỘT lượt cho mọi dòng; phải lọc lại theo `leadChildId` của TỪNG dòng trước khi chọn. Không lọc thì dòng của bé A thấy cả ghi danh của bé B
    // (cùng khoá) ⇒ MO_HO ⇒ không còn là "ghi danh rõ ràng chưa có quyền" ⇒ KHÔNG dòng chờ nào được mở, và ca đa con cùng khoá im lặng rơi khỏi hàng đợi của người vận hành.
    // [XL-DB-11] không canh được: nó KHÁC khoá (bộ lọc theo khoá che mất lỗi) và đã trả đủ tiền (có quyền học thì lọc theo học viên cũng che).
    const lopA = `${T}lop-36a`;
    const lopB = `${T}lop-36b`;
    await dungLop({ id: lopA, daDay: 2 });
    await dungLop({ id: lopB, daDay: 4 });
    const lead = await db.lead.create({ data: { parentName: `${T}khach-36`, phone: SDT, centerId: CS1 }, select: { id: true } });
    const conA = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-36a` }, select: { id: true } });
    const conB = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-36b` }, select: { id: true } });
    const hvA = await dungHocVien(`${T}hv-36a`, "36a");
    const hvB = await dungHocVien(`${T}hv-36b`, "36b");
    await ghiDanh(`${T}gd-36a`, hvA, lopA, { leadChildId: conA.id });
    await ghiDanh(`${T}gd-36b`, hvB, lopB, { leadChildId: conB.id });
    const don = `${T}don-36`;
    const itemA = `${T}item-36a`;
    const itemB = `${T}item-36b`;
    // Dòng KHÔNG gắn `enrollmentId` (đi đường cầu nối con lead) và KHÔNG ghi tiền ⇒ chưa có quyền học nào.
    await dungDon(
      don,
      [
        { id: itemA, soBuoi: 48, studentId: hvA, leadChildId: conA.id },
        { id: itemB, soBuoi: 48, studentId: hvB, leadChildId: conB.id },
      ],
      { leadId: lead.id },
    );
    await hichCapQuyenHocChoDon(don, "CHUYEN_DOI", NOW);

    expect(await quyenCua(don), "tiền chưa đủ ⇒ chưa quyền học nào").toHaveLength(0);
    const cho = await choCua(don);
    expect(cho.map((c) => c.orderItemId).sort(), "mỗi dòng đơn đúng MỘT dòng chờ").toEqual([itemA, itemB].sort());
    for (const c of cho) {
      expect(c, c.orderItemId).toMatchObject({ trangThai: "OPEN", studentId: null });
      expect(c.lyDo, c.orderItemId).toMatch(/chưa có quyền học hợp lệ/);
      expect(c.lyDo, "không bé nào bị coi là mơ hồ").not.toMatch(/khớp \d+ ghi danh/);
    }
    for (const id of [`${T}gd-36a`, `${T}gd-36b`]) {
      expect((await db.enrollment.findUniqueOrThrow({ where: { id } })).buoiBatDau, `${id}: chưa xếp thật`).toBeNull();
    }
  });

  it("[XL-DB-12] CHIỀU NGƯỢC: quyền học đang bị đánh dấu CAN_THU_HOI ⇒ KHÔNG chốt phạm vi, mở dòng CHO_XEP_LOP nói rõ", async () => {
    const c = await dungDayDu("12", { soBuoi: 12, daDay: 2 });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW); //  đã xếp
    // Đưa quyền học về chưa xếp + đánh dấu thu hồi (tiền bị đảo trước khi xếp) — dựng đúng hình dạng cap-tu-don để lại.
    const [q] = await quyenCua(c.don);
    await db.studyEntitlement.update({ where: { id: q!.id }, data: { status: "AWAITING_PLACEMENT", enrollmentId: null, classId: null, startLessonOrder: null, endLessonOrder: null, scopeLockedAt: null, effectiveFrom: null } });
    await db.studyEntitlementXuLy.create({ data: { loai: "CAN_THU_HOI", trangThai: "OPEN", orderId: c.don, orderItemId: c.item, centerId: CS1, studentId: c.hv, entitlementId: q!.id, lyDo: "Tiền bị đảo." } });
    await xetXepLopChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(c.don))[0]).toMatchObject({ status: "AWAITING_PLACEMENT", startLessonOrder: null });
    expect((await choCua(c.don))[0]!.lyDo).toMatch(/đánh dấu thu hồi/);
  });

  it("[XL-DB-13] bài học vượt KHÔNG gắn được buổi đã dạy (buổi duy nhất của bài đó bị huỷ) ⇒ vẫn chốt phạm vi, các bài còn lại có nhu cầu, bài thiếu nằm trong dòng CHO_XEP_LOP; hích lại KHÔNG đóng dòng ấy", async () => {
    const c = await dungDayDu("13", { daDay: 6, huyDaDay: [2] }); //  bài 3 chỉ có một buổi và buổi ấy CANCELLED
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48 });
    const nc = await nhuCauBu(c.hv);
    expect(nc.map((n) => n.missedSessionId).sort()).toEqual([0, 1, 3, 4, 5].map((i) => `${c.lop}-s${i}`).sort());
    const [cho] = await choCua(c.don);
    expect(cho).toMatchObject({ trangThai: "OPEN" });
    expect(cho!.lyDo).toMatch(/không gắn được vào buổi đã dạy[\s\S]*\b3\b|\(3\)/);
    await hichCapQuyenHocChoDon(c.don, "CHUYEN_DOI", NOW);
    expect((await choCua(c.don))[0]).toMatchObject({ trangThai: "OPEN" });
    expect(await nhuCauBu(c.hv)).toHaveLength(5);
  });

  it("[XL-DB-18] NGUỒN CHIỀU NGƯỢC (DUNG_HOC / TIEN_BI_HOAN / TIEN_BI_TU_CHOI / DON_BI_LOAI) KHÔNG BAO GIỜ chốt phạm vi; cùng đơn, nguồn thường thì chốt (đối chứng dương)", async () => {
    const c = await dungDayDu("18", { soBuoi: 12, daDay: 2 });
    // Cấp quyền trước (cờ BẬT, lớp tạm hết buổi sắp tới ⇒ chưa xếp được), rồi đưa buổi sắp tới trở lại.
    await db.classSession.updateMany({ where: { classId: c.lop, date: { gt: NOW } }, data: { status: "CANCELLED" } });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(c.don))[0]).toMatchObject({ status: "AWAITING_PLACEMENT" });
    await db.classSession.updateMany({ where: { classId: c.lop, date: { gt: NOW } }, data: { status: "SCHEDULED" } });
    for (const nguon of ["DUNG_HOC", "TIEN_BI_HOAN", "TIEN_BI_TU_CHOI", "DON_BI_LOAI"] as const) {
      await hichCapQuyenHocChoDon(c.don, nguon, NOW);
      expect((await quyenCua(c.don))[0], nguon).toMatchObject({ status: "AWAITING_PLACEMENT", enrollmentId: null });
    }
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(c.don))[0]).toMatchObject({ status: "ACTIVE", startLessonOrder: 3, endLessonOrder: 14 });
  });

  it("[XL-DB-19] QUYỀN HỌC ĐÃ CẤP NHƯNG DÒNG CHƯA GẮN GHI DANH (học viên cũ, đơn tạo tay): chờ BÌNH THƯỜNG — quyền học giữ AWAITING_PLACEMENT, KHÔNG mở dòng hàng đợi, KHÔNG đoán ghi danh theo (học viên, khoá)", async () => {
    const lop = `${T}lop-19`;
    await dungLop({ id: lop, daDay: 2 });
    const hv = await dungHocVien(`${T}hv-19`, "19");
    await ghiDanh(`${T}gd-19`, hv, lop); //  CÙNG học viên + CÙNG khoá, nhưng dòng đơn KHÔNG trỏ tới nó
    const don = `${T}don-19`;
    const item = `${T}item-19`;
    const [tien] = await dungDon(don, [{ id: item, soBuoi: 12, studentId: hv }]);
    await thu(don, item, tien!);
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(don))[0]).toMatchObject({ status: "AWAITING_PLACEMENT", enrollmentId: null, studentId: hv });
    expect(await choCua(don)).toHaveLength(0);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: `${T}gd-19` } })).buoiBatDau).toBeNull();
  });

  it("[XL-DB-34] MÀN CHUYỂN ĐỔI (`docDuLieuChuyenDoi`): dòng SCOPE + cờ BẬT ⇒ KHÔNG hỏi buổi bắt đầu (quyền học quyết); cờ TẮT ⇒ khoảng buổi bắt đầu cho Sale nhập + phán quyết theo `xetTheoBuoiBatDau` [27/10/2026]", async () => {
    const lop = `${T}lop-34`;
    await dungLop({ id: lop, daDay: 9 }); //  lớp đã dạy 9 buổi ⇒ bài kế tiếp 10 ≤ 37 ⇒ luật CŨ cho gói 12 buổi ra 'cho_toi_luot' (bé chờ tới bài 37)
    const don = `${T}don-34`;
    await dungDon(don, [{ id: `${T}item-34`, soBuoi: 12, studentId: null }]);

    const bat = await docDuLieuChuyenDoi(don, NOW, { vai: "ADMIN", tran: 6, xemPiiLead: true });
    const dongBat = bat!.dong[0]!;
    const lopBat = dongBat.lop.find((l) => l.id === lop)!;
    // [28/10/2026] dòng SCOPE mua KHÔNG trọn (12/48) ⇒ CÓ ô buổi bắt đầu; mua trọn ⇒ KHÔNG ô (kiểm ở dưới).
    expect({ phamVi: dongBat.phamVi, khoangBuoi: dongBat.khoangBuoi }).toEqual({ phamVi: true, khoangBuoi: { min: 1, max: 37, macDinh: 37, muaDuKhoa: false } });
    const donTron = `${T}don-34t`;
    await dungDon(donTron, [{ id: `${T}item-34t`, soBuoi: 48, studentId: null }]);
    const tron = await docDuLieuChuyenDoi(donTron, NOW, { vai: "ADMIN", tran: 6, xemPiiLead: true });
    expect({ phamVi: tron!.dong[0]!.phamVi, khoangBuoi: tron!.dong[0]!.khoangBuoi }).toEqual({ phamVi: true, khoangBuoi: null });
    expect(lopBat.soBuoiDaQua).toBe(9);

    await datCo(OU1, false);
    const tat = await docDuLieuChuyenDoi(don, NOW, { vai: "ADMIN", tran: 6, xemPiiLead: true });
    const dongTat = tat!.dong[0]!;
    expect({ phamVi: dongTat.phamVi, khoangBuoi: dongTat.khoangBuoi }).toEqual({ phamVi: false, khoangBuoi: { min: 1, max: 37, macDinh: 37, muaDuKhoa: false } });
    const lopTat = dongTat.lop.find((l) => l.id === lop)!;
    expect(xetTheoBuoiBatDau({ tongSoBuoiKhoa: dongTat.tongSoBuoiKhoa, soBuoiMua: dongTat.soBuoiMua, buoiBatDau: 37, soBuoiDaQua: lopTat.soBuoiDaQua, tran: 6 })).toMatchObject({ loai: "cho_toi_luot", buoiBatDau: 37, soBuoiCanBu: 0 });
  });

  it("[XL-DB-35] BÀI CÓ HAI BUỔI ĐÃ DẠY (dạy lại / dời lịch): nhu cầu học vượt gắn vào buổi SỚM NHẤT của bài đó — kết quả không phụ thuộc thứ tự đọc", async () => {
    const lop = `${T}lop-35`;
    await dungLop({ id: lop, daDay: 6 });
    //  buổi DẠY LẠI bài 3 (plan order 2) vào một ngày ĐÃ QUA nhưng MUỘN hơn buổi gốc
    await db.classSession.create({ data: { id: `${lop}-lai`, classId: lop, centerId: CS1, planId: `${lop}-p2`, date: new Date(NOW.getTime() - 1.5 * NGAY), status: "COMPLETED" } });
    const hv = await dungHocVien(`${T}hv-35`, "35");
    const gd = await ghiDanh(`${T}gd-35`, hv, lop);
    const don = `${T}don-35`;
    const item = `${T}item-35`;
    const [tien] = await dungDon(don, [{ id: item, soBuoi: 48, studentId: hv, enrollmentId: gd }]);
    await thu(don, item, tien!);
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);
    const nc = await nhuCauBu(hv);
    expect(nc).toHaveLength(6);
    expect(nc.map((n) => n.missedSessionId)).not.toContain(`${lop}-lai`);
    expect(nc.map((n) => n.missedSessionId).sort()).toEqual(r6(lop));
  });

  // ═══ 4 · IDEMPOTENT / ĐỒNG THỜI / CỜ ═════════════════════════════════════════════════════════════════════════════
  it("[XL-DB-14] IDEMPOTENT: hích lại 3 lần ⇒ không đổi gì (đếm hàng + audit + updatedAt); 5 lượt ĐỒNG THỜI ⇒ đúng MỘT lần xếp, không nhu cầu trùng, không treo bể kết nối", async () => {
    const c = await dungDayDu("14", { daDay: 6 });
    await Promise.all([1, 2, 3, 4, 5].map(() => hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW)));
    const [q] = await quyenCua(c.don);
    expect(q).toMatchObject({ status: "ACTIVE", startLessonOrder: 1, endLessonOrder: 48 });
    expect(await db.auditLog.count({ where: { entityType: "StudyEntitlement", entityId: q!.id, action: "PLACE" } }), "đúng MỘT lần xếp lớp").toBe(1);
    expect(await nhuCauBu(c.hv)).toHaveLength(6);
    const truoc = await demHang();
    // Gọi THẲNG hàm xét (không qua vỏ nuốt lỗi): lượt sau thấy quyền học đã chốt ⇒ báo "đã xếp từ trước", KHÔNG ném, KHÔNG xếp lại.
    const lai = await xetXepLopChoDon(c.don, "CHUYEN_DOI", NOW);
    expect({ daXep: lai.daXep, daXepTruoc: lai.daXepTruoc, cho: lai.cho }).toEqual({ daXep: [], daXepTruoc: [c.item], cho: [] });
    for (let i = 0; i < 3; i++) await hichCapQuyenHocChoDon(c.don, "CHUYEN_DOI", new Date(NOW.getTime() + (i + 1) * 3_600_000));
    expect(await demHang()).toEqual(truoc);
    const sau = (await quyenCua(c.don))[0]!;
    expect(sau.updatedAt.toISOString()).toBe(q!.updatedAt.toISOString());
    expect(sau.scopeLockedAt?.toISOString(), "phạm vi đã chốt KHÔNG bị chốt lại ở lượt sau").toBe(NOW.toISOString());
  });

  it("[XL-DB-15] 5 lượt ĐỒNG THỜI trên 5 đơn khác nhau (mỗi đơn một lớp): mỗi quyền học xếp đúng, không treo bể kết nối", async () => {
    const cs = await Promise.all([0, 1, 2, 3, 4].map((i) => dungDayDu(`15${i}`, { soBuoi: 12, daDay: i + 1 })));
    await Promise.all(cs.map((c) => hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW)));
    for (const [i, c] of cs.entries()) {
      expect((await quyenCua(c.don))[0], c.don).toMatchObject({ status: "ACTIVE", startLessonOrder: i + 2, endLessonOrder: i + 13 });
    }
  });

  it("[XL-DB-16] CỜ TẮT ⇒ KHÔNG GHI GÌ: đếm hàng trước/sau mọi bảng liên quan, quyền học đang AWAITING giữ nguyên, ghi danh.buoiBatDau nguyên", async () => {
    const c = await dungDayDu("16", { soBuoi: 12, daDay: 8 });
    // Dựng quyền học AWAITING khi cờ BẬT (cấp quyền nhưng chưa xếp: lớp tạm hết buổi), rồi TẮT cờ và cho lớp có buổi ⇒ nếu cờ không gác thì sẽ xếp.
    await datCo(OU1, true);
    await db.classSession.updateMany({ where: { classId: c.lop, date: { gt: NOW } }, data: { status: "CANCELLED" } });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect((await quyenCua(c.don))[0]).toMatchObject({ status: "AWAITING_PLACEMENT" });
    await db.classSession.updateMany({ where: { classId: c.lop, date: { gt: NOW } }, data: { status: "SCHEDULED" } });
    await db.studyEntitlementXuLy.deleteMany({ where: { orderId: c.don } });

    await datCo(OU1, false);
    const truoc = await demHang();
    const gdTruoc = await db.enrollment.findUniqueOrThrow({ where: { id: c.gd } });
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    await xetXepLopChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    expect(await demHang()).toEqual(truoc);
    expect((await quyenCua(c.don))[0]).toMatchObject({ status: "AWAITING_PLACEMENT", enrollmentId: null });
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: c.gd } })).toEqual(gdTruoc);
    expect((await xetXepLopChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW)).boQua).toBe("CO_TAT");
  });

  it("[XL-DB-17] ĐƠN THƯỜNG (không dấu SCOPE) ⇒ hích không ghi gì, kể cả khi cờ BẬT", async () => {
    const lop = `${T}lop-17`;
    await dungLop({ id: lop, daDay: 3 });
    const hv = await dungHocVien(`${T}hv-17`, "17");
    const gd = await ghiDanh(`${T}gd-17`, hv, lop);
    const don = `${T}don-17`;
    await db.order.create({ data: { id: don, code: `ORD-2699-XL-17`, type: "COURSE", status: "PENDING_PAYMENT", customerName: `${T}khach`, customerPhone: SDT, totalAmount: 5_000_000, subtotal: 5_000_000, centerId: CS1 } });
    await db.orderItem.create({ data: { id: `${T}item-17`, orderId: don, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 5_000_000, totalPrice: 5_000_000, discountAmount: 0, studentId: hv, enrollmentId: gd, status: "ACTIVE", metadata: { courseId: KHOA, soBuoi: 24 } } });
    const truoc = await demHang();
    await hichCapQuyenHocChoDon(don, "KE_TOAN_XAC_NHAN", NOW);
    expect(await demHang()).toEqual(truoc);
    expect((await xetXepLopChoDon(don, "KE_TOAN_XAC_NHAN", NOW)).boQua).toBe("KHONG_PHAI_DON_PHAM_VI");
  });

  // ═══ 5 · ĐỐI CHIẾU VỚI `layUngVienLop` (bảo lưu) — CÙNG MỘT câu hỏi, hai nguồn phải ra CÙNG một số ═══════════════════════════
  it("[XL-DB-20] `docBaiKeTiepCuaLop` = `layUngVienLop.baiHienTai` trên CÙNG fixture: lớp thường · buổi sớm nhất bị huỷ · buổi HÔM NAY · buổi sớm nhất chưa ghim giáo trình · hết buổi · mọi buổi sắp tới bị huỷ · buổi huỷ nằm trong quá khứ", async () => {
    await dungLop({ id: `${T}lop-p-thuong`, daDay: 5, conLai: 4 });
    await dungLop({ id: `${T}lop-p-huy-dau`, daDay: 3, conLai: 4 });
    await db.classSession.update({ where: { id: `${T}lop-p-huy-dau-s3` }, data: { status: "CANCELLED" } }); //  buổi sắp tới sớm nhất (bài 4) bị huỷ ⇒ bài kế tiếp là 5
    await dungLop({ id: `${T}lop-p-hom-nay`, daDay: 4, conLai: 3 });
    //  buổi bài 5 diễn ra SÁNG NAY (01:00Z = 08:00 VN, trước NOW=10:00 VN nhưng sau đầu ngày VN) và đã COMPLETED ⇒ vẫn là bài kế tiếp (mốc là ĐẦU NGÀY VN)
    await db.classSession.update({ where: { id: `${T}lop-p-hom-nay-s4` }, data: { date: new Date("2026-10-11T01:00:00Z"), status: "COMPLETED" } });
    await dungLop({ id: `${T}lop-p-chua-ghim`, daDay: 2, conLai: 3 });
    await db.classSession.update({ where: { id: `${T}lop-p-chua-ghim-s2` }, data: { planId: null } }); //  buổi sớm nhất chưa ghim ⇒ KHÔNG nhảy sang buổi sau
    await dungLop({ id: `${T}lop-p-het`, daDay: 6, conLai: 0 });
    await dungLop({ id: `${T}lop-p-huy-het`, daDay: 2, conLai: 2 });
    await db.classSession.updateMany({ where: { classId: `${T}lop-p-huy-het`, date: { gt: NOW } }, data: { status: "CANCELLED" } });
    await dungLop({ id: `${T}lop-p-huy-qua-khu`, daDay: 4, conLai: 2, huyDaDay: [1, 2] }); //  huỷ trong QUÁ KHỨ không ảnh hưởng bài kế tiếp

    const ungVien = await layUngVienLop(db, { courseId: KHOA, centerId: CS1, now: NOW });
    const ban: Array<[string, number | null]> = [
      ["thuong", 6],
      ["huy-dau", 5],
      ["hom-nay", 5],
      ["chua-ghim", null],
      ["het", null],
      ["huy-het", null],
      ["huy-qua-khu", 5],
    ];
    for (const [ten, mong] of ban) {
      const id = `${T}lop-p-${ten}`;
      const cu = ungVien.find((l) => l.classId === id);
      expect(cu, `${ten}: lớp phải có mặt trong layUngVienLop`).toBeDefined();
      expect(cu!.baiHienTai, `${ten}: nguồn CŨ (bảo lưu)`).toBe(mong);
      expect(await docBaiKeTiepCuaLop(db, id, NOW), `${ten}: nguồn MỚI`).toBe(mong);
    }
  });

  it("[XL-DB-21] HAI buổi CÙNG THỜI ĐIỂM của một lớp KHÔNG tồn tại được (ràng buộc duy nhất [classId, date]) ⇒ hai nguồn không thể lệch ở chỗ 'take: 1 tuỳ ý' vs 'bài nhỏ nhất'", async () => {
    await dungLop({ id: `${T}lop-p-trung`, daDay: 3, conLai: 2 });
    const plan = await db.classSessionPlan.findFirstOrThrow({ where: { classId: `${T}lop-p-trung`, order: 3 } });
    await expect(
      db.classSession.create({ data: { id: `${T}lop-p-trung-sx`, classId: `${T}lop-p-trung`, centerId: CS1, planId: plan.id, date: ngaySapToi(0), status: "SCHEDULED" } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  // ═══ 6 · GATE D — `convertLeadV2` THẬT ═══════════════════════════════════════════════════════════════════════════════
  async function chotLead(tenCa: string, o: { soBuoi: 12 | 24 | 48; scope: boolean }) {
    const lop = `${T}lop-${tenCa}`;
    await dungLop({ id: lop, daDay: 3 });
    const lead = await db.lead.create({ data: { parentName: `${T}khach-${tenCa}`, phone: SDT, centerId: CS1 }, select: { id: true } });
    const con = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${T}con-${tenCa}` }, select: { id: true } });
    const don = `${T}don-${tenCa}`;
    const item = `${T}item-${tenCa}`;
    if (o.scope) {
      await dungDon(don, [{ id: item, soBuoi: o.soBuoi, studentId: null, leadChildId: con.id }], { leadId: lead.id });
    } else {
      // Đơn THƯỜNG: metadata cũ (courseId + soBuoi + leadChildId), KHÔNG dấu SCOPE — đối chứng dương của đường cũ.
      await db.order.create({ data: { id: don, code: `ORD-2699-XL-${++dem}-${tenCa}`, type: "COURSE", status: "PENDING_PAYMENT", customerName: `${T}khach`, customerPhone: SDT, totalAmount: 5_000_000, subtotal: 5_000_000, centerId: CS1, leadId: lead.id } });
      await db.orderItem.create({ data: { id: item, orderId: don, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 5_000_000, totalPrice: 5_000_000, discountAmount: 0, status: "ACTIVE", metadata: { courseId: KHOA, soBuoi: o.soBuoi, leadChildId: con.id } } });
    }
    const kq = await convertLeadV2(
      { id: KE_TOAN, name: "Hệ thống — test XL" },
      {
        leadId: lead.id,
        parentEmail: null,
        parentName: `${T}khach-${tenCa}`,
        parentPhone: "84905123456",
        students: [{ leadChildId: con.id, name: `${T}be-${tenCa}`, courseId: KHOA, listPrice: GIA48, classId: lop, consentMedia: false }],
        idempotencyKey: `${T}idem-${tenCa}`,
        allowNoPayment: { reason: "test XL — không tiền" },
      },
    );
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    const gd = await db.enrollment.findFirstOrThrow({ where: { classId: lop, leadChildId: con.id } });
    return { gd, don, item, lop };
  }
  /** Convert tạo Student/User/idempotency ngoài tiền tố `T` — dọn riêng. */
  async function donConvert() {
    await db.idempotencyKey.deleteMany({ where: { key: { startsWith: T } } });
  }

  it("[XL-DB-30] GATE D: dòng SCOPE 12 buổi, cờ BẬT ⇒ `convertLeadV2` KHÔNG ghi buoiBatDau 'học các buổi cuối' (NULL); đầu-cuối: ghi danh có mặt, quyền học chưa có ⇒ dòng CHO_XEP_LOP, không xếp thật", async () => {
    const c = await chotLead("30", { soBuoi: 12, scope: true });
    expect(c.gd.buoiBatDau, "cờ BẬT + SCOPE ⇒ bài bắt đầu do quyền học quyết, không phải 48−12+1=37").toBeNull();
    const [cho] = await choCua(c.don);
    expect(cho).toMatchObject({ trangThai: "OPEN", orderItemId: c.item });
    expect(await quyenCua(c.don)).toHaveLength(0);
    await donConvert();
  });

  it("[XL-DB-31] GATE D ĐỐI CHỨNG: cùng dòng SCOPE 12 buổi nhưng cờ TẮT ⇒ đường cũ NGUYÊN CHỮ (buoiBatDau = 37), không dòng chờ, không quyền học", async () => {
    await datCo(OU1, false);
    const c = await chotLead("31", { soBuoi: 12, scope: true });
    expect(c.gd.buoiBatDau).toBe(37);
    expect(await choCua(c.don)).toHaveLength(0);
    expect(await quyenCua(c.don)).toHaveLength(0);
    await donConvert();
  });

  it("[XL-DB-32] GATE D ĐỐI CHỨNG DƯƠNG: đơn THƯỜNG 24 buổi (không dấu SCOPE) ⇒ cờ BẬT vẫn ra buoiBatDau = 25 như cũ", async () => {
    const c = await chotLead("32", { soBuoi: 24, scope: false });
    expect(c.gd.buoiBatDau).toBe(25);
    expect(await choCua(c.don)).toHaveLength(0);
    await donConvert();
  });

  it("[XL-DB-33] ĐẦU-CUỐI convert → tiền → hích: dòng chờ 'chưa có quyền' ⇒ khi tiền xác nhận đủ, quyền học được cấp + CHỐT PHẠM VI theo ghi danh do convert tạo (cầu nối leadChildId), dòng chờ đóng", async () => {
    const c = await chotLead("33", { soBuoi: 12, scope: true });
    expect((await choCua(c.don))[0]).toMatchObject({ trangThai: "OPEN" });
    const don = await db.order.findUniqueOrThrow({ where: { id: c.don }, select: { totalAmount: true } });
    await thu(c.don, c.item, don.totalAmount);
    await hichCapQuyenHocChoDon(c.don, "KE_TOAN_XAC_NHAN", NOW);
    const [q] = await quyenCua(c.don);
    // Lớp đã dạy 3 ⇒ bài kế tiếp 4 ⇒ gói 12 buổi = 4–15. Học viên là học viên do convert tạo (khớp ghi danh).
    expect(q).toMatchObject({ status: "ACTIVE", enrollmentId: c.gd.id, studentId: c.gd.studentId, startLessonOrder: 4, endLessonOrder: 15 });
    expect((await choCua(c.don))[0]).toMatchObject({ trangThai: "DA_XU_LY" });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.gd.id } })).buoiBatDau).toBe(4);
    await donConvert();
  });
});
