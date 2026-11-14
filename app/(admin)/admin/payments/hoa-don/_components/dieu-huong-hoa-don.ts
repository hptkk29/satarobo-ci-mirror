// Điều hướng khu Hoá đơn điện tử — luật THUẦN (S5b Invoice Hub, 01/11/2026). Server và client cùng đọc.
//
// Một mục sidebar ("Hoá đơn điện tử") + bốn khu vực bên trong, theo audit 05 §4.1:
//
//     Hoá đơn · Cảnh báo & sai sót · Cấu hình · (Nhật ký — CHƯA MỞ, chờ O-6)
//
// Ba thứ nằm ở ĐÂY và không ở đâu khác:
//   1. `NGAN_THEO_KHU_VUC` — mỗi ngăn của bàn chứng từ thuộc đúng một khu vực (PHÂN HOẠCH của `CAC_NGAN`;
//      ca [HDNAV-01] đỏ nếu thêm ngăn mà quên xếp chỗ — ngăn sẽ biến mất khỏi giao diện mà không lỗi nào báo).
//   2. `KHU_VUC` — danh sách tab. ⚠️ `href` là CHUỖI LITERAL: `components/admin/nav-coverage.test.ts` quét chuỗi đứng
//      ngay sau `href:` để biết route nào còn lối vào; ghép động là route thành mồ côi (audit 05 K1).
//   3. Cách dựng link giữ PHẠM VI (cơ sở + tháng + sắp xếp): mọi link đi qua `queryHoaDon` — MỘT cửa sinh query của
//      màn — và BỎ dòng chọn / ngăn / trang / `hoaDon` (chúng thuộc về tab và cơ sở cũ).
//
// Không import giá trị từ `@prisma/client` hay `@/lib/db`: tệp này đi xuống bundle trình duyệt.

