import "server-only";
// lib/entitlements/bai-ke-tiep-db.ts — "BÀI KẾ TIẾP CỦA LỚP" ĐỌC TỪ DB. MỘT câu: buổi + plan + lesson của lớp. Dùng chung hàm thuần.
//
// Cùng câu hỏi với `lib/bao-luu/phuc-hoc-db.ts: layUngVienLop` (cột `baiHienTai`) — hai nơi hỏi cùng một câu thì phải ra CÙNG
// một số. Điều kiện đọc GIỐNG hệt: buổi không `CANCELLED`, `date ≥ vnStartOfDay(now)`, sớm nhất, `plan.order`/`lesson.order` qua
// `soBuoiTheoLoTrinh`. Phép chọn "buổi sớm nhất" và "buổi chưa ghim ⇒ null" là của `baiKeTiepCuaLop` (thuần, đã có test); ở đây CHỈ
// nạp dữ liệu.
//
// Chỗ DUY NHẤT hai bản có thể lệch về lý thuyết: nhiều buổi CÙNG THỜI ĐIỂM (bản bảo lưu `take: 1` lấy tuỳ ý, còn `baiKeTiepCuaLop` lấy bài nhỏ nhất).
// Trên dữ liệu thật điều đó KHÔNG xảy ra được: `ClassSession` có ràng buộc duy nhất [classId, date] — `[XL-DB-21]` ghim chuyện đó. Test đối chiếu
// hai nguồn trên cùng fixture: `[XL-DB-20]`. KHÔNG sửa `layUngVienLop` ở PR này (chỉ `export` để test đối chiếu gọi được).
//
// `client` nhận `db` hoặc `tx` (đọc trong giao dịch của người gọi). `now` BẮT BUỘC (luật 19).
import type { Prisma } from "@prisma/client";
import type { db } from "@/lib/db";
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { vnStartOfDay } from "@/lib/time/vn";
import { baiKeTiepCuaLop, type BuoiCuaLop } from "./bai-ke-tiep";

type Client = Prisma.TransactionClient | typeof db;

/** Buổi CHƯA huỷ từ đầu ngày VN của `now` trở đi, kèm `plan.order` / `lesson.order`. Một câu. */
export async function docBuoiConLaiCuaLop(client: Client, classId: string, now: Date): Promise<BuoiCuaLop[]> {
  const rows = await client.classSession.findMany({
    where: { classId, status: { not: "CANCELLED" }, date: { gte: vnStartOfDay(now) } },
    orderBy: { date: "asc" },
    select: { date: true, status: true, plan: { select: { order: true } }, lesson: { select: { order: true } } },
  });
  return rows.map((b) => ({ date: b.date, status: b.status, planOrder: b.plan?.order ?? null, lessonOrder: b.lesson?.order ?? null }));
}

/** Bài kế tiếp (1-based) của lớp, hoặc `null` nếu lớp hết buổi / buổi sớm nhất chưa ghim giáo trình — `null` = KHÔNG suy được, đừng đoán. */
export async function docBaiKeTiepCuaLop(client: Client, classId: string, now: Date): Promise<number | null> {
  return baiKeTiepCuaLop(await docBuoiConLaiCuaLop(client, classId, now), now);
}

/**
 * Bài k → id buổi ĐÃ DẠY của lớp mang bài k (buổi chưa huỷ, `date < vnStartOfDay(now)` — phần bù của `docBuoiConLaiCuaLop`), cho các bài
 * `bai`. Nhiều buổi cùng mang một bài (dời lịch, dạy lại) ⇒ lấy buổi SỚM NHẤT (rồi theo id) để kết quả không phụ thuộc thứ tự đọc.
 * Bài không có buổi nào KHÔNG có trong Map — người gọi phải coi đó là "chưa gắn được" (treo review), không đoán buổi khác.
 */
export async function docBuoiDaDayTheoBai(client: Client, classId: string, now: Date, bai: readonly number[]): Promise<Map<number, string>> {
  const can = new Set(bai);
  const ra = new Map<number, string>();
  if (can.size === 0) return ra;
  const rows = await client.classSession.findMany({
    where: { classId, status: { not: "CANCELLED" }, date: { lt: vnStartOfDay(now) } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { id: true, plan: { select: { order: true } }, lesson: { select: { order: true } } },
  });
  for (const b of rows) {
    const k = soBuoiTheoLoTrinh({ planOrder: b.plan?.order ?? null, lessonOrder: b.lesson?.order ?? null });
    if (k !== null && can.has(k) && !ra.has(k)) ra.set(k, b.id);
  }
  return ra;
}
