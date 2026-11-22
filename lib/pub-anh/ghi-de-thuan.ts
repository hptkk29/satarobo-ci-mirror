/**
 * Ảnh giao diện public SỬA ĐƯỢC từ admin (chủ dự án 04/11/2026: "admin hoặc marketing sửa được ảnh").
 *
 * Mỗi ảnh của giao diện public là một "ô" định danh bằng MÃ ẢNH (32 ký tự hex — chính là mã đang dùng ở `<PubAnh id="…">`).
 * Ảnh mặc định nằm trong repo; ảnh THAY do admin/marketing tải lên R2 (qua `/api/admin/upload`) và chỉ được lưu một dòng
 * `SitePageContent(pageKey="pub-anh", contentKey=<mã ảnh>, contentValue=<JSON {url,w,h}>)` — KHÔNG thêm bảng, KHÔNG migration.
 * Xoá dòng = quay về ảnh mặc định.
 *
 * Tệp này THUẦN (không DB, không React) để client và server dùng chung cùng một luật.
 */

/** `SitePageContent.pageKey` của mọi dòng ghi đè ảnh. */
export const PUB_ANH_PAGE_KEY = "pub-anh";

export const MA_ANH_RE = /^[0-9a-f]{32}$/;

/** Host CDN công khai mặc định (cùng host trong `images.remotePatterns` của next.config.ts). */
export const HOST_CDN_MAC_DINH = "cdn.satarobo.vn";

/** Mọi ảnh thay đều nằm dưới thư mục này của R2 (do `/api/admin/upload` sinh ra). */
export const TIEN_TO_DUONG_DAN = "/uploads/images/";

export const DUOI_ANH_CHO_PHEP = [".webp", ".jpg", ".jpeg", ".png"] as const;

/** Biên kích thước pixel hợp lý của ảnh đã lưu. */
export const CANH_MIN = 100;
export const CANH_MAX = 4000;

/** Độ lệch tỉ lệ khung tối đa giữa ảnh thay và ô (ảnh được cắt theo khung ở trình duyệt nên chỉ lệch do làm tròn). */
export const SAI_SO_TI_LE = 0.02;

export interface GhiDeAnh {
  url: string;
  w: number;
  h: number;
}

/**
 * Host được phép: CDN mặc định + host của `R2_PUBLIC_URL`. ⛔ KHÔNG nới thành wildcard — `/_next/image` không qua đăng nhập
 * nên mọi host ở đây là host mà MÁY CHỦ sẽ đi tải và giải mã ảnh (issue #1067, `lib/security/next-image-config.test.ts`).
 */
export function hostChoPhep(r2PublicUrl: string | undefined): string[] {
  const ds = new Set<string>([HOST_CDN_MAC_DINH]);
  const goc = r2PublicUrl?.trim();
  if (goc) {
    try {
      ds.add(new URL(/^https?:\/\//i.test(goc) ? goc : `https://${goc}`).host.toLowerCase());
    } catch {
      /* cấu hình hỏng: chỉ còn CDN mặc định */
    }
  }
  return [...ds];
}

/** Trả lời lý do TỪ CHỐI (tiếng Việt) hoặc `null` nếu URL hợp lệ. */
export function lyDoUrlKhongHopLe(url: string, hosts: readonly string[]): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Địa chỉ ảnh không hợp lệ";
  }
  if (u.protocol !== "https:") return "Địa chỉ ảnh phải dùng https";
  if (u.username || u.password) return "Địa chỉ ảnh không được chứa tài khoản";
  if (!hosts.includes(u.host.toLowerCase())) return "Ảnh phải được tải lên kho ảnh của hệ thống";
  if (!u.pathname.startsWith(TIEN_TO_DUONG_DAN)) return "Ảnh phải nằm trong thư mục ảnh tải lên";
  if (u.pathname.includes("..") || u.search || u.hash) return "Địa chỉ ảnh không hợp lệ";
  const p = u.pathname.toLowerCase();
  if (!DUOI_ANH_CHO_PHEP.some((d) => p.endsWith(d))) return "Chỉ nhận ảnh WebP, JPG hoặc PNG";
  return null;
}

