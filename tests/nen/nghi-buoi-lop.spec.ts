/**
 * "NGHỈ & LÙI LỊCH" CỦA RIÊNG MỘT LỚP — tầng DB thật (`nghiBuoiLop`).
 *
 * Chủ dự án 27/09/2026:
 *   · ngày NGHỈ (`Holiday`) là ngày CẢ TRUNG TÂM nghỉ — chấm công đọc nó; ngày sự kiện thì
 *     trung tâm vẫn làm, chỉ vài lớp nghỉ ⇒ thao tác theo TỪNG LỚP, không đụng Holiday;
 *   · áp được cả buổi ĐÃ QUA, và khi buổi sau đã được điểm danh thì "lùi TÊN BÀI": ngày +
 *     điểm danh giữ nguyên, nội dung bài dịch lùi một buổi, cuối khoá thêm một buổi.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { nghiBuoiLop, LoiNghiBuoi } from "../../lib/classes/lui-lich";
import { vnDateAt, vnYmd } from "../../lib/time/vn";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const RUN = RUN_DB_TESTS;
const db = new PrismaClient();
const P = "NBL_";
const NGUOI = { id: null, name: "Người test" };
/** 17:30 giờ VN. `nam` + tháng 1-12. 05/05/2099 và 05/05/2020 đều là THỨ BA. */
const luc = (nam: number, thang: number, ngay: number) => vnDateAt(nam, thang - 1, ngay, 17, 30);

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

/** Hai lớp T3/T5 CÙNG cơ sở, mỗi lớp 5 buổi 05 · 07 · 12 · 14 · 19/05 của năm `nam`. */
async function dung(nam: number, hoanTatLopA: number[] = []) {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const center = await db.center.create({
    data: { name: `${P}CS`, slug: `${P.toLowerCase()}cs-${tag}`, address: "x" },
  });
  const course = await db.course.create({ data: { name: `${P}K`, slug: `${P.toLowerCase()}k-${tag}` } });
  const ngay = [5, 7, 12, 14, 19].map((d) => luc(nam, 5, d));
  const taoLop = async (ten: string, hoanTat: number[]) => {
    const cls = await db.class.create({
      data: { name: `${P}${ten}`, courseId: course.id, centerId: center.id, endDate: luc(nam, 5, 19) },
    });
    const buoi = [];
    for (const [i, d] of ngay.entries()) {
      buoi.push(
        await db.classSession.create({
          data: {
            classId: cls.id,
            centerId: center.id,
            date: d,
            topic: `Bài ${i + 1}`,
            lessonNotes: `ghi chú bài ${i + 1}`,
            ...(hoanTat.includes(i) ? { status: "COMPLETED" as const } : {}),
          },
        }),
      );
    }
    return { cls, buoi };
  };
  return { center, a: await taoLop("A", hoanTatLopA), b: await taoLop("B", []) };
}

async function lich(classId: string) {
  return db.classSession.findMany({
    where: { classId },
    orderBy: { date: "asc" },
    select: { id: true, topic: true, lessonNotes: true, date: true, status: true, centerId: true, lessonId: true },
  });
}

