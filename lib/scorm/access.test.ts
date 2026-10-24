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

  it("[SCORM-SUB] GV được xếp DẠY THAY buổi (substituteTeacherId) → true, dù không thuộc lớp", () => {
    expect(
      isAssignedTeacher(
        actor({ userId: "sub-9" }),
        session({ substituteTeacherId: "sub-9" }),
      ),
    ).toBe(true);
  });

  it("[SCORM-SUB] đối chứng: dạy thay buổi NÀY không mở được buổi khác (không có substituteTeacherId)", () => {
    expect(
      isAssignedTeacher(
        actor({ userId: "sub-9" }),
        session({ substituteTeacherId: "nguoi-khac" }),
      ),
    ).toBe(false);
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

// [SCORM-SUB-W] Dây nối: cổng thuần đọc `substituteTeacherId`, nhưng nó chỉ thấy cột mà trang player `select` ra —
// gỡ cột khỏi `select` thì mọi ca thuần ở trên vẫn xanh còn GV dạy thay thì bị đá về trang chủ.
describe("[SCORM-SUB-W] hai trang player nạp cột dạy thay cho cổng", () => {
  for (const f of [
    "app/(teacher)/teacher/scorm/play/[id]/page.tsx",
    "app/(admin)/admin/scorm/play/[id]/page.tsx",
  ]) {
    it(f, async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const src = readFileSync(join(__dirname, "..", "..", f), "utf8")
        .split(/\r?\n/)
        .filter((d) => !/^\s*(\/\/|\/\*|\*)/.test(d))
        .join("\n");
      const khoi = src.slice(src.indexOf("classSession.findUnique"));
      expect(khoi.slice(0, khoi.indexOf("});"))).toContain("substituteTeacherId: true");
    });
  }
});
