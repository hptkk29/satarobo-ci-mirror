/**
 * THÔNG BÁO CHO GIÁO VIÊN CỦA CA DẠY BÙ — tầng DB thật (`baoGvCaBu`).
 *
 * Chủ dự án 07/10/2026: "thiếu thông báo lịch dạy bù cho giáo viên". Test thuần
 * (lib/hoc-bu/bao-gv.test.ts) khoá câu chữ + luật "không báo chính mình" + dây nối trong
 * case-db.ts; ở đây khoá phần chúng KHÔNG chạm: đọc ca thật (tên khoá, phòng, số học viên),
 * ghi `StaffNotification` cho đúng người, và hàm KHÔNG BAO GIỜ ném (ca bù vẫn phải được tạo
 * dù chuông hỏng).
 *
 * Dữ liệu ngày TUYỆT ĐỐI (luật 19) và mang tiền tố `BGV_` để dọn đúng phần của mình.
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { baoGvCaBu } from "../../lib/hoc-bu/bao-gv-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const RUN = RUN_DB_TESTS;
const db = new PrismaClient();
const P = "BGV_";

async function don() {
  const gv = await db.user.findMany({ where: { email: { startsWith: P.toLowerCase() } }, select: { id: true } });
  const ids = gv.map((u) => u.id);
  if (ids.length) {
    await db.webPushOutbox.deleteMany({ where: { userId: { in: ids } } });
    await db.staffNotification.deleteMany({ where: { userId: { in: ids } } });
    await db.makeupCaseStudent.deleteMany({ where: { case: { teacherId: { in: ids } } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  await db.course.deleteMany({ where: { slug: { startsWith: P.toLowerCase() } } });
  await db.center.deleteMany({ where: { slug: { startsWith: P.toLowerCase() } } });
}

async function dung() {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const center = await db.center.create({ data: { name: `${P}CS`, slug: `${P.toLowerCase()}cs-${tag}`, address: "x" } });
  const course = await db.course.create({ data: { name: `${P}Sata 3`, slug: `${P.toLowerCase()}k-${tag}` } });
  const room = await db.room.create({ data: { name: `${P}Phòng`, code: "CS2-301", centerId: center.id } });
  const gv = await db.user.create({ data: { email: `${P.toLowerCase()}gv-${tag}@x.test`, name: "GV", role: "TEACHER" } });
  const ql = await db.user.create({ data: { email: `${P.toLowerCase()}ql-${tag}@x.test`, name: "QL", role: "CENTER_MANAGER" } });
  const c = await db.makeupCase.create({
    data: {
      centerId: center.id,
      courseId: course.id,
      lessonId: "bai-bat-ky",
      date: new Date(Date.UTC(2099, 4, 7)), // 07/05/2099 — THỨ NĂM
      startTime: "18:00",
      endTime: "19:30",
      roomId: room.id,
      teacherId: gv.id,
      createdById: ql.id,
    },
  });
  return { gv, ql, c };
}

describe.skipIf(!RUN)("baoGvCaBu — báo giáo viên của ca dạy bù (DB thật)", () => {
  beforeEach(don, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[BGV-DB-01] người khác tạo ca ⇒ GV nhận ĐÚNG MỘT thông báo, câu chữ đọc từ ca thật", async () => {
    const { gv, ql, c } = await dung();
    await baoGvCaBu("ca-moi", c.id, ql.id);
    const tb = await db.staffNotification.findMany({ where: { userId: gv.id } });
    expect(tb).toHaveLength(1);
    expect(tb[0]!.dedupeKey).toBe(`hoc-bu.ca-moi:${c.id}`);
    expect(tb[0]!.title).toBe("Bạn có ca dạy bù mới");
    expect(tb[0]!.body).toBe("T5 07/05/2099 18:00–19:30 · BGV_Sata 3 · phòng CS2-301 · 0 học viên.");
    expect(tb[0]!.href).toBe(`/hoc-bu/case/${c.id}`);
    // Đối chứng: người bấm KHÔNG nhận gì.
    expect(await db.staffNotification.count({ where: { userId: ql.id } })).toBe(0);
  });

  it("[BGV-DB-02] GV tự tạo ca của mình ⇒ không có thông báo nào", async () => {
    const { gv, c } = await dung();
    await baoGvCaBu("ca-moi", c.id, gv.id);
    expect(await db.staffNotification.count({ where: { userId: gv.id } })).toBe(0);
  });

  it("[BGV-DB-03] gọi lại cùng ca ⇒ không nhân đôi (khoá chống trùng)", async () => {
    const { gv, ql, c } = await dung();
    await baoGvCaBu("ca-moi", c.id, ql.id);
    await baoGvCaBu("ca-moi", c.id, ql.id);
    expect(await db.staffNotification.count({ where: { userId: gv.id } })).toBe(1);
  });

  it("[BGV-DB-04] ca không tồn tại ⇒ KHÔNG ném (thao tác chính không được hỏng vì cái chuông)", async () => {
    await expect(baoGvCaBu("huy", "khong-co-ca-nay", "ai-do")).resolves.toBeUndefined();
  });
});
