// tests/finance/bao-luu-ca-cu.test.ts — [BL7-CCDB] báo cáo ca bảo lưu cũ chưa có hồ sơ, trên POSTGRES THẬT.
// Chạy: pnpm test:finance-db. Đồng hồ đóng băng (luật 19).
import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docCaCuChuaCoHoSo } from "@/lib/bao-luu/ca-cu-db";
import { docKhoaThamChieuBaoLuu } from "@/lib/bao-luu/don-tep-mo-coi";

if (!RUN_DB_TESTS) console.warn(`[BL7-CCDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl7cc-";
const CS = `${T}cs`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const NOW = new Date("2026-10-08T03:00:00Z");

async function don() {
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { startsWith: T } } });
  await db.studentReserve.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.center.deleteMany({ where: { id: CS } });
}

describe.skipIf(!RUN_DB_TESTS)("[BL7-CCDB] docCaCuChuaCoHoSo", () => {
  afterAll(don);

  it("[BL7-CCDB-01] chỉ ghi danh PAUSED KHÔNG được hồ sơ phủ; ngày lấy từ nhật ký (mới nhất), thiếu nhật ký thì lùi updatedAt; hồ sơ đã kết thúc / chưa bắt đầu KHÔNG phủ", async () => {
    await don();
    await db.center.create({ data: { id: CS, name: "CS CC", slug: CS, address: "x" } });
    await db.course.create({ data: { id: KHOA, name: "Sata 3 CC", slug: KHOA, totalSessions: 48 } });
    await db.class.create({ data: { id: LOP, name: "Lớp CC", courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 12 } });
    const mk = async (k: string, status: "PAUSED" | "ACTIVE") => {
      await db.student.create({ data: { id: `${T}hv-${k}`, name: `HV ${k}`, centerId: CS, status: "ACTIVE" } });
      await db.enrollment.create({ data: { id: `${T}gd-${k}`, studentId: `${T}hv-${k}`, classId: LOP, courseId: KHOA, status, centerId: CS } });
    };
    for (const k of ["a", "b", "c", "d", "e"]) await mk(k, "PAUSED");
    await mk("f", "ACTIVE");

    // a: không hồ sơ, có 2 dòng nhật ký (lấy dòng MỚI nhất)
    await db.enrollmentAuditLog.createMany({
      data: [
        { enrollmentId: `${T}gd-a`, fromStatus: "ACTIVE", toStatus: "PAUSED", changedByName: "x", createdAt: new Date("2026-03-01T03:00:00Z") },
        { enrollmentId: `${T}gd-a`, fromStatus: "PAUSED", toStatus: "ACTIVE", changedByName: "x", createdAt: new Date("2026-04-01T03:00:00Z") },
        { enrollmentId: `${T}gd-a`, fromStatus: "ACTIVE", toStatus: "PAUSED", changedByName: "x", createdAt: new Date("2026-05-01T03:00:00Z") },
      ],
    });
    // b: có hồ sơ còn hiệu lực cùng ghi danh ⇒ bị loại
    await db.studentReserve.create({ data: { studentId: `${T}hv-b`, enrollmentId: `${T}gd-b`, reason: "fx", createdByName: "x", centerId: CS, status: "ACTIVE", isActive: true } });
    // c: hồ sơ dòng cũ (enrollmentId NULL) của cùng học viên còn hiệu lực ⇒ bị loại
    await db.studentReserve.create({ data: { studentId: `${T}hv-c`, enrollmentId: null, reason: "fx", createdByName: "x", centerId: CS, status: "ACTIVE", isActive: true } });
    // d: hồ sơ ĐÃ KẾT THÚC ⇒ không phủ ⇒ vẫn là ca cũ, không nhật ký
    await db.studentReserve.create({
      data: { studentId: `${T}hv-d`, enrollmentId: `${T}gd-d`, reason: "fx", createdByName: "x", centerId: CS, status: "ENDED", isActive: false, endedAt: new Date("2026-06-01T03:00:00Z") },
    });
    // e: hồ sơ APPROVED (chưa tới ngày bắt đầu: isActive=false, endedAt=NULL) ⇒ CHƯA phủ — bé vẫn đang PAUSED theo đường cũ
    await db.studentReserve.create({ data: { studentId: `${T}hv-e`, enrollmentId: `${T}gd-e`, reason: "fx", createdByName: "x", centerId: CS, status: "APPROVED", isActive: false } });

    const r = (await docCaCuChuaCoHoSo(db, { maxMonths: 6, now: NOW })).filter((x) => x.enrollmentId.startsWith(T));
    expect(r.map((x) => x.enrollmentId).sort()).toEqual([`${T}gd-a`, `${T}gd-d`, `${T}gd-e`]);
    const a = r.find((x) => x.enrollmentId === `${T}gd-a`)!;
    expect(a).toMatchObject({ nguonNgay: "NHAT_KY", centerId: CS, tenKhoa: "Sata 3 CC" });
    expect(a.tuNgay.toISOString()).toBe("2026-05-01T03:00:00.000Z");
    expect(r.find((x) => x.enrollmentId === `${T}gd-d`)).toMatchObject({ nguonNgay: "CAP_NHAT" });
    expect(r.find((x) => x.enrollmentId === `${T}gd-e`)).toMatchObject({ nguonNgay: "CAP_NHAT" });
  });

  it("[BL7-CCDB-02] báo cáo KHÔNG ghi gì: số dòng ghi danh/hồ sơ/nhật ký trước = sau", async () => {
    const dem = async () => [await db.enrollment.count(), await db.studentReserve.count(), await db.enrollmentAuditLog.count()];
    const truoc = await dem();
    await docCaCuChuaCoHoSo(db, { maxMonths: 6, now: NOW });
    expect(await dem()).toEqual(truoc);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL7-TMCDB] tập khoá đang được tham chiếu (cron tệp mồ côi)", () => {
  afterAll(don);

  it("[BL7-TMCDB-01] gồm đơn + minh chứng của hồ sơ MỌI trạng thái (kể cả REJECTED/CANCELLED); không có khoá rỗng; hồ sơ không tệp không đóng góp gì", async () => {
    await don();
    await db.center.create({ data: { id: CS, name: "CS CC", slug: CS, address: "x" } });
    await db.course.create({ data: { id: KHOA, name: "Sata 3 CC", slug: KHOA, totalSessions: 48 } });
    await db.class.create({ data: { id: LOP, name: "Lớp CC", courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 12 } });
    const K = (n: string) => `bao-luu/2026-09/${n.padStart(8, "a")}.pdf`;
    const ca: [string, "ACTIVE" | "REJECTED" | "CANCELLED" | "PENDING", string | null, string[]][] = [
      ["a", "ACTIVE", K("1"), [K("2")]],
      ["b", "REJECTED", K("3"), []],
      ["c", "CANCELLED", null, [K("4"), K("5")]],
      ["d", "PENDING", null, []],
    ];
    for (const [k, status, don_, mc] of ca) {
      await db.student.create({ data: { id: `${T}hv-${k}`, name: `HV ${k}`, centerId: CS, status: "ACTIVE" } });
      await db.studentReserve.create({
        data: { studentId: `${T}hv-${k}`, reason: "fx", createdByName: "x", centerId: CS, status, isActive: status === "ACTIVE", applicationFileKey: don_, evidenceFileKeys: mc },
      });
    }
    const tap = await docKhoaThamChieuBaoLuu();
    for (const k of ["1", "2", "3", "4", "5"]) expect(tap.has(K(k)), k).toBe(true);
    expect(tap.has("")).toBe(false);
  });
});
