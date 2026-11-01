/**
 * lib/nguon/danh-muc-goc.ts — DANH MỤC MẶC ĐỊNH 8 NGUỒN + UNKNOWN (SPEC "nguồn động" 09/10/2026 §1.3) và vài hằng của nó. THUẦN.
 *
 * Đặc tả: `docs/source-commission/07 §2.6.1`; mô hình `02 §13.1`. 8 dòng này là DANH MỤC MẶC ĐỊNH (seed) chứ KHÔNG phải taxonomy
 * đóng: nguồn thứ 9, 10, 50 xuất hiện bằng cấu hình (master data động). Văn bản 06/10 từng có 11 nguồn; bốn nhóm nhân sự
 * (Sale/Quản lý/Giáo viên/nhân sự khác) nay gộp thành `EMPLOYEE_REFERRAL`, còn VAI của người giới thiệu là ảnh chụp ở
 * `LeadAttribution.referrerRoleCode`.
 *
 * ⚠️ HAI nơi giữ cùng 9 dòng này: khối seed của `migration.sql` (chèn lúc migrate) và `DANH_MUC_GOC`
 * ở đây (script di trú tra theo `code`, ca DB tự dựng bằng `damBaoDanhMucGoc`). Lưới `[NHH-SRC-01c]`
 * (`danh-muc-goc.test.ts`) so hai bên — đổi một chữ ở một bên là đỏ. Đừng chép bản thứ ba.
 *
 * Logic nghiệp vụ KHÔNG ĐƯỢC so mã nhóm trừ `"UNKNOWN"` (03 T3): hành vi theo THUỘC TÍNH của dòng
 * (`referrerRequirement`, `requiresNote`, `selectable`, `attributionWindowDays`, `commissionEnabled`, `ownerEmployeeId`) — vì danh mục
 * MỞ, admin thêm nguồn không sửa mã. "MANUAL_REVIEW" không phải một nguồn: nó là trạng thái xem tay (`xemTay`).
 */

/** Mã 9 dòng GỐC. Nguồn do admin tạo mang mã chuỗi tuỳ ý — đó là DỮ LIỆU, không nằm trong union này. */
export type MaNhomGoc =
  | "PARENT_REFERRAL"
  | "PAID_ADS"
  | "CENTER_ORGANIC"
  | "WALK_IN"
  | "EMPLOYEE_REFERRAL"
  | "EVENT"
  | "PARTNER"
  | "OTHER"
  | "UNKNOWN";

/** Nhóm cấp cao (cột `LeadSourceGroup.sourceType`): lọc / báo cáo / mặc định UI. KHÔNG quyết hoa hồng. */
export type LoaiNguon = "REFERRAL" | "MARKETING" | "ORGANIC" | "OFFLINE" | "EVENT" | "PARTNER" | "OTHER" | "SYSTEM";

export type DongDanhMucGoc = {
  code: MaNhomGoc;
  documentNo: number | null;
  name: string;
  description: string | null;
  referrerRequirement: "NONE" | "PARENT" | "EMPLOYEE" | "AFFILIATE_ORG" | "EVENT";
  requiresNote: boolean;
  selectable: boolean;
  sortOrder: number;
  /** [PB-2] Luôn `true` / `"ACTIVE"` cho 9 dòng gốc — khai TƯỜNG MINH, đừng để rơi về @default(false). */
  isSystem: true;
  status: "ACTIVE";
  sourceType: LoaiNguon;
  /** Nguồn này có tham gia hoa hồng THEO NGUỒN không (false ⇒ rule THU HÚT phạm vi SOURCE_GROUP của nó bất hoạt; dòng EXCLUDE vẫn chạy). */
  commissionEnabled: boolean;
};

const dong = (
  code: MaNhomGoc,
  documentNo: number | null,
  name: string,
  referrerRequirement: DongDanhMucGoc["referrerRequirement"],
  sortOrder: number,
  sourceType: LoaiNguon,
  opts: { description?: string; requiresNote?: boolean; selectable?: boolean; commissionEnabled?: boolean } = {},
): DongDanhMucGoc => ({
  code,
  documentNo,
  name,
  description: opts.description ?? null,
  referrerRequirement,
  requiresNote: opts.requiresNote ?? false,
  selectable: opts.selectable ?? true,
  sortOrder,
  isSystem: true,
  status: "ACTIVE",
  sourceType,
  commissionEnabled: opts.commissionEnabled ?? false,
});

