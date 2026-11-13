// lib/email/khung-thuong-hieu.ts — KHUNG EMAIL THƯƠNG HIỆU Sata Robo (đầu thư có logo, thân thư, chân thư). THUẦN: không DB, không đồng hồ, không biến môi trường.
//
// Chủ dự án (09/11/2026), nhìn bản xem trước email hoá đơn: «email gì không có header footer gì hết, màu thương hiệu của Sata Robo đâu?». Trước đó mọi email của hệ thống là chữ thuần
// hoặc vài thẻ <p>. Đây là khung đầu tiên dùng chung; email hoá đơn dùng trước, các email khác nối dần khi chủ dự án chốt.
//
// Luật viết email HTML (khác trang web — đừng "tối ưu" theo thói quen web):
//   · Bố cục bằng <table>, MỌI kiểu viết INLINE (Gmail/Outlook cắt hoặc bỏ <style>); không flex/grid, không CSS biến, không font web.
//   · Ảnh phải là URL TUYỆT ĐỐI ra internet (logo ở `satarobo.vn/brand/…`) kèm `width`/`height` + `alt`: nhiều trình đọc chặn ảnh theo mặc định, khi đó vẫn đọc được nhờ `alt`
//     và tên thương hiệu in chữ ngay cạnh logo.
//   · Màu thương hiệu: cam #F97316, tím #7C3AED (CLAUDE.md). Chữ thân luôn tối trên nền sáng — khoá `color-scheme: light` để chế độ tối của ứng dụng thư không đảo màu nền thành xám khó đọc.
//   · Chân thư KHÔNG in địa chỉ / mã số doanh nghiệp: người bán trên hoá đơn là PHÁP NHÂN phát hành (có hai pháp nhân khác nhau theo cơ sở) — in thông tin công ty ở đây có thể mâu thuẫn
//     với tờ hoá đơn đính kèm. Chỉ in kênh liên hệ chung (điện thoại/Zalo, email, website).
//   · Chữ do người gõ (tên khách, tên đơn vị) PHẢI được escape TRƯỚC khi đưa vào `noiDungHtml` — khung không escape hộ.
import { SATA_ROBO_CONTACT, SATA_ROBO_PHONE } from "@/lib/locations";

export const MAU_THUONG_HIEU = { cam: "#F97316", camNhat: "#FFF7ED", camDam: "#C2410C", tim: "#7C3AED", timNhat: "#F5F3FF", chu: "#111827", chuPhu: "#4B5563", vien: "#E5E7EB", nen: "#F4F4F5" } as const;

export const URL_WEBSITE = "https://satarobo.vn";
/** Logo trên website công khai (`public/brand/logo-satarobo.png`, 644×380). Không đổi tên tệp này mà không sửa đường dẫn ở đây — email đã gửi đi vẫn trỏ tới nó. */
export const URL_LOGO = `${URL_WEBSITE}/brand/logo-satarobo.png`;
const LOGO_RONG = 112;
const LOGO_CAO = Math.round((LOGO_RONG * 380) / 644);

const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape cho văn bản người gõ / hằng số có thể chứa ký tự đặc biệt. */
export const thoatHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESC[c]!);

/** Dòng chân thư dạng chữ thuần (đi kèm bản `text/plain`). */
export function chanThuChu(): string {
  return ["—", `${SATA_ROBO_CONTACT.shortName} · Điện thoại / Zalo: ${SATA_ROBO_PHONE.hien} · ${SATA_ROBO_CONTACT.emails.general} · ${URL_WEBSITE.replace("https://", "")}`, "Đây là email gửi tự động từ hệ thống Sata Robo."].join("\n");
}

/**
 * Bọc `noiDungHtml` (đã escape, đã là HTML hợp lệ) trong khung thương hiệu.
 * `preheader` = dòng xem trước hiện cạnh tiêu đề trong hộp thư (ẩn trong thân thư); `tieuDe` = thẻ <title>.
 */
export function khungEmailSataRobo(i: { tieuDe: string; preheader: string; noiDungHtml: string }): string {
  const m = MAU_THUONG_HIEU;
  const dt = SATA_ROBO_PHONE;
  const mail = SATA_ROBO_CONTACT.emails.general;
  const link = (href: string, chu: string) => `<a href="${thoatHtml(href)}" style="color:${m.tim};text-decoration:none;font-weight:600;">${thoatHtml(chu)}</a>`;
  return [
    `<!doctype html>`,
    `<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${thoatHtml(i.tieuDe)}</title></head>`,
    `<body style="margin:0;padding:0;background:${m.nen};">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${thoatHtml(i.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${m.nen};"><tr><td align="center" style="padding:24px 12px;">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${m.vien};border-radius:12px;">`,
    // Dải màu thương hiệu trên cùng
    `<tr><td style="height:6px;line-height:6px;font-size:0;background:${m.cam};border-radius:12px 12px 0 0;">&nbsp;</td></tr>`,
    // Đầu thư: CHỈ logo (logo đã có chữ SATA ROBO — in thêm tên bằng chữ là trùng, chủ dự án 09/11/2026); khi ảnh bị chặn thì `alt="Sata Robo"` thay thế
    `<tr><td style="padding:22px 28px 14px 28px;border-bottom:1px solid ${m.vien};"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td style="vertical-align:middle;"><a href="${URL_WEBSITE}" style="text-decoration:none;"><img src="${URL_LOGO}" width="${LOGO_RONG}" height="${LOGO_CAO}" alt="Sata Robo" style="display:block;border:0;outline:none;text-decoration:none;width:${LOGO_RONG}px;height:${LOGO_CAO}px;"></a></td>`,
    `</tr></table></td></tr>`,
    // Thân thư
    `<tr><td style="padding:24px 28px 26px 28px;font-family:${FONT};font-size:15px;line-height:1.65;color:${m.chu};">`,
    i.noiDungHtml,
    `</td></tr>`,
    // Chân thư
    `<tr><td style="padding:18px 28px 20px 28px;background:${m.timNhat};border-top:1px solid ${m.vien};border-radius:0 0 12px 12px;font-family:${FONT};font-size:12.5px;line-height:1.7;color:${m.chuPhu};">`,
    `<div style="font-weight:700;color:${m.chu};">Cần hỗ trợ? Liên hệ Sata Robo</div>`,
    `<div>Điện thoại / Zalo: ${link(`tel:${dt.tho}`, dt.hien)} &nbsp;·&nbsp; Email: ${link(`mailto:${mail}`, mail)}</div>`,
    `<div>Website: ${link(URL_WEBSITE, URL_WEBSITE.replace("https://", ""))}</div>`,
    `<div style="margin-top:10px;font-size:11.5px;color:#6B7280;">Đây là email gửi tự động từ hệ thống Sata Robo. Bạn có thể trả lời trực tiếp email này nếu cần điều chỉnh thông tin.</div>`,
    `</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("\n");
}
