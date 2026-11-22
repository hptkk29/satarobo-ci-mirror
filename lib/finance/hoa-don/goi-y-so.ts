// lib/finance/hoa-don/goi-y-so.ts — gợi ý SỐ HOÁ ĐƠN tiếp theo + kiểm trùng trong DÃY. THUẦN (client dùng được).
//
// Vì sao (PR3, docs/ke-toan-hoa-don/NANG-CAP-2026-10.md): số in trên tờ hoá đơn do PHẦN MỀM PHÁT HÀNH cấp
// (MISA / VIN HOADON) — hệ thống KHÔNG cấp số pháp lý. Thứ hệ thống làm được là ĐỀ XUẤT số kế tiếp để kế toán
// đỡ gõ, và chặn gõ trùng số đã dùng trong cùng dãy.
//
// Luật:
//   · DÃY SỐ = (MST người bán, ký hiệu). KHÔNG phải `centerId`: hai cơ sở có thể cùng một dãy, và một cơ sở có
//     thể đổi dãy theo năm. Hôm nay mỗi cơ sở tình cờ có ký hiệu riêng — thiết kế không dựa vào đó.
//   · Đề xuất = số LỚN NHẤT đã dùng trong dãy + 1. KHÔNG lấp số thiếu (đo prod 23/10: CS1 thiếu 1 và 3, CS2 bắt đầu
//     ở 13 — nhiều khả năng phát hành ngoài hệ thống; tự lấp là tự bịa số).
//   · "Đã dùng" gồm MỌI hoá đơn có số, kể cả bản ĐÃ HUỶ (THAY_THE) và đang phát hành: số của hoá đơn huỷ vẫn đã
//     bị tiêu ở phần mềm phát hành, trong khi chỉ mục DB chỉ canh NHAP/DA_XAC_NHAN.
//   · Chưa có số nào trong dãy ⇒ KHÔNG đoán "bắt đầu từ 1": bắt kế toán nhập số thực tế đầu tiên.
//   · Hoá đơn CŨ lưu sai MST (19 hoá đơn CS2 mang ký hiệu 1C26MNV nhưng snapshot Sata Robo) được xếp về dãy ĐÚNG theo
//     quy tắc khai ở `bao-cao-sai-phap-nhan.ts` — nếu không, số 13…36 của CS2 "biến mất" khỏi dãy New Vision và
//     hệ thống đề xuất lại số 1, hoặc cho gõ trùng số đã dùng. KHÔNG sửa dòng DB nào.
//   · Số đề xuất KHÔNG phải số đã phát hành: UI buộc kế toán xác nhận đã đối chiếu với tờ hoá đơn thật.

import { DONG_NGHI_SAI_PHAP_NHAN } from "./bao-cao-sai-phap-nhan";

/** Một hoá đơn có số, như `goi-y-so-db.ts` đọc. */
export type HoaDonCoSo = {
  soHoaDon: string;
  phapNhanMst: string | null;
  kyHieu: string | null;
  /** `Center.code` của cơ sở giữ hoá đơn — để áp quy tắc "sai pháp nhân đã biết". */
  maCoSo: string;
};

const chuanMst = (m: string | null | undefined) => (m ?? "").replace(/[\s-]/g, "");
const chuanKy = (k: string | null | undefined) => (k ?? "").trim().toUpperCase();

/**
 * MST của dãy mà MỘT hoá đơn thực sự thuộc về: mặc định là MST đã lưu; nếu hoá đơn khớp một quy tắc "lưu sai pháp
 * nhân đã biết" (cơ sở + ký hiệu) thì là MST của pháp nhân ĐÚNG theo quy tắc.
 */
export function mstCuaDay(h: Pick<HoaDonCoSo, "phapNhanMst" | "kyHieu" | "maCoSo">, mstTheoMa: (ma: string) => string | undefined): string {
  const q = DONG_NGHI_SAI_PHAP_NHAN.find((r) => r.maCoSo === h.maCoSo && r.kyHieu === chuanKy(h.kyHieu));
  const dung = q ? mstTheoMa(q.phapNhanMaDuKien) : undefined;
  return chuanMst(dung ?? h.phapNhanMst);
}

