// lib/phan-cong/giao-go.ts — luật THUẦN của thao tác giao / gỡ trên màn Phân công gộp (GĐ2, docs/phan-cong-gop/KHAO-SAT.md chốt 1, 6).
// Không DB, không đồng hồ: `homNay` luôn truyền vào (luật 7, 19).
//
// Hai câu hỏi, mỗi câu MỘT hàm — action, áp khung (GĐ4) và màn cùng gọi:
//   1. phạm vi này rải ra những ngày nào                → ngayTheoPhamVi
//   2. ngày này còn giao / gỡ được không (và vì sao)      → lyDoKhongGiaoDuoc
//
// "CÁC TUẦN SAU" = cùng thứ, mỗi tuần, từ ngày được chọn tới HẾT THÁNG CỦA NGÀY ĐÓ — tháng đang xem (chủ dự án 26/10/2026, đảo
// QUYET-DINH-DEM G2-3 "hết tháng kế tiếp"). Có trần để thao tác một lần không lặng lẽ rải sang tháng chưa xem — tháng sau thì làm lại ở
// tháng sau, hoặc dùng Áp khung (GĐ4, khoảng ngày tự chọn).

export type PhamVi = "CHI_BUOI_NAY" | "CAC_TUAN_SAU";

const ngayCong = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Ngày cuối của tháng KẾ TIẾP tháng của `ymd` ("2026-11-04" ⇒ "2026-12-31"). Chỉ còn là MẶC ĐỊNH khoảng đích của Áp khung (GĐ4). */
export function hetThangSau(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  // Ngày 0 của tháng (m + 2) theo đánh số 1-based = ngày cuối tháng (m + 1).
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

/** Ngày cuối của CHÍNH tháng của `ymd` ("2026-10-29" ⇒ "2026-10-31") — trần của "các tuần sau". */
export function hetThang(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Các ngày mà thao tác chạm tới, tăng dần. `CHI_BUOI_NAY` ⇒ đúng một ngày. */
export function ngayTheoPhamVi(p: { ngay: string; phamVi: PhamVi }): string[] {
  if (p.phamVi === "CHI_BUOI_NAY") return [p.ngay];
  const den = hetThang(p.ngay);
  const ra: string[] = [];
  for (let d = p.ngay; d <= den; d = ngayCong(d, 7)) ra.push(d);
  return ra;
}

/**
 * Ngày này có giao / gỡ được không. `null` = được. Thứ tự: đã qua → kỳ đã chốt.
 * "Đã qua" = trước HÔM NAY (giờ VN). Hôm nay vẫn sửa được — QLCS xếp lại người trong ngày là việc thường.
 */
export function lyDoKhongGiaoDuoc(p: { ngay: string; homNay: string; trangThaiKy: string | null }): string | null {
  if (laNgayDaQua(p.ngay, p.homNay)) return `Ngày ${p.ngay} đã qua — sửa buổi đã qua dùng “Sửa buổi đã qua” (có lý do, có nhật ký).`;
  if (p.trangThaiKy === "LOCKED") return `Kỳ ${p.ngay.slice(0, 7)} đã chốt sổ — không giao / gỡ được nữa.`;
  return null;
}

/** Thay / gỡ người ĐANG giữ vai cần lý do — cùng ngưỡng với bảng theo buổi cũ (`doiGvChinhAction` / `huyPhanCongAction`). */
export const LY_DO_DOI_TOI_THIEU = 5;

/**
 * Lý do của thao tác thay / gỡ người đang giữ vai. `null` = đủ. Giao vào vai TRỐNG (`boUserId` null) không cần lý do. MỘT hàm cho action
 * (máy chủ) và nút trên panel (luật 12) — panel hỏi lý do trước khi gửi, máy chủ vẫn tự kiểm.
 */
export function lyDoThieuKhiDoi(p: { boUserId: string | null; lyDo: string | null | undefined }): string | null {
  if (!p.boUserId) return null;
  return (p.lyDo ?? "").trim().length >= LY_DO_DOI_TOI_THIEU
    ? null
    : `Thay / gỡ người đang giữ vai cần lý do (tối thiểu ${LY_DO_DOI_TOI_THIEU} ký tự) — lý do ghi vào nhật ký và gửi cho giáo viên liên quan.`;
}

/** Ngày đã qua — panel khoá giao / gỡ thường bằng CÙNG phép so với `lyDoKhongGiaoDuoc` (máy chủ bỏ qua ngày đó). */
export function laNgayDaQua(ngay: string, homNay: string): boolean {
  return ngay < homNay;
}
