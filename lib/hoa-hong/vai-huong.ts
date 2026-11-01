// lib/hoa-hong/vai-huong.ts — MASTER vai hưởng hoa hồng (BeneficiaryRole) + hằng dùng chung.
//
// Nguồn: docs/source-commission/02 §8.1 + §13.3, 04 §7.1. THUẦN. Migration `20261014100000_hoa_hong_chinh_sach`
// chèn ĐÚNG tập này; lưới `[NHH-POL-MIG-02]` đọc `migration.sql` và so với hằng này — lệch là đỏ.
//
// ⚠️ H18: LÕI MỚI KHÔNG dùng số "5/6/7/8" (mã vai suy từ nhóm nguồn của văn bản 06/10). Số cũ chỉ sống
// trong migration/adapter của PR2–PR3. Ở đây vai là MÃ NGỮ NGHĨA: SALE · QUẢN LÝ · GIÁO VIÊN · NHÂN SỰ
// KHÁC (xem `VAI_NGUOI_GIOI_THIEU`) — và vai TRẢ TIỀN là mã master dưới đây.
export type KieuResolver =
  | "DIRECT_PERSON"
  | "TRANSACTION_ROLE"
  | "ORG_UNIT_ROLE"
  | "SOURCE_MEMBER"
  | "SOURCE_OWNER";

export type DongMasterVaiHuong = {
  readonly code: string;
  readonly name: string;
  readonly resolverType: KieuResolver;
  /** Tập ĐÓNG theo 04 §7.1: khoá cụ thể trong resolver. */
  readonly resolverKey: string;
  /** Chịu cửa sổ 90 ngày (04 §7.3). */
  readonly isAcquisition: boolean;
  /** Tầng cũ của `CommissionLine.tier` — nối kỳ cũ/mới và `LEGACY_REVERSAL` (04 §11.3). */
  readonly legacyTier: string | null;
  readonly sortOrder: number;
};

export const MASTER_VAI_HUONG: readonly DongMasterVaiHuong[] = [
  { code: "SALE", name: "Sale (người chốt đơn)", resolverType: "TRANSACTION_ROLE", resolverKey: "LEAD_CONVERTED_BY", isAcquisition: false, legacyTier: "SALE", sortOrder: 10 },
  { code: "SALE_ADMIN", name: "Sale Admin (Hội sở)", resolverType: "TRANSACTION_ROLE", resolverKey: "LEAD_ADMIN", isAcquisition: false, legacyTier: "SALE_ADMIN", sortOrder: 20 },
  { code: "CENTER_MANAGER", name: "Quản lý cơ sở", resolverType: "ORG_UNIT_ROLE", resolverKey: "ASSIGNEE_QL_TT", isAcquisition: false, legacyTier: "QL_TT", sortOrder: 30 },
  { code: "MARKETING", name: "Marketing (Quảng cáo)", resolverType: "ORG_UNIT_ROLE", resolverKey: "ASSIGNEE_QC", isAcquisition: false, legacyTier: "QC", sortOrder: 40 },
  { code: "TRIAL_TEACHER", name: "Giáo viên dạy Trial", resolverType: "TRANSACTION_ROLE", resolverKey: "TRIAL_TEACHER", isAcquisition: false, legacyTier: "TRIAL_TEACHER", sortOrder: 50 },
  { code: "REFERRER_PARENT", name: "Phụ huynh giới thiệu", resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT", isAcquisition: true, legacyTier: null, sortOrder: 60 },
  { code: "REFERRER_EMPLOYEE", name: "Nhân sự giới thiệu", resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_EMPLOYEE", isAcquisition: true, legacyTier: null, sortOrder: 70 },
  { code: "AFFILIATE", name: "Cộng tác viên / đối tác", resolverType: "DIRECT_PERSON", resolverKey: "AFFILIATE", isAcquisition: true, legacyTier: null, sortOrder: 80 },
  // Nguồn ĐỘNG (SPEC 09/10/2026 §1.4). Người hưởng = ảnh chụp `LeadAttribution.referrerSaleUserId` — KHÁC `SALE` (người chốt đơn).
  { code: "REFERRER_PARENT_SALE", name: "Sale phụ trách phụ huynh giới thiệu", resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT_SALE", isAcquisition: true, legacyTier: null, sortOrder: 90 },
  // Người hưởng = nhân sự `ownerEmployeeId` của NGUỒN: admin tạo nguồn mới + "đội X hưởng n%" chỉ bằng cấu hình.
  { code: "SOURCE_OWNER", name: "Người phụ trách nguồn", resolverType: "SOURCE_OWNER", resolverKey: "SOURCE_OWNER", isAcquisition: true, legacyTier: null, sortOrder: 100 },
] as const;

/**
 * Vai của NGƯỜI GIỚI THIỆU là nhân sự (H18) — mã NGỮ NGHĨA, không phải số của văn bản 06/10. Dùng ở
 * adapter nguồn → chính sách (PR8); khai ở đây để lõi có một chỗ đặt tên, và để lưới `[NHH-POL-H18]`
 * cấm số 5/6/7/8 lọt vào `lib/hoa-hong/**`.
 */
export const VAI_NGUOI_GIOI_THIEU = ["SALE", "MANAGER", "TEACHER", "OTHER_EMPLOYEE"] as const;
export type VaiNguoiGioiThieu = (typeof VAI_NGUOI_GIOI_THIEU)[number];

/** Mã vai master (tập ĐÓNG của seed; vai thêm sau là dữ liệu, không phải hằng). */
export const MA_VAI_HUONG_GOC = MASTER_VAI_HUONG.map((v) => v.code);

/** Khoá resolver `ORG_UNIT_ROLE` ↔ vai `CenterCommissionRole` (QC / QL_TT). */
export const KHOA_PHAN_CONG_CO_SO = {
  ASSIGNEE_QC: "QC",
  ASSIGNEE_QL_TT: "QL_TT",
} as const;
