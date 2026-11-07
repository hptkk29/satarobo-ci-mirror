// tests/finance/quyen-hoc-diem-danh.test.ts — ĐIỂM DANH TIÊU THỤ QUYỀN HỌC, trên POSTGRES THẬT (khu vực KV4 "portal-gv").
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts; CI: `ci-guong/ci.yml` bước "Run finance DB tests")
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (`fx-dd-`). Chạy được MỘT MÌNH (luật 18).
//
// Đo qua ĐÚNG hàm mà ba đường lưu điểm danh gọi — `giaoDichDiemDanh` + `tx.attendance.upsert` + `dongBoDongSauDiemDanh` — không qua server action
// (action cần phiên đăng nhập). Dây nối action ↔ hàm này do lưới ghim mã nguồn `lib/hoc-bu/so-cai-quyen-hoc-wiring.test.ts` canh.
//
// Thứ cần chứng minh mà test thuần KHÔNG chứng minh được:
//   1. ghi/huỷ sổ cái hội tụ theo BẰNG CHỨNG đọc từ DB (không theo "điểm danh vừa đổi từ A sang B");
//   2. cờ TẮT ⇒ KHÔNG chạm DB (bộ trung gian ném khi bị truy cập), và đường cũ không đổi;
//   3. quyền học khác cơ sở không làm cuộn ngược điểm danh;
//   4. hai lượt lưu đồng thời cho cùng học viên + bài, ở hai lớp khác nhau, cho sổ cái khớp trạng thái điểm danh CUỐI;
//   5. cùng số phận với giao dịch của người gọi (rollback).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async (goc) => {
  const m = await goc<typeof import("next/cache")>();
  return { ...m, revalidatePath: vi.fn(), revalidateTag: vi.fn() };
});

import type { AttendanceStatus, Prisma, StudyEntitlement } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { tinhGiaTheoMoc } from "@/lib/pricing/tinh-gia-theo-moc";
import { capQuyenHoc, xepLop, type PhuThuoc } from "@/lib/entitlements/dich-vu";
import { docSoCaiDiemDanh, dongBoSoCaiNeuBat, type SoCaiDiemDanh } from "@/lib/entitlements/dong-bo-bai-db";
import { dongBoDongSauDiemDanh, giaoDichDiemDanh, xoaDiemDanhVaDongBoSoCai } from "@/lib/hoc-bu/dong-diem-danh";

