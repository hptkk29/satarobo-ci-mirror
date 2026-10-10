// lib/permissions/scope-shadow-perm.test.ts — Nền Hệ thống P3 · US-12 (mở rộng).
//
// ── VÌ SAO CÓ FILE NÀY (chỗ kẹt thật của P3) ───────────────────────────────────────
// Bản US-12 đầu tiên chỉ shadow nhánh `PermissionGrant.dataScope` (4 mức, bảng P0).
// Đo lại thì bảng đó gần như KHÔNG có dòng nào: cả repo chỉ có ĐÚNG MỘT chỗ ghi vào nó
// (`app/(admin)/admin/user-groups/_actions.ts`, và chỉ ghi grant cấp NHÓM). Nghĩa là
// shadow chạy nhưng quan sát gần như 0 lượt — rồi cổng 7 ngày sẽ xanh vì KHÔNG CÓ GÌ
// để lệch. Đó đúng là kiểu "sạch trên mẫu rỗng" mà cổng phải từ chối.
//
// Đường ĐANG enforce thật trên prod là `canV2` → `scopeMatches(PermEntry)` với
// `scopeType: "CENTER"` đo bằng `p.centerScope`. P4 sẽ lật chính chỗ đó. Nên shadow
// phải phủ chỗ đó, nếu không P3 đo một thứ và P4 lật một thứ khác.
//
// Ở đây chỉ shadow `CENTER` — bốn scopeType còn lại (GLOBAL/OWN/CHILDREN/CLASS/ASSIGNED)
// KHÔNG đo bằng đơn vị nên không có gì để so; coi chúng là "giống" chứ không phải bỏ sót.
import { describe, it, expect } from "vitest";
import type { Actor, PermEntry } from "@/lib/auth/actor";
import { scopeMatchesByOrgUnit, soSanhPermEntry } from "@/lib/permissions/scope-shadow";

const perm = (over: Partial<PermEntry> = {}): PermEntry => ({
  action: "students:view",
  scopeType: "CENTER",
  orgUnitId: "ou-cs1",
  roleCode: "CENTER_MANAGER",
  centerScope: ["c-cs1"],
  orgUnitScope: ["ou-cs1"],
  ...over,
});

const actor = (): Actor => ({ userId: "u1" }) as Actor;

describe("[US-12][AC1] scopeMatchesByOrgUnit — bản song song của scopeMatches", () => {
  it("CENTER: khớp đơn vị trong tầm nhìn", () => {
    expect(scopeMatchesByOrgUnit(perm(), actor(), { orgUnitId: "ou-cs1" })).toBe(true);
    expect(scopeMatchesByOrgUnit(perm(), actor(), { orgUnitId: "ou-cs2" })).toBe(false);
  });

  it('CENTER + "ALL" (vai gắn ở HO) ⇒ mọi đơn vị, nhưng target rỗng vẫn false', () => {
    const p = perm({ orgUnitScope: "ALL" });
    expect(scopeMatchesByOrgUnit(p, actor(), { orgUnitId: "ou-bat-ky" })).toBe(true);
    expect(scopeMatchesByOrgUnit(p, actor(), {})).toBe(false);
  });

  it("VAI QUAN HỆ (PARENT): orgUnitScope null ⇒ false — GIỮ NGUYÊN fail-closed của đường cũ", () => {
    // CLAUDE.md ghim: perm của vai quan hệ cố ý mang centerScope null để scope CENTER
    // không bao giờ khớp. Bản đo bằng đơn vị PHẢI giữ y hệt, nếu không P4 sẽ NỚI quyền
    // phụ huynh một cách im lặng — đúng loại lỗi không ai phát hiện cho tới khi muộn.
    const p = perm({ orgUnitScope: null, centerScope: null });
    expect(scopeMatchesByOrgUnit(p, actor(), { orgUnitId: "ou-cs1" })).toBe(false);
  });

  it("GLOBAL: không đo bằng đơn vị ⇒ vẫn true", () => {
    expect(
      scopeMatchesByOrgUnit(perm({ scopeType: "GLOBAL" }), actor(), undefined),
    ).toBe(true);
  });
});

describe("[US-12][AC2] soSanhPermEntry — chỉ CENTER mới có gì để so", () => {
  it("hai đường cùng CHO ⇒ giống", () => {
    const kq = soSanhPermEntry(perm(), actor(), { centerId: "c-cs1", orgUnitId: "ou-cs1" });
    expect(kq.ketQua).toBe("giong");
  });

  it("cũ CHO mà mới TỪ CHỐI ⇒ lệch", () => {
    const kq = soSanhPermEntry(perm(), actor(), { centerId: "c-cs1", orgUnitId: "ou-khac" });
    expect(kq.ketQua).toBe("lech");
    expect(kq.cu).toBe(true);
    expect(kq.moi).toBe(false);
  });

  it("thiếu orgUnitId trên target ⇒ chưa phủ, KHÔNG phải lệch", () => {
    const kq = soSanhPermEntry(perm(), actor(), { centerId: "c-cs1" });
    expect(kq.ketQua).toBe("chua-phu");
  });

  it("scopeType KHÔNG đo bằng đơn vị ⇒ giống, không tính vào 'chưa phủ'", () => {
    // Nếu tính GLOBAL/OWN/CLASS là "chưa phủ" thì mẫu số phồng lên và cổng không bao
    // giờ đóng được, dù chẳng có gì cần sửa.
    for (const st of ["GLOBAL", "OWN", "CHILDREN", "CLASS", "ASSIGNED"] as const) {
      const kq = soSanhPermEntry(perm({ scopeType: st }), actor(), { centerId: "c-cs1" });
      expect(kq.ketQua, st).toBe("giong");
    }
  });

  it("perm CŨ chưa có orgUnitScope (Actor dựng tay ở ~35 chỗ) ⇒ chưa phủ, không lệch", () => {
    // Field là ADDITIVE OPTIONAL. Actor literal cũ không có nó; coi đó là lệch thì
    // shadow đỏ vì fixture chứ không vì resolver.
    const p = { ...perm() } as PermEntry;
    delete (p as { orgUnitScope?: unknown }).orgUnitScope;
    const kq = soSanhPermEntry(p, actor(), { centerId: "c-cs1", orgUnitId: "ou-cs1" });
    expect(kq.ketQua).toBe("chua-phu");
    expect(kq.lyDo).toContain("orgUnitScope");
  });
});
