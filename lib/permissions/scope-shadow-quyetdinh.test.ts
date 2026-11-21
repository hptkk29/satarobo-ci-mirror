// lib/permissions/scope-shadow-quyetdinh.test.ts — Nền Hệ thống P3 · US-12.
//
// ── VÌ SAO SO Ở MỨC QUYẾT ĐỊNH, KHÔNG PHẢI TỪNG DÒNG ──────────────────────────────
// Bản đầu tôi phát tin shadow cho TỪNG grant/perm khớp key. Sai mức đo: `can()` là
// ALLOW-wins trên NHIỀU dòng, nên một dòng đo lệch mà dòng khác vẫn cho phép thì người
// dùng KHÔNG thấy gì khác cả. Đếm kiểu đó làm số "lệch" phồng lên bằng nhiễu vô hại, và
// P4 sẽ bị chặn bởi những dòng chẳng đổi gì.
//
// Câu hỏi mà P4 thực sự cần trả lời là: **lật đơn vị đo thì `can()` có trả khác không.**
// Nên shadow so đúng câu đó — một phép so cho một lượt `can()`.
import { describe, it, expect } from "vitest";
import type { Actor, PermEntry } from "@/lib/auth/actor";
import type { GrantRow } from "@/lib/permissions/grant-types";
import { soSanhQuyetDinh } from "@/lib/permissions/scope-shadow";

const perm = (over: Partial<PermEntry> = {}): PermEntry => ({
  action: "students:view",
  scopeType: "CENTER",
  orgUnitId: "ou-cs1",
  roleCode: "CENTER_MANAGER",
  centerScope: ["c-cs1"],
  orgUnitScope: ["ou-cs1"],
  ...over,
});

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

const actor = (over: Partial<Actor> = {}): Actor =>
  ({
    userId: "u1",
    isSuperAdmin: false,
    roleIds: ["role-gv"],
    groupIds: [],
    permissions: [],
    permissionGrants: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    roleCenterScope: { "role-gv": { unitOnly: ["c-cs1"], unitAndBelow: ["c-cs1"] } },
    roleOrgScope: { "role-gv": { unitOnly: ["ou-cs1"], unitAndBelow: ["ou-cs1"] } },
    ...over,
  }) as unknown as Actor;

describe("[US-12][AC2] soSanhQuyetDinh — đường PermEntry (thứ prod đang enforce)", () => {
  it("hai đường cùng CHO ⇒ giống", () => {
    const kq = soSanhQuyetDinh(actor({ permissions: [perm()] }), "students:view", {
      centerId: "c-cs1",
      orgUnitId: "ou-cs1",
    });
    expect(kq.ketQua).toBe("giong");
    expect(kq.cu).toBe(true);
  });

  it("cũ CHO mà mới TỪ CHỐI ⇒ lệch", () => {
    const kq = soSanhQuyetDinh(actor({ permissions: [perm()] }), "students:view", {
      centerId: "c-cs1",
      orgUnitId: "ou-khac",
    });
    expect(kq.ketQua).toBe("lech");
    expect(kq.cu).toBe(true);
    expect(kq.moi).toBe(false);
  });

  it("MỘT dòng lệch nhưng dòng KHÁC vẫn cho ⇒ GIỐNG, không phải lệch", () => {
    // Đây là ca biện minh cho cả file. Đo từng dòng thì ca này ra "lệch"; đo mức quyết
    // định thì ra "giống" — và người dùng đúng là không thấy gì khác.
    const kq = soSanhQuyetDinh(
      actor({
        permissions: [
          perm({ centerScope: ["c-cs1"], orgUnitScope: ["ou-khac"] }), // dòng lệch
          perm({ roleCode: "TRAINING", scopeType: "GLOBAL" }), // dòng vẫn cho
        ],
      }),
      "students:view",
      { centerId: "c-cs1", orgUnitId: "ou-cs1" },
    );
    expect(kq.ketQua).toBe("giong");
  });

  it("target thiếu orgUnitId nhưng có dòng đo bằng đơn vị ⇒ chưa phủ", () => {
    const kq = soSanhQuyetDinh(actor({ permissions: [perm()] }), "students:view", {
      centerId: "c-cs1",
    });
    expect(kq.ketQua).toBe("chua-phu");
  });

  it("không dòng nào đo bằng đơn vị ⇒ VẪN so được (giống), không tính chưa phủ", () => {
    const kq = soSanhQuyetDinh(
      actor({ permissions: [perm({ scopeType: "GLOBAL" })] }),
      "students:view",
      { centerId: "c-cs1" },
    );
    expect(kq.ketQua).toBe("giong");
  });

  it("SUPER_ADMIN ⇒ giống, không có gì để học", () => {
    const kq = soSanhQuyetDinh(actor({ isSuperAdmin: true }), "students:view", {
      centerId: "c-cs1",
    });
    expect(kq.ketQua).toBe("giong");
    expect(kq.cu).toBe(true);
  });
});

describe("[US-12][AC2] soSanhQuyetDinh — đường PermissionGrant (bảng P0)", () => {
  it("grant nói CHO ở cả hai đường ⇒ giống, và ghi rõ nguồn là grant", () => {
    const kq = soSanhQuyetDinh(
      actor({ permissionGrants: [grant()] }),
      "students:view",
      { centerId: "c-cs1", orgUnitId: "ou-cs1" },
    );
    expect(kq.ketQua).toBe("giong");
    expect(kq.nguon).toBe("grant");
  });

  it("grant lệch giữa hai đường ⇒ lệch (grant là nguồn sự thật, KHÔNG rơi xuống đường cũ)", () => {
    const kq = soSanhQuyetDinh(
      actor({ permissionGrants: [grant()], permissions: [perm({ scopeType: "GLOBAL" })] }),
      "students:view",
      { centerId: "c-cs1", orgUnitId: "ou-khac" },
    );
    expect(kq.ketQua).toBe("lech");
  });

  it("không có grant nào khớp ⇒ nguồn là perm", () => {
    const kq = soSanhQuyetDinh(actor({ permissions: [perm()] }), "students:view", {
      centerId: "c-cs1",
      orgUnitId: "ou-cs1",
    });
    expect(kq.nguon).toBe("perm");
  });
});
