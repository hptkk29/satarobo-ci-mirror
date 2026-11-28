// lib/cham-cong/holidays.ts — đọc NGÀY LỄ phủ một khoảng, cho đúng một cơ sở.
//
// ⚠️ VÌ SAO PHẢI CÓ FILE NÀY, VÀ VÌ SAO NÓ DÙNG `db` TRẦN
//
// `Holiday` nằm trong `SCOPED_MODELS` nhưng KHÔNG nằm trong `NULL_IS_GLOBAL_MODELS`
// (`lib/db-scope.ts`). Nên `scopedDb` thêm `centerId IN [...]` trần và CẮT SẠCH dòng
// `centerId = null` — tức mọi ngày lễ TOÀN HỆ THỐNG (Tết, 30/4, 2/9) tàng hình với người cấp
// cơ sở. Hậu quả nặng nhất: lưới phân ca không tô ngày lễ ⇒ Quản lý cơ sở xếp ca đè lên Tết.
//
// KHÔNG vá bằng cách thêm `Holiday` vào `NULL_IS_GLOBAL_MODELS`. `passesScope` trả thẳng
// `NULL_IS_GLOBAL_MODELS.has(model)` khi `centerId == null`, và BA CỔNG GHI của `/admin/holidays`
// dựa đúng vào đó (`holidays/_actions.ts` — tạo/sửa/xoá). Đổi một dòng danh sách là Quản lý CS1
// XOÁ ĐƯỢC NGÀY TẾT CỦA TOÀN CÔNG TY. `lib/db-scope-function.test.ts` đang cố ý khoá chiều đó.
//
// Cách đúng — và là cách ba đường tính công đã dùng sẵn (`period.ts`, `recompute.ts`,
// `brief-db.ts`): đọc bằng `db` trần rồi TỰ viết điều kiện `centerId IS NULL OR = <cơ sở>`.
// Gom về một chỗ vì `app/(admin)/**` bị ESLint cấm import `@/lib/db` trần.
//
// Vì sao đọc bằng `db` trần ở đây KHÔNG phải lỗ quyền: ngày lễ không phải dữ liệu riêng tư của
// cơ sở nào — nó là lịch chung của công ty, ai cũng cần thấy để không xếp ca vào. Điều kiện
// `centerId` bên dưới vẫn chặn: cơ sở này không thấy ngày nghỉ riêng của cơ sở kia.
import type { HolidayType } from "@prisma/client";
import { db } from "@/lib/db";

export type HolidayRange = { date: Date; endDate: Date | null };

/**
 * Ngày lễ phủ khoảng `[from, to]` — gồm lễ toàn hệ thống và lễ riêng của `centerId`.
 *
 * `centerId` là chuỗi khối của module (centerId thật, hoặc `"hoi-so"`). Khối Hội sở không có
 * dòng lễ riêng nên chỉ nhận lễ toàn hệ thống — đúng ý.
 */
export async function loadHolidayRanges(
  centerId: string,
  from: Date,
  to: Date,
): Promise<HolidayRange[]> {
  return db.holiday.findMany({
    where: {
      date: { lte: to },
      OR: [{ endDate: null, date: { gte: from } }, { endDate: { gte: from } }],
      AND: [{ OR: [{ centerId: null }, { centerId }] }],
    },
    select: { date: true, endDate: true },
  });
}

/** Trải các khoảng lễ thành tập "YYYY-MM-DD" để tra nhanh khi vẽ lưới. */
export function holidayYmdSet(rows: readonly HolidayRange[]): Set<string> {
  const out = new Set<string>();
  for (const h of rows) {
    for (let d = new Date(h.date); d <= (h.endDate ?? h.date); d = new Date(d.getTime() + 86_400_000)) {
      out.add(d.toISOString().slice(0, 10));
    }
  }
  return out;
}

/**
 * Ngày lễ TOÀN HỆ THỐNG (`centerId = null`) trong một khoảng, kèm bộ lọc loại.
 *
 * Dùng cho màn danh mục `/admin/holidays` — ngoài module chấm công, nhưng gốc bệnh y hệt: bộ
 * lọc "toàn hệ thống" đặt `centerId = null` rồi `scopedDb` AND thêm `centerId IN [...]` ⇒ LUÔN
 * RỖNG. Vai `CENTER_HR` không bao giờ nhìn thấy ngày lễ quốc gia.
 *
 * CỐ Ý tách thành truy vấn riêng thay vì nới `scopedDb`: dòng lễ RIÊNG của từng cơ sở vẫn đi
 * đường cũ, nên không cơ sở nào thấy ngày nghỉ riêng của cơ sở khác. Chỉ phần dùng chung mới
 * mở ra — và nó vốn là lịch chung của công ty.
 */
export async function loadGlobalHolidays(args: {
  from: Date;
  to: Date;
  type?: HolidayType;
}) {
  return db.holiday.findMany({
    where: {
      centerId: null,
      date: { gte: args.from, lt: args.to },
      ...(args.type ? { type: args.type } : {}),
    },
    orderBy: { date: "asc" },
    include: { center: { select: { id: true, name: true } } },
  });
}
