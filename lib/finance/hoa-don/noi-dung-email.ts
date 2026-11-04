// lib/finance/hoa-don/noi-dung-email.ts — NỘI DUNG email gửi hoá đơn điện tử cho khách. THUẦN.
//
// PLAN §7: mẫu viết INLINE trong mã, KHÔNG seed `EmailTemplate` ⇒ không có bước chạy tay trên prod.
// ⚠️ Tên người mua / tên đơn vị là chữ NGƯỜI GÕ (sale, phụ huynh) ⇒ ESCAPE trước khi vào HTML.
// ⚠️ Worker đưa subject/body qua `renderTemplate` (thay `{{…}}`). Nội dung ở đây không dùng biến,
// nên dấu `{{` trong tên người mua phải được vô hiệu hoá — không thì chữ khách gõ bị hiểu là biến.

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

const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Vô hiệu hoá cú pháp biến `{{…}}` của `renderTemplate` trong chữ người dùng gõ. */
function voHieuBien(s: string): string {
  return s.replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }");
}

function thoat(s: string): string {
  return voHieuBien(s).replace(/[&<>"']/g, (c) => HTML_ESC[c]!);
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
  const bodyText = voHieuBien(dong.join("\n"));

  const li = (nhan: string, giaTri: string) => `<li>${nhan}: <strong>${thoat(giaTri)}</strong></li>`;
  const bodyHtml = [
    `<p>${thoat(chao)}</p>`,
    `<p>${thoat(donVi)} gửi Quý khách hoá đơn điện tử cho khoản học phí đã thanh toán.</p>`,
    "<ul>",
    li("Số hoá đơn", so),
    ...(t.ngayPhatHanh ? [li("Ngày phát hành", ngayVn(t.ngayPhatHanh))] : []),
    li("Số tiền", tien(t.tongTien)),
    li("Mã đơn hàng", t.maDon),
    "</ul>",
    `<p>Hoá đơn được đính kèm trong email này (${tep}).</p>`,
    "<p>Nếu thông tin trên hoá đơn cần điều chỉnh, Quý khách vui lòng phản hồi email này.</p>",
    `<p>Trân trọng,<br>${thoat(donVi)}</p>`,
  ].join("\n");

  return { subject: voHieuBien(`Hoá đơn điện tử ${so} — ${donVi}`), bodyText, bodyHtml };
}
