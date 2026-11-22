/**
 * lib/affiliate/the-trang-dich.ts — tab «Link theo trang đích» của màn «Link giới thiệu của tôi». THUẦN.
 *
 * Chủ dự án 21/11/2026: chọn trang đích ⇒ «Lấy link» ⇒ NGAY TRÊN THẺ: link ngắn để sao chép + mã QR + lượt bấm + lượt giới thiệu + trạng thái + nút «Thu hồi»; thu hồi xong thẻ hiện
 * «Cấp link mới». KHÔNG còn khối «Link của bạn» riêng bên dưới (lặp thông tin).
 *
 * Mỗi trang đích mà nhân sự được phát link (CÙNG danh sách với ô chọn «Tạo link» — `TaoLinkCuaToi`, đã qua cổng chương trình/website/trang đích) thành MỘT thẻ. Link gắn vào thẻ = link
 * của chính người đó khớp host + đường dẫn: link ĐANG HOẠT ĐỘNG nếu có, không thì link MỚI NHẤT đã thu hồi (danh sách link đến theo `createdAt` giảm dần). «Lấy link» / «Cấp link mới» gửi
 * đúng bộ khoá mà form «Tạo link» gửi, nên máy chủ xét y như nhau.
 */
import type { LinkCuaToi, TaoLinkCuaToi } from "./cua-toi";

export type LinkTrenThe = {
  id: string;
  hoatDong: boolean;
  /** Link để gửi khách: link ngắn nếu máy chủ có gốc link ngắn, không thì URL cuối. null khi đã thu hồi. */
  lienKet: string | null;
  laLinkNgan: boolean;
  soLuotBam: number;
  soReferral: number;
};

export type TheTrangDich = {
  khoa: string;
  ten: string;
  host: string;
  duongDan: string;
  /** Bộ khoá gửi máy chủ khi «Lấy link» / «Cấp link mới» — CÙNG hình với form «Tạo link». */
  vao: { membershipId: string; siteId: string; landingPageId: string; landingPath: string; label: null };
  /** null = trang này chưa từng có link của người này. */
  link: LinkTrenThe | null;
};

function linkCuaThe(l: LinkCuaToi): LinkTrenThe {
  const lienKet = l.hoatDong ? (l.lienKetNgan ?? l.urlCuoi) : null;
  return { id: l.id, hoatDong: l.hoatDong, lienKet, laLinkNgan: l.hoatDong && l.lienKetNgan !== null, soLuotBam: l.soLuotBam, soReferral: l.soReferral };
}

export function dungTheTrangDich(taoLink: TaoLinkCuaToi, link: readonly LinkCuaToi[]): TheTrangDich[] {
  const ra: TheTrangDich[] = [];
  const daCo = new Set<string>();
  for (const ct of taoLink.chuongTrinh) {
    for (const w of ct.websites) {
      for (const t of w.trangDich) {
        const khoa = `${w.siteId}|${t.id}`;
        if (daCo.has(khoa)) continue; // cùng trang đích ở hai chương trình ⇒ một thẻ (chương trình đầu tiên)
        daCo.add(khoa);
        const cungTrang = link.filter((l) => l.website === w.host && l.trangDich === t.mau);
        const chon = cungTrang.find((l) => l.hoatDong) ?? cungTrang[0] ?? null;
        ra.push({
          khoa,
          ten: t.nhan ?? t.mau,
          host: w.host,
          duongDan: t.mau,
          vao: { membershipId: ct.membershipId, siteId: w.siteId, landingPageId: t.id, landingPath: t.mau, label: null },
          link: chon ? linkCuaThe(chon) : null,
        });
      }
    }
  }
  return ra;
}
