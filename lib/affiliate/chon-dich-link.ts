// lib/affiliate/chon-dich-link.ts — LUẬT CHỌN ĐÍCH CỦA MỘT LINK Ở GIAO DIỆN (Sheet «Phát link» của admin + biểu mẫu «Tạo link» của cổng đối tác). THUẦN, dùng được ở trình duyệt. (AFF-L6)
//
// Giao diện KHÔNG viết luật: ô chọn chỉ là BỘ LỌC dễ dùng; cổng thật là `kiemPhatLink` ở máy chủ (cùng `kiemChuoiLink` với lúc khách bấm). Tệp này chỉ gom phần "người chọn đã chọn đủ chưa / đường
// dẫn cụ thể có khớp mẫu của trang đích đã chọn không" để HAI nơi chọn (admin · cổng đối tác) không có hai bản — sửa một bên là sai lệch bên kia (luật 12b).
//
// Mọi thứ gửi lên máy chủ chỉ là ID lựa chọn + đường dẫn: tên miền KHÔNG gửi (máy chủ suy từ dòng trang đích), đối tác/membership/website được máy chủ kiểm lại thuộc về người gọi.
import type { TrangDichChon } from "./doc-link";
import { DO_DAI_NHAN_LINK_TOI_DA, kiemDuongDanLink } from "./ghi-link-dau-vao";
import { khopDuongDan } from "./website-hop-le";

/** Phần đường dẫn gợi ý khi chọn mẫu tiền tố: `/khoa-hoc/*` ⇒ `/khoa-hoc/`; `/*` ⇒ `/`. */
export const tienToCuaMau = (mau: string): string => mau.slice(0, -1);

/** Đường dẫn đích: mẫu CHÍNH XÁC dùng nguyên văn; mẫu tiền tố lấy phần người dùng gõ. */
export function duongDanDaChon(trang: TrangDichChon | null, cuThe: string): string {
  if (trang === null) return "";
  return trang.kieu === "CHINH_XAC" ? trang.mau : cuThe.trim();
}

/** Nhãn một trang đích trong ô chọn: có TÊN MIỀN (một website có thể có nhiều) và đường dẫn / tiền tố. */
export function nhanTrangDichChon(t: TrangDichChon): string {
  const dich = t.kieu === "TIEN_TO" ? `Mọi trang con của ${t.host}${tienToCuaMau(t.mau)}` : `${t.host}${t.mau}`;
  return t.nhan ? `${dich} — ${t.nhan}` : dich;
}

export type TruongChonLink = "partyId" | "membershipId" | "siteId" | "landingPath" | "label";
export type LoiChonLink = Partial<Record<TruongChonLink, string>>;

/** Kiểm lựa chọn TRƯỚC khi gọi máy chủ (chỉ để báo sớm cạnh ô — không phải cổng). `doiTacDaChon` / … là true khi đã chọn được phần tử tương ứng. */
export function kiemLuaChonLink(p: {
  daChonDoiTac: boolean;
  daChonChuongTrinh: boolean;
  daChonWebsite: boolean;
  trang: TrangDichChon | null;
  cuThe: string;
  nhan: string;
}): { loi: LoiChonLink; duongDan: string } {
  const loi: LoiChonLink = {};
  const duongDan = duongDanDaChon(p.trang, p.cuThe);
  if (!p.daChonDoiTac) loi.partyId = "Chọn đối tác.";
  else if (!p.daChonChuongTrinh) loi.membershipId = "Chọn chương trình (campaign) của đối tác.";
  else if (!p.daChonWebsite) loi.siteId = "Chọn website.";
  else if (p.trang === null) loi.landingPath = "Chọn trang đích.";
  else {
    const d = kiemDuongDanLink(duongDan);
    if (!d.ok) loi.landingPath = d.loi;
    else if (!khopDuongDan(p.trang.mau, d.duongDan)) loi.landingPath = `Đường dẫn không khớp mẫu ${p.trang.mau}.`;
  }
  if (p.nhan.trim().length > DO_DAI_NHAN_LINK_TOI_DA) loi.label = `Nhãn tối đa ${DO_DAI_NHAN_LINK_TOI_DA} ký tự.`;
  return { loi, duongDan };
}
