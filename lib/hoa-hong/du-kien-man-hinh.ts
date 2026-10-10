// lib/hoa-hong/du-kien-man-hinh.ts — VIEW-MODEL của khối "Hoa hồng dự kiến của bạn" trên lead / đơn (06 §5.6, 04 §16). THUẦN.
//
// Nguồn số liệu là `duKienCuaToi` (doc-so.ts) — đã ép "chỉ phần của chính actor" Ở SERVER; ở đây chỉ định hình lại cho màn:
//   · KHÔNG tổng của vai khác, KHÔNG tên người khác (view-model không có chỗ để chứa chúng);
//   · chưa tính được ⇒ lý do bằng chữ ("Chưa thể tính"), KHÔNG BAO GIỜ "0đ" — 0đ là một câu trả lời, "chưa biết" là một câu khác;
//   · không có gì để nói ⇒ ẨN khối (không vẽ khung rỗng cho mọi vai nội bộ ở mọi lead).
import type { KetQuaDuKien } from "./doc-so";
import { kyHienThi } from "./dinh-dang";

export type DongDaGhi = { id: string; soTien: number; khoanThu: number; vai: string; ky: string };

export type DuKienManHinh =
  | { loai: "AN" }
  /** Đọc hỏng — màn nói thẳng "chưa tải được", KHÔNG im lặng ẩn khối (ẩn là nói "không có gì" khi thật ra không biết). */
  | { loai: "LOI" }
  | {
      loai: "HIEN";
      daGhi: { tong: number; dong: DongDaGhi[] };
      /** `null` khi không có dự kiến thêm (đã thu đủ / không có phần của mình). */
      duKien: { tong: number; dong: { vai: string; soTien: number }[] } | null;
      /** Lý do chưa tính được — rỗng nếu không liên quan đến người xem. */
      chuaThe: string[];
      giaDinh: string[];
    };

/** "2026-10" → "10/2026". */

/**
 * @param laNguoiLienQuan  người xem có thể là người hưởng của lead/đơn này không (chủ lead / admin lead). Chỉ khi đó lý do "chưa thể tính" mới đáng nói: với
 *                         mọi vai nội bộ khác nó là nhiễu trên hầu hết các đơn chưa gắn học viên. KHÔNG có giá trị mặc định (luật 7).
 */
export function dungDuKienManHinh(i: { kq: KetQuaDuKien; laNguoiLienQuan: boolean; tenVai: ReadonlyMap<string, string> }): DuKienManHinh {
  const { kq } = i;
  const dong: DongDaGhi[] = kq.daGhiCuaToi.map((d) => ({ id: d.id, soTien: d.amount, khoanThu: d.grossAmount, vai: d.tenVai, ky: kyHienThi(d.kyGhi) }));
  // Gộp theo VAI: một lead có thể có nhiều dòng học phí cùng vai Sale — người đọc cần "Sale: tổng", không phải mỗi dòng đơn một dòng chữ.
  const theoVai = new Map<string, number>();
  for (const d of kq.duKienCuaToi) {
    const ten = i.tenVai.get(d.roleCode) ?? d.roleCode;
    theoVai.set(ten, (theoVai.get(ten) ?? 0) + d.soTien);
  }
  const duKienDong = [...theoVai].map(([vai, soTien]) => ({ vai, soTien }));
  const chuaThe = i.laNguoiLienQuan ? [...new Set(kq.chuaTinhDuoc.map((c) => c.lyDo))] : [];

  if (dong.length === 0 && duKienDong.length === 0 && chuaThe.length === 0) return { loai: "AN" };

  return {
    loai: "HIEN",
    daGhi: { tong: dong.reduce((s, d) => s + d.soTien, 0), dong },
    duKien: duKienDong.length > 0 ? { tong: duKienDong.reduce((s, d) => s + d.soTien, 0), dong: duKienDong } : null,
    chuaThe,
    // `giaDinh` trộn lời giả định với dòng báo lỗi kỹ thuật ("Dòng <id>: …"). Lời giả định chỉ có nghĩa khi CÓ dự kiến để giả định về.
    giaDinh: duKienDong.length > 0 ? kq.giaDinh.filter((g) => !g.startsWith("Dòng ")) : [],
  };
}
