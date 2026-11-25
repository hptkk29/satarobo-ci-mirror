// Canh gác `detectActorScopeConflict` — QA site GV vòng 1, nguyên nhân gốc RC-3.
//
// Hàm này KHÔNG quyết định quyền; nó chỉ phát hiện actor tự mâu thuẫn để ghi log.
// Test ở đây chốt hai điều: (1) không báo động giả cho các vai bình thường, vì một
// cảnh báo kêu suốt ngày là cảnh báo bị tắt; (2) bắt đúng hình dạng sự cố prod 07/08.
import { describe, expect, it } from "vitest";

import { detectActorScopeConflict } from "@/lib/auth/actor";

const base = {
  isSuperAdmin: false,
  isHoLevel: false,
  visibleCenterIdCount: 1,
  assignedClassCount: 3,
  orgRoleCount: 1,
};

describe("detectActorScopeConflict", () => {
  it("giáo viên bình thường: không cảnh báo", () => {
    expect(detectActorScopeConflict(base)).toBe(null);
  });

  it("sự cố prod 07/08: có lớp, KHÔNG có UserOrgRole nào", () => {
    expect(
      detectActorScopeConflict({
        ...base,
        visibleCenterIdCount: 0,
        orgRoleCount: 0,
      }),
    ).toBe("MISSING_ORG_ROLE");
  });

  it("có UserOrgRole nhưng không vai nào neo vào cơ sở nhìn thấy được", () => {
    expect(
      detectActorScopeConflict({
        ...base,
        visibleCenterIdCount: 0,
        orgRoleCount: 2,
      }),
    ).toBe("NO_VISIBLE_CENTER");
  });

  it("SUPER_ADMIN không bao giờ bị báo — đi nhánh cross-center riêng", () => {
    expect(
      detectActorScopeConflict({
        ...base,
        isSuperAdmin: true,
        visibleCenterIdCount: 0,
        orgRoleCount: 0,
      }),
    ).toBe(null);
  });

  it("vai cấp Hội sở không bị báo — cũng đi nhánh cross-center riêng", () => {
    expect(
      detectActorScopeConflict({
        ...base,
        isHoLevel: true,
        visibleCenterIdCount: 0,
        orgRoleCount: 0,
      }),
    ).toBe(null);
  });

  it("không được phân lớp nào thì không có gì mâu thuẫn (nhân sự văn phòng, phụ huynh)", () => {
    // Phụ huynh là vai QUAN HỆ: cố ý mang centerScope null và không đóng góp vào
    // visibleCenterIds. Báo động cho họ là kêu oan mỗi request của cổng phụ huynh.
    expect(
      detectActorScopeConflict({
        ...base,
        assignedClassCount: 0,
        visibleCenterIdCount: 0,
        orgRoleCount: 0,
      }),
    ).toBe(null);
  });
});