function laCanhHopLe(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= CANH_MIN && n <= CANH_MAX;
}

/** Đọc giá trị đã lưu. Sai hình dạng / sai host ⇒ `null` (coi như không ghi đè, ảnh mặc định hiện ra — KHÔNG ném lỗi ra trang công khai). */
export function phanTichGhiDe(raw: string, hosts: readonly string[]): GhiDeAnh | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null) return null;
  const { url, w, h } = o as Record<string, unknown>;
  if (typeof url !== "string" || !laCanhHopLe(w) || !laCanhHopLe(h)) return null;
  if (lyDoUrlKhongHopLe(url, hosts) !== null) return null;
  return { url, w, h };
}

export function dongGoiGhiDe(g: GhiDeAnh): string {
  return JSON.stringify({ url: g.url, w: g.w, h: g.h });
}

/** Tỉ lệ của ảnh thay phải khớp tỉ lệ của ô (trong sai số) — nếu không, khung trang sẽ méo/nhảy. */
export function tiLeKhop(slotW: number, slotH: number, w: number, h: number): boolean {
  const a = slotW / slotH;
  const b = w / h;
  return Math.abs(a - b) / a <= SAI_SO_TI_LE;
}

export interface KhungCat {
  /** Toạ độ góc trái-trên và kích thước vùng lấy từ ảnh nguồn (pixel nguồn). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Vùng lớn nhất của ảnh nguồn có đúng tỉ lệ của ô (kiểu `object-fit: cover`). `viTri` ∈ [0,1] trượt vùng cắt dọc theo
 * trục bị thừa (0 = sát trái/trên, 0.5 = giữa, 1 = sát phải/dưới); nguồn đã đúng tỉ lệ thì không có gì để trượt.
 */
export function tinhKhungCat(srcW: number, srcH: number, slotW: number, slotH: number, viTri = 0.5): KhungCat {
  const t = Math.min(1, Math.max(0, Number.isFinite(viTri) ? viTri : 0.5));
  const tiLeO = slotW / slotH;
  const tiLeNguon = srcW / srcH;
  if (tiLeNguon > tiLeO) {
    const sw = Math.round(srcH * tiLeO);
    return { sx: Math.round((srcW - sw) * t), sy: 0, sw, sh: srcH };
  }
  const sh = Math.round(srcW / tiLeO);
  return { sx: 0, sy: Math.round((srcH - sh) * t), sw: srcW, sh };
}

/** Cạnh dài mục tiêu của ảnh xuất: gấp đôi ô (cho màn DPR2), tối thiểu 1600, tối đa 2000 — rồi KHÔNG phóng to quá vùng cắt. */
export function kichThuocXuat(slotW: number, slotH: number, cat: KhungCat): { w: number; h: number } {
  const canhDaiO = Math.max(slotW, slotH);
  const mucTieu = Math.min(2000, Math.max(1600, 2 * canhDaiO));
  const canhDaiCat = Math.max(cat.sw, cat.sh);
  const canhDaiXuat = Math.min(mucTieu, canhDaiCat);
  const k = canhDaiXuat / canhDaiO;
  return { w: Math.max(CANH_MIN, Math.round(slotW * k)), h: Math.max(CANH_MIN, Math.round(slotH * k)) };
}

export type CanhBaoDoNet = "nho-hon-anh-cu" | "hoi-nho" | null;

/** Cảnh báo ảnh chọn có thể mờ — dựa trên vùng cắt THẬT (pixel nguồn), không phải ảnh sau khi nén. */
export function canhBaoDoNet(slotW: number, slotH: number, cat: KhungCat): CanhBaoDoNet {
  const canhDaiCat = Math.max(cat.sw, cat.sh);
  if (canhDaiCat < Math.max(slotW, slotH)) return "nho-hon-anh-cu";
  if (canhDaiCat < 1000) return "hoi-nho";
  return null;
}
