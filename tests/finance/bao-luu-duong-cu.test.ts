// tests/finance/bao-luu-duong-cu.test.ts — ĐƯỜNG BẢO LƯU CŨ (nút "Bảo lưu / Kết thúc bảo lưu / Nghỉ học hẳn") sau Phiên 3, trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db
// Ba điều Phiên 3 sửa trên đường cũ, mỗi điều có ca ĐỎ-TRƯỚC (đã tái hiện bằng git stash mã cũ — xem TIEN-DO):
//   1. tạo hồ sơ phải mang `centerId` (bảng đã vào SCOPED_MODELS; thiếu ⇒ vô hình với người cấp cơ sở);
//   2. đóng hồ sơ phải đưa `status` về ENDED — trước đây chỉ `isActive=false`, hồ sơ vẫn được chỉ mục "một hồ sơ mở mỗi
//      ghi danh" coi là MỞ ⇒ lần bảo lưu kế của cùng ghi danh nổ P2002;
//   3. cơ sở ĐÃ BẬT `pause.enabled` ⇒ đường ghi thẳng đóng (không đơn, không maker–checker, không kiểm nợ).
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

const h = vi.hoisted(() => ({ sync: vi.fn(async (_tx: unknown, _c: string) => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: <F,>(fn: F) => fn }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
vi.mock("@/lib/chat/sync-membership", () => ({ syncConversationMembership: h.sync }));
vi.mock("@/lib/email/trigger", () => ({ sendEmailForTrigger: async () => ({ ok: true }) }));
vi.mock("@/lib/finance/bao-luu-tien", () => ({ apDungDoiHanBaoLuu: async () => ({ ok: true, soDotDaDoi: 0, donDaCham: [] }) }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "fx-bl3c-user", name: "QL fixture", email: "x@y.z" } }) }));
vi.mock("@/lib/auth/check-permission", async (orig) => ({ ...(await orig<object>()), checkPermission: async () => true }));
vi.mock("@/lib/auth/actor", async (orig) => {
  const m = await orig<typeof import("@/lib/auth/actor")>();
  const actor = {
    userId: "fx-bl3c-user", isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [],
    visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
  } as unknown as Actor;
  return { ...m, resolveActor: async () => actor };
});

import { reserveStudentAction, resumeStudentReserveAction, withdrawStudentAction } from "@/app/(admin)/admin/students/_actions";

