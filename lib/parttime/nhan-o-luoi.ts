// lib/parttime/nhan-o-luoi.ts — CHỮ của một ô lưới phân công GV ở ba nơi đọc (ô, nhãn trình đọc màn hình, tầng "Kế hoạch" trong ngăn chi tiết).
// THUẦN. QA cuối 25/10/2026: ô in "D+T?" nhưng ngăn chi tiết ghi "Kế hoạch D" và aria-label của nút ô chỉ đọc "D" — ba chỗ nói ba điều về
// CÙNG một ô (luật 12). Một hàm, ba nơi gọi. Và hộp cảnh báo của ngăn không nhắc lại CAN_QUYET_TRUC khi khối "Cần quyết định trực" đã ở ngay trên.
import type { OLuoi } from "./luoi-tuan-ghep";

type O = Pick<OLuoi, "ke" | "canhBao">;

/** Ca có trực + buổi học bù chưa ai quyết GV còn trực phần còn lại không. */
export const choQuyetTruc = (o: Pick<OLuoi, "canhBao">): boolean => o.canhBao.includes("CAN_QUYET_TRUC");

/** Mã kế hoạch đúng như ô in: "D+T?" khi chờ quyết trực; "—" khi ngày cũ (không có mã dự kiến). */
export function maKeHoach(o: O): string {
  if (!o.ke) return "—";
  return `${o.ke.ma ?? "?"}${choQuyetTruc(o) ? "+T?" : ""}${o.ke.coTrial ? " +TR" : ""}`;
}

/** Nhãn cho trình đọc màn hình — nói bằng CHỮ phần mà ô chỉ biểu thị bằng dấu "+T?". */
export function nhanTruyCap(o: O): string {
  if (!o.ke) return "ngày cũ";
  return `${o.ke.ma ?? "?"}${o.ke.coTrial ? " có Trial" : ""}${choQuyetTruc(o) ? " · chờ quyết định trực" : ""}`;
}

/** Cảnh báo in trong hộp của ngăn chi tiết: bỏ CAN_QUYET_TRUC khi người xem đang thấy khối quyết định (đã nói đúng câu đó, kèm nút). */
export function canhBaoTrongNgan<T extends string>(canhBao: readonly T[], dangHienKhoiQuyet: boolean): T[] {
  return canhBao.filter((c) => !(dangHienKhoiQuyet && c === "CAN_QUYET_TRUC"));
}
