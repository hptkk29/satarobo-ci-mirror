// tests/finance/bao-luu-khoa-cho-phep.test.ts — [BLK] ĐẶT "KHOÁ NÀO ĐƯỢC BẢO LƯU" (Course.allowPause) trên POSTGRES THẬT.
//
// Chạy: pnpm test:finance-db. Anh Toại (Đào tạo, 12/10/2026): không bảo lưu Sata 1 · Sata 2 · Combo · Sata 8, và danh sách phải tự đặt được.
// Lưới này khoá HÀNH VI của phép đặt: ghi đúng cột, audit có giá trị cũ/mới + số hồ sơ bị ảnh hưởng, đặt lại cùng giá trị thì im, đếm tác động đúng khoá.
import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { datChoPhepBaoLuuCuaKhoa, demTacDongTatBaoLuu } from "@/lib/bao-luu/khoa-cho-phep";

if (!RUN_DB_TESTS) console.warn(`[BLK] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-blk-";
const CS = `${T}cs`;
const OU = `${T}ou`;
const K1 = `${T}khoa-1`;
const K2 = `${T}khoa-2`;
const LOP1 = `${T}lop-1`;
const LOP2 = `${T}lop-2`;
const NGUOI = { id: `${T}dt`, name: "Đào tạo fixture" };
const SIEU: Actor = {
  userId: NGUOI.id, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [CS], visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
};
const sdb = () => scopedDb(SIEU);

async function dọn() {
  await db.auditLog.deleteMany({ where: { entityId: { in: [K1, K2] } } });
  await db.studentReserve.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { in: [LOP1, LOP2] } } });
  await db.course.deleteMany({ where: { id: { in: [K1, K2] } } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.orgUnit.deleteMany({ where: { id: OU } });
  await db.center.deleteMany({ where: { id: CS } });
}

/**
 * Khoá 1: 1 hồ sơ PENDING + 1 hồ sơ ACTIVE. Khoá 2 (khoá KHÁC): 1 hồ sơ PENDING — không được lọt vào số đếm của khoá 1.
 */
async function dung() {
  await dọn();
  await db.center.create({ data: { id: CS, name: "CS BLK", slug: CS, address: "x" } });
  await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: `${T}OU`, name: "ĐV BLK", centerId: CS } });
  await db.course.create({ data: { id: K1, name: "Khoá BLK 1", slug: K1, totalSessions: 12 } });
  await db.course.create({ data: { id: K2, name: "Khoá BLK 2", slug: K2, totalSessions: 12 } });
  await db.class.create({ data: { id: LOP1, name: "Lớp BLK 1", courseId: K1, centerId: CS, status: "ACTIVE", maxStudents: 20 } });
  await db.class.create({ data: { id: LOP2, name: "Lớp BLK 2", courseId: K2, centerId: CS, status: "ACTIVE", maxStudents: 20 } });
  const mk = async (k: string, lop: string, khoa: string, status: "PENDING" | "ACTIVE") => {
    await db.student.create({ data: { id: `${T}hv-${k}`, name: `HV ${k}`, centerId: CS, orgUnitId: OU, status: "ACTIVE" } });
    await db.enrollment.create({ data: { id: `${T}gd-${k}`, studentId: `${T}hv-${k}`, classId: lop, courseId: khoa, status: "ACTIVE", centerId: CS } });
    await db.studentReserve.create({
      data: {
        id: `${T}r-${k}`, studentId: `${T}hv-${k}`, enrollmentId: `${T}gd-${k}`, reason: "BLK", createdByName: "x",
        isActive: status === "ACTIVE", startedAt: new Date("2026-10-01T00:00:00Z"), centerId: CS, orgUnitId: OU, type: "PARENT", status,
      },
    });
  };
  await mk("a", LOP1, K1, "PENDING");
  await mk("b", LOP1, K1, "ACTIVE");
  await mk("c", LOP2, K2, "PENDING");
}

const allow = async (id: string) => (await db.course.findUniqueOrThrow({ where: { id }, select: { allowPause: true } })).allowPause;
const nhatKy = (id: string) => db.auditLog.findMany({ where: { entityType: "Course", entityId: id }, orderBy: { createdAt: "asc" } });

describe.skipIf(!RUN_DB_TESTS)("[BLK] Course.allowPause đặt qua hệ thống", () => {
  afterAll(dọn);

  it("[BLK-01] đếm tác động ĐÚNG KHOÁ: khoá 1 = 1 chờ duyệt + 1 đang bảo lưu; hồ sơ của khoá 2 không lọt vào", async () => {
    await dung();
    expect(await demTacDongTatBaoLuu(sdb(), K1)).toEqual({ hoSoChoDuyet: 1, hoSoDangBaoLuu: 1 });
    expect(await demTacDongTatBaoLuu(sdb(), K2)).toEqual({ hoSoChoDuyet: 1, hoSoDangBaoLuu: 0 });
  });

  it("[BLK-02] TẮT: ghi cột, đúng MỘT dòng nhật ký có giá trị cũ/mới + số hồ sơ lúc bấm; khoá khác không đổi", async () => {
    await dung();
    expect(await allow(K1)).toBe(true); // mặc định BẬT hết (Q9)
    const kq = await datChoPhepBaoLuuCuaKhoa({ sdb: sdb(), courseId: K1, choPhep: false, nguoi: NGUOI });
    expect(kq).toEqual({ ok: true, doi: true, tacDong: { hoSoChoDuyet: 1, hoSoDangBaoLuu: 1 } });
    expect(await allow(K1)).toBe(false);
    expect(await allow(K2)).toBe(true);
    const log = await nhatKy(K1);
    expect(log).toHaveLength(1);
    expect(log[0]!.oldValues).toMatchObject({ allowPause: true });
    expect(log[0]!.newValues).toMatchObject({ allowPause: false, hoSoChoDuyet: 1, hoSoDangBaoLuu: 1 });
    expect(await nhatKy(K2)).toHaveLength(0);
  });

  it("[BLK-03] đặt lại ĐÚNG giá trị đang có: không ghi, không nhật ký, báo doi=false", async () => {
    await dung();
    await datChoPhepBaoLuuCuaKhoa({ sdb: sdb(), courseId: K1, choPhep: false, nguoi: NGUOI });
    const kq = await datChoPhepBaoLuuCuaKhoa({ sdb: sdb(), courseId: K1, choPhep: false, nguoi: NGUOI });
    expect(kq).toMatchObject({ ok: true, doi: false });
    expect(await nhatKy(K1)).toHaveLength(1);
  });

  it("[BLK-04] BẬT lại được (đảo chiều), mỗi lần đổi một dòng nhật ký, hồ sơ cũ không bị đụng", async () => {
    await dung();
    await datChoPhepBaoLuuCuaKhoa({ sdb: sdb(), courseId: K1, choPhep: false, nguoi: NGUOI });
    const kq = await datChoPhepBaoLuuCuaKhoa({ sdb: sdb(), courseId: K1, choPhep: true, nguoi: NGUOI });
    expect(kq).toMatchObject({ ok: true, doi: true });
    expect(await allow(K1)).toBe(true);
    expect(await nhatKy(K1)).toHaveLength(2);
    expect(await db.studentReserve.count({ where: { studentId: { startsWith: T } } })).toBe(3);
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id: `${T}r-a` } })).status).toBe("PENDING");
  });

  it("[BLK-05] khoá không tồn tại ⇒ từ chối, không ghi gì", async () => {
    await dung();
    const kq = await datChoPhepBaoLuuCuaKhoa({ sdb: sdb(), courseId: `${T}khong-co`, choPhep: false, nguoi: NGUOI });
    expect(kq.ok).toBe(false);
    expect(await db.auditLog.count({ where: { entityId: `${T}khong-co` } })).toBe(0);
  });
});
