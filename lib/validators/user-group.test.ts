// US-03 (Nền Hệ thống P0) — validator UserGroup + grant GROUP · VIẾT TRƯỚC hiện thực (luật #5).
//
// Hợp đồng đông cứng (thiết kế duyệt 09/08/2026) + SIẾT theo review đối kháng 09/08:
// - Grant GROUP ở P0 CHỈ nhận dataScope ALL — OWN bị SIẾT THÊM so với chốt "ALL|OWN"
//   ban đầu (bẫy thu hồi im lặng: consumer chưa truyền target → ALLOW+OWN đè quyền
//   vai sẵn có thành false; xem chú thích GROUP_GRANT_DATA_SCOPES — chờ user veto).
//   UNIT_ONLY/UNIT_AND_BELOW như cũ (mapping group→center chưa tồn tại tới P1).
//   Tất cả bị chặn với LỖI RÕ CHỮ ở write path, không cho tạo grant "trông như hoạt động".
// - Khoá QUẢN TRỊ (NON_GROUP_GRANTABLE_KEYS) CẤM cấp qua nhóm — chống tự-leo-thang.
// - ALLOW ⇒ fieldMask BẮT BUỘC rỗng (mask chỉ dành cho DENY cấp trường — BA §2.5;
//   engine US-02 đã bỏ qua row ALLOW+mask kèm warn, đây là cú chặn cứng hứa ở đó).
// - reason BẮT BUỘC (audit — RbacAuditLog).
// - name nhóm: 1..100 ký tự sau trim.
// - groupMemberIneligibleReason: PARENT không vào nhóm (pin server-side của
//   addGroupMemberAction — action dùng đúng hàm này, đối xứng query ứng viên của page).
//
// File này ĐỎ (Cannot find module) cho tới khi lib/validators/user-group.ts tồn tại.
import { describe, it, expect } from "vitest";
import {
  userGroupCreateSchema,
  groupGrantCreateSchema,
  groupMemberIneligibleReason,
  NON_GROUP_GRANTABLE_KEYS,
} from "@/lib/validators/user-group";

/** Input grant hợp lệ làm nền — từng case override đúng 1 chiều. */
const validGrant = {
  permissionKey: "students:view-all",
  effect: "DENY",
  dataScope: "ALL",
  fieldMask: ["parentPhone"],
  reason: "TS-02: che SĐT phụ huynh cho nhóm CSKH tạm thời",
};

function messagesOf(result: { success: boolean; error?: { issues: { message: string }[] } }): string {
  if (result.success || !result.error) return "";
  return result.error.issues.map((i) => i.message).join(" · ");
}

describe("US-03 · groupGrantCreateSchema — luật ALLOW/DENY × fieldMask", () => {
  it("DENY + ALL + fieldMask ['parentPhone'] → pass (DENY cấp trường của TS-02)", () => {
    const r = groupGrantCreateSchema.safeParse(validGrant);
    expect(r.success).toBe(true);
  });

  it("DENY + ALL + fieldMask rỗng → pass (DENY toàn action — AC2)", () => {
    const r = groupGrantCreateSchema.safeParse({ ...validGrant, fieldMask: [] });
    expect(r.success).toBe(true);
  });

  it("ALLOW + fieldMask khác rỗng → reject, lỗi nói rõ mask chỉ dành cho DENY", () => {
    const r = groupGrantCreateSchema.safeParse({ ...validGrant, effect: "ALLOW" });
    expect(r.success).toBe(false);
    expect(messagesOf(r)).toMatch(/DENY/);
  });

  it("ALLOW + fieldMask rỗng → pass (grant editor cấp cả ALLOW — SUPER_ADMIN only ở action)", () => {
    const r = groupGrantCreateSchema.safeParse({
      ...validGrant,
      effect: "ALLOW",
      fieldMask: [],
    });
    expect(r.success).toBe(true);
  });
});