/** 9 dòng — NGUYÊN VĂN khối seed của migration 20261014090000 (lưới [NHH-SRC-01c]). */
export const DANH_MUC_GOC: readonly DongDanhMucGoc[] = [
  dong("PARENT_REFERRAL", 1, "Nguồn từ phụ huynh giới thiệu", "PARENT", 1, "REFERRAL", { commissionEnabled: true }),
  dong("PAID_ADS", 2, "Nguồn từ Quảng Cáo", "NONE", 2, "MARKETING", { commissionEnabled: true }),
  dong("CENTER_ORGANIC", 3, "Nguồn Review, chia sẻ, seeding từ Trung tâm", "NONE", 3, "ORGANIC"),
  dong("WALK_IN", 4, "Nguồn KH tự đến Trung tâm", "NONE", 4, "OFFLINE"),
  dong("EMPLOYEE_REFERRAL", 5, "Nguồn từ nhân sự giới thiệu", "EMPLOYEE", 5, "REFERRAL", { commissionEnabled: true }),
  dong("EVENT", 6, "Nguồn từ sự kiện", "EVENT", 6, "EVENT"),
  dong("PARTNER", 7, "Nguồn từ đối tác", "AFFILIATE_ORG", 7, "PARTNER"),
  dong("OTHER", 8, "Nguồn khác", "NONE", 8, "OTHER", {
    description: "BẮT BUỘC giải trình rõ (văn bản 06/10/2026).",
    requiresNote: true,
  }),
  dong("UNKNOWN", null, "Không rõ nguồn (hệ thống)", "NONE", 999, "SYSTEM", {
    description: 'Hệ thống gán khi không xác định được nguồn. Không chọn được ở ô nhập; khác "Nguồn khác" (D7).',
    selectable: false,
  }),
];

/**
 * [H18] Mã VAI NGỮ NGHĨA của người giới thiệu là nhân sự. Sau khi bốn nhóm nhân sự gộp thành MỘT nguồn, vai KHÔNG còn chọn
 * nhóm — nó chỉ là ảnh chụp ghi ở `LeadAttribution.referrerRoleCode` (báo cáo / khiếu nại đọc lại được "lúc đó là ai").
 */
export type MaVaiNguon = "SALE" | "MANAGER" | "TEACHER" | "OTHER_EMPLOYEE";

/**
 * Nhóm MẶC ĐỊNH của "nhân sự giới thiệu" khi chỉ biết loại người (không ai CHỌN RÕ nhóm) — GIÁ TRỊ KHỞI ĐẦU của setting
 * `nguon.nhomNhanSuMacDinh` và nhóm đích của di trú / bảng nhãn cũ (dữ liệu lịch sử, không đổi theo cấu hình). Vai KHÔNG còn chọn nhóm:
 * nó chỉ là SNAPSHOT (`LeadAttribution.referrerRoleCode`). Đường sống đọc SETTING, đừng import hằng này vào đó.
 */
export const NHOM_NHAN_SU_GOC: MaNhomGoc = "EMPLOYEE_REFERRAL";

/**
 * Thu hẹp một mã nhóm về 9 mã GỐC — cho đường DI TRÚ (luôn đích vào nhóm gốc). Mã lạ ⇒ NÉM: di trú gặp nhóm ngoài danh mục gốc là lỗi cấu hình,
 * không phải dữ liệu để đoán.
 */
export function nhomGocHoacNem(code: string): MaNhomGoc {
  if (!DANH_MUC_GOC.some((d) => d.code === code)) throw new Error(`Mã nhóm "${code}" không thuộc 9 nhóm gốc.`);
  return code as MaNhomGoc;
}

export type DongVaiSangNguon = { roleCodes: readonly string[]; vai: MaVaiNguon };

/**
 * Vai → vai ngữ nghĩa (03 §2.4, ĐỀ XUẤT; gồm MANAGER — CHỜ chủ dự án ký, H18). Bậc đầu khớp thắng.
 * PR2 chuyển thành setting `nguon.vaiSangNguon` (khi đó trường đích là groupId); bảng này là MẶC ĐỊNH.
 * Không khớp bậc nào ⇒ `OTHER_EMPLOYEE` (bậc "còn lại").
 */
export const VAI_SANG_NGUON_MAC_DINH: readonly DongVaiSangNguon[] = [
  { roleCodes: ["CENTER_SALES_CSM", "HO_SALE"], vai: "SALE" },
  { roleCodes: ["CENTER_MANAGER", "GIAM_DOC", "SUPER_ADMIN"], vai: "MANAGER" },
  { roleCodes: ["TEACHER", "ASSISTANT_TEACHER", "TRAINING"], vai: "TEACHER" },
];

/**
 * Vai ngữ nghĩa suy từ vai của người nhập. Duyệt theo thứ tự của BẢNG (bậc đầu khớp thắng), không theo thứ
 * tự vai của người. Không bao giờ trả null: bậc "còn lại" là `OTHER_EMPLOYEE`.
 */
export function suyVaiNguon(roleCodes: readonly string[], bang: readonly DongVaiSangNguon[]): MaVaiNguon {
  const co = new Set(roleCodes);
  for (const bac of bang) {
    if (bac.roleCodes.some((r) => co.has(r))) return bac.vai;
  }
  return "OTHER_EMPLOYEE";
}

/** Thuộc tính quyết hành vi, KHÔNG so mã (03 T3): nhóm này bắt chọn NGƯỜI. */
export function canNguoi(nhom: string): boolean {
  const d = DANH_MUC_GOC.find((x) => x.code === nhom);
  if (!d) return false;
  return d.referrerRequirement === "PARENT" || d.referrerRequirement === "EMPLOYEE" || d.referrerRequirement === "AFFILIATE_ORG";
}
