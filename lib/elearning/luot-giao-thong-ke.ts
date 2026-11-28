import type { DongNguoiNhan } from "@/lib/elearning/luot-giao-view";

/**
 * Ba ô thống kê đầu màn CHI TIẾT LƯỢT GIAO (thiết kế: Đã xong · Trễ · Đã thu hồi) — đếm từ chính danh sách người nhận ĐANG HIỂN THỊ, nên cùng một nguồn với bảng bên dưới
 * (không có con số nào không giải thích được bằng các dòng của bảng).
 *  · Đã xong = hoàn thành (đúng hạn hoặc trễ);
 *  · Trễ     = quá hạn CHƯA xong (`OVERDUE`) — hoàn thành trễ đã nằm ở "Đã xong", không đếm hai lần;
 *  · Thu hồi = `REVOKED`.
 * Còn lại (chưa bắt đầu / đang học) là phần chưa vào ba ô — `conLai`.
 */
export function thongKeLuotGiao(dong: readonly Pick<DongNguoiNhan, "status">[]): { daXong: number; tre: number; thuHoi: number; conLai: number; tong: number } {
  let daXong = 0;
  let tre = 0;
  let thuHoi = 0;
  for (const d of dong) {
    if (d.status === "COMPLETED" || d.status === "COMPLETED_LATE") daXong += 1;
    else if (d.status === "OVERDUE") tre += 1;
    else if (d.status === "REVOKED") thuHoi += 1;
  }
  return { daXong, tre, thuHoi, conLai: dong.length - daXong - tre - thuHoi, tong: dong.length };
}

/** Chữ cái đầu của tên để vẽ avatar (hai chữ: họ + tên cuối); tên rỗng ⇒ "?". */
export function chuCaiDau(ten: string): string {
  const t = ten.trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return "?";
  const dau = t[0]!.charAt(0);
  const cuoi = t.length > 1 ? t[t.length - 1]!.charAt(0) : "";
  return (dau + cuoi).toLocaleUpperCase("vi-VN");
}