if (!RUN_DB_TESTS) console.warn(`[BL3C-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl3c-";
const CS = `${T}cs`;
const OU = `${T}ou`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HV = `${T}hv`;
const GD = `${T}gd`;
const GD2 = `${T}gd2`;

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { entityId: { in: [] } }] } });
  await db.studentReserveEvent.deleteMany({ where: { reserve: { studentId: HV } } });
  await db.studentReserve.deleteMany({ where: { studentId: HV } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { in: [GD, GD2] } } });
  await db.enrollment.deleteMany({ where: { id: { in: [GD, GD2] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, `${T}lop2`] } } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.orgUnit.deleteMany({ where: { id: OU } });
  await db.center.deleteMany({ where: { id: CS } });
  await db.systemSetting.deleteMany({ where: { key: "pause.enabled" } });
}

async function batCongTac(bat: boolean) {
  await db.systemSetting.upsert({ where: { key: "pause.enabled" }, create: { key: "pause.enabled", valueJson: bat }, update: { valueJson: bat } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "CS BL3C", slug: CS, address: "x" } });
  await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: `${T}OU`, name: "ĐV BL3C", centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá BL3C", slug: KHOA, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp BL3C", courseId: KHOA, centerId: CS } });
  await db.student.create({ data: { id: HV, name: "HV BL3C", centerId: CS, orgUnitId: OU } });
  await db.enrollment.create({ data: { id: GD, studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE", centerId: CS } });
  await batCongTac(false);
}

const bao = () => reserveStudentAction({ studentId: HV, enrollmentId: GD, reason: "Gia đình bận", expectedEndAt: null });

describe.skipIf(!RUN_DB_TESTS)("[BL3C-DB] đường bảo lưu CŨ sau Phiên 3", () => {
  beforeEach(dung);
  afterAll(don);

  it("[BL3C-DB-01] cờ TẮT: bảo lưu cũ vẫn chạy NGUYÊN — hồ sơ ACTIVE mang centerId (+orgUnitId do ghi kép), ghi danh + học viên PAUSED", async () => {
    const r = await bao();
    expect(r.ok).toBe(true);
    const hs = await db.studentReserve.findFirstOrThrow({ where: { studentId: HV } });
    expect(hs).toMatchObject({ status: "ACTIVE", isActive: true, centerId: CS, orgUnitId: OU, enrollmentId: GD, type: "PARENT" });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("PAUSED");
    expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("PAUSED");
  });

  it("[BL3C-DB-02] kết thúc bảo lưu ⇒ status ENDED + isActive=false + endedAt + sự kiện RESUME; rồi bảo lưu LẠI cùng ghi danh KHÔNG nổ P2002", async () => {
    await bao();
    const id = (await db.studentReserve.findFirstOrThrow({ where: { studentId: HV } })).id;
    const r = await resumeStudentReserveAction({ reserveId: id, endReason: "Phụ huynh báo quay lại" });
    expect(r).toEqual({ ok: true });
    const hs = await db.studentReserve.findUniqueOrThrow({ where: { id } });
    expect(hs).toMatchObject({ status: "ENDED", isActive: false, endKind: "RESUMED", endReason: "Phụ huynh báo quay lại", endedByUserId: "fx-bl3c-user" });
    expect(hs.endedAt).not.toBeNull();
    expect((await db.studentReserveEvent.findMany({ where: { reserveId: id } })).map((e) => e.kind)).toEqual(["RESUME"]);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("STUDYING");

    // Hồi quy chính: trước bản vá, hồ sơ cũ còn status ACTIVE ⇒ chỉ mục từng phần coi là mở ⇒ lần này nổ.
    const lai = await bao();
    expect(lai).toMatchObject({ ok: true });
    expect(await db.studentReserve.count({ where: { studentId: HV, isActive: true } })).toBe(1);
  });

  it("[BL3C-DB-03] kết thúc hồ sơ đời mới QUÁ HẠN (NOTICE_SENT) đi qua RESUME_PENDING rồi ENDED — đủ hai sự kiện", async () => {
    await bao();
    const id = (await db.studentReserve.findFirstOrThrow({ where: { studentId: HV } })).id;
    await db.studentReserve.update({ where: { id }, data: { status: "NOTICE_SENT" } });
    expect(await resumeStudentReserveAction({ reserveId: id })).toEqual({ ok: true });
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id } })).status).toBe("ENDED");
    expect((await db.studentReserveEvent.findMany({ where: { reserveId: id }, orderBy: { at: "asc" } })).map((e) => e.kind)).toEqual(["RESUME_REQUEST", "RESUME"]);
  });

  it("[BL3C-DB-04] cờ BẬT: đường ghi thẳng ĐÓNG — từ chối, không tạo hồ sơ, không đụng ghi danh/học viên", async () => {
    await batCongTac(true);
    const r = await bao();
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("mục Bảo lưu") });
    expect(await db.studentReserve.count({ where: { studentId: HV } })).toBe(0);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("ACTIVE");
    expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("ACTIVE");
  });

  it("[BL3C-DB-05] nghỉ học hẳn: hồ sơ ĐANG MỞ → ENDED (kind TERMINATE); hồ sơ CHỜ DUYỆT → CANCELLED; không hồ sơ nào còn mở", async () => {
    await bao(); // ACTIVE trên GD
    await db.class.create({ data: { id: `${T}lop2`, name: "Lớp 2 BL3C", courseId: KHOA, centerId: CS } });
    await db.enrollment.create({ data: { id: GD2, studentId: HV, classId: `${T}lop2`, courseId: KHOA, status: "ACTIVE", centerId: CS } });
    const cho = await db.studentReserve.create({
      data: { studentId: HV, enrollmentId: GD2, reason: "chờ", createdByName: "x", centerId: CS, status: "PENDING", isActive: false },
    });
    const dang = await db.studentReserve.findFirstOrThrow({ where: { studentId: HV, status: "ACTIVE" } });

    const r = await withdrawStudentAction({ studentId: HV, reason: "Chuyển nhà ra tỉnh" });
    expect(r.ok).toBe(true);

    expect(await db.studentReserve.findUniqueOrThrow({ where: { id: dang.id } })).toMatchObject({ status: "ENDED", isActive: false, endKind: "TERMINATED" });
    expect(await db.studentReserve.findUniqueOrThrow({ where: { id: cho.id } })).toMatchObject({ status: "CANCELLED", isActive: false });
    expect((await db.studentReserveEvent.findMany({ where: { reserveId: dang.id } })).map((e) => e.kind)).toEqual(["TERMINATE"]);
    expect((await db.studentReserveEvent.findMany({ where: { reserveId: cho.id } })).map((e) => e.kind)).toEqual(["CANCEL"]);
    expect(await db.studentReserve.count({ where: { studentId: HV, status: { in: ["PENDING", "APPROVED", "ACTIVE", "OVERDUE", "NOTICE_SENT", "RESUME_PENDING"] } } })).toBe(0);
    expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("INACTIVE");
  });
});
