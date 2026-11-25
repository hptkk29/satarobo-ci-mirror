// Phần THUẦN của lib/chat/members-admin.ts — nhóm vai, nhãn vai, tin hệ thống, schema.
// Phần chạm DB (ghi MANUAL, sync/reconcile bỏ qua MANUAL, quyền) ở tests/chat/members-admin.spec.ts.
import { describe, expect, it, vi } from "vitest";

// Module kéo Prisma + next-auth qua `lib/chat/admin.ts`; test thuần không cần chúng.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: async () => true,
  conversationBroadcast: () => ({}),
  userBumpBroadcasts: () => [],
}));

import {
  MEMBERS_ADD_MAX_CONVERSATIONS,
  MEMBERS_ADD_MAX_USERS,
  STAFF_BUCKETS,
  STAFF_BUCKET_LABELS,
  addMembersSchema,
  addedSystemMessage,
  bucketsOf,
  removeManualMemberSchema,
  roleLabelsOf,
} from "./members-admin";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("[MAU-01] bucketsOf — người thuộc nhóm vai nào (v1 ∪ v2)", () => {
  it("QLCS v1, QLCS v2, Giáo vụ v2, Sale v1/v2, GV đều ra đúng nhóm", () => {
    expect(bucketsOf({ role: "CENTER_MANAGER", roles: [], roleDefCodes: [] })).toEqual(["QLCS"]);
    expect(bucketsOf({ role: "SALES_CSM", roles: [], roleDefCodes: ["CENTER_MANAGER"] })).toEqual(["QLCS", "SALE"]);
    expect(bucketsOf({ role: "SALES_CSM", roles: [], roleDefCodes: ["CENTER_CLASS_MANAGER"] })).toEqual([
      "GIAO_VU",
      "SALE",
    ]);
    expect(bucketsOf({ role: "SALES_CSM", roles: [], roleDefCodes: ["CENTER_SALES_CSM"] })).toEqual(["SALE"]);
    expect(bucketsOf({ role: "TEACHER", roles: [], roleDefCodes: ["ASSISTANT_TEACHER"] })).toEqual(["GIAO_VIEN"]);
  });

  it("người không thuộc nhóm nào (Kế toán, Marketing…) rơi vào KHAC — không bao giờ ra mảng rỗng", () => {
    expect(bucketsOf({ role: "ACCOUNTANT", roles: [], roleDefCodes: [] })).toEqual(["KHAC"]);
    expect(bucketsOf({ role: null, roles: [], roleDefCodes: [] })).toEqual(["KHAC"]);
  });

  it("mọi nhóm đều có nhãn hiển thị (thêm nhóm mới mà quên nhãn là đỏ ở đây)", () => {
    for (const b of STAFF_BUCKETS) expect(STAFF_BUCKET_LABELS[b]).toBeTruthy();
  });
});

describe("[MAU-02] roleLabelsOf — ưu tiên RoleDef v2, lùi về enum v1, bỏ PARENT", () => {
  it("có v2 ⇒ dùng nhãn v2 (đúng thứ prod enforce)", () => {
    expect(
      roleLabelsOf({ role: "SALES_CSM", roles: [], roleDefCodes: ["CENTER_CLASS_MANAGER", "CENTER_SALES_CSM"] }),
    ).toEqual(["Quản lý lớp học", "Tư vấn & CSKH cơ sở"]);
  });
  it("không có v2 ⇒ nhãn v1; PARENT không bao giờ hiện", () => {
    expect(roleLabelsOf({ role: "SALES_CSM", roles: ["PARENT"], roleDefCodes: [] })).toEqual(["Tư vấn & Chăm sóc"]);
    expect(roleLabelsOf({ role: "PARENT", roles: [], roleDefCodes: ["PARENT"] })).toEqual([]);
  });
});

describe("[MAU-03] addedSystemMessage", () => {
  it("nêu đủ tên khi ít người", () => {
    expect(addedSystemMessage(["Vân"])).toBe("Quản trị viên đã thêm Vân vào nhóm.");
    expect(addedSystemMessage(["A", "B", "C", "D"])).toBe("Quản trị viên đã thêm A, B, C, D vào nhóm.");
  });
  it("gọn lại khi nhiều người — không dựng một dòng dài cả màn", () => {
    expect(addedSystemMessage(["A", "B", "C", "D", "E", "F"])).toBe(
      "Quản trị viên đã thêm A, B, C, D và 2 người khác vào nhóm.",
    );
  });
});

describe("[MAU-04] schema", () => {
  it("lý do KHÔNG bắt buộc (chủ dự án: 'add thôi')", () => {
    expect(addMembersSchema.safeParse({ conversationIds: [UUID], userIds: ["u1"] }).success).toBe(true);
  });
  it("chặn rỗng và vượt trần — chặn bấm nhầm 'chọn tất cả' trên dữ liệu lớn", () => {
    expect(addMembersSchema.safeParse({ conversationIds: [], userIds: ["u1"] }).success).toBe(false);
    expect(addMembersSchema.safeParse({ conversationIds: [UUID], userIds: [] }).success).toBe(false);
    const many = Array.from({ length: MEMBERS_ADD_MAX_CONVERSATIONS + 1 }, (_, i) => UUID.replace(/1/g, String(i % 9)));
    expect(addMembersSchema.safeParse({ conversationIds: many, userIds: ["u1"] }).success).toBe(false);
    const users = Array.from({ length: MEMBERS_ADD_MAX_USERS + 1 }, (_, i) => `u${i}`);
    expect(addMembersSchema.safeParse({ conversationIds: [UUID], userIds: users }).success).toBe(false);
  });
  it("id nhóm phải là UUID — chuỗi lạ không lọt vào truy vấn", () => {
    expect(addMembersSchema.safeParse({ conversationIds: ["abc"], userIds: ["u1"] }).success).toBe(false);
    expect(removeManualMemberSchema.safeParse({ conversationId: "abc", userId: "u1" }).success).toBe(false);
    expect(removeManualMemberSchema.safeParse({ conversationId: UUID, userId: "u1" }).success).toBe(true);
  });
});
