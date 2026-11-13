// lib/portal/hv-hom-nay-thuan.ts — Cổng học sinh, màn "Hôm nay" (artifact HV-Hom-nay): phần THUẦN, không DB, mọi hàm nhận `now`.
import { vnParts } from "@/lib/time/vn";
import { demNgayLich } from "@/lib/portal/tong-quan-thuan";

const hai = (n: number) => String(n).padStart(2, "0");
const THU_HOA = ["CHỦ NHẬT", "THỨ HAI", "THỨ BA", "THỨ TƯ", "THỨ NĂM", "THỨ SÁU", "THỨ BẢY"] as const;
const THU_DAI = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"] as const;
const THU_NGAN = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

/** `THỨ NĂM, 05/11` — theo LỊCH VN (không năm: màn của em nhỏ chỉ cần biết hôm nay là hôm nào). */
export function nhanNgayHomNay(now: Date): string {
  const p = vnParts(now);
  return `${THU_HOA[p.weekday]}, ${hai(p.day)}/${hai(p.month + 1)}`;
}

/** `T7, 07/11` theo lịch VN. */
export function nhanNgayNgan(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const p = vnParts(new Date(t));
  return `${THU_NGAN[p.weekday]}, ${hai(p.day)}/${hai(p.month + 1)}`;
}

/** `Thứ Bảy` theo lịch VN. */
export function thuDayDu(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return THU_DAI[vnParts(new Date(t)).weekday] ?? "";
}

/** Chip cạnh "BUỔI HỌC TIẾP THEO": `Hôm nay` · `Ngày mai` · `Còn 2 ngày` (số ngày LỊCH, không phải số giờ). */
export function nhanConNgayEm(ngayISO: string, now: Date): string {
  const n = demNgayLich(ngayISO, now);
  if (n <= 0) return "Hôm nay";
  if (n === 1) return "Ngày mai";
  return `Còn ${n} ngày`;
}

/** Hạn nộp bài: `Hạn hôm nay` · `Hạn ngày mai` · `Còn 3 ngày` · `Quá hạn 2 ngày` · `` (bài không đặt hạn). */
export function nhanHanBai(dueISO: string | null, now: Date): { nhan: string; gap: boolean } {
  if (!dueISO) return { nhan: "", gap: false };
  const n = demNgayLich(dueISO, now);
  if (n < 0) return { nhan: `Quá hạn ${-n} ngày`, gap: true };
  if (n === 0) return { nhan: "Hạn hôm nay", gap: true };
  if (n === 1) return { nhan: "Hạn ngày mai", gap: true };
  return { nhan: `Còn ${n} ngày`, gap: n <= 3 };
}

/**
 * Câu chào dưới "Chào {tên}!". Chỉ nói điều HỆ THỐNG BIẾT: buổi tiếp theo (nếu có) và bài về nhà chưa nộp (nếu có) —
 * không thêm lời hứa ("cô đang chờ xem chương trình của em") như bản mẫu.
 */
export function cauChao(i: {
  tiep: { homNay: boolean; ngayISO: string; so: number | null } | null;
  soBaiChuaNop: number;
}): string {
  if (!i.tiep) return "Em chưa có buổi học sắp tới. Xem lại hành trình của mình nhé!";
  const buoi = i.tiep.so !== null ? ` buổi ${i.tiep.so}` : "";
  const dau = i.tiep.homNay ? "Hôm nay em học" : `${thuDayDu(i.tiep.ngayISO)} này em học`;
  const duoi = i.soBaiChuaNop > 0 ? " Làm xong bài về nhà là mình sẵn sàng rồi!" : " Mình cùng học tiếp nhé!";
  return `${dau}${buoi}.${duoi}`;
}

export type OHocPhan = boolean[]; // 12 ô: true = đã xong

/**
 * Vị trí trong học phần (mỗi học phần 12 buổi — cấu trúc của khoá 48 buổi trong bản thiết kế). `done` = số buổi đã học của cả khoá.
 * Khoá ngắn hơn 12 buổi thì vẫn chia 12 ô, ô vượt quá `total` KHÔNG vẽ (mảng ngắn lại).
 */
export function viTriHocPhan(done: number, total: number): { hocPhan: number; trong: number; o: OHocPhan; soHocPhan: number } {
  const d = Math.max(0, Math.trunc(done));
  const t = Math.max(0, Math.trunc(total));
  const soHocPhan = Math.max(1, Math.ceil(t / 12));
  const hocPhan = Math.min(soHocPhan, Math.floor(d / 12) + 1);
  const dau = (hocPhan - 1) * 12;
  const trong = Math.max(0, Math.min(12, d - dau));
  const kich = Math.max(0, Math.min(12, t - dau));
  return { hocPhan, trong, o: Array.from({ length: kich }, (_, i) => i < trong), soHocPhan };
}

/** Phần trăm cả khoá (0 khi chưa có tổng). */
export function phanTram(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/**
 * Còn bao nhiêu buổi nữa là tới buổi DEMO kế tiếp (buổi có tên bắt đầu bằng "Demo"). `null` khi khoá không có buổi demo phía trước —
 * bản mẫu luôn nói "còn X buổi nữa là tới buổi demo" kể cả khi giáo trình không có, nên ở đây câu đó chỉ hiện khi có thật.
 */
export function conBuoiToiDemo(buoi: { order: number; title: string }[], daHoc: number): number | null {
  const demo = buoi
    .filter((b) => /^demo\b/i.test(b.title.trim()) && b.order > daHoc)
    .map((b) => b.order)
    .sort((a, b) => a - b)[0];
  return demo === undefined ? null : demo - daHoc - 1;
}

/** Lời dặn mặc định khi thầy cô chưa viết nhận xét (chủ dự án chốt 04/11/2026). */
export const LOI_DAN_MAC_DINH = "Nhớ làm bài tập về nhà đấy nhé!";

/**
 * Nội dung khung «Lời thầy cô dặn em»: nhận xét của thầy cô đã rút gọn; để trống / chỉ có khoảng trắng ⇒ câu mặc định
 * (không để hiện khung rỗng `“”`).
 */
export function noiDungLoiDan(nhanXet: string | null | undefined, toiDa: number): string {
  return rutGonLoi(nhanXet ?? "", toiDa) || LOI_DAN_MAC_DINH;
}

/** Rút gọn lời nhận xét dài để vừa khung "Lời thầy cô dặn" (cắt ở khoảng trắng, thêm "…"). */
export function rutGonLoi(text: string, toiDa: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= toiDa) return s;
  const cat = s.slice(0, toiDa);
  const sp = cat.lastIndexOf(" ");
  return `${(sp > toiDa * 0.6 ? cat.slice(0, sp) : cat).trimEnd()}…`;
}
