// #13 (câu 11) — "Chuyển vai trò". Lõi THUẦN: cookie do client set nên KHÔNG được tin.
import { describe, it, expect } from "vitest";
import { menuUserForRole, resolveActiveRole } from "@/lib/auth/active-role";
import { getEffectiveRoles } from "@/lib/auth/permissions";

const toai = { role: "CENTER_MANAGER", roles: ["CENTER_MANAGER", "TEACHER", "TRAINING"] };
const duc = { role: "TEACHER", roles: ["TEACHER"] };

describe("resolveActiveRole — chỉ chấp nhận vai trò user THỰC SỰ giữ", () => {
  it("không có cookie → null (xem gộp mọi vai)", () => {
    expect(resolveActiveRole(toai, undefined)).toBeNull();
    expect(resolveActiveRole(toai, "")).toBeNull();
  });

  it("vai trò hợp lệ → trả về chính nó", () => {
    expect(resolveActiveRole(toai, "TEACHER")).toBe("TEACHER");
    expect(resolveActiveRole(toai, "TRAINING")).toBe("TRAINING");
  });

  it("vai trò user KHÔNG giữ → null, không leo thang quyền qua devtools", () => {
    expect(resolveActiveRole(toai, "SUPER_ADMIN")).toBeNull();
    expect(resolveActiveRole(duc, "CENTER_MANAGER")).toBeNull();
  });

  it("giá trị rác → null", () => {
    expect(resolveActiveRole(toai, "'; DROP TABLE users;--")).toBeNull();
    expect(resolveActiveRole(toai, "teacher")).toBeNull(); // phân biệt hoa/thường
  });
});

describe("menuUserForRole — lọc menu, KHÔNG đụng grant riêng", () => {
  const grants = [{ action: "leads:export", grant: "ALLOW" as const }];

  it("không chọn vai → giữ nguyên union", () => {
    const u = { ...toai, grants };
    expect(menuUserForRole(u, null)).toEqual(u);
  });

  it("chọn vai → chỉ còn vai đó, grant giữ nguyên", () => {
    const out = menuUserForRole({ ...toai, grants }, "TEACHER");
    expect(out.role).toBe("TEACHER");
    expect(out.roles).toEqual(["TEACHER"]);
    expect(out.grants).toEqual(grants); // grant gắn với CON NGƯỜI, không gắn với vai
  });
});

describe("getEffectiveRoles.length — quyết định hiện nút chuyển vai (hasMultipleRoles đã gỡ, check tại chỗ)", () => {
  it("nhiều vai → >1", () => expect(getEffectiveRoles(toai).length > 1).toBe(true));
  it("một vai → không hiện", () => expect(getEffectiveRoles(duc).length > 1).toBe(false));
  it("dedup: roles trùng phần tử → vẫn tính 1 vai", () =>
    expect(getEffectiveRoles({ role: "TEACHER", roles: ["TEACHER", "TEACHER"] }).length > 1).toBe(false));
});
