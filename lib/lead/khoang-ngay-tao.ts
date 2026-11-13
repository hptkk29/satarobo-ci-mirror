// lib/lead/khoang-ngay-tao.ts — Ô «Từ ngày / Đến ngày» của danh sách lead (13/11/2026). Hai lỗi cũ, cả hai làm lead MỚI biến mất khỏi kết quả:
//
//   1. LỆCH 7 TIẾNG. `new Date("2026-11-13")` là 00:00 UTC = 07:00 VN; `new Date("2026-11-13T23:59:59")` là giờ địa phương của tiến trình (UTC trên VPS) = 06:59 VN hôm sau.
//      Lead tạo 00:00–06:59 sáng của «Từ ngày» bị LOẠI, lead 00:00–06:59 sáng hôm sau «Đến ngày» lại LỌT VÀO. Nay đọc theo NGÀY VN.
//   2. SAI TRƯỜNG. Cột «Ngày nhận lead» in `lastInboundAt` khi khách nhập lại (`laNhapLai`: lastInboundAt > createdAt), còn bộ lọc lọc `createdAt`. Lead cũ vừa điền form hôm nay hiện ngày HÔM NAY
//      trong bảng nhưng lọc «từ hôm nay» thì mất. Nay lọc theo CHÍNH ngày cột đang in: ngày nhận hiệu lực = max(createdAt, lastInboundAt).
//
// max(c, l) ≥ a ⇔ c ≥ a HOẶC l ≥ a;  max(c, l) ≤ b ⇔ c ≤ b VÀ (l rỗng HOẶC l ≤ b) ⇒ viết được bằng Prisma thuần, không cần SQL thô, và vẫn đi qua `scopedDb`.
// Chuỗi sai định dạng ⇒ bỏ qua đầu đó (trước đây `new Date("abc")` ném ở Prisma và làm trắng trang).
import type { Prisma } from "@prisma/client";
import { parseVnYmd, vnEndOfDay } from "@/lib/time/vn";

export function locNgayNhanLead(dateFrom: string | undefined, dateTo: string | undefined): Prisma.LeadWhereInput | undefined {
  const tu = dateFrom ? parseVnYmd(dateFrom) : null;
  const den = dateTo ? parseVnYmd(dateTo) : null;
  if (!tu && !den) return undefined;
  const dieuKien: Prisma.LeadWhereInput[] = [];
  if (tu) dieuKien.push({ OR: [{ createdAt: { gte: tu } }, { lastInboundAt: { gte: tu } }] });
  if (den) {
    const het = vnEndOfDay(den);
    dieuKien.push({ createdAt: { lte: het } }, { OR: [{ lastInboundAt: null }, { lastInboundAt: { lte: het } }] });
  }
  return { AND: dieuKien };
}
