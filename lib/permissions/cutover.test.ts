// lib/permissions/cutover.test.ts — Nền Hệ thống P4 · US-13 · AC2.
//
// Cờ cutover: `can()` đổi ĐƠN VỊ ĐO từ `centerId` sang `orgUnitId`.
//
// ── VÌ SAO CỜ NẰM TRÊN ACTOR CHỨ KHÔNG ĐỌC ENV TRONG can() ─────────────────────────
// AC2 đòi "rollback 1 thao tác, KHÔNG cần deploy". Env trên Vercel muốn đổi là phải
// redeploy — vài phút, và trong lúc đó quyền vẫn sai. Nên nguồn cờ là `SystemSetting`
// (màn Cấu hình, có audit + lý do), đọc lúc dựng Actor mỗi request. `can()` vẫn THUẦN
// và ĐỒNG BỘ: nó chỉ đọc `actor.orgScopeCutover`.
//
// ── CA QUAN TRỌNG NHẤT: CỜ TẮT PHẢI GIỐNG HỆT TRƯỚC KHI CÓ CỜ ─────────────────────
// Rollback chỉ đáng tin nếu đường tắt không bị đụng vào. Nên mỗi ca dưới đây đo cả hai
// trạng thái cờ trên CÙNG dữ liệu, và ca "tắt" so với kỳ vọng của hành vi cũ.
import { describe, it, expect } from "vitest";
import type { Actor, PermEntry } from "@/lib/auth/actor";
import type { GrantRow } from "@/lib/permissions/grant-types";
import { can } from "@/lib/permissions/can";

const perm = (over: Partial<PermEntry> = {}): PermEntry => ({
  action: "students:view",
  scopeType: "CENTER",
  orgUnitId: "ou-cs1",
  roleCode: "CENTER_MANAGER",
  centerScope: ["c-cs1"],
  orgUnitScope: ["ou-cs1"],
  ...over,
});

const grant = (over: Partial<GrantRow> = {}): GrantRow =>
  ({
    subjectType: "ROLE",
    subjectId: "role-gv",
    permissionKey: "students:view",
    effect: "ALLOW",
    dataScope: "UNIT_ONLY",
    fieldMask: [],
    ...over,
  }) as GrantRow;

const actor = (over: Partial<Actor> = {}): Actor =>
  ({
    userId: "u1",
    isSuperAdmin: false,
    roleIds: ["role-gv"],
    groupIds: [],
    permissions: [perm()],
    permissionGrants: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    guardedStudentIds: new Set<string>(),
    roleCenterScope: { "role-gv": { unitOnly: ["c-cs1"], unitAndBelow: ["c-cs1"] } },
    roleOrgScope: { "role-gv": { unitOnly: ["ou-cs1"], unitAndBelow: ["ou-cs1"] } },
    orgScopeCutover: false,
    ...over,
  }) as unknown as Actor;

describe("[US-13][AC2] cờ cutover đổi đơn vị đo — đường PermEntry", () => {
  // Dữ liệu cố tình dựng để hai đơn vị đo cho kết quả KHÁC nhau: cơ sở khớp,
  // đơn vị không. Nếu cờ không có tác dụng thì hai dòng dưới sẽ bằng nhau.
  const target = { centerId: "c-cs1", orgUnitId: "ou-khac" };

  it("TẮT ⇒ đo bằng centerId (hành vi cũ, y nguyên)", () => {
    expect(can(actor(), "students:view", target)).toBe(true);
  });

  it("BẬT ⇒ đo bằng orgUnitId", () => {
    expect(can(actor({ orgScopeCutover: true }), "students:view", target)).toBe(false);
  });

  it("BẬT nhưng target thiếu orgUnitId ⇒ TỪ CHỐI (fail-closed, không rơi về centerId)", () => {
    // Rơi ngược về centerId khi thiếu dữ liệu sẽ biến cutover thành nửa vời và giấu
    // đúng những chỗ chưa được vá — chính là thứ cổng "chưa phủ" bắt phải dọn TRƯỚC.
    expect(can(actor({ orgScopeCutover: true }), "students:view", { centerId: "c-cs1" })).toBe(
      false,
    );
  });
});

describe("[US-13][AC2] cờ cutover — đường PermissionGrant", () => {
  const a = (cutover: boolean) =>
    actor({ permissionGrants: [grant()], permissions: [], orgScopeCutover: cutover });

  it("TẮT ⇒ centerId", () => {
    expect(a(false)).toBeTruthy();
    expect(can(a(false), "students:view", { centerId: "c-cs1", orgUnitId: "ou-khac" })).toBe(true);
  });

  it("BẬT ⇒ orgUnitId", () => {
    expect(can(a(true), "students:view", { centerId: "c-cs1", orgUnitId: "ou-khac" })).toBe(false);
  });
});

describe("[US-13][AC4] OWN của phụ huynh resolve qua liên kết Guardian–Student", () => {
  const phuHuynh = (studentIds: string[], cutover = true) =>
    actor({
      userId: "ph-1",
      roleIds: [],
      permissions: [
        { action: "students:view", scopeType: "OWN", orgUnitId: "", roleCode: "PARENT", centerScope: null, orgUnitScope: null },
      ],
      guardedStudentIds: new Set(studentIds),
      orgScopeCutover: cutover,
    });

  it("PH xem con MÌNH ⇒ được", () => {
    expect(can(phuHuynh(["hs-1"]), "students:view", { studentId: "hs-1" })).toBe(true);
  });

  it("PH đổi ID sang học viên khác ⇒ TỪ CHỐI (chặn IDOR — TS-15)", () => {
    expect(can(phuHuynh(["hs-1"]), "students:view", { studentId: "hs-2" })).toBe(false);
  });

  it("gỡ liên kết Guardian–Student ⇒ TỪ CHỐI ngay ở request kế tiếp", () => {
    expect(can(phuHuynh([]), "students:view", { studentId: "hs-1" })).toBe(false);
  });

  it("OWN theo người tạo VẪN chạy — mở rộng chứ không thay thế", () => {
    const a = actor({
      permissions: [
        { action: "notes:edit", scopeType: "OWN", orgUnitId: "", roleCode: "TEACHER", centerScope: null, orgUnitScope: null },
      ],
      orgScopeCutover: true,
    });
    expect(can(a, "notes:edit", { createdById: "u1" })).toBe(true);
    expect(can(a, "notes:edit", { createdById: "u2" })).toBe(false);
  });

  it("cờ TẮT: OWN vẫn nhận liên kết Guardian — đây là SỬA LỖI, không phải cutover", () => {
    // AC4 không phụ thuộc đơn vị đo. Buộc nó vào cờ cutover nghĩa là phụ huynh phải
    // chờ hết pha shadow mới hết bị 403 — trong khi lỗi IDOR/403 của họ là chuyện hôm nay.
    expect(can(phuHuynh(["hs-1"], false), "students:view", { studentId: "hs-1" })).toBe(true);
  });
});
