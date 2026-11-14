// lib/portal/hv-thong-bao-thuan.ts — Cổng học sinh, màn "Tin mới cho em" (artifact HV-Thong-bao): phần THUẦN. Không DB.
//
// Tin của em CHỈ dựng từ dữ liệu HỌC TẬP của chính em (nhận xét, bài tập, coin, ảnh sản phẩm, lịch học, đợt đánh giá) —
// KHÔNG lọc từ bảng tin của ba mẹ (học phí, khảo sát, thông báo trung tâm, cảnh báo khoá mã…): lọc theo tên con vẫn để lọt
// tin học phí của đúng con đó. Trạng thái "đã đọc" là của RIÊNG em (một mốc thời gian lưu trên máy này), KHÔNG chạm chuông ba mẹ.
import { vnParts } from "@/lib/time/vn";
import { demNgayLich } from "@/lib/portal/tong-quan-thuan";

const hai = (n: number) => String(n).padStart(2, "0");

export type LocTin = "tat" | "bt" | "huy" | "lich" | "khac";

export const BO_LOC_TIN: { id: LocTin; ten: string }[] = [
  { id: "tat", ten: "Tất cả" },
  { id: "bt", ten: "Bài tập" },
  { id: "huy", ten: "Huy hiệu & ảnh" },
  { id: "lich", ten: "Lịch học" },
  { id: "khac", ten: "Khác" },
];

/** Bộ lọc của màn «Tin mới cho em». Ẩn «Bài tập & bài thi» (`dangHien` = false, tạm ẩn 03/11/2026) ⇒ bỏ tab «Bài tập». */
export function boLocTinTheoMuc(dangHien: boolean): { id: LocTin; ten: string }[] {
  return dangHien ? [...BO_LOC_TIN] : BO_LOC_TIN.filter((l) => l.id !== "bt");
}

export type SacTin = "xanh" | "cam" | "tim" | "nen";

export type TinHv = {
  id: string;
  loc: Exclude<LocTin, "tat">;
  ten: string;
  /** Thời điểm của sự kiện (ISO). */
  luc: string;
  href: string;
  /** Ký hiệu 1 ký tự trong ô vuông bên trái. */
  ky: string;
  sac: SacTin;
};

export function sapXepTin<T extends { luc: string }>(tin: T[]): T[] {
  return [...tin].sort((a, b) => (Date.parse(b.luc) || 0) - (Date.parse(a.luc) || 0));
}

/** `Hôm nay, 09:30` · `Hôm qua, 21:10` · `3 ngày trước` · `Tuần trước` · `12/10` (theo lịch VN). */
export function nhanThoiGian(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const n = -demNgayLich(iso, now);
  const p = vnParts(new Date(t));
  const gio = `${hai(p.hour)}:${hai(p.minute)}`;
  if (n <= 0) return `Hôm nay, ${gio}`;
  if (n === 1) return `Hôm qua, ${gio}`;
  if (n < 7) return `${n} ngày trước`;
  if (n < 14) return "Tuần trước";
  return `${hai(p.day)}/${hai(p.month + 1)}`;
}

/** Số ngày một tin còn được coi là "mới" khi em chưa bấm "đánh dấu đã đọc hết" lần nào. */
export const NGAY_MOI_MAC_DINH = 2;

/**
 * Tin có MỚI không. `daXemDen` = mốc (ms) em bấm "đánh dấu đã đọc hết" lần cuối trên máy này; chưa từng bấm (null) thì tin trong
 * vòng `NGAY_MOI_MAC_DINH` ngày là mới. Tin tương lai (đồng hồ lệch) cũng coi là mới.
 */
export function laTinMoi(luc: string, daXemDen: number | null, now: Date): boolean {
  const t = Date.parse(luc);
  if (Number.isNaN(t)) return false;
  if (daXemDen !== null) return t > daXemDen;
  return now.getTime() - t < NGAY_MOI_MAC_DINH * 86_400_000;
}

export function demTinMoi(tin: { luc: string }[], daXemDen: number | null, now: Date): number {
  return tin.filter((t) => laTinMoi(t.luc, daXemDen, now)).length;
}

export function locTin<T extends { loc: string }>(tin: T[], l: LocTin): T[] {
  return l === "tat" ? tin : tin.filter((t) => t.loc === l);
}

export function nhanChuaDoc(n: number): string {
  return n > 0 ? `Em có ${n} tin chưa đọc` : "Em đã đọc hết tin rồi";
}

/** Tên cookie lưu mốc đã xem — tách theo con để hai anh em dùng chung máy không xoá dấu của nhau. */
export function tenCookieDaXem(studentId: string): string {
  return `hv_xem_${studentId.slice(-12)}`;
}

/** Đọc mốc từ giá trị cookie; rác/âm/quá tương lai ⇒ null (rơi về quy tắc "2 ngày"). */
export function docMocDaXem(raw: string | undefined | null, now: Date): number | null {
  if (!raw || !/^\d{10,14}$/.test(raw)) return null;
  const n = Number(raw);
  return n > now.getTime() + 86_400_000 ? null : n;
}