import type { KeyboardEvent } from "react";
import type { NganHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";
import { CAC_NGAN, laNgan, nganHienThi, type MoTaNgan } from "@/lib/finance/hoa-don/ngan-hang-cho";
import { queryHoaDon } from "@/lib/finance/hoa-don/loc-hang-cho";

export type KhuVucKey = "hoa-don" | "canh-bao" | "cau-hinh" | "nhat-ky";
/** Hai khu vực có danh sách lần thu (bàn chứng từ). */
export type KhuVucDanhSach = "hoa-don" | "canh-bao";

/** Cổng quyền của khu vực — khoá của `PAGE_GATES` (trang gác bằng đúng khoá này; menu nói thật, luật 12). */
export type CongKhuVuc = "/payments/hoa-don" | "/payments/hoa-don/cau-hinh";

export type MoTaKhuVuc = {
  key: KhuVucKey;
  nhan: string;
  href: string;
  cong: CongKhuVuc;
  /** `false` = chỗ đã để sẵn nhưng CHƯA mở: không bao giờ vẽ (luật 12 — nút/tab không dẫn tới đâu là lời hứa suông). */
  moRa: boolean;
};

export const KHU_VUC: readonly MoTaKhuVuc[] = [
  { key: "hoa-don", nhan: "Hoá đơn", href: "/payments/hoa-don", cong: "/payments/hoa-don", moRa: true },
  { key: "canh-bao", nhan: "Cảnh báo & sai sót", href: "/payments/hoa-don/canh-bao", cong: "/payments/hoa-don", moRa: true },
  { key: "cau-hinh", nhan: "Cấu hình", href: "/payments/hoa-don/cau-hinh", cong: "/payments/hoa-don/cau-hinh", moRa: true },
  // Nhật ký: O-6 (quyền đọc nhật ký) chưa chốt — ĐỪNG nới `audit-logs:view`. Mở khi có route + cổng riêng dưới `payments:confirm`.
  { key: "nhat-ky", nhan: "Nhật ký", href: "/payments/hoa-don/nhat-ky", cong: "/payments/hoa-don", moRa: false },
];

/** Lối vào TRANG PHỤ (không phải tab). O-1 chưa chốt: Chứng từ ngân hàng tạm là trang phụ của khu vực Hoá đơn. */
export const TRANG_PHU = {
  chungTu: { nhan: "Chứng từ ngân hàng", href: "/payments/hoa-don/chung-tu-ngan-hang" },
} as const;

export const NGAN_THEO_KHU_VUC = {
  "hoa-don": ["cho", "nhap", "phat-hanh", "da-xuat", "khong-xuat"],
  "canh-bao": ["lech", "can-dieu-chinh", "don-huy"],
} as const satisfies Record<KhuVucDanhSach, readonly NganHangCho[]>;

export function khuVucCuaNgan(ngan: NganHangCho): KhuVucDanhSach {
  return (NGAN_THEO_KHU_VUC["canh-bao"] as readonly NganHangCho[]).includes(ngan) ? "canh-bao" : "hoa-don";
}

/** Ngăn của một khu vực, theo thứ tự `CAC_NGAN` (một nguồn thứ tự, một nguồn nhãn). */
export function nganTrongKhuVuc(khuVuc: KhuVucDanhSach): MoTaNgan[] {
  const co = NGAN_THEO_KHU_VUC[khuVuc] as readonly NganHangCho[];
  return CAC_NGAN.filter((n) => co.includes(n.ngan));
}

/**
 * Ngăn đang mở TRONG một khu vực. URL nói thì theo URL; không thì theo dòng đang chọn; không nữa thì ngăn ĐẦU của chính
 * khu vực (Cảnh báo mở ra ở "Lệch số", không rơi về "Chờ xuất" rồi bị đá sang tab khác).
 * `lacSang` ≠ null ⇒ ngăn đó thuộc khu vực KHÁC: trang phải chuyển hướng (URL cũ `?ngan=lech`, hoặc `?chon=` của dòng
 * nằm ở tab kia) — không bao giờ vẽ ngăn ngoài khu vực của mình.
 */
export function chonNganTheoKhuVuc(input: {
  tuUrl: string | null | undefined;
  dongDangChon: { ngan: NganHangCho; daGuiNhap: { luc: string } | null } | null;
  khuVuc: KhuVucDanhSach;
}): { ngan: NganHangCho; lacSang: KhuVucDanhSach | null } {
  const goc: NganHangCho | null = laNgan(input.tuUrl) ? input.tuUrl : (input.dongDangChon ? nganHienThi(input.dongDangChon) : null);
  if (!goc) return { ngan: NGAN_THEO_KHU_VUC[input.khuVuc][0], lacSang: null };
  const cua = khuVucCuaNgan(goc);
  return { ngan: goc, lacSang: cua === input.khuVuc ? null : cua };
}

/** Phạm vi ĐANG XEM nằm trên URL — phần mọi link giữa các tab phải mang theo. */
export type PhamViUrl = { coSo: string | null; thang: string | null; sapXep?: "cu-nhat" | null };

// Cùng dạng với `docBoLoc`: tháng sai dạng ⇒ coi như không ghi (server sẽ rơi về tháng hiện tại).
const DANG_THANG = /^\d{4}-(0[1-9]|1[0-2])$/;

export function phamViTuQuery(q: { get(k: string): string | null }): Required<PhamViUrl> {
  const thang = q.get("thang");
  return {
    coSo: q.get("coSo")?.trim() || null,
    thang: thang && DANG_THANG.test(thang) ? thang : null,
    sapXep: q.get("sapXep") === "cu-nhat" ? "cu-nhat" : null,
  };
}

const ghepQuery = (duongDan: string, q: string) => (q ? `${duongDan}?${q}` : duongDan);

/** Link sang một khu vực: mang cơ sở + tháng + sắp xếp, BỎ ngăn / dòng chọn / trang / `hoaDon`. */
export function hrefKhuVuc(key: KhuVucKey, pv: PhamViUrl): string {
  const k = KHU_VUC.find((x) => x.key === key)!;
  return ghepQuery(k.href, queryHoaDon(pv, {}));
}

/** Link sang trang phụ (Chứng từ ngân hàng) — chỉ cơ sở là có nghĩa ở đó, nhưng mang cả tháng để vòng khứ hồi không mất. */
export function hrefTrangPhu(pv: PhamViUrl): string {
  return ghepQuery(TRANG_PHU.chungTu.href, queryHoaDon(pv, {}));
}

/**
 * Link của thanh phạm vi khi đổi MỘT thành phần. Ở lại CHÍNH trang đang mở, giữ ngăn; BỎ dòng chọn (có thể không còn
 * thuộc cơ sở / tháng mới) và `hoaDon`.
 */
export function hrefDoiPhamVi(duongDan: string, pv: PhamViUrl, ngan: string | null, doi: Partial<PhamViUrl>): string {
  return ghepQuery(duongDan, queryHoaDon({ ...pv, ...doi }, { ngan }));
}

/**
 * Chuyển khu vực mà GIỮ MỌI tham số đang có (đường dẫn thông báo cũ `?hoaDon=` vẫn phải chạy). `ghiDe` chỉ áp khi có
 * giá trị — `null` KHÔNG xoá tham số đang có.
 */
export function chuyenKhuVuc(
  sp: Readonly<Record<string, string | undefined>>,
  den: KhuVucDanhSach,
  ghiDe: { ngan?: string | null; coSo?: string | null; thang?: string | null } = {},
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v !== "") q.set(k, v);
  for (const [k, v] of Object.entries(ghiDe)) if (v) q.set(k, v);
  const k = KHU_VUC.find((x) => x.key === den)!;
  return ghepQuery(k.href, q.toString());
}

