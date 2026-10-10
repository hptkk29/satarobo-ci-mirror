// lib/permissions/scope-shadow.test.ts — Nền Hệ thống P3 · US-12.
//
// Resolver dataScope mới đo bằng ĐƠN VỊ (`orgUnitId`, subtree tính từ `path`) chạy
// SONG SONG resolver cũ đo bằng CƠ SỞ (`centerId`), so kết quả, lệch thì ghi log.
//
// ⚠️ VÌ SAO PHẢI CÓ NHÁNH "KHÔNG SO SÁNH ĐƯỢC" (và vì sao nó quan trọng nhất file này):
// hầu hết chỗ gọi hiện truyền `Target` chỉ có `centerId`. Nếu coi "thiếu orgUnitId" là
// LỆCH thì shadow sẽ đỏ rực ngay ngày đầu vì lý do KHÔNG liên quan gì tới đúng/sai của
// resolver — và theo đúng vết xe đã ghi trong repo ("kêu sói mỗi đêm trên 28 bảng chưa
// duyệt là cách nhanh nhất khiến cả đội thôi đọc alert"), cổng 7 ngày sẽ thành vô nghĩa.
// Nên ca đó được ĐẾM RIÊNG như "chưa phủ", không tính vào lệch.
import { describe, it, expect } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import type { GrantRow } from "@/lib/permissions/grant-types";
import { scopeSatisfiedByOrgUnit, soSanhScope } from "@/lib/permissions/scope-shadow";

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

/** Actor tối thiểu: chỉ những field mà resolver thật sự đọc. */
const actor = (over: Partial<Actor> = {}): Actor =>
  ({
    userId: "u1",
    roleCenterScope: {
      "role-gv": { unitOnly: ["c-cs1"], unitAndBelow: ["c-cs1"] },
    },
    roleOrgScope: {
      "role-gv": { unitOnly: ["ou-cs1"], unitAndBelow: ["ou-cs1"] },
    },
    ...over,
  }) as Actor;

describe("[US-12][AC1] scopeSatisfiedByOrgUnit — 4 mức đo bằng đơn vị", () => {
  it("ALL: không lọc", () => {
    expect(scopeSatisfiedByOrgUnit(grant({ dataScope: "ALL" }), actor(), null)).toBe(true);
  });

  it("UNIT_ONLY: khớp đúng đơn vị của actor", () => {
    expect(
      scopeSatisfiedByOrgUnit(grant(), actor(), { orgUnitId: "ou-cs1" }),
    ).toBe(true);
    expect(
      scopeSatisfiedByOrgUnit(grant(), actor(), { orgUnitId: "ou-cs2" }),
    ).toBe(false);
  });

  it("UNIT_AND_BELOW: với tới cả cây con (subtree tính từ path)", () => {
    const a = actor({
      roleOrgScope: {
        "role-gv": { unitOnly: ["ou-danang"], unitAndBelow: ["ou-danang", "ou-cs1", "ou-cs2"] },
      },
    });
    const g = grant({ dataScope: "UNIT_AND_BELOW" });
    expect(scopeSatisfiedByOrgUnit(g, a, { orgUnitId: "ou-cs2" })).toBe(true);
    // ...nhưng UNIT_ONLY của chính vai đó thì KHÔNG — vùng không phải cơ sở.
    expect(scopeSatisfiedByOrgUnit(grant(), a, { orgUnitId: "ou-cs2" })).toBe(false);
  });

  it('"ALL" của một vai = mọi đơn vị, nhưng target rỗng vẫn false', () => {
    const a = actor({ roleOrgScope: { "role-gv": "ALL" } });
    expect(scopeSatisfiedByOrgUnit(grant(), a, { orgUnitId: "ou-bat-ky" })).toBe(true);
    expect(scopeSatisfiedByOrgUnit(grant(), a, {})).toBe(false);
  });

  it("thiếu mapping cho vai ⇒ false (fail-closed), KHÔNG mở quyền", () => {
    const a = actor({ roleOrgScope: {} });
    expect(scopeSatisfiedByOrgUnit(grant(), a, { orgUnitId: "ou-cs1" })).toBe(false);
  });

  it("OWN: so người tạo, không đụng đơn vị", () => {
    const g = grant({ dataScope: "OWN" });
    expect(scopeSatisfiedByOrgUnit(g, actor(), { createdById: "u1" })).toBe(true);
    expect(scopeSatisfiedByOrgUnit(g, actor(), { createdById: "u2" })).toBe(false);
  });
});

describe("[US-12][AC2] soSanhScope — cũ vs mới", () => {
  it("hai bên cùng CHO ⇒ giống", () => {
    const kq = soSanhScope(grant(), actor(), { centerId: "c-cs1", orgUnitId: "ou-cs1" });
    expect(kq.ketQua).toBe("giong");
    expect(kq.cu).toBe(true);
    expect(kq.moi).toBe(true);
  });

  it("hai bên cùng TỪ CHỐI ⇒ giống", () => {
    const kq = soSanhScope(grant(), actor(), { centerId: "c-cs2", orgUnitId: "ou-cs2" });
    expect(kq.ketQua).toBe("giong");
  });

  it("cũ CHO mà mới TỪ CHỐI ⇒ lệch, và nêu rõ hai vế", () => {
    // Đơn vị của target không nằm trong phạm vi mới, nhưng cơ sở thì có — ca sẽ xuất
    // hiện thật khi cây tổ chức và bảng Center lệch nhau.
    const kq = soSanhScope(grant(), actor(), { centerId: "c-cs1", orgUnitId: "ou-khac" });
    expect(kq.ketQua).toBe("lech");
    expect(kq.cu).toBe(true);
    expect(kq.moi).toBe(false);
  });

  it("THIẾU orgUnitId ⇒ 'chưa phủ', KHÔNG phải lệch", () => {
    // Đây là ca thường gặp nhất trong pha shadow: chỗ gọi cũ chỉ truyền centerId.
    // Tính nó là lệch thì báo động mất hết ý nghĩa.
    const kq = soSanhScope(grant(), actor(), { centerId: "c-cs1" });
    expect(kq.ketQua).toBe("chua-phu");
    expect(kq.lyDo).toContain("orgUnitId");
  });

  it("dataScope ALL / OWN: không cần orgUnitId nên VẪN so được", () => {
    expect(soSanhScope(grant({ dataScope: "ALL" }), actor(), { centerId: "c-cs1" }).ketQua).toBe(
      "giong",
    );
    expect(
      soSanhScope(grant({ dataScope: "OWN" }), actor(), { createdById: "u1" }).ketQua,
    ).toBe("giong");
  });

  it("target rỗng hoàn toàn: vẫn so được (cả hai fail-closed như nhau)", () => {
    expect(soSanhScope(grant(), actor(), null).ketQua).toBe("giong");
  });
});
