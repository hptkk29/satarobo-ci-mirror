/**
 * Ba mục quản trị/kho — "Cơ sở" · "Lịch nghỉ" · "Học cụ" — KHÔNG hiện với Sale và
 * Quản lý lớp học (chủ dự án chốt 29/08/2026).
 *
 * Vì sao khoá bằng test chứ không chỉ sửa seed: sidebar không tự phán quyền, nó đọc
 * `grantedMenuActions()` — CÙNG hàm quyết định với cổng trang. Nghĩa là ba mục này
 * hiện/ẩn hoàn toàn theo việc RoleDef có giữ `centers:view` / `holidays:view` /
 * `kits:view` hay không. Ai đó thêm lại một dòng quyền "cho tiện" ở seed là mục lặng
 * lẽ mọc lại trên menu — không có lỗi nào nổ, không ai biết.
 *
 * ⚠️ ĐỪNG "sửa" test này bằng cách đổi `perm` của mục menu trong sidebar.tsx: làm thế
 * là giấu lối vào mà vẫn để cửa mở (gõ thẳng URL vẫn vào được) — đúng lớp lỗi
 * `lib/auth/page-gates.ts` sinh ra để diệt. Muốn đổi thì đổi ở CẤP QUYỀN, cả hai hệ.
 *
 * Vì sao có Quản lý lớp học trong danh sách dù seed vốn chưa từng cấp: đó là bất biến
 * cần GIỮ, không phải việc cần làm — và bất biến chưa ai viết ra thì sớm muộn cũng bị
 * xoá bằng một dòng "thêm cho đủ".
 */
import { describe, it, expect } from "vitest";
import { PERMISSIONS, type Action } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";

/** Ba action gác đúng ba mục menu đang nói tới (components/admin/sidebar.tsx). */
const ACTION_BI_AN = ["centers:view", "holidays:view", "kits:view"] as const;

/** v2 (nguồn quyền của PROD) — Sale cơ sở + Giáo vụ. */
const VAI_V2 = ["CENTER_SALES_CSM", "CENTER_CLASS_MANAGER"] as const;

/** v1 (local/dev/CI) — Sale. Giáo vụ KHÔNG tồn tại ở enum 9 vai của v1. */
const VAI_V1 = "SALES_CSM";

describe("sidebar — ba mục quản trị ẩn với Sale và Quản lý lớp học", () => {
  it.each(VAI_V2)("v2 · %s KHÔNG giữ centers:view / holidays:view / kits:view", (code) => {
    const role = ROLE_SEED.find((r) => r.code === code);
    expect(role, `seed-roles.ts phải có RoleDef "${code}"`).toBeDefined();
    const co = role!.perms.map((p) => p.action).filter((a) => (ACTION_BI_AN as readonly string[]).includes(a));
    expect(co).toEqual([]);
  });

  it.each(ACTION_BI_AN)("v1 · %s KHÔNG cấp cho SALES_CSM (khớp v2, để dev ≠ prod thôi lệch)", (action) => {
    expect(PERMISSIONS[action as Action]).not.toContain(VAI_V1);
  });

  it("ba action vẫn CÒN trong ma trận — đây là gỡ khỏi VAI, không phải xoá quyền", () => {
    for (const a of ACTION_BI_AN) {
      expect(PERMISSIONS[a as Action], `${a} biến mất khỏi PERMISSIONS`).toBeDefined();
      expect(PERMISSIONS[a as Action].length).toBeGreaterThan(0);
    }
  });
});
