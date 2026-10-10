import { describe, it, expect } from "vitest";
import {
  canOpenScorm,
  isAssignedTeacher,
  canManageTraining,
  type ScormActor,
  type ScormClassSession,
} from "./access";
import type { PermEntry } from "@/lib/auth/actor";

function actor(opts: {
  userId: string;
  isSuperAdmin?: boolean;
  actions?: string[];
  grants?: string[];
}): ScormActor {
  const permissions: PermEntry[] = (opts.actions ?? []).map((action) => ({
    action,
    scopeType: "GLOBAL",
    orgUnitId: "org-1",
    roleCode: "ROLE",
    centerScope: null,
  }));
  return {
    userId: opts.userId,
    isSuperAdmin: opts.isSuperAdmin ?? false,
    permissions,
    grantsAllow: new Set(opts.grants ?? []),
  };
}

const session = (over: Partial<ScormClassSession> = {}): ScormClassSession => ({
  actualTeacherId: null,
  class: { teacherId: "teacher-1", assistantId: "assist-1" },
  ...over,
});

describe("isAssignedTeacher", () => {
  it("GV chính của lớp → true", () => {
    expect(isAssignedTeacher(actor({ userId: "teacher-1" }), session())).toBe(
      true,
    );
  });

  it("trợ giảng của lớp → true", () => {
    expect(isAssignedTeacher(actor({ userId: "assist-1" }), session())).toBe(
      true,
    );
  });

  it("GV thực dạy buổi (actualTeacherId) → true", () => {
    expect(
      isAssignedTeacher(
        actor({ userId: "sub-9" }),
        session({ actualTeacherId: "sub-9" }),
      ),
    ).toBe(true);
  });

  it("GV lớp khác → false", () => {
    expect(isAssignedTeacher(actor({ userId: "other" }), session())).toBe(
      false,
    );
  });

  it("class null → false (không crash)", () => {
    expect(
      isAssignedTeacher(actor({ userId: "x" }), { class: null }),
    ).toBe(false);
  });
});

describe("canManageTraining", () => {
  it("có training:manage → true", () => {
    expect(
      canManageTraining(actor({ userId: "u", actions: ["training:manage"] })),
    ).toBe(true);
  });

  it("SUPER_ADMIN → true (không cần action)", () => {
    expect(canManageTraining(actor({ userId: "u", isSuperAdmin: true }))).toBe(
      true,
    );
  });

  it("grant ALLOW training:manage → true", () => {
    expect(
      canManageTraining(actor({ userId: "u", grants: ["training:manage"] })),
    ).toBe(true);
  });

  it("không có quyền → false", () => {
    expect(canManageTraining(actor({ userId: "u" }))).toBe(false);
  });
});

describe("canOpenScorm", () => {
  it("GV phân công lớp → true", () => {
    expect(canOpenScorm(actor({ userId: "teacher-1" }), session())).toBe(true);
  });

  it("GV khác lớp, không quyền quản lý → false", () => {
    expect(canOpenScorm(actor({ userId: "stranger" }), session())).toBe(false);
  });

  it("training:manage (Đào tạo) dù không phân công → true", () => {
    expect(
      canOpenScorm(
        actor({ userId: "trainer", actions: ["training:manage"] }),
        session(),
      ),
    ).toBe(true);
  });

  it("SUPER_ADMIN → true", () => {
    expect(
      canOpenScorm(actor({ userId: "admin", isSuperAdmin: true }), session()),
    ).toBe(true);
  });
});
