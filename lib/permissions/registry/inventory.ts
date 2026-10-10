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
