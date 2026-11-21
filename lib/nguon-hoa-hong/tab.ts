// lib/nguon-hoa-hong/tab.ts — LUẬT THUẦN của khung module "Nguồn lead & Chính sách hoa hồng":
// tab nào hiện được, route gốc chuyển đi đâu. Đặc tả: docs/source-commission/05 §1.5, 06 §4.1.
//
// Thuần = không DB, không session, không đồng hồ ⇒ test không cần gì (tab.test.ts).
//
// ⚠️ MỘT NGUỒN cho "người này vào tab nào được": ModuleNav (hiện/ẩn tab), route gốc (chuyển hướng) và
// từng `page.tsx` (404 khi cờ tắt) đều gọi `tabMoDuoc`. Mỗi nơi tự viết lại điều kiện là sinh dead-link
// (thấy tab, bấm vào 404) hoặc hở-quyền-theo-URL (luật 12). Quyền của tab = ĐÚNG `PAGE_GATES[href]`.
import { PAGE_GATES, type GatedHref } from "@/lib/auth/page-gates";

// Thứ tự = thứ tự HIỂN THỊ trên ModuleNav (lưới `[NHH-FE-01]` so với `TABS` của module-nav) VÀ thứ tự ứng viên của route gốc (`chonTabGoc`).
// Ba tab Affiliate (AFF-P0b, 12/10/2026) đứng ngay sau tab Nguồn — chúng là phần "ai giới thiệu" của nguồn, đi trước phần chính sách/sổ.
export const TAB_KEYS = ["nguon", "affiliate", "campaign", "website", "link", "referral", "chinh-sach", "so", "ky", "khieu-nai"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

/**
 * Địa chỉ từng tab. ⚠️ `components/admin/nguon-hoa-hong/module-nav.tsx` PHẢI khai lại bằng chuỗi LITERAL
 * (`nav-coverage` quét chuỗi đứng sau `href:` ở `app/` + `components/`, không quét `lib/`); ca `[NHH-FE-01]`
 * so hai bên — lệch là đỏ.
 */
export const TAB_HREF = {
  nguon: "/nguon-hoa-hong/nguon",
  affiliate: "/nguon-hoa-hong/affiliate",
  campaign: "/nguon-hoa-hong/campaign",
  website: "/nguon-hoa-hong/website",
  link: "/nguon-hoa-hong/link",
  referral: "/nguon-hoa-hong/referral",
  "chinh-sach": "/nguon-hoa-hong/chinh-sach",
  so: "/nguon-hoa-hong/so",
  ky: "/nguon-hoa-hong/ky",
  "khieu-nai": "/nguon-hoa-hong/khieu-nai",
} as const satisfies Record<TabKey, GatedHref>;

export const TAB_NHAN: Record<TabKey, string> = {
  nguon: "Nguồn",
  affiliate: "Affiliate",
  campaign: "Campaign",
  website: "Website",
  link: "Link / QR / Mã",
  referral: "Referral",
  "chinh-sach": "Chính sách",
  so: "Sổ hoa hồng",
  ky: "Kỳ",
  "khieu-nai": "Khiếu nại & lịch sử",
};

/**
 * Tiêu đề trang + câu một dòng dưới tiêu đề của từng tab. Giọng ngắn, trung tính, không marketing-speak
 * (PRODUCT.md). Ở đây để PageHeader và NoPermission cùng gọi tên một màn bằng một chữ.
 */
export const TIEU_DE_TAB: Record<TabKey, { tieuDe: string; phuDe: string }> = {
  nguon: { tieuDe: "Nguồn lead", phuDe: "Mỗi lead cần một nguồn rõ ràng trước khi tính hoa hồng." },
  affiliate: { tieuDe: "Affiliate", phuDe: "Người và tổ chức giới thiệu khách: loại, nhãn, trạng thái và các chương trình họ tham gia." },
  campaign: { tieuDe: "Campaign Affiliate", phuDe: "Chương trình giới thiệu: nguồn khách mỗi loại đối tác được tính, cửa sổ ghi nhận, website được phép." },
  website: { tieuDe: "Website & trang đích", phuDe: "Website đối tác và trang đích được phép gắn link giới thiệu. Người dùng chỉ chọn trong danh sách này." },
  link: { tieuDe: "Link / QR / Mã giới thiệu", phuDe: "Phát, thu hồi và xoay link, QR, mã của từng đối tác trong từng campaign. Mỗi link mang một mã ngẫu nhiên, không chứa thông tin cá nhân." },
  referral: { tieuDe: "Referral", phuDe: "Khách do đối tác giới thiệu: nguồn đã ghi, trạng thái bảo vệ, ca chờ xem tay. Không hiện số điện thoại hay tên khách." },
  "chinh-sach": { tieuDe: "Chính sách hoa hồng", phuDe: "Chính sách theo vai hưởng, loại giao dịch và nguồn; mỗi thay đổi là một phiên bản mới." },
  so: { tieuDe: "Sổ hoa hồng", phuDe: "Mỗi dòng là một khoản hoa hồng đã tính, kèm căn cứ." },
  ky: { tieuDe: "Kỳ hoa hồng", phuDe: "Tính, rà soát và khoá hoa hồng theo tháng và cơ sở." },
  "khieu-nai": { tieuDe: "Khiếu nại & lịch sử", phuDe: "Khiếu nại hoa hồng, lịch sử chính sách và nhật ký." },
};

/**
 * Cụm chữ sau con số ở pill của tab (title + chữ cho trình đọc màn hình). MỖI TAB MỘT câu nói ĐÚNG điều nó đếm: pill Sổ đếm MỌI hàng chờ đang mở trong tầm nhìn (chặn khoá lẫn
 * không chặn), pill Kỳ chỉ đếm hàng chờ CHẶN khoá và cộng dồn mọi kỳ chưa khoá — hai con số khác nghĩa mà cùng chữ "việc cần xử lý" thì người xem "Sổ 7 · Kỳ 3" không biết đếm gì.
 * `Record<TabKey, …>`: thêm tab mà quên nhãn là LỖI BIÊN DỊCH (luật 7).
 */
export const CUM_SO_DEM: Record<TabKey, string> = {
  nguon: "việc cần xử lý",
  affiliate: "đối tác chờ duyệt",
  campaign: "việc cần xử lý",
  website: "việc cần xử lý",
  link: "việc cần xử lý",
  referral: "referral chờ xem tay",
  "chinh-sach": "việc cần xử lý",
  so: "hàng chờ đang mở",
  ky: "hàng chờ chặn khoá, mọi kỳ chưa khoá",
  "khieu-nai": "việc cần xử lý",
};

/** Ai cấp được quyền của tab — in trong `NoPermission` để người dùng biết hỏi ai (DESIGN.md §5). Vai NGHIỆP VỤ, không phải mã RoleDef. */
export const HOI_AI_TAB: Record<TabKey, string> = {
  nguon: "Marketing Hội sở, Kế toán Hội sở hoặc Quản lý cơ sở",
  affiliate: "Marketing Hội sở, Kế toán Hội sở, Quản lý cơ sở hoặc Quản trị hệ thống",
  campaign: "Marketing Hội sở, Kế toán Hội sở, Quản lý cơ sở hoặc Quản trị hệ thống",
  website: "Marketing Hội sở, Kế toán Hội sở, Quản lý cơ sở hoặc Quản trị hệ thống",
  link: "Marketing Hội sở, Kế toán Hội sở, Quản lý cơ sở hoặc Quản trị hệ thống",
  referral: "Marketing Hội sở, Kế toán Hội sở, Quản lý cơ sở hoặc Quản trị hệ thống",
  "chinh-sach": "HR Hội sở, Kế toán Hội sở hoặc Quản trị hệ thống",
  so: "Quản lý cơ sở, Kế toán hoặc Quản trị hệ thống",
  ky: "Kế toán cơ sở, Kế toán Hội sở hoặc Quản lý cơ sở",
  "khieu-nai": "HR Hội sở hoặc Quản trị hệ thống",
};

/**
 * Ba cờ toàn hệ của module (đã giải tổ hợp — `nguon.enabled`, `hoaHong.engineBat`, `affiliate.enabled` ∧ `nguon.enabled`).
 * `affiliate` ở đây ĐÃ là kết quả của `hopCoAffiliate` — nơi gọi không tự AND lại.
 */
export type CoModule = { nguon: boolean; engine: boolean; affiliate: boolean };

/** Tab nào gác bằng cờ nào: Nguồn = cờ nguồn; ba tab Affiliate = cờ affiliate; bốn tab hoa hồng = cờ engine (05 §1.5). */
const CO_CUA_TAB: Record<TabKey, keyof CoModule> = {
  nguon: "nguon",
  affiliate: "affiliate",
  campaign: "affiliate",
  website: "affiliate",
  link: "affiliate",
  referral: "affiliate",
  "chinh-sach": "engine",
  so: "engine",
  ky: "engine",
  "khieu-nai": "engine",
};

/** Cờ gác tab này (nguồn hay engine) — page 404 theo đúng cờ này TRƯỚC khi hỏi quyền. */
export function coCuaTab(tab: TabKey): keyof CoModule {
  return CO_CUA_TAB[tab];
}

/** Các key quyền mở được tab (OR) — chính là `PAGE_GATES[href]`, không khai rời. */
export function cacKeyCuaTab(tab: TabKey): readonly string[] {
  return PAGE_GATES[TAB_HREF[tab]];
}

export type DauVaoTab = {
  /** Có ÍT NHẤT MỘT key trong danh sách không (OR). */
  coQuyen: (cacKey: readonly string[]) => boolean;
  co: CoModule;
};

/** Tab hiện/vào được ⇔ quyền (một trong các key của gate) ∧ cờ của tab. */
export function tabMoDuoc(tab: TabKey, v: DauVaoTab): boolean {
  return v.co[CO_CUA_TAB[tab]] && v.coQuyen(cacKeyCuaTab(tab));
}

/** Các tab người xem vào được, theo thứ tự `TAB_KEYS`. */
export function tabUngVien(v: DauVaoTab): TabKey[] {
  return TAB_KEYS.filter((t) => tabMoDuoc(t, v));
}

/**
 * Route gốc `/nguon-hoa-hong` chuyển sang đâu (06 §4.1, `[NHH-FE-11]`): trong các tab ứng viên, tab ĐẦU TIÊN
 * có hàng chờ > 0; không tab nào có việc thì ứng viên đầu tiên; không ứng viên ⇒ `null` (trang trả 404).
 *
 * ⚠️ KHÔNG chuyển cứng sang tab Kỳ: lúc pilot nguồn (`engineBat` tắt) tab Kỳ trả 404, nên chuyển cứng là
 * tặng người dùng một link chết ngay cửa vào. Hàng chờ ở tab KHÔNG nằm trong ứng viên bị bỏ qua.
 */
export function chonTabGoc(
  ungVien: readonly TabKey[],
  hangCho: Partial<Record<TabKey, number>>,
): TabKey | null {
  if (ungVien.length === 0) return null;
  return ungVien.find((t) => (hangCho[t] ?? 0) > 0) ?? ungVien[0]!;
}
