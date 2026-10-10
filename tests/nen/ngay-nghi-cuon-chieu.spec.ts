/**
 * NGÀY NGHỈ ⇒ DỜI CẢ DÃY BUỔI LÙI MỘT NHỊP — tầng DB thật (Postgres LOCAL).
 *
 * Hàm cuốn chiếu thuần có test riêng (`lib/holidays/cuon-chieu.test.ts`). Bộ này canh phần
 * DÂY NỐI mà test thuần không chạm: `applyHolidayShift` phải (1) đọc đúng buổi đã KHOÁ từ DB
 * (`findLockedSessions`), (2) ghi mọi ngày mới trong MỘT giao dịch, (3) nới `Class.endDate`,
 * (4) để lại nhật ký lớp. Yêu cầu chủ dự án 27/09/2026.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; chỉ dọn dữ liệu mang tiền tố riêng.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { applyHolidayShift } from "../../lib/holidays/apply";
import { vnDateAt, vnYmd } from "../../lib/time/vn";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const RUN = RUN_DB_TESTS;
const db = new PrismaClient();
const P = "NNCC_";

/** Ngày học trong TƯƠNG LAI xa (hàm chỉ dời buổi từ hôm nay) — 17:30 giờ VN, tháng 1-12. */
const luc = (thang: number, ngay: number) => vnDateAt(2099, thang - 1, ngay, 17, 30);

async function don() {
  const lop = await db.class.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
  const ids = lop.map((l) => l.id);
  if (ids.length) {
    await db.classSession.deleteMany({ where: { classId: { in: ids } } });
    await db.class.deleteMany({ where: { id: { in: ids } } });
  }
  await db.course.deleteMany({ where: { slug: { startsWith: P.toLowerCase() } } });
  await db.center.deleteMany({ where: { slug: { startsWith: P.toLowerCase() } } });
}

/** Lớp T3/T5 với 5 buổi 05/05 · 07/05 · 12/05 · 14/05 · 19/05/2099. */
async function dungLop(buoiKhoa?: number) {
  const center = await db.center.create({
    data: { name: `${P}CS`, slug: `${P.toLowerCase()}cs-${Date.now()}`, address: "x" },
  });
  const course = await db.course.create({
    data: { name: `${P}Khoá`, slug: `${P.toLowerCase()}k-${Date.now()}` },
  });
  const cls = await db.class.create({
    data: { name: `${P}Lớp`, courseId: course.id, centerId: center.id, endDate: luc(5, 19) },
  });
  const ngay = [luc(5, 5), luc(5, 7), luc(5, 12), luc(5, 14), luc(5, 19)];
  const buoi = [];
  for (const [i, d] of ngay.entries()) {
    buoi.push(
      await db.classSession.create({
        data: {
          classId: cls.id,
          date: d,
          topic: `Bài ${i + 1}`,
          ...(buoiKhoa === i ? { status: "COMPLETED" as const } : {}),
        },
      }),
    );
  }
  return { center, cls, buoi };
}

async function ngayTheoBai(classId: string): Promise<Record<string, string>> {
  const rows = await db.classSession.findMany({ where: { classId }, select: { topic: true, date: true } });
  return Object.fromEntries(rows.map((r) => [r.topic!, vnYmd(r.date)]));
}

const NGUOI = { id: "nguoi-test", name: "Người test" };

describe.skipIf(!RUN)("applyHolidayShift — dời cả dãy lùi một nhịp (DB thật)", () => {
  beforeEach(don, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[NNCC-01] nghỉ 07/05 ⇒ Bài 2 sang 12/05, Bài 3 sang 14/05… Bài 5 sang buổi MỚI 21/05; endDate nới", async () => {
    const x = await dungLop();
    const ngayNghi = luc(5, 7);

    const kq = await applyHolidayShift({ date: ngayNghi, endDate: null, centerId: x.center.id }, NGUOI);

    expect(kq).toEqual({ shifted: 4, affectedClasses: 1 });
    expect(await ngayTheoBai(x.cls.id)).toEqual({
      "Bài 1": "2099-05-05",
      "Bài 2": "2099-05-12",
      "Bài 3": "2099-05-14",
      "Bài 4": "2099-05-19",
      "Bài 5": "2099-05-21",
    });
    const lop = await db.class.findUniqueOrThrow({ where: { id: x.cls.id } });
    expect(vnYmd(lop.endDate!)).toBe("2099-05-21");
  }, 60_000);

  it("[NNCC-02] buổi ĐÃ HOÀN TẤT sau ngày nghỉ giữ nguyên ngày — dãy vòng qua nó", async () => {
    const x = await dungLop(2); // Bài 3 (12/05) đã hoàn tất
    await applyHolidayShift({ date: luc(5, 7), endDate: null, centerId: x.center.id }, NGUOI);

    expect(await ngayTheoBai(x.cls.id)).toEqual({
      "Bài 1": "2099-05-05",
      "Bài 2": "2099-05-14",
      "Bài 3": "2099-05-12",
      "Bài 4": "2099-05-19",
      "Bài 5": "2099-05-21",
    });
  }, 60_000);

  it("[NNCC-03] ngày nghỉ của CƠ SỞ KHÁC ⇒ lớp này không bị dời", async () => {
    const x = await dungLop();
    const khac = await db.center.create({
      data: { name: `${P}CS khác`, slug: `${P.toLowerCase()}khac-${Date.now()}`, address: "x" },
    });
    const kq = await applyHolidayShift({ date: luc(5, 7), endDate: null, centerId: khac.id }, NGUOI);
    expect(kq).toEqual({ shifted: 0, affectedClasses: 0 });
    expect((await ngayTheoBai(x.cls.id))["Bài 2"]).toBe("2099-05-07");
  }, 60_000);
});