/** Số đã dùng (số nguyên, tăng dần, không trùng) của MỘT dãy (MST người bán, ký hiệu). */
export function soDaDungCuaDay(
  hoaDon: readonly HoaDonCoSo[],
  day: { mst: string; kyHieu: string },
  mstTheoMa: (ma: string) => string | undefined,
): number[] {
  const mst = chuanMst(day.mst);
  const ky = chuanKy(day.kyHieu);
  const so = new Set<number>();
  for (const h of hoaDon) {
    if (chuanKy(h.kyHieu) !== ky) continue;
    if (mstCuaDay(h, mstTheoMa) !== mst) continue;
    if (!/^\d+$/.test(h.soHoaDon)) continue;
    const n = Number(h.soHoaDon);
    if (Number.isSafeInteger(n) && n > 0) so.add(n);
  }
  return [...so].sort((a, b) => a - b);
}

export type GoiYSo =
  | { loai: "CO"; so: number; max: number; soLuong: number }
  | { loai: "CHUA_CO" };

/** Đề xuất số kế tiếp = lớn nhất + 1; dãy rỗng ⇒ `CHUA_CO` (kế toán nhập số thực tế đầu tiên). */
export function goiYSo(soDaDung: readonly number[]): GoiYSo {
  if (soDaDung.length === 0) return { loai: "CHUA_CO" };
  const max = soDaDung.reduce((m, n) => (n > m ? n : m), 0);
  return { loai: "CO", so: max + 1, max, soLuong: soDaDung.length };
}

/** `true` nếu số (đã chuẩn hoá, bỏ số 0 đầu) đã dùng trong dãy. */
export function soDaCoTrongDay(soDaDung: readonly number[], so: string): boolean {
  if (!/^\d+$/.test(so)) return false;
  return soDaDung.includes(Number(so));
}

/** Khoá khoá-tư-vấn của một dãy — dùng cho `pg_advisory_xact_lock(hashtext(...))`. */
export function khoaDay(day: { mst: string; kyHieu: string }): string {
  return `hoa-don-so:${chuanMst(day.mst)}|${chuanKy(day.kyHieu)}`;
}

/**
 * Cách xác minh SỐ HOÁ ĐƠN của một lượt lưu (ghi vào audit):
 *   · "XML"                  — XML đính kèm đọc được, có số, và hệ thống đã đối chiếu KHỚP số kế toán nhập (bằng chứng hệ thống);
 *   · "KE_TOAN_DA_DOI_CHIEU" — không có XML khớp số: kế toán khai đã đối chiếu tờ hoá đơn thật. Là LỜI KHAI của người dùng,
 *                              KHÔNG tương đương XML;
 *   · "KHONG_CAN"            — không có số để xác minh (nháp để trống số) hoặc số / ký hiệu không đổi so với bản nháp đã lưu.
 */
export type XacMinhSo = "XML" | "KE_TOAN_DA_DOI_CHIEU" | "KHONG_CAN";

/**
 * Tình trạng XML của lượt lưu (ghi vào audit):
 *   KHONG_CO · KHOP_SO (khớp, có số) · KHOP_KHONG_CO_SO (đọc được nhưng không có số để so) · KHONG_DOC_DUOC.
 * XML đọc được mà LỆCH thông tin quan trọng thì không lưu — không có trạng thái "LECH".
 */
export type XmlTrangThai = "KHONG_CO" | "KHOP_SO" | "KHOP_KHONG_CO_SO" | "KHONG_DOC_DUOC";

/** Số hoá đơn dạng so sánh: chỉ chữ số, bỏ số 0 đầu ("00000127" ≡ "127"). */
export const soDeSoSanh = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");
