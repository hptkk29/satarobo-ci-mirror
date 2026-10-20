// [GD-CS] 28/09/2026 — góc nhìn giảng dạy của site giáo viên.
//
// Sự cố prod: giáo viên Hội sở được "gán cơ sở" CS1 mà dạy lớp ở CS2 ⇒ lưu điểm danh được
// (đường ghi dùng db trần) nhưng MỌI màn đọc của site GV đi scopedDb ⇒ lớp CS2 biến khỏi
// trang chủ/lịch, màn điểm danh mãi báo "chưa điểm danh". Vá: `actorGiangDay(actor)`.
//
// Hành vi thật (Postgres) nằm ở tests/e2e/r7/teacher-attendance.spec.ts `[GD-CS-01..04]`.
// Tệp này giữ phần THUẦN + LƯỚI GHIM DÂY NỐI: một trang GV mới viết `scopedDb(actor)` trần
// thì không ca hành vi nào đỏ (ca hành vi gọi thẳng lib), nên lưới quét mã nguồn.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Actor } from "@/lib/auth/actor";
import { actorGiangDay, getModelVisibleCenterIds, GIANG_DAY_MODELS } from "@/lib/db-scope";

function actorCs1(teachingCenterIds: string[]): Actor {
  return {
    userId: "gv",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [{ orgUnitId: "ou-cs1", roleCode: "TEACHER" }],
    permissions: [
      { action: "classes:view-own", scopeType: "GLOBAL", centerScope: ["cs1"], orgUnitId: "ou-cs1", roleCode: "TEACHER" },
      { action: "students:view-own-class", scopeType: "GLOBAL", centerScope: ["cs1"], orgUnitId: "ou-cs1", roleCode: "TEACHER" },
      { action: "attendance:mark", scopeType: "CLASS", centerScope: ["cs1"], orgUnitId: "ou-cs1", roleCode: "TEACHER" },
      { action: "leads:view", scopeType: "GLOBAL", centerScope: ["cs1"], orgUnitId: "ou-cs1", roleCode: "TEACHER" },
    ],
    visibleCenterIds: ["cs1"],
    visibleOrgUnitIds: ["ou-cs1"],
    grantsAllow: new Set(),
    assignedClassIds: new Set(["lop-cs2"]),
    teachingCenterIds,
  };
}

describe("[GD-CS] getModelVisibleCenterIds — góc nhìn giảng dạy", () => {
  it("[GD-CS-P1] actor THƯỜNG không nới, dù có teachingCenterIds (màn admin giữ nguyên)", () => {
    const a = actorCs1(["cs2"]);
    for (const m of GIANG_DAY_MODELS) expect(getModelVisibleCenterIds(m, a)).toEqual(["cs1"]);
  });

  it("[GD-CS-P2] actorGiangDay cộng cơ sở lớp mình dạy cho model ĐÀO TẠO", () => {
    const a = actorGiangDay(actorCs1(["cs2"]));
    for (const m of ["Class", "ClassSession", "Attendance", "Enrollment", "ReportCard", "Student"]) {
      expect([...(getModelVisibleCenterIds(m, a) as string[])].sort()).toEqual(["cs1", "cs2"]);
    }
  });

  it("[GD-CS-P3] actorGiangDay KHÔNG nới model ngoài đào tạo (Lead/Order/Payment)", () => {
    const a = actorGiangDay(actorCs1(["cs2"]));
    for (const m of ["Lead", "Order", "Payment"]) {
      const v = getModelVisibleCenterIds(m, a);
      expect(v === "ALL" ? v : v.includes("cs2")).toBe(false);
    }
  });

  it("[GD-CS-P4] không dạy lớp cơ sở nào khác ⇒ actorGiangDay không đổi gì", () => {
    expect(getModelVisibleCenterIds("Class", actorGiangDay(actorCs1([])))).toEqual(["cs1"]);
  });
});

// ── Lưới ghim dây nối ────────────────────────────────────────────────────────────
// Mã TRƯỚC bản vá: `scopedDb(actor)` / `withMakeupException(actor)` trần ở 32 tệp site GV.
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function tepSiteGv(): string[] {
  const root = resolve(process.cwd(), "app/(teacher)");
  return readdirSync(root, { recursive: true })
    .map((p) => String(p).replaceAll("\\", "/"))
    .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
    .map((p) => `app/(teacher)/${p}`);
}

describe("[GD-CS-W] site GV luôn dựng client đọc bằng actorGiangDay", () => {
  it("[GD-CS-W1] không còn scopedDb(...) / withMakeupException(...) trần trong app/(teacher)", () => {
    const tran: string[] = [];
    let tong = 0;
    for (const f of tepSiteGv()) {
      const src = boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
      for (const m of src.matchAll(/\b(?:scopedDb|withMakeupException)\(([^)]*)/g)) {
        tong++;
        if (!m[1].trimStart().startsWith("actorGiangDay(")) tran.push(`${f}: ${m[0]}`);
      }
    }
    // Đối chứng dương: lưới phải THẤY lời gọi — 0 lời gọi nghĩa là bộ quét hỏng, không phải "sạch".
    expect(tong).toBeGreaterThan(30);
    expect(tran).toEqual([]);
  });

  it("[GD-CS-W2] chotBuoi: site GV truyền 'giang-day', admin truyền 'quan-tri'", () => {
    const gv = boChuThich(readFileSync(resolve(process.cwd(), "app/(teacher)/teacher/lop/_actions.ts"), "utf8"));
    const ad = boChuThich(readFileSync(resolve(process.cwd(), "app/(admin)/admin/attendance/_actions.ts"), "utf8"));
    expect(gv.match(/phamVi:\s*"giang-day"/g)?.length).toBe(1);
    expect(ad.match(/phamVi:\s*"quan-tri"/g)?.length).toBe(1);
  });
});
