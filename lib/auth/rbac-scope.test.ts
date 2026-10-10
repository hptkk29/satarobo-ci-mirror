// R1 — scope non-GLOBAL trên action bị gọi trần = khoá trang sau flip #09.
//
// `can.ts` trả false khi scope cần target mà call-site không truyền:
//   CENTER → target.centerId · CLASS/ASSIGNED → target.classId
//   OWN    → target.createdById · CHILDREN → target.parentUserId
//
// Nên `{ action: "students:view-all", scopeType: "CENTER" }` + một call-site
// `checkPermission("students:view-all")` (không target) = role đó mất trang học viên.
// Đây KHÔNG phải giả thuyết: 09/07/2026 audit tìm ra 34 chỗ như vậy, gồm cả 5 role
// đã được duyệt (CENTER_SALES_CSM 18, CENTER_ACCOUNTANT 8).
//
// Cách ly cơ sở đến từ scopedDb + checkEnrollmentScope, KHÔNG từ scopeType.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROLE_SEED } from "../../prisma/seed-roles";
import { PAGE_GATES } from "./page-gates";

const ROOTS = ["app", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Bỏ comment trước khi quét. Không có bước này, một dòng chú thích như
 * `// checkPermission("attendance:mark") — ...` bị đếm thành call-site trần và test đỏ
 * oan (đã xảy ra 10/07 với app/(teacher)/teacher/lop/_actions.ts:7, nơi lời gọi THẬT ở
 * dòng 109 có truyền target). Guard `[^:]` để không cắt nhầm `https://`.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const blob = ROOTS.flatMap((r) => walk(r))
  .map((f) => stripComments(readFileSync(f, "utf8")))
  .join("\n");

/**
 * Call-site gọi TRẦN (không target), 3 dạng:
 * - `checkPermission("x")` / `assertPermission("x")` — page-gate;
 * - `<obj>.can("x")` — cfg.can của pending-tasks (evaluatePermission, cũng chạy v2);
 * - action nằm trong `PAGE_GATES` — page.tsx gọi `checkAnyPermission(PAGE_GATES["/x"])`,
 *   không truyền target ⇒ mọi action trong bảng đều là call-site trần.
 *
 * Mỗi dạng từng là một điểm mù: shadow prod 10/07 bắt 25 lệch `hr_attendance:adjust`
 * vì scanner mù dạng 2. Dạng 3 sinh ra cùng ngày khi gộp gate về một bảng — thêm ngay,
 * đừng để nó âm thầm cho phép scope CENTER trên action gác trang.
 */
const PAGE_GATE_ACTIONS = new Set<string>(Object.values(PAGE_GATES).flat());

function bareCallSites(action: string): number {
  const esc = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(checkPermission|assertPermission)\\(\\s*["']${esc}["']\\s*\\)`, "g");
  const reDotCan = new RegExp(`\\.can\\(\\s*["']${esc}["']\\s*\\)`, "g");
  const viaTable = PAGE_GATE_ACTIONS.has(action) ? 1 : 0;
  return (blob.match(re) ?? []).length + (blob.match(reDotCan) ?? []).length + viaTable;
}

/**
 * Ngoại lệ có lý do: PARENT không bao giờ đi qua `checkPermission` — portal
 * (`app/(portal)/**`) có 0 call-site, ownership check làm bằng `assertOwnsStudent`.
 * 5 call-site trần của `parent-feedback:view` nằm ở trang admin mà phụ huynh không
 * vào được (layout gate). Giữ CHILDREN cho đúng ngữ nghĩa.
 */
const MIEN_TRU = new Set(["PARENT:parent-feedback:view"]);

describe("R1 — scopeType non-GLOBAL không được đặt trên action bị gọi trần", () => {
  const viPham = ROLE_SEED.flatMap((role) =>
    role.perms
      .filter((p) => p.scopeType !== "GLOBAL")
      .filter((p) => !MIEN_TRU.has(`${role.code}:${p.action}`))
      .filter((p) => bareCallSites(p.action) > 0)
      .map((p) => `${role.code}:${p.action}[${p.scopeType}] · ${bareCallSites(p.action)} call-site trần`),
  );

  it("không role nào khoá trang chính mình sau flip", () => {
    expect(viPham).toEqual([]);
  });

  it("attendance:edit vẫn giữ scope CENTER thật (call-site đã truyền target — #16)", () => {
    expect(bareCallSites("attendance:edit")).toBe(0);
    const cm = ROLE_SEED.find((r) => r.code === "CENTER_MANAGER")!;
    expect(cm.perms.find((p) => p.action === "attendance:edit")?.scopeType).toBe("CENTER");
  });
});
