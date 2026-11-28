// lib/portal/hv-ma-thuan.ts — luật THUẦN của mã thoát Cổng học sinh (không DB, không giờ thật: mọi hàm nhận `now`).

export const DO_DAI_MA = 4;
/** Số lần nhập sai tối đa trong một đợt; lần thứ 5 sai ⇒ khoá. */
export const TOI_DA_LAN_SAI = 5;
export const KHOA_PHUT = 5;
export const KHOA_MS = KHOA_PHUT * 60 * 1000;

export type LoiMa =
  | "SAI_KHUON"
  | "DE_DOAN_LAP"
  | "DE_DOAN_DAY_SO"
  | "DE_DOAN_NAM_SINH"
  | "DE_DOAN_PHO_BIEN"
  | "TRUNG_MA_CU";

/** Mã chỉ gồm đúng 4 chữ số. */
export function laMaDungKhuon(ma: unknown): ma is string {
  return typeof ma === "string" && /^\d{4}$/.test(ma);
}

// Các mã người ta hay chọn nhất (mẫu bàn phím + năm quen thuộc). Ngoài ra luật còn chặn theo HÌNH (lặp / dãy số).
const PHO_BIEN = new Set([
  "1004", "2000", "2001", "6969", "1313", "1357", "2468", "2580", "0852", "1010", "0101", "1122", "2211", "1230", "5683",
]);

/**
 * Mã có DỄ ĐOÁN không. `namSinhCon` = năm sinh của MỌI con của phụ huynh (mã dùng chung cho cả nhà, nên không chỉ
 * con đang chọn), `namNay` = năm hiện tại theo lịch VN (chặn luôn năm nay và năm ngoái — thứ người ta gõ khi bí).
 * Trả `null` khi chấp nhận được.
 */
export function laMaDeDoan(ma: string, namSinhCon: readonly number[], namNay: number): LoiMa | null {
  if (!laMaDungKhuon(ma)) return "SAI_KHUON";
  const so = ma.split("").map(Number) as [number, number, number, number];
  // 0000, 1111, …, 9999 và nhịp hai số lặp (1212, 7878…)
  if (so.every((d) => d === so[0])) return "DE_DOAN_LAP";
  if (so[0] === so[2] && so[1] === so[3]) return "DE_DOAN_LAP";
  // dãy tăng/giảm từng đơn vị (0123, 1234, 2345 … 6789 và 9876 … 3210)
  const buoc = so[1] - so[0];
  if ((buoc === 1 || buoc === -1) && so[2] - so[1] === buoc && so[3] - so[2] === buoc) return "DE_DOAN_DAY_SO";
  const nam = Number(ma);
  if (namNay === nam || namNay - 1 === nam) return "DE_DOAN_NAM_SINH";
  if (namSinhCon.includes(nam)) return "DE_DOAN_NAM_SINH";
  if (PHO_BIEN.has(ma)) return "DE_DOAN_PHO_BIEN";
  return null;
}

export const CAU_LOI_MA: Record<LoiMa, string> = {
  SAI_KHUON: "Mã gồm đúng 4 chữ số.",
  DE_DOAN_LAP: "Mã này dễ đoán quá. Ba mẹ chọn 4 số khác nhé.",
  DE_DOAN_DAY_SO: "Mã này dễ đoán quá. Ba mẹ chọn 4 số khác nhé.",
  DE_DOAN_NAM_SINH: "Mã này dễ đoán quá. Ba mẹ chọn 4 số khác nhé.",
  DE_DOAN_PHO_BIEN: "Mã này dễ đoán quá. Ba mẹ chọn 4 số khác nhé.",
  TRUNG_MA_CU: "Mã mới phải khác mã đang dùng.",
};

// ── Khoá sau khi nhập sai ─────────────────────────────────────────────────────────────

export type TrangThaiDem = { soLanSai: number; khoaDen: Date | null };

/** Đang bị khoá tại `now` không. */
export function dangBiKhoa(t: TrangThaiDem, now: Date): boolean {
  return t.khoaDen !== null && t.khoaDen.getTime() > now.getTime();
}

/** Khoá đã HẾT HẠN (cần dọn bộ đếm về 0 trước khi nhận lần thử mới). */
export function khoaDaHet(t: TrangThaiDem, now: Date): boolean {
  return t.khoaDen !== null && t.khoaDen.getTime() <= now.getTime();
}

/** Sau một lần sai, bộ đếm = `soLanSaiSau`: đã tới ngưỡng khoá chưa. */
export function chamNguongKhoa(soLanSaiSau: number): boolean {
  return soLanSaiSau >= TOI_DA_LAN_SAI;
}

export function mocKhoaDen(now: Date): Date {
  return new Date(now.getTime() + KHOA_MS);
}

/** Số lần thử còn lại SAU khi đã sai `soLanSai` lần (không âm). */
export function lanThuConLai(soLanSai: number): number {
  return Math.max(0, TOI_DA_LAN_SAI - soLanSai);
}

export function giayConKhoa(khoaDen: Date | null, now: Date): number {
  if (!khoaDen) return 0;
  return Math.max(0, Math.ceil((khoaDen.getTime() - now.getTime()) / 1000));
}

/** 299 giây ⇒ "04:59". */
export function dongHoKhoa(giay: number): string {
  const g = Math.max(0, Math.trunc(giay));
  return `${String(Math.floor(g / 60)).padStart(2, "0")}:${String(g % 60).padStart(2, "0")}`;
}
