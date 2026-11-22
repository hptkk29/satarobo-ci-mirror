// lib/misa/meinvoice/gia-lap.ts — cổng GIẢ LẬP: không gọi mạng, KHÔNG có giá trị pháp lý.
//
// Để màn Hoá đơn điện tử chạy trọn luồng (phát hành → tra cứu → tải tệp) ở máy dev / test mà không
// chạm MISA. Số hoá đơn TẤT ĐỊNH từ refId (tiền tố "MP") để test so được; bộ nhớ các refId đã
// phát hành là của TIẾN TRÌNH (khởi động lại là quên — traCuu trả CHUA_CO, đúng như một MISA trống).
//
// Kiểm phiếu y hệt cổng thật (`kiemPhieu`) ⇒ nhánh TU_CHOI dùng được để thử màn hình.

import type { CongHoaDon, DaPhatHanh, KetQuaPhatHanh, KetQuaTraCuu, LoaiTep, PhieuPhatHanh } from "./cong";
import { MA_TU_CHAN, kiemPhieu } from "./anh-xa";

export const DONG_MO_PHONG = "BAN MO PHONG - KHONG CO GIA TRI PHAP LY";

/** refId (chữ thường, đã trim) → kết quả đã phát hành. */
const daPhatHanh = new Map<string, DaPhatHanh>();

/** Chỉ cho test. */
export function _xoaBoNhoGiaLapChoTest(): void {
  daPhatHanh.clear();
}

/** FNV-1a 32 bit — đủ tất định, không cần mật mã. */
function bam(s: string, hat = 0x811c9dc5): number {
  let h = hat >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function khoa(refId: string): string {
  return refId.trim().toLowerCase();
}

export function soHoaDonGiaLap(refId: string): string {
  return `MP${String(bam(khoa(refId)) % 100_000_000).padStart(8, "0")}`;
}

export function maTraCuuGiaLap(refId: string): string {
  const a = bam(khoa(refId)).toString(36).toUpperCase().padStart(7, "0");
  const b = bam(khoa(refId), 0x9e3779b9).toString(36).toUpperCase().padStart(7, "0");
  return `MP-${a}${b}`;
}

function chiAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "?");
}

/** PDF 1.4 tối thiểu hợp lệ (bảng xref đúng offset), một trang, hai dòng chữ. */
export function pdfMoPhong(maTraCuu: string): Uint8Array {
  const esc = (s: string) => chiAscii(s).replace(/[\\()]/g, (c) => `\\${c}`);
  const noiDung =
    `BT /F1 14 Tf 50 780 Td (${esc(DONG_MO_PHONG)}) Tj ET\n` +
    `BT /F1 11 Tf 50 750 Td (Ma tra cuu: ${esc(maTraCuu)}) Tj ET\n`;
  const doiTuong = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(noiDung, "latin1")} >>\nstream\n${noiDung}endstream`,
  ];
  let out = "%PDF-1.4\n";
  const offset: number[] = [];
  doiTuong.forEach((o, i) => {
    offset.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${doiTuong.length + 1}\n0000000000 65535 f \n`;
  for (const o of offset) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${doiTuong.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

export function xmlMoPhong(maTraCuu: string): Uint8Array {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<HoaDonMoPhong>\n  <GhiChu>${DONG_MO_PHONG}</GhiChu>\n  <MaTraCuu>${esc(maTraCuu)}</MaTraCuu>\n</HoaDonMoPhong>\n`;
  return new Uint8Array(Buffer.from(xml, "utf8"));
}

export function taoCongGiaLap(): CongHoaDon {
  return {
    cheDo: "GIA_LAP",
    moiTruong: "gia-lap",
    async phatHanh(phieu: PhieuPhatHanh): Promise<KetQuaPhatHanh> {
      const loi = kiemPhieu(phieu);
      if (loi) return { loai: "TU_CHOI", ma: MA_TU_CHAN, thongDiep: loi };
      const k = khoa(phieu.refId);
      const co = daPhatHanh.get(k);
      if (co) return co; // cùng refId ⇒ cùng hoá đơn (như MISA chống trùng theo RefID)
      const kq: DaPhatHanh = {
        loai: "DA_PHAT_HANH",
        refId: phieu.refId,
        kyHieu: phieu.kyHieu.trim().toUpperCase(),
        soHoaDon: soHoaDonGiaLap(phieu.refId),
        ngayPhatHanh: phieu.ngayHoaDon,
        maTraCuu: maTraCuuGiaLap(phieu.refId),
      };
      daPhatHanh.set(k, kq);
      return kq;
    },
    async traCuu(refId: string): Promise<KetQuaTraCuu> {
      return daPhatHanh.get(khoa(refId)) ?? { loai: "CHUA_CO" };
    },
    async taiTep(maTraCuu: string, loai: LoaiTep): Promise<Uint8Array> {
      return loai === "pdf" ? pdfMoPhong(maTraCuu) : xmlMoPhong(maTraCuu);
    },
  };
}
