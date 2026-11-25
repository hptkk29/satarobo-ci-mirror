/**
 * SỔ SỨC KHOẺ của CỔNG PHỤ HUYNH — phần tính toán THUẦN (08/11/2026). Dữ liệu ở lại TRÊN MÁY người dùng (xem `components/portal/suc-khoe/luu-tru.ts`).
 *
 * Nguồn: artifact «Cổng Phụ Huynh — Thiết kế lại» (Suc-khoe.dc.html): bảng số đo cả nhà (≤ 6 người × 3 bản), BMI theo ngưỡng châu Á, ước tính năng lượng
 * (Mifflin–St Jeor × hệ số vận động), thước vùng BMI, xu hướng. Ngưỡng + khuôn lời khuyên DÙNG CHUNG với trang công khai (`dong-co-goc.ts`, `khuon-ket-qua.ts`)
 * — một nguồn lời khuyên (chủ dự án chốt 08/11/2026).
 *
 * ⚠️ Trẻ dưới 18 tuổi: BMI phải so BẢNG CHUẨN WHO theo tuổi và giới; Sata Robo CHƯA có bảng ấy nên KHÔNG phân loại (artifact mẫu ghi «trong vùng tham khảo thông
 * thường» cho bé là số bịa) — chỉ hiện BMI thô và nói rõ chưa đánh giá, đúng như `ketQua` của trang công khai.
 */
import { layHomNay, nhomTuoi, NG, thangTuoi } from "./dong-co-goc";
import type { TenKhuon } from "./khuon-ket-qua";

export const TOI_DA_NGUOI_CONG = 6;
export const TOI_DA_BAN = 3;
export const SO_CAU_THU_THACH = 3;

export type HoatDong = "it" | "vua" | "nhieu";
export type Ban = { id: string; ngay: string; cao: number; nang: number; eo: number | null };
export type KhaoSatDaLam = { ngay: string; ai: string; tl: Record<string, number | number[]> };
export type NguoiCong = {
  id: string;
  ten: string;
  vt: string;
  /** yyyy-mm-dd */
  ns: string;
  gt: "nu" | "nam";
  hoatDong: HoatDong;
  mt: boolean;
  benhNen: boolean;
  /** Mới nhất đứng đầu; tối đa `TOI_DA_BAN`. Luôn ≥ 1. */
  ban: Ban[];
  ks: KhaoSatDaLam | null;
};

export const bmiCua = (b: Pick<Ban, "cao" | "nang">): number => b.nang / Math.pow(b.cao / 100, 2);

export const f1 = (x: number): string => x.toFixed(1).replace(".", ",");
export const f1Gon = (x: number): string => f1(x).replace(",0", "");

export type PhanLoaiBmi = { ten: string; loai: "ok" | "cy" | "chua"; mau: string };

export function laTreEm(ns: string): boolean {
  const g = nhomTuoi(ns);
  return g === "u5" || g === "c6" || g === "c12";
}

/** Phân loại BMI. Người lớn: ngưỡng châu Á (18,5 / 23 / 25 / 30). Trẻ em hoặc đang mang thai/cho con bú: KHÔNG phân loại. */
export function phanLoaiBmi(n: Pick<NguoiCong, "ns" | "mt">, bmi: number): PhanLoaiBmi {
  if (laTreEm(n.ns)) return { ten: "Chưa đánh giá — cần so bảng chuẩn WHO theo tuổi và giới", loai: "chua", mau: "#620c8b" };
  if (n.mt) return { ten: "BMI không áp dụng khi mang thai / cho con bú", loai: "chua", mau: "#620c8b" };
  if (bmi < NG.thieu) return { ten: "Nhẹ cân (châu Á)", loai: "cy", mau: "#c2410c" };
  if (bmi < NG.thua) return { ten: "Bình thường (châu Á)", loai: "ok", mau: "#1d7a46" };
  if (bmi < NG.beo) return { ten: "Thừa cân (châu Á)", loai: "cy", mau: "#c2410c" };
  if (bmi < NG.nang) return { ten: "Béo phì độ I (châu Á)", loai: "cy", mau: "#c2410c" };
  return { ten: "Béo phì độ II (châu Á)", loai: "cy", mau: "#c2410c" };
}