describe.skipIf(!RUN)("nghiBuoiLop — nghỉ một buổi của RIÊNG một lớp (DB thật)", () => {
  beforeEach(don, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[NBL-01] buổi TƯƠNG LAI: nghỉ 07/05 ⇒ 07/05 'Đã huỷ', bài lùi một buổi, buổi mới 21/05; lớp B giữ nguyên", async () => {
    const x = await dung(2099);
    const kq = await nghiBuoiLop({ sessionId: x.a.buoi[1]!.id, actor: NGUOI, lyDo: "Trung tâm tổ chức sự kiện" });
    expect(kq.doiNoiDung).toBe(3);

    const a = await lich(x.a.cls.id);
    expect(a.map((s) => [vnYmd(s.date), s.status, s.topic])).toEqual([
      ["2099-05-05", "SCHEDULED", "Bài 1"],
      ["2099-05-07", "CANCELLED", "Lớp nghỉ — Trung tâm tổ chức sự kiện"],
      ["2099-05-12", "SCHEDULED", "Bài 2"],
      ["2099-05-14", "SCHEDULED", "Bài 3"],
      ["2099-05-19", "SCHEDULED", "Bài 4"],
      ["2099-05-21", "SCHEDULED", "Bài 5"],
    ]);
    // Đủ bộ nội dung đi theo, không chỉ tên.
    expect(a[2]!.lessonNotes).toBe("ghi chú bài 2");
    expect(a[1]!.lessonNotes).toBeNull();
    // SCOPED_MODELS — buổi mới thiếu centerId là vô hình với người cấp cơ sở.
    expect(a[5]!.centerId).toBe(x.center.id);
    expect(vnYmd((await db.class.findUniqueOrThrow({ where: { id: x.a.cls.id } })).endDate!)).toBe("2099-05-21");

    // Lớp B cùng cơ sở, cùng ngày — KHÔNG ĐỤNG.
    const b = await lich(x.b.cls.id);
    expect(b.map((s) => [vnYmd(s.date), s.status, s.topic])).toEqual([
      ["2099-05-05", "SCHEDULED", "Bài 1"],
      ["2099-05-07", "SCHEDULED", "Bài 2"],
      ["2099-05-12", "SCHEDULED", "Bài 3"],
      ["2099-05-14", "SCHEDULED", "Bài 4"],
      ["2099-05-19", "SCHEDULED", "Bài 5"],
    ]);
  }, 60_000);

  it("[NBL-02] buổi ĐÃ QUA, buổi sau ĐÃ HOÀN TẤT ⇒ giữ ngày + trạng thái của nó, chỉ tên bài lùi", async () => {
    const x = await dung(2020, [2, 3]); // 12/05 + 14/05 đã dạy xong (có dữ liệu)
    const idBuoi12 = x.a.buoi[2]!.id;
    await nghiBuoiLop({ sessionId: x.a.buoi[1]!.id, actor: NGUOI, lyDo: "Sự kiện hôm 07/05" });

    const a = await lich(x.a.cls.id);
    expect(a.map((s) => [vnYmd(s.date), s.status, s.topic])).toEqual([
      ["2020-05-05", "SCHEDULED", "Bài 1"],
      ["2020-05-07", "CANCELLED", "Lớp nghỉ — Sự kiện hôm 07/05"],
      ["2020-05-12", "COMPLETED", "Bài 2"],
      ["2020-05-14", "COMPLETED", "Bài 3"],
      ["2020-05-19", "SCHEDULED", "Bài 4"],
      ["2020-05-21", "SCHEDULED", "Bài 5"],
    ]);
    // Buổi đã dạy 12/05 vẫn là ĐÚNG bản ghi đó (điểm danh/nhận xét gắn theo id đi cùng).
    expect(a[2]!.id).toBe(idBuoi12);
  }, 60_000);

  it("[NBL-03] buổi nghỉ ĐÃ CÓ DỮ LIỆU ⇒ từ chối, không đổi gì", async () => {
    const x = await dung(2020, [1]);
    const truoc = await lich(x.a.cls.id);
    await expect(
      nghiBuoiLop({ sessionId: x.a.buoi[1]!.id, actor: NGUOI, lyDo: "Nghỉ nhầm" }),
    ).rejects.toBeInstanceOf(LoiNghiBuoi);
    expect(await lich(x.a.cls.id)).toEqual(truoc);
  }, 60_000);

  it("[NBL-04] KHÔNG tạo Holiday — ngày nghỉ của lớp không chạm tới chấm công trung tâm", async () => {
    const x = await dung(2099);
    const truoc = await db.holiday.count();
    await nghiBuoiLop({ sessionId: x.a.buoi[1]!.id, actor: NGUOI, lyDo: "Sự kiện" });
    expect(await db.holiday.count()).toBe(truoc);
  }, 60_000);
});
