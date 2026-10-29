// lib/phan-cong/panel-gop.ts — câu chữ + phép đếm của PANEL màn Phân công gộp (chủ dự án 26/10/2026: panel GV × buổi liệt kê MỌI việc
// của cơ sở trong buổi, hàng "Lớp & trực trong buổi" đầu lưới). THUẦN — không DB, không đồng hồ. Màn gọi, không viết lại ở chỗ gọi.
//
// Ba câu hỏi:
//   1. mã ô này nghĩa là gì                      → giaiThichMaO   (đọc `trucQuyDoi` THẬT của ô — 0,5 / 1 phụ thuộc `toiDaTietMoiCa`)
//   2. buổi này có mấy lớp, thiếu mấy, mấy GV trực → tomTatCa
//   3. GV này đã có lớp nào chồng giờ chưa          → lopCungGio     (cùng định nghĩa trùng giờ của `tinhMaO` cho hai lớp chính thức)
import { phutTrongNgay } from "@/lib/parttime/chinh-sach";
import type { BuoiGop, OGop } from "./luoi-gop";

/** Tên đầy đủ của buổi — nhãn hàng của lưới và tiêu đề panel. Mã lạ ⇒ giữ nguyên mã (không đoán). */
export const TEN_CA: Record<string, string> = { S: "Sáng", C: "Chiều", T: "Tối" };
export const tenCa = (ma: string) => TEN_CA[ma] ?? ma;

const so = (n: number) => n.toLocaleString("vi-VN");

function phanTruc(quyDoi: number, coTiet: boolean): string {
  if (quyDoi === 1) return coTiet ? "cả ca trực" : "trực cả ca";
  if (quyDoi === 0.5) return "nửa ca trực";
  if (quyDoi === 0) return "trực (không quy đổi — đã đủ 2 tiết trong buổi)";
  return `trực quy đổi ${so(quyDoi)} ca`;
}

/**
 * Câu giải thích mã ô: "TD" ⇒ "Đứng chính + nửa ca trực". Đọc SỐ của ô (tiết, trực quy đổi), không tra bảng theo mã — cùng mã TD có thể là
 * nửa ca hay cả ca tuỳ `toiDaTietMoiCa` của chính sách. Ô trống ⇒ "Chưa giao gì trong buổi này".
 */
export function giaiThichMaO(o: Pick<OGop, "tietD" | "tietTG" | "trucId" | "trucQuyDoi" | "coTrial">): string {
  const phan: string[] = [];
  if (o.tietD > 0) phan.push(o.tietD === 1 ? "Đứng chính" : `Đứng chính ${o.tietD} lớp`);
  if (o.tietTG > 0) phan.push(o.tietTG === 1 ? "Trợ giảng" : `Trợ giảng ${o.tietTG} lớp`);
  if (o.trucId) phan.push(phanTruc(o.trucQuyDoi, phan.length > 0));
  if (o.coTrial) phan.push("có Trial");
  if (!phan.length) return "Chưa giao gì trong buổi này";
  const cau = phan.join(" + ");
  return cau.charAt(0).toUpperCase() + cau.slice(1);
}

export type TomTatCa = { soLop: number; thieu: number; soTruc: number };

/**
 * Chip "Sáng · N lớp · thiếu M" + "K GV trực". `thieu` = lớp chính thức CÒN MỞ chưa có đứng chính (trợ giảng không bắt buộc từ 20/10 —
 * không đếm). Học bù / Trial không tính vào "lớp" (chúng có cờ đỏ "chưa ai trực" riêng).
 */
export function tomTatCa(p: { buoi: readonly BuoiGop[]; ngay: string; ca: string; truc: readonly string[] }): TomTatCa {
  const lop = p.buoi.filter((b) => b.ngay === p.ngay && b.ca === p.ca && b.loai === "LOP");
  return { soLop: lop.length, thieu: lop.filter((b) => b.mo && !b.main).length, soTruc: new Set(p.truc).size };
}

/** Vai của người này trong buổi (null = không có vai). */
export function vaiCua(userId: string, b: Pick<BuoiGop, "main" | "ta">): "MAIN" | "TA" | null {
  if (b.main?.userId === userId) return "MAIN";
  return b.ta.some((t) => t.userId === userId) ? "TA" : null;
}

/**
 * Lớp chính thức KHÁC mà người này đang đứng chính / trợ giảng, chồng giờ với buổi `b` (cùng ngày, giao ≥ 1 phút). Hai lớp chính thức
 * chồng giờ luôn là trùng giờ (`tinhMaO`, chốt 12); học bù / Trial thì có thể GHÉP nên không coi là bận. null = rảnh.
 */
export function lopCungGio(userId: string, b: Pick<BuoiGop, "key" | "ngay" | "gioBatDau" | "gioKetThuc">, buoi: readonly BuoiGop[]): BuoiGop | null {
  const a0 = phutTrongNgay(b.gioBatDau);
  const a1 = phutTrongNgay(b.gioKetThuc);
  return (
    buoi.find(
      (x) =>
        x.key !== b.key &&
        x.ngay === b.ngay &&
        x.loai === "LOP" &&
        vaiCua(userId, x) != null &&
        Math.min(a1, phutTrongNgay(x.gioKetThuc)) - Math.max(a0, phutTrongNgay(x.gioBatDau)) > 0,
    ) ?? null
  );
}
