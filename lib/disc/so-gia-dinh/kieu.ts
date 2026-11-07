/**
 * KIỂU DÙNG CHUNG CỦA SỔ GIA ĐÌNH DISC (docs/disc-tich-hop/18, mục 2–9).
 *
 * Thuần: không DB, không React, không đồng hồ. Mọi thứ ở đây an toàn để import từ client.
 * (Không import engine gốc: file này được client dùng.)
 */
import type { VaiGiaDinh } from "./vai";

export type { VaiGiaDinh };

// KHÔNG import engine-goc ở đây (lưới [ENG-P09]): các kiểu dưới là SAO của `engine-goc/modules/core/bo-de/kieu.ts`.
// TypeScript so khớp cấu trúc nên truyền qua lại với engine vẫn được kiểm ở chỗ gọi; `vai.test.ts` [SG-VAI-02] ghim hằng số.
export type MaBoDe = "MN" | "TH" | "THCS" | "PH" | "QS";
export type MaTruc = "D" | "I" | "S" | "C";
export type Kieu =
  | { readonly loai: "don"; readonly truc: MaTruc }
  | { readonly loai: "pha"; readonly cap: readonly [MaTruc, MaTruc] }
  | { readonly loai: "deu" };

/** Bốn trục theo thứ tự đọc cố định. Khai lại ở đây để client không phải import engine. */
export const BON_TRUC: readonly MaTruc[] = ["D", "I", "S", "C"];

export type CachLam = "TU_LAM" | "GOC_NHIN";
export type DiemDisc = Readonly<Record<MaTruc, number>>;

/** Một thành viên trong sổ (đã loại thành viên bị xoá mềm). */
export type ThanhVien = {
  readonly id: string;
  readonly ten: string;
  readonly vaiTro: VaiGiaDinh;
  /** `mam-non` · `1`..`12` · `tren-12`. Chỉ có với vai còn đi học. */
  readonly lop: string | null;
  readonly namSinh: number | null;
  readonly thuTu: number;
  readonly ghiChu: string | null;
  readonly studentId: string | null;
};

/** Một lần làm bài đã lưu. KHÔNG có câu trả lời từng câu — chỉ điểm. */
export type BaiLam = {
  readonly id: string;
  /** null = mục "chưa xếp". */
  readonly thanhVienId: string | null;
  readonly tenLuc: string;
  readonly boDe: MaBoDe;
  /** "1.1" (đề gốc) | "nh:nh1" (ngân hàng). */
  readonly phienBanBoDe: string;
  readonly cachLam: CachLam;
  readonly diem: DiemDisc;
  readonly kieu: Kieu;
  readonly canhBao: readonly string[];
  readonly createdAt: Date;
};

export const NHAN_TRUC: Readonly<Record<MaTruc, string>> = {
  D: "Quyết đoán",
  I: "Ảnh hưởng",
  S: "Kiên định",
  C: "Chuẩn xác",
};

/** Chuỗi YYYY-MM-DD theo giờ Việt Nam của một mốc thời gian. */
export function ngayVN(d: Date): string {
  const v = new Date(d.getTime() + 7 * 3_600_000);
  return v.toISOString().slice(0, 10);
}

/** Cộng `n` ngày vào một chuỗi YYYY-MM-DD (không phụ thuộc múi giờ máy). */
export function congNgay(ymd: string, n: number): string {
  const [y, m, dd] = ymd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, dd) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Số ngày từ a đến b (b − a), cả hai YYYY-MM-DD. */
export function soNgayGiua(a: string, b: string): number {
  const f = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((f(b) - f(a)) / 86_400_000);
}

/** 0 = Chủ nhật … 6 = Thứ bảy, của một ngày YYYY-MM-DD. */
export function thuTrongTuan(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const NHAN_THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;
export const nhanThu = (ymd: string) => NHAN_THU[thuTrongTuan(ymd)]!;

/** "03/11/2026" từ "2026-11-03". */
export function hienNgay(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/** "03/11" từ "2026-11-03". */
export function hienNgayNgan(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}
