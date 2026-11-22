/**
 * XIN LINK TẢI một ebook (07/11/2026) — logic THUẦN, phụ thuộc (kho R2, thẻ mở khoá) được TIÊM để test không cần mạng.
 *
 * Luật: PDF là tệp RIÊNG TƯ ở bucket R2 RIÊNG (`bucket-pdf.ts`, không công khai); chỉ ký link (hết hạn nhanh) cho người ĐÃ để lại thông tin (có thẻ mở khoá hợp lệ). Ảnh trang để ĐỌC thì công khai (đọc luôn miễn phí).
 * Kho chưa cấu hình / tệp chưa nhập ⇒ `CHUA_CO_TEP` (giao diện nói «đang cập nhật», không phải lỗi đáng sợ) — KHÔNG ký link cho tệp không tồn tại.
 */
import { EBOOKS, khoaSach, type Ebook } from "./ebook";

export const TTL_LINK_TAI_GIAY = 300;

export type KhoTep = {
  daCauHinh: () => boolean;
  tonTai: (khoa: string) => Promise<boolean>;
  kyLinkTai: (khoa: string, tenTep: string, ttlGiay: number) => Promise<string>;
};

export type KetQuaXinLink =
  | { ok: true; url: string }
  | { ok: false; trangThai: 400 | 401 | 404 | 503; loi: "SO_KHONG_HOP_LE" | "CHUA_DE_LAI_THONG_TIN" | "KHONG_CO_SACH" | "CHUA_CO_TEP" | "LOI_KHO" };

const boDau = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Tên tệp tải về: chỉ ASCII an toàn (đi vào header Content-Disposition). */
export function tenTepTai(e: Pick<Ebook, "so" | "tieuDe">): string {
  const slug = boDau(e.tieuDe).slice(0, 60).replace(/-+$/, "");
  return `Sata-Robo-Ebook-${e.so}${slug ? "-" + slug : ""}.pdf`;
}

export function soEbookHopLe(raw: string): number | null {
  if (!/^[0-9]{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return EBOOKS.some((e) => e.so === n) ? n : null;
}

export async function xinLinkTai(p: { soTho: string; daMoKhoa: boolean; kho: KhoTep }): Promise<KetQuaXinLink> {
  const so = soEbookHopLe(p.soTho);
  if (so === null) return /^[0-9]{1,3}$/.test(p.soTho) ? { ok: false, trangThai: 404, loi: "KHONG_CO_SACH" } : { ok: false, trangThai: 400, loi: "SO_KHONG_HOP_LE" };
  if (!p.daMoKhoa) return { ok: false, trangThai: 401, loi: "CHUA_DE_LAI_THONG_TIN" };
  const ebook = EBOOKS.find((e) => e.so === so)!;
  if (!p.kho.daCauHinh()) return { ok: false, trangThai: 404, loi: "CHUA_CO_TEP" };
  try {
    const khoa = khoaSach.pdf(so);
    if (!(await p.kho.tonTai(khoa))) return { ok: false, trangThai: 404, loi: "CHUA_CO_TEP" };
    return { ok: true, url: await p.kho.kyLinkTai(khoa, tenTepTai(ebook), TTL_LINK_TAI_GIAY) };
  } catch {
    return { ok: false, trangThai: 503, loi: "LOI_KHO" };
  }
}
