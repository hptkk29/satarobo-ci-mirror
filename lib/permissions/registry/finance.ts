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
