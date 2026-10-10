// tests/finance/bao-luu-backfill.test.ts — [BL2-BF] backfill của migration nền bảo lưu KHÔNG được biến dòng cũ thành "hồ sơ đời mới". POSTGRES THẬT.
//
// Sự cố bắt được 08/10/2026 (trước khi migration chạy ở đâu ngoài máy dev): bản đầu backfill `approvedAt = startedAt` cho MỌI dòng cũ. Mà
// `approvedAt IS NOT NULL` chính là dấu "hồ sơ đời mới" mà roster / cron / cổng phụ huynh khoá vào, và đường cũ `reserveStudentAction` CÓ ghi
// `enrollmentId` ⇒ vừa migrate xong, các bé đang bảo lưu theo đường cũ rời lớp / nhóm chat / bị cron xử lý BẤT KỂ cờ `pause.enabled` đang TẮT.
// Ca này chạy ĐÚNG đoạn backfill trong tệp migration (không chép lại) trên một dòng mang hình dạng dữ liệu cũ.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { ghiDanhDangBaoLuuTai, trongLop } from "@/lib/bao-luu/roster";

if (!RUN_DB_TESTS) console.warn(`[BL2-BF] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = new Date("2026-10-08T03:00:00Z");
const T = "fx-bl2bf-";
const CS = `${T}cs`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;

/** Đoạn backfill của tệp migration: từ dấu "Backfill dòng cũ" tới dấu "Chỉ mục", tách theo câu lệnh, bỏ dòng chú thích. */
function cauBackfill(): string[] {
  const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261008150000_bao_luu_nen_du_lieu/migration.sql"), "utf8");
  const a = sql.indexOf("-- ── Backfill dòng cũ");
  const b = sql.indexOf("-- ── Chỉ mục");
  expect(a, "mất dấu đầu đoạn backfill").toBeGreaterThan(0);
  expect(b, "mất dấu cuối đoạn backfill").toBeGreaterThan(a);
  return sql
    .slice(a, b)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function don() {
  await db.studentReserve.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.center.deleteMany({ where: { id: CS } });
}

/** Mỗi ca tự dựng nền của mình (luật 18: chạy MỘT MÌNH vẫn xanh). */
async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "CS BF", slug: CS, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 3 BF", slug: KHOA, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp BF", courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 12 } });
  for (const k of ["", "2"]) {
    await db.student.create({ data: { id: `${T}hv${k}`, name: `HV BF${k}`, centerId: CS, status: "PAUSED" } });
    await db.enrollment.create({ data: { id: `${T}gd${k}`, studentId: `${T}hv${k}`, classId: LOP, courseId: KHOA, status: "PAUSED", centerId: CS } });
  }
}

describe.skipIf(!RUN_DB_TESTS)("[BL2-BF] backfill dòng cũ", () => {
  afterAll(don);

  it("[BL2-BF-01] dòng cũ THEO GHI DANH (đường cũ có ghi enrollmentId) sau backfill: approvedAt VẪN NULL (dấu 'hồ sơ đời mới' roster/cron/cổng PH khoá vào; ca roster ở `[BL4-BF]`); requestedAt/standardEndDate được điền", async () => {
    await dung();
    // Hình dạng dữ liệu CŨ: không requestedAt/approvedAt, type mặc định PARENT, có enrollmentId, đang hiệu lực, có ngày kết thúc dự kiến.
    const cu = await db.studentReserve.create({
      data: {
        studentId: `${T}hv`, enrollmentId: `${T}gd`, reason: "đường cũ", createdByName: "x", isActive: true,
        startedAt: new Date("2026-08-01T03:00:00Z"), expectedEndAt: new Date("2027-01-01T03:00:00Z"),
      },
    });
    expect(cu.approvedAt).toBeNull();

    for (const cau of cauBackfill()) await db.$executeRawUnsafe(cau);

    const sau = await db.studentReserve.findUniqueOrThrow({ where: { id: cu.id } });
    expect(sau.approvedAt).toBeNull();
    expect(sau.requestedAt).not.toBeNull();
    expect(sau.standardEndDate?.toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });

  it("[BL2-BF-02] chạy lại backfill lần hai KHÔNG đổi gì (idempotent) và không đụng hồ sơ ĐỜI MỚI đã duyệt", async () => {
    await dung();
    const moi = await db.studentReserve.create({
      data: {
        studentId: `${T}hv`, reason: "đời mới", createdByName: "x", isActive: true, status: "ACTIVE", type: "PARENT",
        requestedAt: new Date("2026-09-01T03:00:00Z"), approvedAt: new Date("2026-09-02T03:00:00Z"), startedAt: new Date("2026-09-02T03:00:00Z"),
        standardEndDate: new Date("2027-03-02T03:00:00Z"),
      },
    });
    for (const cau of cauBackfill()) await db.$executeRawUnsafe(cau);
    const sau = await db.studentReserve.findUniqueOrThrow({ where: { id: moi.id } });
    expect(sau.approvedAt?.toISOString()).toBe("2026-09-02T03:00:00.000Z");
    expect(sau.standardEndDate?.toISOString()).toBe("2027-03-02T03:00:00.000Z");
    expect(sau.type).toBe("PARENT");
  });

  it("[BL4-BF] hệ quả cho roster: sau backfill, bé có dòng cũ THEO GHI DANH vẫn nằm trong `trongLop` (không bị rút khỏi lớp); hồ sơ đời mới đã duyệt thì bị rút", async () => {
    await dung();
    await db.studentReserve.create({
      data: {
        studentId: `${T}hv`, enrollmentId: `${T}gd`, reason: "đường cũ", createdByName: "x", isActive: true,
        startedAt: new Date("2026-08-01T03:00:00Z"), expectedEndAt: new Date("2027-01-01T03:00:00Z"),
      },
    });
    await db.studentReserve.create({
      data: {
        studentId: `${T}hv2`, enrollmentId: `${T}gd2`, reason: "đời mới", createdByName: "x", isActive: true, status: "ACTIVE", type: "PARENT",
        requestedAt: new Date("2026-09-01T03:00:00Z"), approvedAt: new Date("2026-09-02T03:00:00Z"), startedAt: new Date("2026-09-02T03:00:00Z"),
      },
    });
    for (const cau of cauBackfill()) await db.$executeRawUnsafe(cau);
    const trongLopIds = (await db.enrollment.findMany({ where: trongLop({ classId: LOP }, NOW), select: { id: true } })).map((e) => e.id);
    expect(trongLopIds).toContain(`${T}gd`); // dòng cũ: giữ nguyên như hôm nay
    expect(trongLopIds).not.toContain(`${T}gd2`); // đối chứng dương: hồ sơ đời mới đã duyệt thì rời lớp
    expect(await db.enrollment.count({ where: { id: `${T}gd`, ...ghiDanhDangBaoLuuTai(NOW) } })).toBe(0);
    expect(await db.enrollment.count({ where: { id: `${T}gd2`, ...ghiDanhDangBaoLuuTai(NOW) } })).toBe(1);
  });
});
