// Registry quyền — module Tài chính: thanh toán, đơn hàng, trả góp, giảm giá.
// Key GIỮ NGUYÊN format v1 `resource:verb` (TS-01).
import type { ModuleDecl } from "./types";

export const financeModule: ModuleDecl = {
  module: "finance",
  permissions: [
    // --- Payments ---
    { key: "payments:manage", action: "manage" },
    {
      key: "payments:view",
      action: "view",
      description: "Chỉ XEM đối soát (Công nợ, Biến động số dư) — không thao tác.",
    },
    {
      key: "payments:record",
      action: "record",
      description: "Sale ghi nhận khoản thu (chưa phải xác nhận).",
    },
    {
      key: "payments:confirm",
      action: "confirm",
      description: "Kế toán xác nhận khoản thu (tách nhiệm vụ với record).",
    },
    {
      key: "payments:adjust",
      action: "adjust",
      description:
        "Điều chỉnh khoản thu ĐÃ XÁC NHẬN — sinh bút toán delta, dòng gốc bất biến. " +
        "Cấp cho kế toán Hội sở + kế toán cơ sở ở RBAC v2 (prisma/seed-roles.ts). " +
        "Ma trận v1 cố ý chỉ có SUPER_ADMIN.",
    },
    {
      key: "payments:view-pii",
      action: "view-pii",
      // Field thật đang mask: Student.parentNationalId + Student.address
      // (lib/finance/pii-mask.ts — maskNationalId/maskAddress).
      sensitiveFields: ["parentNationalId", "address"],
      description: "Break-glass xem đầy đủ CCCD + địa chỉ PH (reason + audit).",
    },
    {
      key: "payments:import-pos",
      action: "import-pos",
      // 29/09/2026 — docs/pos-the-smartpos.md (Q-D): chỉ Kế toán HO + Quản trị tối cao.
      // Gác cả import file, tab "Máy POS" lẫn hành động đóng cảnh báo hủy-sau-ghi-nhận.
      description: "Import file giao dịch thẻ POS",
    },
    {
      key: "payments:pos-check",
      action: "pos-check",
      // 06/10/2026 — GĐ1 POS (docs/pos-gd1-thiet-ke.md §6.5). Sale cơ sở + QL cơ sở + Kế toán HO.
      description: "Thu học phí bằng thẻ POS: tạo phiếu thu thẻ, kiểm tra kết quả, báo admin",
    },

    // --- Mục tiêu doanh thu (B-01) ---
    {
      key: "revenue_targets:manage",
      action: "manage",
      description:
        "Đặt/sửa mục tiêu doanh thu theo tháng × cơ sở. TÁCH khỏi payments:manage (mở/huỷ/hoàn tiền) để Quản lý cơ sở dùng được mà không chạm sổ tiền.",
    },
    {
      key: "commission-assignee:manage",
      action: "manage",
      description:
        "Khai QC / quản lý phụ trách từng cơ sở (nguồn người hưởng hoa hồng QC 1% + Quản lý TT 2%). TÁCH khỏi payments:manage: người trả tiền không nên đồng thời chỉ định người nhận.",
    },

    // --- Kỳ hoa hồng (27/08/2026) ---
    {
      key: "commission_periods:manage",
      action: "manage",
      description:
        "CHỐT / DUYỆT / MỞ LẠI kỳ hoa hồng. TÁCH khỏi payments:manage vì bảng kê là bảng KỲ toàn hệ thống (period @unique, không có centerId) — đường ghi không cắt được theo cơ sở, mà payments:manage thì kế toán cơ sở cũng giữ ở scope GLOBAL. Chỉ Super Admin + kế toán Hội sở.",
    },

    // --- Chính sách & sổ hoa hồng mới (08/10/2026, docs/source-commission/05 §1.2) ---
    // `commission_policies:*` `scopable: false`: chính sách do Hội sở / BLĐ ban hành, phạm vi cơ sở của MỘT
    // chính sách là NỘI DUNG của nó (áp ở đâu), không phải dữ liệu thuộc riêng một cơ sở — cùng lý do
    // `promotions:*`. Sổ/kỳ/khiếu nại thì cách ly theo `centerScope` của vai (prefix ở `lib/db-scope.ts`).
    {
      key: "commission_policies:view",
      action: "view",
      scopable: false,
      description: "Xem chính sách hoa hồng, các version và văn bản ban hành. Gác tab Chính sách.",
    },
    {
      key: "commission_policies:manage",
      action: "manage",
      scopable: false,
      description: "Soạn nháp chính sách, tạo version, gắn văn bản, thử tính. KHÔNG kèm quyền kích hoạt.",
    },
    {
      key: "commission_policies:activate",
      action: "activate",
      scopable: false,
      description: "Kích hoạt / cho hết hiệu lực một version chính sách (tách khỏi manage để giao BLĐ).",
    },
    {
      key: "commission:view-self",
      action: "view-self",
      description:
        "Xem dòng hoa hồng của CHÍNH MÌNH và khoản dự kiến, tạo khiếu nại trên dòng của mình. " +
        "Hàm đọc ép beneficiaryUserId = người xem — không có cách xem dòng người khác bằng key này.",
    },
    {
      key: "commission:view-center",
      action: "view-center",
      description: "Xem mọi dòng sổ và kỳ hoa hồng trong tầm nhìn cơ sở (vai neo Hội sở thì toàn hệ).",
    },
    {
      key: "commission_disputes:review",
      action: "review",
      description: "Nhận và quyết khiếu nại hoa hồng.",
    },

    // --- Installments / Discounts ---
    {
      key: "installments:approve",
      action: "approve",
      description: "Duyệt kế hoạch trả góp 2 đợt.",
    },
    {
      key: "discounts:approve",
      action: "approve",
      description: "Duyệt giảm giá nhập tay (kèm giải trình).",
    },

    // --- Orders ---
    { key: "orders:view", action: "view" },
    { key: "orders:manage", action: "manage" },
    {
      key: "orders:create",
      action: "create",
      description:
        "Tạo đơn hàng. Ai KHÔNG có orders:manage thì chỉ tạo được đơn gắn lead của chính mình (guard: lib/orders/create-guard.ts).",
    },
    {
      key: "orders:view-pii",
      action: "view-pii",
      // Field thật đang mask trên trang đơn: customerName/customerPhone/customerEmail.
      sensitiveFields: ["customerName", "customerPhone", "customerEmail"],
      description: "Xem đầy đủ liên hệ khách trên đơn hàng (vai khác thấy bản che).",
    },
  ],
};