/** Khuôn lời khuyên — cùng quy tắc với `SucKhoeVm` của trang công khai. */
export function khuonCua(n: Pick<NguoiCong, "ns" | "mt" | "benhNen">, bmi: number): TenKhuon {
  const g = nhomTuoi(n.ns);
  if (g === "u5") return "tre-nho";
  if (g === "c6" || g === "c12") return "tre";
  if (n.mt || n.benhNen) return "dac-biet";
  if (!Number.isFinite(bmi)) return "nl-binh-thuong";
  if (bmi < NG.thieu) return "nl-nhe-can";
  if (bmi >= NG.thua) return "nl-can-chu-y";
  return "nl-binh-thuong";
}

const HE_SO: Record<HoatDong, number> = { it: 1.2, vua: 1.55, nhieu: 1.725 };

/** Ước tính năng lượng/ngày (kcal), làm tròn chục — CHỈ cho người lớn không mang thai. Ước tính tham khảo, không phải chỉ tiêu. */
export function nangLuongUocTinh(n: Pick<NguoiCong, "ns" | "gt" | "hoatDong" | "mt">, b: Pick<Ban, "cao" | "nang">): number | null {
  if (laTreEm(n.ns) || n.mt) return null;
  const thang = thangTuoi(n.ns);
  if (thang === null || thang < 0) return null;
  const tuoi = Math.floor(thang / 12);
  const bmr = 10 * b.nang + 6.25 * b.cao - 5 * tuoi + (n.gt === "nam" ? 5 : -161);
  return Math.round((bmr * HE_SO[n.hoatDong]) / 10) * 10;
}

/** Vị trí kim trên thước (0–100%): BMI 15 → 32, kẹp 2–98. */
export const viTriKim = (bmi: number): number => Math.max(2, Math.min(98, ((bmi - 15) / 17) * 100));

/** Đường gấp khúc xu hướng BMI (mới nhất ở bên phải), toạ độ trong khung 84×28 như thiết kế. */
export function diemXuHuong(ban: readonly Ban[]): string {
  const b = ban.map(bmiCua).reverse();
  if (b.length === 1) return "6,14 78,14";
  const mn = Math.min(...b) - 0.6;
  const mx = Math.max(...b) + 0.6;
  return b.map((v, k) => `${Math.round(6 + (k * 72) / (b.length - 1))},${Math.round(24 - ((v - mn) / (mx - mn)) * 20)}`).join(" ");
}

export const ngayHienThi = (iso: string): string => {
  const p = iso.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
};
export const ngayNgan = (iso: string): string => ngayHienThi(iso).slice(0, 5);

export type LoiBan = "THIEU_NGAY" | "NGAY_TUONG_LAI" | "CAO_SAI" | "NANG_SAI" | "EO_SAI";
/** Kiểm số đo nhập vào. Khoảng hợp lý để chặn gõ nhầm (không phải chẩn đoán). */
export function kiemBan(p: { ngay: string; cao: number; nang: number; eo: number | null }, homNay: string = layHomNay()): LoiBan | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.ngay)) return "THIEU_NGAY";
  if (p.ngay > homNay) return "NGAY_TUONG_LAI";
  if (!(p.cao >= 40 && p.cao <= 230)) return "CAO_SAI";
  if (!(p.nang >= 2 && p.nang <= 250)) return "NANG_SAI";
  if (p.eo !== null && !(p.eo >= 30 && p.eo <= 200)) return "EO_SAI";
  return null;
}

/** Thêm một bản vào đầu danh sách, giữ tối đa `TOI_DA_BAN`; trả cả bản bị thay (cũ nhất) nếu có. */
export function themBan(ban: readonly Ban[], moi: Ban): { ban: Ban[]; bi_thay: Ban | null } {
  const ds = [moi, ...ban].sort((a, b) => (a.ngay < b.ngay ? 1 : a.ngay > b.ngay ? -1 : 0));
  return { ban: ds.slice(0, TOI_DA_BAN), bi_thay: ds.length > TOI_DA_BAN ? ds[ds.length - 1]! : null };
}

/** Thứ trong tuần theo nhãn của lịch tuần: T2..T7, CN. */
export function nhanThu(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const w = d.getDay();
  return w === 0 ? "CN" : `T${w + 1}`;
}

/** Cột chia thước vùng (người lớn): nhẹ cân · bình thường · thừa cân · béo phì — tỉ lệ theo khoảng BMI 15→32. */
export const COT_THUOC = "3.5fr 4.5fr 2fr 7fr";
