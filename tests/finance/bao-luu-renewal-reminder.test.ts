// tests/finance/bao-luu-renewal-reminder.test.ts — cron `renewal-reminder` hỏi `dangBaoLuu`, KHÔNG hỏi
// `Student.status` (chốt 08/10/2026, mục C(b)). Postgres thật: `pnpm test:finance-db`.
//
// ⚠️ Cron đọc đồng hồ thật và quét MỌI ghi danh trong cửa sổ nhắc, nên test đo bằng HIỆU của hai lượt chạy
// (trước/sau khi dựng fixture): số `skipped*` của người khác triệt tiêu, chỉ còn phần của fixture.
// Học viên fixture KHÔNG có email ⇒ ca "không bị tha" rơi vào `skippedNoEmail` (nhánh đối chứng dương):
// thiếu nó, một cron chết hẳn cũng làm ca "bị tha vì bảo lưu" xanh vì lý do sai (CLAUDE.md luật 11).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { GET as cronRenewal } from "@/app/api/cron/renewal-reminder/route";

if (!RUN_DB_TESTS) console.warn(`[BL2-RN] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl2rn-";
const SECRET = "bl2-cron-secret-0123456789abcdef0123456789";
const CENTER = `${T}cs`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const BE = ["nghi", "hoc", "mocoi", "hoclai", "nghikhac"].reduce(
  (o, k) => ({ ...o, [k]: { hs: `${T}hs-${k}`, gd: `${T}gd-${k}` } }),
  {} as Record<string, { hs: string; gd: string }>,
);
const TAT_CA = Object.values(BE);
const BAT_DAU = new Date("2019-12-01T00:00:00Z");

async function don() {
  await db.studentReserve.deleteMany({ where: { studentId: { in: TAT_CA.map((b) => b.hs) } } });
  await db.enrollment.deleteMany({ where: { id: { in: TAT_CA.map((b) => b.gd) } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: TAT_CA.map((b) => b.hs) } } });
  await db.center.deleteMany({ where: { id: CENTER } });
}

async function chay(): Promise<Record<string, number>> {
  process.env.CRON_SECRET = SECRET;
  const res = await cronRenewal(
    new NextRequest("http://localhost/api/cron/renewal-reminder", { headers: { authorization: `Bearer ${SECRET}` } }),
  );
  expect(res.status).toBe(200);
  return (await res.json()).stats as Record<string, number>;
}

describe.skipIf(!RUN_DB_TESTS)("[BL2-RN] renewal-reminder × bảo lưu", () => {
  beforeEach(don);
  afterAll(don);

  it("[BL2-RN-01] ghi danh có hồ sơ còn hiệu lực ⇒ bị tha (skippedReserved) KỂ CẢ khi Student.status vẫn ACTIVE; phần còn lại đúng như cũ", async () => {
    const truoc = await chay();

    await db.center.create({ data: { id: CENTER, name: "CS BL2RN", slug: CENTER, address: "x" } });
    await db.course.create({ data: { id: KHOA, name: "Khoá BL2RN", slug: KHOA, totalSessions: 48 } });
    await db.class.create({ data: { id: LOP, name: "Lớp BL2RN", courseId: KHOA } });
    const hanTaiTuc = new Date(Date.now() + 14 * 86_400_000); // giữa cửa sổ 13–15 ngày mặc định
    for (const [k, b] of Object.entries(BE)) {
      await db.student.create({
        data: {
          id: b.hs, name: `Bé ${k}`, centerId: CENTER, parentEmail: null,
          // `mocoi`: Student.status=PAUSED nhưng KHÔNG có hồ sơ nào — đường tắt cũ để lại.
          status: k === "mocoi" ? "PAUSED" : "ACTIVE",
        },
      });
      await db.enrollment.create({
        data: { id: b.gd, studentId: b.hs, classId: LOP, courseId: KHOA, status: "ACTIVE", endDate: hanTaiTuc },
      });
    }
    // nghi: hồ sơ còn hiệu lực phủ ĐÚNG ghi danh. hoclai: hồ sơ đã đóng. nghikhac: hồ sơ cả học viên còn hiệu lực.
    await db.studentReserve.create({ data: { studentId: BE.nghi!.hs, enrollmentId: BE.nghi!.gd, reason: "f", createdByName: "f", startedAt: BAT_DAU, status: "ACTIVE", isActive: true } });
    await db.studentReserve.create({ data: { studentId: BE.hoclai!.hs, enrollmentId: BE.hoclai!.gd, reason: "f", createdByName: "f", startedAt: BAT_DAU, endedAt: new Date("2019-12-20T00:00:00Z"), status: "ENDED", isActive: false } });
    await db.studentReserve.create({ data: { studentId: BE.nghikhac!.hs, enrollmentId: null, reason: "f", createdByName: "f", startedAt: BAT_DAU, status: "ACTIVE", isActive: true, type: "LEGACY" } });

    const sau = await chay();
    const d = (k: string) => (sau[k] ?? 0) - (truoc[k] ?? 0);

    // 2 bị tha: `nghi` (theo ghi danh) + `nghikhac` (cả học viên). Student.status của cả hai vẫn ACTIVE ⇒ mã cũ KHÔNG tha.
    expect(d("skippedReserved"), "chỉ hai ghi danh có hồ sơ còn hiệu lực bị tha").toBe(2);
    // 3 còn lại đi tiếp tới kiểm email (không có) = đối chứng dương: `hoc` (bình thường), `hoclai` (hồ sơ đã đóng),
    // `mocoi` (Student.PAUSED nhưng KHÔNG hồ sơ — nguồn sự thật không nói bảo lưu ⇒ không tha oan).
    expect(d("skippedNoEmail")).toBe(3);
    expect(d("enrollmentsFound")).toBe(5);
  });
});