if (!RUN_DB_TESTS) console.warn(`[DDD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const T = "fx-dd-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const KHOA = `${T}khoa`;
const KHOA_KHAC = `${T}khoa-khac`;
const LOP = `${T}lop`;
const LOP2 = `${T}lop2`;
const LOP_KHAC = `${T}lop-khac`;
const HV = `${T}hv`;
const HV2 = `${T}hv2`;
const HV_CU = `${T}hv-cu`; // học viên không có quyền học nào (LEGACY)
const NGUOI = { id: `${T}nguoi`, name: "Người thử điểm danh" };
const NOW = new Date("2026-10-19T03:00:00Z");
const NGAY = 24 * 3600 * 1000;
const BAT: PhuThuoc = { batChoCoSo: async () => true };
const SO_BAI = 15;

const soCaiCS1: SoCaiDiemDanh = { co: { centerId: CS1, bat: true }, actor: NGUOI, now: NOW };
const soCaiCS2: SoCaiDiemDanh = { co: { centerId: CS2, bat: true }, actor: NGUOI, now: NOW };

const buoi = (lop: string, bai: number) => `${lop}-s${bai}`; // bài 1-based

async function don() {
  await db.attendance.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studyEntitlementUsage.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studyEntitlement.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: NGUOI.id }, { module: "entitlements", entityType: "StudyEntitlement", entityId: { startsWith: T } }] } });
}

async function dungLop(id: string, courseId: string) {
  await db.class.create({ data: { id, name: id, courseId, centerId: CS1, status: "ACTIVE", maxStudents: 12 } });
  for (let i = 0; i < SO_BAI; i++) {
    const plan = await db.classSessionPlan.create({ data: { id: `${id}-p${i}`, classId: id, seq: i + 1, order: i } });
    await db.classSession.create({
      data: { id: `${id}-s${i + 1}`, classId: id, centerId: CS1, planId: plan.id, date: new Date(NOW.getTime() + (i - 30) * NGAY), status: "COMPLETED" },
    });
  }
}

async function xoaHet() {
  await don();
  await db.classSession.deleteMany({ where: { classId: { startsWith: T } } });
  await db.classSessionPlan.deleteMany({ where: { classId: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: T } } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA_KHAC] } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

let dem = 0;
async function capVaXep(studentId: string, o: { centerId?: string; courseId?: string; bai?: number } = {}): Promise<StudyEntitlement> {
  const k = ++dem;
  const gia = tinhGiaTheoMoc({ gia48: 10_560_000, soBuoi: 12, thuTuCon: 1 });
  const { quyenHoc } = await capQuyenHoc(
    {
      studentId,
      courseId: o.courseId ?? KHOA,
      orderId: `${T}don-${k}`,
      orderItemId: `${T}dong-${k}`,
      centerId: o.centerId ?? CS1,
      gia,
      pricingSnapshot: { gia48: 10_560_000 },
      actor: NGUOI,
    },
    BAT,
  );
  const r = await xepLop({ entitlementId: quyenHoc.id, enrollmentId: `${T}gd-${k}`, classId: LOP, baiKeTiepCuaLop: o.bai ?? 1, actor: NGUOI, now: NOW }, BAT);
  return r.quyenHoc;
}

const doc = (id: string) => db.studyEntitlement.findUniqueOrThrow({ where: { id } });
const dongSoCai = (entitlementId: string) => db.studyEntitlementUsage.findMany({ where: { entitlementId }, orderBy: { lessonOrder: "asc" } });
const dongSong = async (entitlementId: string) => (await dongSoCai(entitlementId)).filter((d) => d.voidedAt === null);
const demAudit = (entityId: string, action: string) => db.auditLog.count({ where: { module: "entitlements", entityId, action } });

type Ghi = { studentId: string; status: AttendanceStatus };

/** Đúng nhịp của ba đường lưu điểm danh: MỘT giao dịch = upsert điểm danh + `dongBoDongSauDiemDanh` (có `soCai`). */
async function luu(sessionId: string, ghi: Ghi[], soCai: SoCaiDiemDanh | null = soCaiCS1) {
  await giaoDichDiemDanh(async (tx) => {
    const daLuu = [];
    for (const g of ghi) {
      const att = await tx.attendance.upsert({
        where: { sessionId_studentId: { sessionId, studentId: g.studentId } },
        create: { sessionId, studentId: g.studentId, status: g.status, centerId: CS1 },
        update: { status: g.status },
        select: { id: true },
      });
      daLuu.push({ studentId: g.studentId, attendanceId: att.id, status: g.status, makeupStatus: "NONE" as const, makeupStatusTruoc: undefined, absenceReason: null });
    }
    await dongBoDongSauDiemDanh(tx, { sessionId, createdById: null, soCai, ghi: daLuu });
  });
}

describe.skipIf(!RUN_DB_TESTS)("[DDD] điểm danh tiêu thụ quyền học (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await xoaHet();
  });
  beforeEach(async () => {
    await xoaHet();
    for (const id of [CS1, CS2]) await db.center.create({ data: { id, name: id, slug: id, address: "x" } });
    for (const id of [KHOA, KHOA_KHAC]) await db.course.create({ data: { id, name: id, slug: id, price: 10_560_000, totalSessions: 48 } });
    for (const id of [HV, HV2, HV_CU]) await db.student.create({ data: { id, name: id, centerId: CS1, status: "ACTIVE" } });
    await dungLop(LOP, KHOA);
    await dungLop(LOP2, KHOA); // CÙNG khoá, lớp khác — bằng chứng của một bài có thể đến từ lớp nào
    await dungLop(LOP_KHAC, KHOA_KHAC);
  });
  afterAll(xoaHet);

  // ═══ 1 · GHI, HUỶ, IDEMPOTENT ═════════════════════════════════════════════════════════════════════════════════════
  it("[DDD-01] CÓ MẶT ⇒ một dòng CLASS + consumedSessions = 1 + một audit CONSUME; lưu lại 3 lần vẫn đúng một dòng, một audit (idempotent)", async () => {
    const e = await capVaXep(HV);
    for (let i = 0; i < 4; i++) await luu(buoi(LOP, 5), [{ studentId: HV, status: "PRESENT" }]);
    const dong = await dongSoCai(e.id);
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ lessonOrder: 5, source: "CLASS", voidedAt: null, studentId: HV, sessionId: buoi(LOP, 5) });
    expect(dong[0]!.attendanceId).toBeTruthy();
    expect((await doc(e.id)).consumedSessions).toBe(1);
    expect(await demAudit(e.id, "CONSUME")).toBe(1);
  });

  it("[DDD-02] có mặt → vắng → có mặt → vắng: sổ cái luôn khớp trạng thái CUỐI, không nhân đôi dòng, quyền học vẫn ACTIVE", async () => {
    const e = await capVaXep(HV);
    const chuoi: Array<[AttendanceStatus, number]> = [["PRESENT", 1], ["ABSENT", 0], ["PRESENT", 1], ["LATE", 1], ["ABSENT_EXCUSED", 0], ["EXCUSED", 0]];
    for (const [status, mongDoi] of chuoi) {
      await luu(buoi(LOP, 5), [{ studentId: HV, status }]);
      expect((await dongSong(e.id)).length, status).toBe(mongDoi);
      expect((await dongSoCai(e.id)).length, "không bao giờ quá MỘT dòng cho một bài").toBeLessThanOrEqual(1);
      expect((await doc(e.id)).consumedSessions, status).toBe(mongDoi);
    }
    expect((await doc(e.id)).status).toBe("ACTIVE");
    expect(await demAudit(e.id, "USAGE_VOID")).toBe(2);
  });

  it("[DDD-03] nhiều học viên một lượt lưu: chỉ học viên CÓ quyền học và CÓ MẶT được ghi; học viên cũ (không quyền học) không làm hỏng gì", async () => {
    const e1 = await capVaXep(HV);
    const e2 = await capVaXep(HV2);
    await luu(buoi(LOP, 3), [
      { studentId: HV, status: "PRESENT" },
      { studentId: HV2, status: "ABSENT" },
      { studentId: HV_CU, status: "PRESENT" },
    ]);
    expect((await dongSong(e1.id)).map((d) => d.lessonOrder)).toEqual([3]);
    expect(await dongSong(e2.id)).toHaveLength(0);
    expect(await db.studyEntitlementUsage.count({ where: { studentId: HV_CU } })).toBe(0);
    expect(await db.attendance.count({ where: { sessionId: buoi(LOP, 3) } }), "điểm danh của cả ba đều đã lưu").toBe(3);
  });

  // ═══ 2 · CỜ TẮT ═══════════════════════════════════════════════════════════════════════════════════════════════════
  it("[DDD-04] CỜ TẮT (soCai = null): điểm danh lưu bình thường, KHÔNG dòng sổ cái, KHÔNG audit, quyền học không đổi", async () => {
    const e = await capVaXep(HV);
    const truoc = await doc(e.id);
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "PRESENT" }], null);
    expect(await db.attendance.count({ where: { studentId: HV } })).toBe(1);
    expect(await db.studyEntitlementUsage.count({ where: { studentId: HV } })).toBe(0);
    expect(await demAudit(e.id, "CONSUME")).toBe(0);
    expect(await doc(e.id)).toEqual(truoc);
  });

  it("[DDD-05] CỜ TẮT KHÔNG CHẠM DB: tx là bộ trung gian ném khi bị truy cập — `dongBoSoCaiNeuBat` và `dongBoDongSauDiemDanh` (bản ghi vắng, ĐÃ BÙ XONG — nhánh không việc gì phải làm) đều chạy xong", async () => {
    let truyCap = 0;
    const tx = new Proxy({}, { get: (_t, p) => { truyCap++; throw new Error(`tx bị truy cập: ${String(p)}`); } }) as unknown as Prisma.TransactionClient;
    const kq = await dongBoSoCaiNeuBat(tx, { soCai: null, dau: [{ studentId: HV, sessionId: buoi(LOP, 1) }] });
    expect(kq).toMatchObject({ daGhi: 0, daHuy: 0, boQuaKhacCoSo: 0 });
    await dongBoDongSauDiemDanh(tx, {
      sessionId: buoi(LOP, 1),
      createdById: null,
      soCai: null,
      // Trước 22/10/2026 dùng `makeupStatus: "NONE"` làm ca "không việc gì". Nay vắng + NONE là lựa chọn "Không cần bù" và CÓ đọc dòng cần bù để thu hồi
      // (xem [KCD] ở tests/hoc-bu) — nên ca "không chạm DB" của CỜ SỔ CÁI phải dùng một nhánh thật sự không làm gì: vắng + đã MADE_UP.
      ghi: [{ studentId: HV, attendanceId: "x", status: "ABSENT", makeupStatus: "MADE_UP", makeupStatusTruoc: "MADE_UP", absenceReason: null }],
    });
    expect(truyCap).toBe(0);
  });

  it("[DDD-06] docSoCaiDiemDanh: cờ BẬT ⇒ trả đối tượng; cờ TẮT ⇒ null; cơ sở không có OrgUnit ⇒ null (fail-closed, KHÔNG rơi về giá trị toàn hệ); không có cơ sở ⇒ null", async () => {
    await seedOrg(["HO", "CS1"]);
    const ou = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } }));
    const trungTam = ou.centerId!;
    const datCo = async (bat: boolean | null) => {
      if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId: ou.id, key: KHOA_CONG_TAC_PHAM_VI } });
      else {
        await db.centerSetting.upsert({
          where: { orgUnitId_key: { orgUnitId: ou.id, key: KHOA_CONG_TAC_PHAM_VI } },
          create: { orgUnitId: ou.id, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
          update: { valueJson: bat },
        });
      }
      clearSettingsCache();
    };
    // Cờ TOÀN HỆ đặt BẬT để cái bẫy có răng: nếu mã hỏi cờ với `orgUnitId = null` thì nó rơi về giá trị toàn hệ (BẬT) và ĐÚNG cơ sở không có OrgUnit lại được coi là BẬT.
    const truocToanHe = await db.systemSetting.findUnique({ where: { key: KHOA_CONG_TAC_PHAM_VI } });
    await db.systemSetting.upsert({
      where: { key: KHOA_CONG_TAC_PHAM_VI },
      create: { key: KHOA_CONG_TAC_PHAM_VI, valueJson: true, updatedByName: "test sổ cái" },
      update: { valueJson: true },
    });
    clearSettingsCache();
    try {
      await datCo(true);
      expect(await docSoCaiDiemDanh({ centerId: trungTam, actor: NGUOI, now: NOW })).toEqual({ co: { centerId: trungTam, bat: true }, actor: NGUOI, now: NOW });
      await datCo(false);
      expect(await docSoCaiDiemDanh({ centerId: trungTam, actor: NGUOI, now: NOW }), "cờ riêng của cơ sở TẮT thắng cờ toàn hệ BẬT").toBeNull();
      await datCo(true);
      expect(await docSoCaiDiemDanh({ centerId: CS1, actor: NGUOI, now: NOW }), "Center fixture không có OrgUnit").toBeNull();
      expect(await docSoCaiDiemDanh({ centerId: null, actor: NGUOI, now: NOW })).toBeNull();
      expect(await docSoCaiDiemDanh({ centerId: undefined, actor: NGUOI, now: NOW })).toBeNull();
    } finally {
      await datCo(null);
      if (truocToanHe) await db.systemSetting.update({ where: { key: KHOA_CONG_TAC_PHAM_VI }, data: { valueJson: truocToanHe.valueJson as never } });
      else await db.systemSetting.deleteMany({ where: { key: KHOA_CONG_TAC_PHAM_VI } });
      clearSettingsCache();
    }
  });

  // ═══ 3 · CƠ SỞ ════════════════════════════════════════════════════════════════════════════════════════════════════
  it("[DDD-07] cờ đã đọc cho CƠ SỞ KHÁC quyền học ⇒ KHÔNG ném, điểm danh vẫn commit, sổ cái không đổi, được đếm vào boQuaKhacCoSo", async () => {
    const e = await capVaXep(HV); // quyền học ở CS1
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "PRESENT" }], soCaiCS2);
    expect(await db.attendance.count({ where: { studentId: HV } })).toBe(1);
    expect(await dongSoCai(e.id)).toHaveLength(0);
    const kq = await giaoDichDiemDanh((tx) => dongBoSoCaiNeuBat(tx, { soCai: soCaiCS2, dau: [{ studentId: HV, sessionId: buoi(LOP, 5) }] }));
    expect(kq.boQuaKhacCoSo).toBe(1);
    expect(kq.daGhi).toBe(0);
  });

  it("[DDD-08] quyền học khác cơ sở KHÔNG bị HUỶ khi cờ của cơ sở kia đọc được: dòng đã có ở CS1, lưu vắng với cờ CS2 ⇒ dòng CS1 còn nguyên", async () => {
    const e = await capVaXep(HV);
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "PRESENT" }]);
    expect(await dongSong(e.id)).toHaveLength(1);
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "ABSENT" }], soCaiCS2);
    expect(await dongSong(e.id), "cờ CS2 không có quyền sửa sổ cái của CS1").toHaveLength(1);
  });

  // ═══ 4 · BẰNG CHỨNG TỪ NHIỀU NGUỒN ═══════════════════════════════════════════════════════════════════════════════
  it("[DDD-09] bằng chứng đến từ LỚP KHÁC cùng khoá: có mặt ở lớp 2 giữ dòng sống dù lớp 1 đánh vắng; vắng cả hai mới huỷ", async () => {
    const e = await capVaXep(HV);
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "PRESENT" }]);
    await luu(buoi(LOP2, 5), [{ studentId: HV, status: "PRESENT" }]);
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "ABSENT" }]);
    expect(await dongSong(e.id), "còn có mặt ở lớp 2").toHaveLength(1);
    await luu(buoi(LOP2, 5), [{ studentId: HV, status: "ABSENT" }]);
    expect(await dongSong(e.id)).toHaveLength(0);
  });

  it("[DDD-10] điểm danh ở KHOÁ KHÁC không tính; buổi đã HUỶ không tính", async () => {
    const e = await capVaXep(HV);
    // Có mặt ở bài 5 của KHOÁ KHÁC rồi đánh VẮNG bài 5 của khoá này: bằng chứng của khoá kia không được tính sang. (Chỉ lưu khoá kia thì ca vô nghĩa:
    // học viên không có quyền học cho khoá đó nên cổng chọn nhóm đã loại sớm — phải có một lượt đồng bộ của KHOÁ NÀY để phép đọc bằng chứng chạy.)
    await luu(buoi(LOP_KHAC, 5), [{ studentId: HV, status: "PRESENT" }]);
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "ABSENT" }]);
    expect(await dongSoCai(e.id), "khoá khác").toHaveLength(0);
    await db.classSession.update({ where: { id: buoi(LOP, 6) }, data: { status: "CANCELLED" } });
    await luu(buoi(LOP, 6), [{ studentId: HV, status: "PRESENT" }]);
    expect(await dongSoCai(e.id), "buổi huỷ").toHaveLength(0);
  });

  it("[DDD-11] ĐÃ BÙ XONG rồi giáo viên lưu lại lưới (vẫn VẮNG): dòng MAKEUP KHÔNG bị huỷ nhầm; hoàn bù (dòng cần bù về PENDING) thì dòng mới bị huỷ", async () => {
    const e = await capVaXep(HV);
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "ABSENT" }]);
    expect(await dongSoCai(e.id)).toHaveLength(0);
    const nhuCau = await db.makeupNeed.create({
      data: {
        studentId: HV, classId: LOP, centerId: CS1, courseId: KHOA, missedSessionId: buoi(LOP, 5), status: "COMPLETED", sourceType: "ABSENCE", completedAt: NOW,
      },
    });
    // Sự kiện đổi bằng chứng đi qua cùng hàm đồng bộ (đường `diemDanhBe` gọi nó theo buổi LỠ).
    await giaoDichDiemDanh((tx) => dongBoSoCaiNeuBat(tx, { soCai: soCaiCS1, dau: [{ studentId: HV, sessionId: buoi(LOP, 5) }] }));
    expect((await dongSong(e.id)).map((d) => [d.lessonOrder, d.source])).toEqual([[5, "MAKEUP"]]);
    // Giáo viên mở buổi cũ bấm Lưu lại: vẫn VẮNG.
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "ABSENT" }]);
    expect((await dongSong(e.id)).map((d) => d.source), "lưu lại lưới KHÔNG huỷ dòng MAKEUP").toEqual(["MAKEUP"]);
    // Sửa điểm danh buổi bù (hoàn bù): dòng cần bù về PENDING.
    await db.makeupNeed.update({ where: { id: nhuCau.id }, data: { status: "PENDING", completedAt: null } });
    await giaoDichDiemDanh((tx) => dongBoSoCaiNeuBat(tx, { soCai: soCaiCS1, dau: [{ studentId: HV, sessionId: buoi(LOP, 5) }] }));
    expect(await dongSong(e.id)).toHaveLength(0);
    expect((await dongSoCai(e.id))[0]!.voidedAt).not.toBeNull();
  });

  it("[DDD-12] HỌC VƯỢT hoàn tất (ORDER_CONVERSION, không điểm danh gốc) ⇒ dòng nguồn CATCH_UP", async () => {
    const e = await capVaXep(HV);
    await db.makeupNeed.create({
      data: { studentId: HV, classId: LOP, centerId: CS1, courseId: KHOA, missedSessionId: buoi(LOP, 2), status: "COMPLETED", sourceType: "ORDER_CONVERSION", completedAt: NOW },
    });
    const kq = await giaoDichDiemDanh((tx) => dongBoSoCaiNeuBat(tx, { soCai: soCaiCS1, dau: [{ studentId: HV, sessionId: buoi(LOP, 2) }] }));
    expect(kq.daGhi).toBe(1);
    expect((await dongSong(e.id)).map((d) => [d.lessonOrder, d.source])).toEqual([[2, "CATCH_UP"]]);
  });

  // ═══ 5 · CÁC BÀI ĐẶC BIỆT ═════════════════════════════════════════════════════════════════════════════════════════
  it("[DDD-13] bài học bù MIỄN PHÍ: không dòng sổ cái, consumed không đổi, và N lần lưu chỉ để lại MỘT audit BONUS_LEARN (khử trùng)", async () => {
    const e = await capVaXep(HV);
    // Gói 12 buổi bắt đầu ở bài 4, ba bài đầu (4..6) là học bù miễn phí.
    await db.studyEntitlement.update({ where: { id: e.id }, data: { startLessonOrder: 4, endLessonOrder: 15, freeMakeupSessions: 3 } });
    for (let i = 0; i < 4; i++) await luu(buoi(LOP, 5), [{ studentId: HV, status: "PRESENT" }]);
    expect(await dongSoCai(e.id), "không dòng Usage cho bài bù miễn phí").toHaveLength(0);
    expect((await doc(e.id)).consumedSessions).toBe(0);
    expect(await demAudit(e.id, "BONUS_LEARN"), "khử trùng theo (quyền học, bài)").toBe(1);
    // Một bài bù miễn phí KHÁC vẫn được ghi nhận riêng; bài trong phạm vi tính tiền (7) vẫn tiêu thụ bình thường.
    await luu(buoi(LOP, 6), [{ studentId: HV, status: "PRESENT" }]);
    await luu(buoi(LOP, 7), [{ studentId: HV, status: "PRESENT" }]);
    expect(await demAudit(e.id, "BONUS_LEARN")).toBe(2);
    expect((await dongSong(e.id)).map((d) => d.lessonOrder)).toEqual([7]);
  });

  it("[DDD-14] bài NGOÀI phạm vi quyền học: không ném, điểm danh vẫn lưu, không dòng sổ cái, được báo là 'không ghi được'", async () => {
    const e = await capVaXep(HV); // phạm vi 1..12
    const kq = await giaoDichDiemDanh(async (tx) => {
      await tx.attendance.create({ data: { sessionId: buoi(LOP, 14), studentId: HV, status: "PRESENT", centerId: CS1 } });
      return dongBoSoCaiNeuBat(tx, { soCai: soCaiCS1, dau: [{ studentId: HV, sessionId: buoi(LOP, 14) }] });
    });
    expect(kq.khongGhiDuoc).toEqual([{ studentId: HV, lessonOrder: 14, lyDo: "NGOAI_PHAM_VI" }]);
    expect(await dongSoCai(e.id)).toHaveLength(0);
    expect(await db.attendance.count({ where: { studentId: HV } })).toBe(1);
  });

  it("[DDD-15] quyền học đang BẢO LƯU (FROZEN): có mặt không làm hỏng điểm danh và không ghi sổ cái", async () => {
    const e = await capVaXep(HV);
    await db.studyEntitlement.update({ where: { id: e.id }, data: { status: "FROZEN", statusBeforeFreeze: "ACTIVE" } });
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "PRESENT" }]);
    expect(await dongSoCai(e.id)).toHaveLength(0);
    expect(await db.attendance.count({ where: { studentId: HV } })).toBe(1);
  });

  it("[DDD-16] buổi CHƯA GHIM giáo trình (không plan, không lesson) ⇒ không đoán bài: không ghi, được đếm vào buoiKhongCoBai", async () => {
    const e = await capVaXep(HV);
    await db.classSession.create({ data: { id: `${T}buoi-tran`, classId: LOP, centerId: CS1, date: new Date(NOW.getTime() + 5 * NGAY), status: "COMPLETED" } });
    const kq = await giaoDichDiemDanh(async (tx) => {
      await tx.attendance.create({ data: { sessionId: `${T}buoi-tran`, studentId: HV, status: "PRESENT", centerId: CS1 } });
      return dongBoSoCaiNeuBat(tx, { soCai: soCaiCS1, dau: [{ studentId: HV, sessionId: `${T}buoi-tran` }] });
    });
    expect(kq.buoiKhongCoBai).toBe(1);
    expect(await dongSoCai(e.id)).toHaveLength(0);
    await db.attendance.deleteMany({ where: { sessionId: `${T}buoi-tran` } });
    await db.classSession.delete({ where: { id: `${T}buoi-tran` } });
  });

  it("[DDD-17] quyền học HẾT (conLai = 0) rồi sửa vắng: HUY mở lại quyền học EXHAUSTED → ACTIVE", async () => {
    const e = await capVaXep(HV);
    for (let bai = 1; bai <= 12; bai++) await luu(buoi(LOP, bai), [{ studentId: HV, status: "PRESENT" }]);
    expect(await doc(e.id)).toMatchObject({ status: "EXHAUSTED", consumedSessions: 12 });
    await luu(buoi(LOP, 12), [{ studentId: HV, status: "ABSENT" }]);
    expect(await doc(e.id)).toMatchObject({ status: "ACTIVE", consumedSessions: 11 });
  });

  // ═══ 6 · XOÁ ĐIỂM DANH · ROLLBACK · ĐỒNG THỜI ═════════════════════════════════════════════════════════════════════
  it("[DDD-18] XOÁ bản ghi điểm danh ⇒ dòng sổ cái của bài bị huỷ cùng giao dịch; xoá hết bằng chứng mới huỷ", async () => {
    const e = await capVaXep(HV);
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "PRESENT" }]);
    await luu(buoi(LOP2, 5), [{ studentId: HV, status: "PRESENT" }]);
    const a1 = await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: buoi(LOP, 5), studentId: HV } } });
    await xoaDiemDanhVaDongBoSoCai({ attendanceId: a1.id, studentId: HV, sessionId: buoi(LOP, 5), soCai: soCaiCS1 });
    expect(await dongSong(e.id), "còn bản ghi ở lớp 2").toHaveLength(1);
    const a2 = await db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: buoi(LOP2, 5), studentId: HV } } });
    await xoaDiemDanhVaDongBoSoCai({ attendanceId: a2.id, studentId: HV, sessionId: buoi(LOP2, 5), soCai: soCaiCS1 });
    expect(await dongSong(e.id)).toHaveLength(0);
    expect(await db.attendance.count({ where: { studentId: HV } })).toBe(0);
  });

  it("[DDD-19] CÙNG SỐ PHẬN: giao dịch của người gọi cuộn ngược sau khi đồng bộ ⇒ không điểm danh, không dòng sổ cái, không audit", async () => {
    const e = await capVaXep(HV);
    class Huy extends Error {}
    await expect(
      giaoDichDiemDanh(async (tx) => {
        const att = await tx.attendance.create({ data: { sessionId: buoi(LOP, 5), studentId: HV, status: "PRESENT", centerId: CS1 } });
        await dongBoDongSauDiemDanh(tx, {
          sessionId: buoi(LOP, 5),
          createdById: null,
          soCai: soCaiCS1,
          ghi: [{ studentId: HV, attendanceId: att.id, status: "PRESENT", makeupStatus: "NONE", makeupStatusTruoc: undefined, absenceReason: null }],
        });
        expect(await tx.studyEntitlementUsage.count({ where: { entitlementId: e.id } }), "trong giao dịch đã thấy dòng").toBe(1);
        throw new Huy("bước sau của người gọi hỏng");
      }),
    ).rejects.toBeInstanceOf(Huy);
    expect(await db.attendance.count({ where: { studentId: HV } })).toBe(0);
    expect(await dongSoCai(e.id)).toHaveLength(0);
    expect(await demAudit(e.id, "CONSUME")).toBe(0);
    expect((await doc(e.id)).consumedSessions).toBe(0);
  });

  it("[DDD-20] ĐỒNG THỜI: lớp 1 đổi CÓ MẶT → VẮNG trong lúc lớp 2 đổi VẮNG → CÓ MẶT cho CÙNG học viên + bài ⇒ sổ cái khớp trạng thái cuối (còn sống), không phụ thuộc ai commit trước", async () => {
    const e = await capVaXep(HV);
    await luu(buoi(LOP, 5), [{ studentId: HV, status: "PRESENT" }]);
    await luu(buoi(LOP2, 5), [{ studentId: HV, status: "ABSENT" }]);
    expect(await dongSong(e.id)).toHaveLength(1);

    // Lượt A giữ giao dịch MỞ sau khi đồng bộ cho tới khi lượt B đã tới bước đồng bộ của nó: không có khoá quyền học ở giữa thì B đọc bằng chứng
    // mà KHÔNG thấy thay đổi chưa commit của A, và hai bên cho kết quả đối nghịch.
    let thaA!: () => void;
    const aDaDongBo = new Promise<void>((r) => (thaA = r));
    let thaB!: () => void;
    const bDaToiBuocDongBo = new Promise<void>((r) => (thaB = r));
    const trong = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const dau = (sessionId: string) => [{ studentId: HV, sessionId }];

    const luotA = giaoDichDiemDanh(async (tx) => {
      await tx.attendance.update({ where: { sessionId_studentId: { sessionId: buoi(LOP, 5), studentId: HV } }, data: { status: "ABSENT" } });
      await dongBoSoCaiNeuBat(tx, { soCai: soCaiCS1, dau: dau(buoi(LOP, 5)) });
      thaA();
      await bDaToiBuocDongBo;
      await trong(600); // đủ lâu để B (nếu không bị khoá) đọc xong và ghi xong
    });
    const luotB = giaoDichDiemDanh(async (tx) => {
      await tx.attendance.update({ where: { sessionId_studentId: { sessionId: buoi(LOP2, 5), studentId: HV } }, data: { status: "PRESENT" } });
      await aDaDongBo;
      thaB();
      await dongBoSoCaiNeuBat(tx, { soCai: soCaiCS1, dau: dau(buoi(LOP2, 5)) });
    });
    await Promise.all([luotA, luotB]);

    // KHÔNG `orderBy` ở DB: thứ tự chuỗi phụ thuộc collation của Postgres (CI `en_US` bỏ qua dấu gạch: "fx-dd-lop2-s5" < "fx-dd-lop-s5"; máy dev thì ngược lại). Tập kết quả mới là thứ cần khẳng định.
    const diemDanhCuoi = await db.attendance.findMany({ where: { studentId: HV }, select: { sessionId: true, status: true } });
    expect(diemDanhCuoi).toHaveLength(2);
    expect(diemDanhCuoi).toEqual(
      expect.arrayContaining([
        { sessionId: buoi(LOP, 5), status: "ABSENT" },
        { sessionId: buoi(LOP2, 5), status: "PRESENT" },
      ]),
    );
    expect(await dongSong(e.id), "còn một buổi CÓ MẶT ⇒ dòng sổ cái phải còn sống").toHaveLength(1);
    expect((await doc(e.id)).consumedSessions).toBe(1);
  });
});
