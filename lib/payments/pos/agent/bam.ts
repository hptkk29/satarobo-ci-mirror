// lib/payments/pos/agent/bam.ts — BĂM dòng giao dịch (GĐ4 POS — T11, T13). THUẦN (node:crypto).
//
// `bamDong`: sha256 của JSON KHOÁ SẮP XẾP của dòng ĐÃ chuẩn hoá (gồm máy suy ra, gốc VOID suy ra, cột hậu kết
// toán). Agent gửi lại cửa sổ 2 giờ MỖI PHÚT — trùng băm lần agent gửi trước ⇒ bỏ qua (không ghi, không xử
// lý). Đổi bất kỳ ⇒ xử lý lại (máy khai sau, gốc VOID tới sau, có mã hạch toán…).
// `bamDienGiai`: ghi chú KHÔNG lưu ở bảng nguồn (có thể mang tên khách) — chỉ băm để GĐ6 so hai nguồn.
import { createHash } from "node:crypto";
import type { DongPos } from "../kieu";

/** JSON với khoá object SẮP XẾP ở mọi tầng — một giá trị, một chuỗi. */
export function jsonSapKhoa(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonSapKhoa).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonSapKhoa(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}

export type DongDaChuanHoa = { d: DongPos; maKetToan: string | null; maLyDoThatBai: string | null };

export function bamDong(x: DongDaChuanHoa): string {
  return sha256Hex(jsonSapKhoa({ ...x.d, maKetToan: x.maKetToan, maLyDoThatBai: x.maLyDoThatBai }));
}

/** NFC + gộp khoảng trắng + trim ⇒ sha256 hex. */
export function bamDienGiai(s: string): string {
  return sha256Hex(s.normalize("NFC").replace(/\s+/g, " ").trim());
}
