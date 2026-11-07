// lib/students/lifecycle.test.ts — chốt ngữ nghĩa các tab vòng đời học viên (THUẦN, không DB).
//
// Hai hồi quy được canh (21/08/2026):
//
// (a) `Enrollment.status` MẶC ĐỊNH của schema là `ACTIVE` (schema.prisma:1822) và cả hai
//     đường convert lead (`lib/crm/convert-lead.ts`, `convert-lead-v2.ts` — kể cả
//     bulk-convert) tạo ghi danh KHÔNG truyền `status`. Tab vòng đời trước đây chỉ nhận
//     `STUDYING` ⇒ học viên vừa convert rơi ra ngoài CẢ "Đang học" LẪN "Chờ xếp lớp",
//     chỉ còn thấy ở tab "Tất cả".
//
// (b) Gỡ học viên khỏi lớp (nút "Xoá khỏi lớp" ở /classes/[id]/students) đưa ghi danh về
//     WITHDREW/CANCELLED. Em đó phải rơi vào tab "Chờ xếp lớp" — nếu không thì "kick ra
//     nhưng vẫn còn đang học" biến thành học viên tàng hình.
import { describe, expect, it } from "vitest";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import {
  buildLifecycleWhere,
  IN_CLASS_ENROLLMENT_STATUSES,
  STUDYING_ENROLLMENT_STATUSES,
} from "./lifecycle";

/** Bới đệ quy where-clause để tìm mọi mảng status được dùng trong `some`/`none`. */
function collectStatusFilters(node: unknown, out: string[][] = []): string[][] {
  if (Array.isArray(node)) {
    for (const n of node) collectStatusFilters(n, out);
    return out;
  }
  if (node && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    const status = rec.status as { in?: unknown } | string | undefined;
    if (status && typeof status === "object" && Array.isArray(status.in)) {
      out.push(status.in as string[]);
    } else if (typeof status === "string") {
      out.push([status]);
    }
    for (const v of Object.values(rec)) collectStatusFilters(v, out);
  }
  return out;
}

describe("hằng số trạng thái", () => {
  it("STUDYING_ENROLLMENT_STATUSES gồm cả legacy ACTIVE", () => {
    expect(STUDYING_ENROLLMENT_STATUSES).toContain("STUDYING");
    expect(STUDYING_ENROLLMENT_STATUSES).toContain("ACTIVE");
  });

  it("IN_CLASS_ENROLLMENT_STATUSES khớp đúng bộ mà roster/sĩ số coi là thuộc lớp", () => {
    expect([...IN_CLASS_ENROLLMENT_STATUSES].sort()).toEqual(
      [...ENROLLMENT_ACTIVE_STATUS_LIST].sort(),
    );
  });

  it("đang-học là tập con của đang-thuộc-lớp", () => {
    for (const s of STUDYING_ENROLLMENT_STATUSES) {
      expect(IN_CLASS_ENROLLMENT_STATUSES).toContain(s);
    }
  });
});

describe("buildLifecycleWhere('active')", () => {
  const where = buildLifecycleWhere("active");
  const filters = collectStatusFilters(where);

  it("không còn chốt cứng vào riêng STUDYING", () => {
    expect(filters.some((f) => f.length === 1 && f[0] === "STUDYING")).toBe(false);
  });

  it("nhận ghi danh legacy ACTIVE là đang học", () => {
    expect(filters.some((f) => f.includes("ACTIVE") && f.includes("STUDYING"))).toBe(true);
  });
});

describe("buildLifecycleWhere('waiting')", () => {
  const where = buildLifecycleWhere("waiting");
  const json = JSON.stringify(where);
  const filters = collectStatusFilters(where);

  it("loại học viên đang học (kể cả legacy ACTIVE)", () => {
    expect(filters.some((f) => f.includes("ACTIVE") && f.includes("STUDYING"))).toBe(true);
  });

  it("có nhánh 'không giữ chỗ ở lớp nào' để hứng HV vừa bị gỡ khỏi lớp", () => {
    // Nhánh này là `enrollments: { none: { status: { in: <đang-thuộc-lớp> } } }`.
    expect(
      filters.some((f) =>
        [...IN_CLASS_ENROLLMENT_STATUSES].every((s) => f.includes(s)),
      ),
    ).toBe(true);
    expect(json).toContain("none");
  });

  it("vẫn giữ nhánh đã ghi danh chờ xếp (PENDING/CONFIRMED)", () => {
    expect(
      filters.some(
        (f) => f.includes("PENDING") && f.includes("CONFIRMED") && !f.includes("STUDYING"),
      ),
    ).toBe(true);
  });

  it("chỉ xét học viên còn ACTIVE — đã nghỉ hẳn thuộc tab khác", () => {
    expect(json).toContain('"status":"ACTIVE"');
  });
});

describe("buildLifecycleWhere('renewal')", () => {
  it("ghi danh mới sau khi hoàn thành khoá cũ tính cả legacy ACTIVE", () => {
    const filters = collectStatusFilters(buildLifecycleWhere("renewal"));
    expect(
      filters.some(
        (f) => f.includes("PENDING") && f.includes("CONFIRMED") && f.includes("ACTIVE"),
      ),
    ).toBe(true);
  });
});