describe("US-03 · groupGrantCreateSchema — dataScope P0 chỉ ALL (siết 09/08)", () => {
  for (const scope of ["UNIT_ONLY", "UNIT_AND_BELOW"] as const) {
    it(`dataScope ${scope} → reject với lỗi RÕ CHỮ nêu ALL (không phải enum error câm)`, () => {
      const r = groupGrantCreateSchema.safeParse({ ...validGrant, dataScope: scope });
      expect(r.success).toBe(false);
      // Lỗi phải tự giải thích được cho người cấp quyền: nêu scope được phép.
      const msg = messagesOf(r);
      expect(msg).toMatch(/ALL/);
      expect(msg).toMatch(/P1/);
    });
  }

  // SIẾT so với chốt "ALL|OWN" 09/08 — OWN là bẫy thu hồi im lặng khi consumer
  // chưa truyền target (ALLOW+OWN → resolveGrant hit + scope fail → false, đè
  // quyền vai sẵn có). Mở lại ở P1. Message phải nêu được lý do, không câm.
  it("dataScope OWN → reject kèm message giải thích bẫy + hẹn P1", () => {
    const r = groupGrantCreateSchema.safeParse({
      ...validGrant,
      dataScope: "OWN",
      fieldMask: [],
    });
    expect(r.success).toBe(false);
    const msg = messagesOf(r);
    expect(msg).toMatch(/ALL/);
    expect(msg).toMatch(/thu hồi im lặng/);
    expect(msg).toMatch(/P1/);
  });

  it("dataScope ALL → pass (scope duy nhất của P0)", () => {
    const r = groupGrantCreateSchema.safeParse({ ...validGrant, dataScope: "ALL" });
    expect(r.success).toBe(true);
  });
});

describe("US-03 · groupGrantCreateSchema — khoá quản trị KHÔNG cấp qua nhóm (chống tự-leo-thang)", () => {
  // Pin đủ 7 key — thiếu key nào trong hằng là test này lộ ngay.
  // 11 → 7 (02/10/2026): gỡ Cổng dữ liệu agent ⇒ bỏ bốn khoá `agent_gateway:*`.
  const EXPECTED = [
    "roles:manage",
    "users:manage",
    "user-groups:manage",
    "settings:view",
    "settings:edit",
    "audit-logs:view",
    "audit-logs:view-pii",
  ];

  it("NON_GROUP_GRANTABLE_KEYS đúng danh sách 7 khoá quản trị", () => {
    expect([...NON_GROUP_GRANTABLE_KEYS].sort()).toEqual([...EXPECTED].sort());
  });

  for (const key of EXPECTED) {
    it(`permissionKey ${key} → reject (cả ALLOW lẫn DENY), lỗi nêu lý do leo thang`, () => {
      for (const effect of ["ALLOW", "DENY"] as const) {
        const r = groupGrantCreateSchema.safeParse({
          ...validGrant,
          permissionKey: key,
          effect,
          fieldMask: [],
        });
        expect(r.success).toBe(false);
        expect(messagesOf(r)).toMatch(/leo thang/);
      }
    });
  }

  it("key thường (students:view-all) không bị chặn bởi luật này", () => {
    expect(groupGrantCreateSchema.safeParse(validGrant).success).toBe(true);
  });
});

describe("US-03 · groupMemberIneligibleReason — PARENT không vào nhóm (pin cho addGroupMemberAction)", () => {
  // Server Action addGroupMemberAction gọi đúng hàm này sau check isActive/deletedAt —
  // pin ở đây vì repo không có pattern test action thuần (action cần auth()+DB thật).
  // Điều kiện đối xứng query ứng viên của [id]/page.tsx: role CHÍNH ≠ PARENT
  // (page không lọc roles[] → hàm này cũng không).
  it("role PARENT → trả message tiếng Việt rõ", () => {
    const msg = groupMemberIneligibleReason({ role: "PARENT" });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/phụ huynh/i);
  });

  it("role nội bộ → null (hợp lệ)", () => {
    for (const role of ["SUPER_ADMIN", "CENTER_MANAGER", "HR", "TEACHER", "ACCOUNTANT"]) {
      expect(groupMemberIneligibleReason({ role })).toBeNull();
    }
  });
});

describe("US-03 · groupGrantCreateSchema — reason bắt buộc (audit)", () => {
  it("thiếu reason → reject", () => {
    const { reason: _bo, ...khongReason } = validGrant;
    const r = groupGrantCreateSchema.safeParse(khongReason);
    expect(r.success).toBe(false);
  });

  it("reason rỗng/toàn khoảng trắng → reject", () => {
    expect(groupGrantCreateSchema.safeParse({ ...validGrant, reason: "" }).success).toBe(false);
    expect(groupGrantCreateSchema.safeParse({ ...validGrant, reason: "   " }).success).toBe(false);
  });
});

describe("US-03 · userGroupCreateSchema — name 1..100", () => {
  it("name hợp lệ (+description optional) → pass", () => {
    expect(userGroupCreateSchema.safeParse({ name: "Nhóm CSKH hè 2026" }).success).toBe(true);
    expect(
      userGroupCreateSchema.safeParse({
        name: "A".repeat(100),
        description: "grant ad-hoc không sửa vai chuẩn",
      }).success,
    ).toBe(true);
  });

  it("name rỗng / toàn khoảng trắng → reject", () => {
    expect(userGroupCreateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(userGroupCreateSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("name quá 100 ký tự → reject", () => {
    expect(userGroupCreateSchema.safeParse({ name: "A".repeat(101) }).success).toBe(false);
  });
});
