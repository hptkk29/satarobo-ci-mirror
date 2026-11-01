// lib/affiliate/dung-url-theo-doi.ts — DỰNG ĐỊA CHỈ của link giới thiệu (AFF-P1, docs/source-commission/12 §2.3, §2.6; đặc tả §16–§21, §63–§66). THUẦN: không DB, không đồng hồ.
//
// Hai địa chỉ, hai việc — và cả hai chỉ được dựng từ DỮ LIỆU ĐÃ LƯU, không bao giờ từ một URL thô do người dùng/khách đưa:
//   · `dungUrlDich`        — địa chỉ ĐÍCH trên website đối tác: `https://<host><path>?aff=<TOKEN>&cmp=<CODE>[&clk=<ClickId>][&utm_…]`. Đây là chỗ CHẶN open-redirect:
//                            host + đường dẫn phải qua `kiemUrlDuocPhep` (hợp đồng bảo mật của `website-hop-le.ts`) TRƯỚC khi trả; không qua ⇒ không có URL.
//   · `dungUrlChuyenHuong` — địa chỉ NGẮN của dịch vụ chuyển hướng: `<gốc>/r/<TOKEN>` (dùng cho QR / in ấn). `<gốc>` là origin công khai CẤU HÌNH theo môi trường (`goc-cong-khai.ts`), không lấy từ request.
//
// Quy tắc cứng:
//  · Tham số gắn thêm chỉ gồm `aff` · `cmp` · `clk` · năm khoá `utm_*`. KHÔNG tên, SĐT, email, id nội bộ, id đối tác, id membership, id campaign (dùng MÃ campaign `cmp`).
//  · `utm_*` chỉ để báo cáo (§67) — khoá ngoài danh sách bị bỏ, giá trị cắt 100 ký tự, bỏ ký tự điều khiển, mã hoá URL.
//  · `clk` (id lượt bấm) chỉ do `/r/[token]` truyền vào SAU KHI đã ghi click; phải có dạng cuid. Link trực tiếp (phát từ tab) không có `clk` — vẫn hợp lệ.
import { chuanHoaToken } from "./token";
import { MA_DANH_MUC_RE } from "./chung";
import { kiemUrlDuocPhep, type MaLyDo, type SiteDeKiem, type TrangDichDeKiem } from "./website-hop-le";

/** Khoá utm được phép đi theo link. Thứ tự này cũng là thứ tự trên URL. */
export const KHOA_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type KhoaUtm = (typeof KHOA_UTM)[number];
export type Utm = Partial<Record<KhoaUtm, string>>;

/** Trần độ dài giá trị utm. */
export const DO_DAI_UTM_TOI_DA = 100;

/** cuid của Prisma: `c` + 24 ký tự [a-z0-9]. */
export const CLICK_ID_RE = /^c[a-z0-9]{24}$/;

/** Phần của website mà phép dựng cần: thêm `baseUrl` so với `SiteDeKiem`. */
export type SiteDeDung = SiteDeKiem & { baseUrl: string };

export type LyDoKhongDungDuoc = MaLyDo | "TOKEN_KHONG_HOP_LE" | "MA_CAMPAIGN_KHONG_HOP_LE" | "CLICK_ID_KHONG_HOP_LE";

export type KetQuaDungUrl = { ok: true; url: string } | { ok: false; lyDo: LyDoKhongDungDuoc };

/** Chuẩn hoá bộ utm: chỉ khoá trong danh sách, giá trị cắt gọn, bỏ ký tự điều khiển/rỗng. Trả theo thứ tự `KHOA_UTM`. THUẦN. */
export function chuanHoaUtm(raw: Readonly<Record<string, unknown>> | null | undefined): Utm {
  const ra: Utm = {};
  if (!raw) return ra;
  for (const k of KHOA_UTM) {
    const v = raw[k];
    if (typeof v !== "string") continue;
    const sach = v.replace(/\p{Cc}/gu, "").trim().slice(0, DO_DAI_UTM_TOI_DA);
    if (sach !== "") ra[k] = sach;
  }
  return ra;
}

