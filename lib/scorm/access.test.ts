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

  // [SCORM-SUB] Người được xếp DẠY THAY (ClassSession.substituteTeacherId) mở được CHÍNH buổi đó, dù không thuộc lớp.
  it("[SCORM-SUB] GV dạy thay đúng buổi (substituteTeacherId) → true, dù không phải GV/trợ giảng/thực dạy", () => {
    expect(
      isAssignedTeacher(
        actor({ userId: "sub-1" }),
        session({ substituteTeacherId: "sub-1" }),
      ),
    ).toBe(true);
  });

  it("[SCORM-SUB] đối chứng: buổi này xếp người KHÁC dạy thay ⇒ người không liên quan vẫn false", () => {
    expect(
      isAssignedTeacher(
        actor({ userId: "sub-1" }),
        session({ substituteTeacherId: "sub-2" }),
      ),
    ).toBe(false);
  });

  it("[SCORM-SUB] đối chứng: dạy thay buổi NÀY không mở được buổi KHÁC (buổi kia không mang substituteTeacherId của mình)", () => {
    const toi = actor({ userId: "sub-1" });
    expect(isAssignedTeacher(toi, session({ substituteTeacherId: "sub-1" }))).toBe(true);
    expect(isAssignedTeacher(toi, session({ substituteTeacherId: null }))).toBe(false);
    expect(isAssignedTeacher(toi, session())).toBe(false);
  });

  it("[SCORM-SUB] userId rỗng không khớp được substituteTeacherId rỗng/null (fail-closed)", () => {
    expect(
      isAssignedTeacher(
        actor({ userId: "" }),
        session({ substituteTeacherId: "" }),
      ),
    ).toBe(false);
    expect(
      isAssignedTeacher(
        actor({ userId: "" }),
        session({ substituteTeacherId: null, actualTeacherId: null }),
      ),
    ).toBe(false);
  });

  it("[SCORM-SUB] các căn cứ cũ không bị bỏ: có substituteTeacherId của người khác vẫn không làm mất quyền GV chính / trợ giảng / thực dạy", () => {
    const s = session({ substituteTeacherId: "sub-1", actualTeacherId: "real-1" });
    expect(isAssignedTeacher(actor({ userId: "teacher-1" }), s)).toBe(true);
    expect(isAssignedTeacher(actor({ userId: "assist-1" }), s)).toBe(true);
    expect(isAssignedTeacher(actor({ userId: "real-1" }), s)).toBe(true);
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

  it("[SCORM-SUB] GV dạy thay đúng buổi → mở được; người không liên quan → không", () => {
    const s = session({ substituteTeacherId: "sub-1" });
    expect(canOpenScorm(actor({ userId: "sub-1" }), s)).toBe(true);
    expect(canOpenScorm(actor({ userId: "stranger" }), s)).toBe(false);
  });

  it("buổi không đọc được ({} — thiếu/không thấy ClassSession) → từ chối, kể cả GV dạy thay; chỉ training:manage qua được", () => {
    expect(canOpenScorm(actor({ userId: "sub-1" }), {})).toBe(false);
    expect(canOpenScorm(actor({ userId: "teacher-1" }), {})).toBe(false);
    expect(canOpenScorm(actor({ userId: "t", actions: ["training:manage"] }), {})).toBe(true);
  });
});

// [SCORM-SUB-W] Dây nối: cổng thuần đọc `substituteTeacherId`, nhưng nó chỉ thấy cột mà nơi gọi `select` ra —
// gỡ cột khỏi `select` thì mọi ca thuần ở trên vẫn xanh còn GV dạy thay thì bị đá về trang chủ (hoặc ăn 403 khi lưu tiến độ).
describe("[SCORM-SUB-W] nơi gọi cổng nạp cột dạy thay", () => {
  const doc = async (f: string) => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return readFileSync(join(__dirname, "..", "..", f), "utf8")
      .split(/\r?\n/)
      .filter((d) => !/^\s*(\/\/|\/\*|\*)/.test(d))
      .join("\n");
  };
  const khoiSelect = (src: string, moc: string) => {
    const tu = src.indexOf(moc);
    expect(tu, `không thấy ${moc}`).toBeGreaterThanOrEqual(0);
    // Lấy ĐÚNG phần đối số của lời gọi (dấu ngoặc cân bằng) — cắt theo "});" sẽ lan sang mã phía sau và xanh oan.
    const mo = src.indexOf("(", tu);
    let sau = 0;
    for (let i = mo; i < src.length; i++) {
      if (src[i] === "(") sau++;
      else if (src[i] === ")" && --sau === 0) return src.slice(mo, i + 1);
    }
    throw new Error(`không cân ngoặc sau ${moc}`);
  };

  it("trang play site GV: lời gọi findUnique của ClassSession select substituteTeacherId", async () => {
    const src = await doc("app/(teacher)/teacher/scorm/play/[id]/page.tsx");
    expect(khoiSelect(src, "classSession.findUnique")).toContain("substituteTeacherId: true");
  });

  it("trang play site GV đọc buổi qua withMakeupException(actorGiangDay(actor)) đúng MỘT lần, không qua sdb (ClassSession là model SCOPED)", async () => {
    const src = await doc("app/(teacher)/teacher/scorm/play/[id]/page.tsx");
    expect(src.split("withMakeupException(actorGiangDay(actor)).classSession.findUnique").length - 1).toBe(1);
    expect(src).not.toMatch(/sdb\.classSession\./);
  });

  it("route runtime (lưu tiến độ): findUnique của ClassSession select substituteTeacherId", async () => {
    const src = await doc("app/api/scorm/runtime/route.ts");
    expect(khoiSelect(src, "classSession.findUnique")).toContain("substituteTeacherId: true");
  });
});
