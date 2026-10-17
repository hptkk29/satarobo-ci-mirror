// US-04 (TS-18) — chân trị TƯƠNG LAI của chuỗi 4 điều kiện chương trình dạy,
// viết TRƯỚC khi resolver US-16 tồn tại (US-04 AC3 + AC4, luật cứng #5).
//
// Cơ chế expected-fail (thiết kế duyệt 09/08, đã kiểm chứng vitest 4.1.6):
// - `it.fails`: assertion viết theo CHÂN TRỊ TƯƠNG LAI (BA §3.2). Hôm nay
//   canViewSessionContent ném NotImplementedYetError → test "fail" → vitest báo XANH.
//   Khi US-16 hiện thực đúng → assertion pass → vitest báo ĐỎ "Expect test to fail"
//   → buộc gỡ `.fails` đúng lúc, không thể quên.
// - Tripwire THƯỜNG cuối file pin hành vi HÔM NAY (ném NotImplementedYetError):
//   US-16 hiện thực → tripwire đỏ → gỡ tripwire + toàn bộ `.fails` TRONG CÙNG COMMIT.
//
// Fixture tham chiếu (đầu 04-TestScenarios): GV-HO (giáo viên biên chế HO), QL-CS1
// (quản lý CS1), CS-F (FRANCHISEE, FC-1 ACTIVE), CUR-1 (LOCKED, HO sở hữu).
import { describe, it, expect } from "vitest";
import {
  canViewSessionContent,
  NotImplementedYetError,
  type SessionGateInput,
} from "@/lib/permissions/session-content-gate";

/** Input nền: GV đủ cả 4 điều kiện, cơ sở OWNED (không có FC) — case (e). */
function makeGate(overrides: Partial<SessionGateInput> = {}): SessionGateInput {
  return {
    roleAllowsView: true,
    assignedToClass: true,
    classLinkedToCurriculum: true,
    sessionWindowOpen: true,
    viewer: "TEACHER",
    franchiseContractStatus: null,
    ...overrides,
  };
}

describe("US-04 · TS-18 chuỗi 4 điều kiện — chân trị tương lai (US-16)", () => {
  // (a-d) TS-18: "lần lượt bỏ đúng MỘT điều kiện → cả 4 case đều 403".
  // BA §3.2: role ∧ phân công lớp ∧ lớp liên kết chương trình ∧ cửa sổ mở — AND cứng.
  const denyCases: Array<{ tag: string; label: string; overrides: Partial<SessionGateInput> }> = [
    {
      tag: "[US-04-TS18-01]",
      label: "thiếu điều kiện 1 — role không cho phép view",
      overrides: { roleAllowsView: false },
    },
    {
      tag: "[US-04-TS18-02]",
      label: "thiếu điều kiện 2 — không được phân công vào lớp",
      overrides: { assignedToClass: false },
    },
    {
      tag: "[US-04-TS18-03]",
      label: "thiếu điều kiện 3 — lớp không liên kết chương trình (CUR-1)",
      overrides: { classLinkedToCurriculum: false },
    },
    {
      tag: "[US-04-TS18-04]",
      label: "thiếu điều kiện 4 — buổi ngoài cửa sổ mở (khoá theo từng buổi)",
      overrides: { sessionWindowOpen: false },
    },
  ];

  for (const c of denyCases) {
    it.fails(`${c.tag}[US-04→P5] ${c.label} → DENIED`, () => {
      expect(canViewSessionContent(makeGate(c.overrides))).toBe("DENIED");
    });
  }

  // (e) TS-18: "đủ 4 → 200" — GV-HO tại cơ sở OWNED (không có FC).
  it.fails("[US-04-TS18-05][US-04→P5] GV đủ 4 điều kiện, cơ sở OWNED → CONTENT", () => {
    expect(canViewSessionContent(makeGate())).toBe("CONTENT");
  });

  // (f) BA §3.2: "Quản lý chỉ thấy DANH SÁCH có chương trình nào, không xem được nội
  // dung bên trong" — TS-18: "QL-CS1 gọi cùng endpoint → chỉ nhận danh sách tên chương trình".
  it.fails("[US-04-TS18-06][US-04→P5] MANAGER đủ 4 điều kiện → LIST_ONLY (không nội dung)", () => {
    expect(canViewSessionContent(makeGate({ viewer: "MANAGER" }))).toBe("LIST_ONLY");
  });

  // (g) BA §3.2 (chốt 27/07): "Giáo viên ở cơ sở nhượng quyền tỉnh khác VẪN được view
  // nội dung" — TS-18: "giáo viên CS-F (tỉnh khác, FC ACTIVE, đủ 4 điều kiện) → 200".
  it.fails("[US-04-TS18-07][US-04→P5] GV CS-F, FC ACTIVE, đủ 4 điều kiện → CONTENT", () => {
    expect(
      canViewSessionContent(makeGate({ franchiseContractStatus: "ACTIVE" })),
    ).toBe("CONTENT");
  });
});

describe("US-04 · TS-18 tripwire — pin hành vi HÔM NAY của skeleton", () => {
  // TRIPWIRE: US-16 hiện thực canViewSessionContent → test này ĐỎ → gỡ nó cùng toàn bộ
  // 7 case `.fails` [US-04→P5] ở trên TRONG CÙNG COMMIT của story resolver (US-16).
  it("[US-04-TS18-00] skeleton chưa hiện thực → ném NotImplementedYetError", () => {
    expect(() => canViewSessionContent(makeGate())).toThrow(NotImplementedYetError);
  });
});
