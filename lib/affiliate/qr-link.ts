// lib/affiliate/qr-link.ts — DỰNG MÃ QR của link giới thiệu (AFF-P1). CHỈ MÁY CHỦ: `qrcode` không được kéo vào bundle trình duyệt (`server-only`).
//
// QR luôn mã hoá địa chỉ NGẮN `<gốc>/r/<TOKEN>` (`dungUrlChuyenHuong`) — không PII, không id nội bộ, không `?aff=`. Hàm `dungQrChoToken` KHÔNG nhận URL: nhận token + gốc rồi tự dựng,
// để không ai nhét được một địa chỉ khác (có tên/SĐT, hoặc trang ngoài) vào hình QR đem in.
//
// Đầu ra là SVG dạng CHUỖI, không nhúng script/liên kết ngoài. Giao diện hiển thị nó bằng thẻ <img> với data-URI (`svgThanhDataUri`) — KHÔNG `dangerouslySetInnerHTML`
// (cấm ngoài JSON-LD) — và cũng là địa chỉ cho nút «Tải về» (`download="….svg"`).
import "server-only";
import QRCode from "qrcode";
import { dungUrlChuyenHuong } from "./dung-url-theo-doi";

/** Trần độ dài chuỗi đưa vào QR (đủ rộng cho `/r/<TOKEN>`; chặn chuỗi rác khổng lồ). */
export const DO_DAI_QR_TOI_DA = 512;

/** SVG của QR cho một chuỗi. Mức sửa lỗi M — in trên giấy/biển có thể mờ. Chuỗi rỗng hoặc quá dài ⇒ ném. */
export async function dungQrSvg(noiDung: string): Promise<string> {
  if (noiDung === "" || noiDung.length > DO_DAI_QR_TOI_DA) throw new Error("Nội dung QR rỗng hoặc quá dài.");
  return await QRCode.toString(noiDung, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}

/** QR của link `<gốc>/r/<TOKEN>`. Gốc/token hỏng ⇒ ném (xem `dungUrlChuyenHuong`). */
export async function dungQrChoToken(goc: string, token: string): Promise<string> {
  return await dungQrSvg(dungUrlChuyenHuong(goc, token));
}

/** data-URI của SVG, dùng cho <img src> và <a download>. */
export function svgThanhDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
