// Registry quyền — module Kho: tồn kho, bộ ZMRoboKit, sản phẩm bán/cho thuê.
// Key GIỮ NGUYÊN format v1 `resource:verb` (TS-01).
import type { ModuleDecl } from "./types";

export const inventoryModule: ModuleDecl = {
  module: "inventory",
  permissions: [
    // --- Inventory (tồn kho) ---
    { key: "inventory:view", action: "view" },
    { key: "inventory:edit", action: "edit" },
    {
      key: "inventory:movement",
      action: "movement",
      description: "Ghi nhận xuất/nhập/di chuyển kho.",
    },
    {
      key: "inventory:audit",
      action: "audit",
      description: "Kiểm kê kho (đối soát tồn thực tế).",
    },

    // --- Giao hàng đơn Online (Owner M8 28/11/2026) — HAI quyền chuyên biệt cho nhân viên kho, tách đọc PII ≠ đổi trạng thái.
    // CHỈ ĐỊNH NGHĨA: không vai nào trong `seed-roles.ts` được cấp (Quản trị tối cao đi đường sẵn có). Gán cho người = Owner duyệt trước.
    // Đơn Online không thuộc cơ sở nào ⇒ khoá chỉ có tác dụng khi giữ ở tầm TOÀN HỆ + cấp Hội sở (`nguoiVanHanhKho`).
    {
      key: "online_fulfillment:view-pii",
      action: "view-pii",
      description: "Xem danh sách giao hàng đơn Online kèm họ tên, số điện thoại, địa chỉ người nhận.",
    },
    {
      key: "online_fulfillment:update",
      action: "update",
      description: "Chuyển tiến độ giao hàng đơn Online (đóng gói, giao, giao lỗi) và thử lại dòng cần xử lý. Không kèm quyền xem người nhận.",
    },

    // --- Kits (ZMRoboKit) ---
    {
      key: "kits:view",
      action: "view",
      description: "Xem danh mục bộ kit ZMRoboKit.",
    },
    { key: "kits:edit", action: "edit" },

    // --- Products (catalog bán/cho thuê) ---
    { key: "products:view", action: "view" },
    { key: "products:manage", action: "manage" },
  ],
};