/**
 * Tab nào được vẽ: mở ra (`moRa`) VÀ người xem có quyền vào trang đích. Nhật ký không bao giờ qua được cổng `moRa`.
 * Quyền do trang đích gác (`PAGE_GATES[cong]`) — cùng khoá với `redirect` ở trang, nên menu và trang không lệch nhau.
 */
export function khuVucHienThi(coQuyen: Readonly<Record<CongKhuVuc, boolean>>): MoTaKhuVuc[] {
  return KHU_VUC.filter((k) => k.moRa && coQuyen[k.cong]);
}

/** Khu vực đang mở theo đường dẫn: khớp dài nhất. Trang phụ (không khớp chính xác) thuộc khu vực cha, `chinhXac:false`. */
export function khuVucDangMo(duongDan: string): { key: KhuVucKey; chinhXac: boolean } | null {
  let tot: { key: KhuVucKey; chinhXac: boolean; dai: number } | null = null;
  for (const k of KHU_VUC) {
    if (!k.moRa) continue;
    const chinhXac = duongDan === k.href;
    if (!chinhXac && !duongDan.startsWith(`${k.href}/`)) continue;
    if (!tot || k.href.length > tot.dai) tot = { key: k.key, chinhXac, dai: k.href.length };
  }
  return tot ? { key: tot.key, chinhXac: tot.chinhXac } : null;
}

const NGAN_THEO_THANG: readonly string[] = ["da-xuat", "khong-xuat"];

/** Ô tháng chỉ có tác dụng ở hai ngăn SỔ ĐÃ XONG của khu vực Hoá đơn (ngăn việc tồn không lọc tháng) — luật 12. */
export function coOThang(duongDan: string, ngan: string | null): boolean {
  return duongDan === KHU_VUC[0]!.href && ngan !== null && NGAN_THEO_THANG.includes(ngan);
}

/**
 * Phím mũi tên giữa các liên kết của một thanh điều hướng: ←/→ (vòng tròn), Home/End. Phím khác không đụng tới
 * (Tab, Enter giữ hành vi mặc định). Gắn vào `onKeyDown` của <ul>/<nav> chứa các <a>.
 */
export function xuLyPhimMuiTen(e: KeyboardEvent<HTMLElement>): void {
  const ds = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]")];
  if (ds.length === 0) return;
  const vt = ds.indexOf(document.activeElement as HTMLAnchorElement);
  let den: number | null = null;
  if (e.key === "ArrowRight") den = vt < 0 ? 0 : (vt + 1) % ds.length;
  else if (e.key === "ArrowLeft") den = vt < 0 ? ds.length - 1 : (vt - 1 + ds.length) % ds.length;
  else if (e.key === "Home") den = 0;
  else if (e.key === "End") den = ds.length - 1;
  if (den === null) return;
  e.preventDefault();
  ds[den]!.focus();
}
