/**
 * Trạng thái HIỂN THỊ của một lớp trải nghiệm — chủ dự án 23/09/2026: "khi hết ngày hôm
 * đó thì trạng thái tự đổi thành đã đóng, chưa diễn ra thì để là đang mở".
 *
 * Suy lúc ĐỌC, không có cron nào ghi `status` (luật cứng #8 cùng tinh thần: trạng thái
 * theo thời gian là thuộc tính của resolver). Nên "tự đổi" là đúng nghĩa đen: qua nửa
 * đêm, lần tải trang kế tiếp đã ra "Đã đóng", không chờ job nào.
 *
 * ⚠️ Chỉ lớp THEO KHUNG mới có "ngày của lớp". Lớp cũ (slot dùng lại, trước 22/09) không
 * có ngày để hết ⇒ giữ theo cột `status`: chỉ `COMPLETED` mới là đã đóng.
 *
 * Bộ lọc danh sách (`buildClassListWhere`) mã hoá CÙNG luật bằng Prisma — hai bản phải
 * khớp nhau, ca `[TTL-LOC]` ở `filters.test.ts` canh.
 */
export type TrangThaiLop = "DANG_MO" | "DA_DONG" | "DA_HUY";

export const NHAN_TRANG_THAI_LOP: Record<TrangThaiLop, string> = {
  DANG_MO: "Đang mở",
  DA_DONG: "Đã đóng",
  DA_HUY: "Đã huỷ",
};

export function trangThaiLop(input: {
  status: string;
  theoKhung: boolean;
  /** Ngày lớp theo lịch VN, "YYYY-MM-DD". `null` = lớp cũ không có ngày. */
  ngayLop: string | null;
  /** Hôm nay theo lịch VN, "YYYY-MM-DD" — BẮT BUỘC, không đọc đồng hồ ở đây (luật 19). */
  homNay: string;
}): TrangThaiLop {
  if (input.status === "CANCELLED") return "DA_HUY";
  if (input.status === "COMPLETED") return "DA_DONG";
  // "Hết ngày hôm đó": ngày lớp đã QUA. Trong chính ngày lớp vẫn là "Đang mở" — Sale còn
  // đang điểm danh và hoàn tất case.
  if (input.theoKhung && input.ngayLop && input.ngayLop < input.homNay) return "DA_DONG";
  return "DANG_MO";
}