/**
 * Địa chỉ trang đích SẠCH (không `aff`/`cmp`/`clk`) của một link — dùng cho khách bấm link KHÔNG hợp lệ: họ vẫn tới trang họ muốn, chỉ không gắn người giới thiệu.
 * Vẫn qua `kiemUrlDuocPhep` (website đã ngừng/tắt theo dõi ⇒ không có địa chỉ; nơi gọi rơi về trang chủ của gốc công khai).
 */
export function dungUrlTrangDich(p: { site: SiteDeDung; trangDich: readonly TrangDichDeKiem[]; landingHost: string; landingPath: string }): KetQuaDungUrl {
  // AFF-L6: tên miền đích là của LINK (ảnh chụp lúc phát, đã giải) — một website có thể có nhiều tên miền; KHÔNG luôn là `baseUrl`. Vẫn qua `kiemUrlDuocPhep` ⇒ phải ∈ `allowedDomains`.
  const kq = kiemUrlDuocPhep(`https://${p.landingHost}${p.landingPath}`, p.site, p.trangDich);
  if (!kq.ok) return { ok: false, lyDo: kq.lyDo };
  return { ok: true, url: kq.url };
}

/**
 * Địa chỉ ĐÍCH có tham số theo dõi. `token` + `campaignCode` + `landingPath` + `site` đều lấy từ DB; hàm KHÔNG nhận URL thô.
 * `clickId` chỉ có khi đường chuyển hướng `/r` vừa ghi click.
 */
export function dungUrlDich(p: {
  site: SiteDeDung;
  trangDich: readonly TrangDichDeKiem[];
  /** Tên miền đích của link (đã giải). BẮT BUỘC (luật 7): không có mặc định «baseUrl» ngầm. */
  landingHost: string;
  landingPath: string;
  token: string;
  campaignCode: string;
  clickId?: string | null;
  utm?: Readonly<Record<string, unknown>> | null;
}): KetQuaDungUrl {
  const token = chuanHoaToken(p.token);
  if (token === null || token !== p.token) return { ok: false, lyDo: "TOKEN_KHONG_HOP_LE" };
  if (!MA_DANH_MUC_RE.test(p.campaignCode)) return { ok: false, lyDo: "MA_CAMPAIGN_KHONG_HOP_LE" };
  if (p.clickId !== undefined && p.clickId !== null && !CLICK_ID_RE.test(p.clickId)) return { ok: false, lyDo: "CLICK_ID_KHONG_HOP_LE" };

  const sach = dungUrlTrangDich(p);
  if (!sach.ok) return sach;

  const phan: string[] = [`aff=${encodeURIComponent(token)}`, `cmp=${encodeURIComponent(p.campaignCode)}`];
  if (p.clickId) phan.push(`clk=${encodeURIComponent(p.clickId)}`);
  const utm = chuanHoaUtm(p.utm);
  for (const k of KHOA_UTM) {
    const v = utm[k];
    if (v !== undefined) phan.push(`${k}=${encodeURIComponent(v)}`);
  }
  return { ok: true, url: `${sach.url}?${phan.join("&")}` };
}

/** Origin công khai hợp lệ: `https://<tên-miền>` — không đường dẫn, query, cổng. */
const GOC_RE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Địa chỉ NGẮN `<gốc>/r/<TOKEN>`. `goc` là origin công khai CẤU HÌNH (không lấy từ request/Host). Gốc hay token hỏng là LỖI LẬP TRÌNH ⇒ ném (không trả chuỗi nửa vời để in lên QR).
 */
export function dungUrlChuyenHuong(goc: string, token: string): string {
  if (!GOC_RE.test(goc)) throw new Error("Gốc link chuyển hướng phải là https://<tên-miền> (không đường dẫn, không cổng).");
  const t = chuanHoaToken(token);
  if (t === null || t !== token) throw new Error("Token link không hợp lệ.");
  return `${goc}/r/${t}`;
}
