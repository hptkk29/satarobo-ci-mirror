// @vitest-environment node
/**
 * [QTC-*] — `coQuyenTaiCoSo` (THUẦN): «giữ ĐÚNG khoá `key` TẠI cơ sở `centerId`» — phép mà `passesScope` (tầm nhìn gộp theo tiền tố) và `can` trần (quyền GLOBAL luôn đúng) KHÔNG trả lời.
 *
 *   [QTC-01] người giữ khoá ở CS-A: đúng ở CS-A, SAI ở CS-B (đối chứng dương + âm cùng một người)
 *   [QTC-02] khoá KHÁC (cùng tiền tố, quyền xem) ở CS-B không thay được khoá ghi — đây chính là N9
 *   [QTC-03] «ALL» (neo vai ở HO/ROOT) đúng ở mọi cơ sở, kể cả `centerId` null
 *   [QTC-04] `centerId` null: danh sách cơ sở KHÔNG đủ (fail-closed); chỉ SUPER_ADMIN / ALL / grant ALLOW
 *   [QTC-05] SUPER_ADMIN và per-user grant ALLOW là ngoại lệ toàn cục có chủ đích
 *   [QTC-06] không có quyền nào / `centerScope` null (vai quan hệ) ⇒ SAI
 */
import { describe, expect, it } from "vitest";

import type { Actor, PermEntry } from "@/lib/auth/actor";

import { coQuyenTaiCoSo } from "./quyen-tai-co-so";

const KHOA = "commission_disputes:review";
const perm = (action: string, centerScope: PermEntry["centerScope"]): PermEntry => ({ action, scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "FIXTURE", centerScope }) as PermEntry;
const actor = (permissions: PermEntry[], o: Partial<Actor> = {}): Actor =>
  ({ userId: "u", isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions, visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(), ...o }) as Actor;

describe("[QTC] coQuyenTaiCoSo", () => {
  it("[QTC-01] giữ khoá ở CS-A: đúng ở CS-A, sai ở CS-B", () => {
    const a = actor([perm(KHOA, ["A"])]);
    expect(coQuyenTaiCoSo(a, KHOA, "A")).toBe(true);
    expect(coQuyenTaiCoSo(a, KHOA, "B")).toBe(false);
  });

  it("[QTC-02] khoá XEM ở CS-B không thay được khoá GHI (N9)", () => {
    const a = actor([perm(KHOA, ["A"]), perm("commission:view-center", ["A", "B"])]);
    expect(coQuyenTaiCoSo(a, KHOA, "B")).toBe(false);
    expect(coQuyenTaiCoSo(a, "commission:view-center", "B")).toBe(true); // đối chứng: chính khoá xem thì đúng
  });

  it("[QTC-03] «ALL» đúng ở mọi cơ sở kể cả null", () => {
    const a = actor([perm(KHOA, "ALL")]);
    expect(coQuyenTaiCoSo(a, KHOA, "B")).toBe(true);
    expect(coQuyenTaiCoSo(a, KHOA, null)).toBe(true);
  });

  it("[QTC-04] centerId null: danh sách cơ sở không đủ (fail-closed)", () => {
    expect(coQuyenTaiCoSo(actor([perm(KHOA, ["A", "B"])]), KHOA, null)).toBe(false);
  });

  it("[QTC-05] SUPER_ADMIN và per-user grant ALLOW là ngoại lệ toàn cục", () => {
    expect(coQuyenTaiCoSo(actor([], { isSuperAdmin: true }), KHOA, "B")).toBe(true);
    expect(coQuyenTaiCoSo(actor([], { grantsAllow: new Set([KHOA]) }), KHOA, "B")).toBe(true);
    expect(coQuyenTaiCoSo(actor([], { grantsAllow: new Set(["khoa-khac"]) }), KHOA, "B")).toBe(false);
  });

  it("[QTC-06] không quyền nào / centerScope null ⇒ sai", () => {
    expect(coQuyenTaiCoSo(actor([]), KHOA, "A")).toBe(false);
    expect(coQuyenTaiCoSo(actor([perm(KHOA, null)]), KHOA, "A")).toBe(false);
  });
});
