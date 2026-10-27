// lib/phan-cong/giao-go.ts — luật THUẦN của thao tác giao / gỡ trên màn Phân công gộp (GĐ2, docs/phan-cong-gop/KHAO-SAT.md chốt 1, 6).
// Không DB, không đồng hồ: `homNay` luôn truyền vào (luật 7, 19).
//
// Hai câu hỏi, mỗi câu MỘT hàm — action, áp khung (GĐ4) và màn cùng gọi:
//   1. phạm vi này rải ra những ngày nào                → ngayTheoPhamVi
//   2. ngày này còn giao / gỡ được không (và vì sao)      → lyDoKhongGiaoDuoc
//
// "CÁC TUẦN SAU" = cùng thứ, mỗi tuần, từ ngày được chọn tới HẾT THÁNG KẾ TIẾP (QUYET-DINH-DEM G2-3). Có trần để thao tác một lần
// không lặng lẽ rải ra vô hạn — muốn xa hơn thì làm lại ở tháng sau, hoặc dùng Áp khung (GĐ4).

export type PhamVi = "CHI_BUOI_NAY" | "CAC_TUAN_SAU";

const ngayCong = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Ngày cuối của tháng KẾ TIẾP tháng của `ymd` ("2026-11-04" ⇒ "2026-12-31"). */
export function hetThangSau(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  // Ngày 0 của tháng (m + 2) theo đánh số 1-based = ngày cuối tháng (m + 1).
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

/** Các ngày mà thao tác chạm tới, tăng dần. `CHI_BUOI_NAY` ⇒ đúng một ngày. */
export function ngayTheoPhamVi(p: { ngay: string; phamVi: PhamVi }): string[] {
  if (p.phamVi === "CHI_BUOI_NAY") return [p.ngay];
  const den = hetThangSau(p.ngay);
  const ra: string[] = [];
  for (let d = p.ngay; d <= den; d = ngayCong(d, 7)) ra.push(d);
  return ra;
}

/**
 * Ngày này có giao / gỡ được không. `null` = được. Thứ tự: đã qua → kỳ đã chốt.
 * "Đã qua" = trước HÔM NAY (giờ VN). Hôm nay vẫn sửa được — QLCS xếp lại người trong ngày là việc thường.
 */
export function lyDoKhongGiaoDuoc(p: { ngay: string; homNay: string; trangThaiKy: string | null }): string | null {
  if (p.ngay < p.homNay) return `Ngày ${p.ngay} đã qua — sửa buổi đã qua dùng “Sửa buổi đã qua” (có lý do, có nhật ký).`;
  if (p.trangThaiKy === "LOCKED") return `Kỳ ${p.ngay.slice(0, 7)} đã chốt sổ — không giao / gỡ được nữa.`;
  return null;
}
