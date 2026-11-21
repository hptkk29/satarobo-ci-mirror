// lib/finance/hoa-don/noi-dung-email.ts — NỘI DUNG email gửi hoá đơn điện tử cho khách. THUẦN.
//
// PLAN §7: mẫu viết INLINE trong mã, KHÔNG seed `EmailTemplate` ⇒ không có bước chạy tay trên prod.
// ⚠️ Tên người mua / tên đơn vị là chữ NGƯỜI GÕ (sale, phụ huynh) ⇒ ESCAPE trước khi vào HTML.
// ⚠️ Worker đưa subject/body qua `renderTemplate` (thay `{{…}}`). Nội dung ở đây không dùng biến,
// nên dấu `{{` trong tên người mua phải được vô hiệu hoá — không thì chữ khách gõ bị hiểu là biến.
//
// [09/11/2026] Thân HTML nằm trong KHUNG THƯƠNG HIỆU (`lib/email/khung-thuong-hieu.ts`: logo, dải cam, chân thư liên hệ); bản chữ thuần cũng có chân thư.
// Chữ trong khung không mang `{{`, nên `voHieuBien` chạy trên TOÀN BỘ chuỗi cuối vẫn an toàn.
import { MAU_THUONG_HIEU, chanThuChu, khungEmailSataRobo, thoatHtml } from "@/lib/email/khung-thuong-hieu";

export type ThongTinEmailHoaDon = {
  tenNguoiMua: string | null;
  phapNhanTen: string | null;
  kyHieu: string | null;
  soHoaDon: string | null;
  /** yyyy-mm-dd */
  ngayPhatHanh: string | null;
  tongTien: number;
  maDon: string;
  coXml: boolean;
};

/** Vô hiệu hoá cú pháp biến `{{…}}` của `renderTemplate` trong chữ người dùng gõ. */
function voHieuBien(s: string): string {
  return s.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
}

function thoat(s: string): string {
  return thoatHtml(voHieuBien(s));
}

const tien = (n: number) => `${n.toLocaleString("vi-VN")} đồng`;
const ngayVn = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export function noiDungEmailHoaDon(t: ThongTinEmailHoaDon): { subject: string; bodyText: string; bodyHtml: string } {
  const so = [t.kyHieu, t.soHoaDon].filter(Boolean).join(" - ");
  const donVi = t.phapNhanTen?.trim() || "Sata Robo";
  const chao = t.tenNguoiMua?.trim() ? `Kính gửi ${t.tenNguoiMua.trim()},` : "Kính gửi Quý phụ huynh,";
  const tep = t.coXml ? "tệp PDF và tệp XML" : "tệp PDF";

  const dong = [
    chao,
    "",
    `${donVi} gửi Quý khách hoá đơn điện tử cho khoản học phí đã thanh toán.`,
    "",
    `- Số hoá đơn: ${so}`,
    ...(t.ngayPhatHanh ? [`- Ngày phát hành: ${ngayVn(t.ngayPhatHanh)}`] : []),
    `- Số tiền: ${tien(t.tongTien)}`,
    `- Mã đơn hàng: ${t.maDon}`,
    "",
    `Hoá đơn được đính kèm trong email này (${tep}).`,
    "Nếu thông tin trên hoá đơn cần điều chỉnh, Quý khách vui lòng phản hồi email này.",
    "",
    "Trân trọng,",
    donVi,
  ];
  const bodyText = voHieuBien([...dong, "", chanThuChu()].join("\n"));

  const m = MAU_THUONG_HIEU;
  // Bảng chi tiết hoá đơn: nhãn bên trái, giá trị bên phải; số tiền nhấn màu thương hiệu.
  const hang = (nhan: string, giaTri: string, nhan2 = false) =>
    `<tr><td style="padding:9px 14px;font-size:14px;color:${m.chuPhu};border-bottom:1px solid ${m.vien};width:42%;">${nhan}</td>` +
    `<td style="padding:9px 14px;font-size:${nhan2 ? 17 : 14}px;font-weight:700;color:${nhan2 ? m.camDam : m.chu};border-bottom:1px solid ${m.vien};">${thoat(giaTri)}</td></tr>`;
  const noiDungHtml = [
    `<p style="margin:0 0 14px 0;">${thoat(chao)}</p>`,
    `<p style="margin:0 0 18px 0;">${thoat(donVi)} gửi Quý khách hoá đơn điện tử cho khoản học phí đã thanh toán.</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${m.camNhat};border:1px solid #FED7AA;border-radius:10px;margin:0 0 18px 0;">`,
    hang("Số hoá đơn", so),
    ...(t.ngayPhatHanh ? [hang("Ngày phát hành", ngayVn(t.ngayPhatHanh))] : []),
    hang("Mã đơn hàng", t.maDon),
    hang("Số tiền", tien(t.tongTien), true),
    `</table>`,
    `<p style="margin:0 0 14px 0;"><strong>Hoá đơn được đính kèm</strong> trong email này (${tep}).</p>`,
    `<p style="margin:0 0 20px 0;color:${m.chuPhu};">Nếu thông tin trên hoá đơn cần điều chỉnh, Quý khách vui lòng phản hồi email này.</p>`,
    `<p style="margin:0;">Trân trọng,<br><strong>${thoat(donVi)}</strong></p>`,
  ].join("\n");
  const bodyHtml = voHieuBien(
    khungEmailSataRobo({
      tieuDe: `Hoá đơn điện tử ${so}`,
      preheader: `Hoá đơn điện tử ${so} — ${tien(t.tongTien)}. Hoá đơn đính kèm trong email này.`,
      noiDungHtml,
    }),
  );

  return { subject: voHieuBien(`Hoá đơn điện tử ${so} — ${donVi}`), bodyText, bodyHtml };
}
