import { conPhaiHoc, dangTre, type DongNguoiHoc } from "@/lib/elearning/nguoi-hoc";
import { soNgayTre } from "@/lib/elearning/report-compliance";

/**
 * P7 — NHẮC HỌC: phần THUẦN (không DB, không server-only) — dùng được ở cả máy chủ lẫn thành phần client (câu báo kết quả).
 * Phần gửi + ghi sổ ở `nhac-hoc.ts`.
 */

export type LoiNhac = { title: string; body: string };

/** Ngày VN dạng yyyymmdd — phần của khoá chống trùng. */
export function ngayVn(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now).replaceAll("-", "");
}

export const khoaNhacTrongNgay = (userId: string, now: Date): string => `nhac-hoc:${userId}:${ngayVn(now)}`;

/**
 * THUẦN. Lời nhắc dựa trên ĐÚNG những khoá người đó còn nợ; `null` ⇒ không còn gì phải học (không gửi lời nhắc rỗng nghĩa).
 * Chỉ nêu sự thật có trong dữ liệu (số khoá, khoá trễ nặng nhất, số ngày trễ) — không hứa hẹn hậu quả, không nêu SĐT/tiền.
 */
export function soanLoiNhac(ds: readonly DongNguoiHoc[], now: Date): LoiNhac | null {
  const con = ds.filter(conPhaiHoc);
  if (con.length === 0) return null;
  const tre = con.filter((d) => dangTre(d, now));
  if (tre.length > 0) {
    const nang = [...tre].sort((a, b) => (soNgayTre(b, now) ?? 0) - (soNgayTre(a, now) ?? 0))[0]!;
    const ngay = soNgayTre(nang, now) ?? 0;
    return {
      title: tre.length === 1 ? `Khoá "${nang.courseTitle}" đã trễ hạn ${ngay} ngày` : `Bạn có ${tre.length} khoá đang trễ hạn`,
      body: tre.length === 1 ? "Mở Khoá của tôi để hoàn thành khoá này." : `Trễ nhiều nhất: "${nang.courseTitle}" (${ngay} ngày). Mở Khoá của tôi để hoàn thành.`,
    };
  }
  return {
    title: con.length === 1 ? `Nhắc học: "${con[0]!.courseTitle}"` : `Nhắc học: còn ${con.length} khoá cần hoàn thành`,
    body: "Mở Khoá của tôi để tiếp tục học.",
  };
}

export type KetQuaNhacHoc = {
  /** Đã gửi lời nhắc. */
  daNhac: string[];
  /** Hôm nay đã được nhắc thủ công — không gửi lại. */
  daNhacHomNay: string[];
  /** Không còn khoá nào phải học (xong hết/thu hồi/tạm dừng) — không có gì để nhắc. */
  khongCanNhac: string[];
  /** Không có lượt học nào trong tầm nhìn của người bấm. */
  khongThay: string[];
  /** Có việc cần nhắc nhưng kênh không gửi được (cổng người nhận UAT, tài khoản không có thiết bị…). */
  chuaGuiDuoc: string[];
};


/** Câu báo kết quả (toast) — đếm đủ MỌI nhóm để không ai tưởng "đã nhắc" khi thực tế không gửi được. */
export function tomTatKetQuaNhac(r: KetQuaNhacHoc): { sac: "success" | "warning" | "info"; chu: string } {
  const phan: string[] = [];
  if (r.daNhac.length) phan.push(`Đã nhắc ${r.daNhac.length} người`);
  if (r.daNhacHomNay.length) phan.push(`${r.daNhacHomNay.length} người đã được nhắc hôm nay`);
  if (r.khongCanNhac.length) phan.push(`${r.khongCanNhac.length} người không còn khoá nào phải học`);
  if (r.chuaGuiDuoc.length) phan.push(`${r.chuaGuiDuoc.length} người chưa gửi được thông báo`);
  if (r.khongThay.length) phan.push(`${r.khongThay.length} người ngoài phạm vi của bạn — đã bỏ qua`);
  const sac = r.chuaGuiDuoc.length || r.khongThay.length ? "warning" : r.daNhac.length ? "success" : "info";
  return { sac, chu: phan.length ? phan.join(" · ") : "Không có ai để nhắc" };
}
