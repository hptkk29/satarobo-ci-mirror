// lib/permissions/matrix.test.ts — US-04 (TS-04): bảng chân trị 4 dataScope × 3
// relationshipType × 2 effect = 24 ô, đóng băng hành vi resolver (US-04 AC2 — sửa
// resolver làm lệch 1 ô là CI đỏ).
//
// Cơ chế expected-fail (US-04 AC4 — thiết kế duyệt 09/08/2026, đã kiểm chứng vitest 4.1.6):
// - 4 ô FRANCHISEE/AFFILIATE × {ALL, UNIT_AND_BELOW} viết assertion theo CHÂN TRỊ TƯƠNG LAI
//   (=false, khi resolver P5 biết relationshipType/FranchiseContract). Hôm nay engine trả
//   true → assertion sai → it.fails ghi nhận "expected fail" = XANH. Khi resolver P5 lên,
//   assertion bắt đầu ĐÚNG → it.fails đỏ ("Expect test to fail") → buộc gỡ .fails trong
//   chính commit đó — ma trận tự chuyển trạng thái, không ai quên được.
// - Kèm 1 test tripwire THƯỜNG pin hành vi HÔM NAY (=true) của đúng 4 ô pending — xoá
//   ĐỒNG THỜI với các it.fails trong cùng commit của story resolver P5.
// Tag tên case: [US-04-TS04-*] · ô pending thêm [US-04→P5].
import { describe, it, expect } from "vitest";
import { can } from "@/lib/permissions/can";
import {
  MATRIX_KEY,
  matrixActor,
  matrixTarget,
  type MatrixCenterKey,
  type MatrixNodeKey,
} from "@/lib/permissions/matrix-fixture";
import type { GrantRow } from "@/lib/permissions/grant-types";

describe("US-04 · TS-04 · ALLOW × OWNED (target CS1) — 4/4 chạy thật", () => {
  it("[US-04-TS04-A01] ALL (HO→CS1) = true", () => {
    const actor = matrixActor({ at: "HO", scope: "ALL", effect: "ALLOW" });
    expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS1" }))).toBe(true);
  });

  it("[US-04-TS04-A02] UNIT_AND_BELOW (DA_NANG→CS1) = true", () => {
    const actor = matrixActor({ at: "DA_NANG", scope: "UNIT_AND_BELOW", effect: "ALLOW" });
    expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS1" }))).toBe(true);
  });

  it("[US-04-TS04-A03] UNIT_ONLY (CS1→CS1) = true", () => {
    const actor = matrixActor({ at: "CS1", scope: "UNIT_ONLY", effect: "ALLOW" });
    expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS1" }))).toBe(true);
  });

  it("[US-04-TS04-A04] OWN (bản ghi của chính actor tại CS1) = true", () => {
    const actor = matrixActor({ at: "CS1", scope: "OWN", effect: "ALLOW" });
    expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS1", ownedBy: "actor" }))).toBe(true);
  });
});

describe("US-04 · TS-04 · ALLOW × FRANCHISEE (target CS-F) — 2 ô pending P5 + 2 chạy thật", () => {
  // CĂN CỨ nghiệp vụ 2 ô false (chân trị TƯƠNG LAI — resolver P5):
  // - BA §4: học viên của đơn vị FRANCHISEE — HO chỉ thấy SỐ ĐẾM tổng hợp, KHÔNG thấy hồ
  //   sơ chi tiết (ranh giới pháp lý). permissions.md ma trận "Học viên: R ALL*" với chú
  //   thích (*) nói rõ áp cho cả HO lẫn VÙNG.
  // - BA R5: HO nhìn dữ liệu franchise vượt phạm vi pháp lý → mặc định DENY chi tiết,
  //   chỉ mở qua liên kết CatalogItem do HO sở hữu.
  // - BA §2.2: FRANCHISEE sở hữu 0% — cột "HO thấy tài chính: CHỈ tổng hợp".
  it.fails(
    "[US-04-TS04-A05][US-04→P5] ALL (HO→CS-F) = false — HO không xem chi tiết học viên franchise (BA §4, R5)",
    () => {
      const actor = matrixActor({ at: "HO", scope: "ALL", effect: "ALLOW" });
      expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS_F" }))).toBe(false);
    },
  );

  it.fails(
    "[US-04-TS04-A06][US-04→P5] UNIT_AND_BELOW (VUNG_A→CS-F) = false — vùng cũng chỉ thấy tổng hợp (permissions.md chú thích *)",
    () => {
      const actor = matrixActor({ at: "VUNG_A", scope: "UNIT_AND_BELOW", effect: "ALLOW" });
      expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS_F" }))).toBe(false);
    },
  );

  it("[US-04-TS04-A07] UNIT_ONLY (CS-F→CS-F) = true — bên nhận xem dữ liệu CỦA CHÍNH HỌ (BA §2.6: GRACE còn giữ quyền đọc)", () => {
    const actor = matrixActor({ at: "CS_F", scope: "UNIT_ONLY", effect: "ALLOW" });
    expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS_F" }))).toBe(true);
  });

  it("[US-04-TS04-A08] OWN (bản ghi của chính actor tại CS-F) = true", () => {
    const actor = matrixActor({ at: "CS_F", scope: "OWN", effect: "ALLOW" });
    expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS_F", ownedBy: "actor" }))).toBe(true);
  });
});

describe("US-04 · TS-04 · ALLOW × AFFILIATE (target CS-L) — 2 ô pending P5 + 2 chạy thật", () => {
  // CĂN CỨ nghiệp vụ 2 ô false (chân trị TƯƠNG LAI — resolver P5):
  // - BA §2.2: AFFILIATE sở hữu <50% — "trong cây vận hành / dùng chương trình: TUỲ THOẢ
  //   THUẬN", "HO thấy tài chính: RẤT HẠN CHẾ" (chặt hơn cả FRANCHISEE) ⇒ khi chưa có
  //   thoả thuận tường minh, mặc định KHÔNG thấy chi tiết.
  // - Cùng nguyên tắc mặc-định-DENY của BA R5 (mở chi tiết phải qua căn cứ tường minh).
  it.fails(
    "[US-04-TS04-A09][US-04→P5] ALL (HO→CS-L) = false — AFFILIATE 'rất hạn chế' (BA §2.2, R5)",
    () => {
      const actor = matrixActor({ at: "HO", scope: "ALL", effect: "ALLOW" });
      expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS_L" }))).toBe(false);
    },
  );

  it.fails(
    "[US-04-TS04-A10][US-04→P5] UNIT_AND_BELOW (DA_NANG→CS-L) = false — vùng không thấy chi tiết đơn vị liên kết (BA §2.2)",
    () => {
      const actor = matrixActor({ at: "DA_NANG", scope: "UNIT_AND_BELOW", effect: "ALLOW" });
      expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS_L" }))).toBe(false);
    },
  );

  it("[US-04-TS04-A11] UNIT_ONLY (CS-L→CS-L) = true — đơn vị liên kết xem dữ liệu của chính họ", () => {
    const actor = matrixActor({ at: "CS_L", scope: "UNIT_ONLY", effect: "ALLOW" });
    expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS_L" }))).toBe(true);
  });

  it("[US-04-TS04-A12] OWN (bản ghi của chính actor tại CS-L) = true", () => {
    const actor = matrixActor({ at: "CS_L", scope: "OWN", effect: "ALLOW" });
    expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS_L", ownedBy: "actor" }))).toBe(true);
  });
});

describe("US-04 · TS-04 · DENY × 3 relationship — 12/12 = false, chạy thật (BA §2.5: DENY > ALLOW)", () => {
  // Mỗi ô: actor có ALLOW nền (withBaseAllow → dataScope ALL cùng key) + DENY fieldMask
  // RỖNG mang scope của ô, target KHỚP scope DENY ⇒ action bị chặn hẳn. Chân trị này
  // KHÔNG phụ thuộc resolver P5 — "DENY khớp scope thắng mọi ALLOW cùng key" đã là luật
  // engine hôm nay (US-02) và giữ nguyên mãi (công thức quyền BA §2.5).
  const cases: Array<{
    id: string;
    scope: GrantRow["dataScope"];
    rel: "OWNED" | "FRANCHISEE" | "AFFILIATE";
    at: MatrixNodeKey;
    target: { at: MatrixCenterKey; ownedBy?: "actor" | "other" };
  }> = [
    { id: "D01", scope: "ALL", rel: "OWNED", at: "HO", target: { at: "CS1" } },
    { id: "D02", scope: "UNIT_AND_BELOW", rel: "OWNED", at: "DA_NANG", target: { at: "CS1" } },
    { id: "D03", scope: "UNIT_ONLY", rel: "OWNED", at: "CS1", target: { at: "CS1" } },
    { id: "D04", scope: "OWN", rel: "OWNED", at: "CS1", target: { at: "CS1", ownedBy: "actor" } },
    { id: "D05", scope: "ALL", rel: "FRANCHISEE", at: "HO", target: { at: "CS_F" } },
    { id: "D06", scope: "UNIT_AND_BELOW", rel: "FRANCHISEE", at: "VUNG_A", target: { at: "CS_F" } },
    { id: "D07", scope: "UNIT_ONLY", rel: "FRANCHISEE", at: "CS_F", target: { at: "CS_F" } },
    { id: "D08", scope: "OWN", rel: "FRANCHISEE", at: "CS_F", target: { at: "CS_F", ownedBy: "actor" } },
    { id: "D09", scope: "ALL", rel: "AFFILIATE", at: "HO", target: { at: "CS_L" } },
    { id: "D10", scope: "UNIT_AND_BELOW", rel: "AFFILIATE", at: "DA_NANG", target: { at: "CS_L" } },
    { id: "D11", scope: "UNIT_ONLY", rel: "AFFILIATE", at: "CS_L", target: { at: "CS_L" } },
    { id: "D12", scope: "OWN", rel: "AFFILIATE", at: "CS_L", target: { at: "CS_L", ownedBy: "actor" } },
  ];

  for (const c of cases) {
    it(`[US-04-TS04-${c.id}] DENY ${c.scope} × ${c.rel} (${c.at}→${c.target.at}) = false`, () => {
      const actor = matrixActor({ at: c.at, scope: c.scope, effect: "DENY", withBaseAllow: true });
      expect(can(actor, MATRIX_KEY, matrixTarget(c.target))).toBe(false);
    });
  }
});

describe("US-04 · TS-04 · tripwire + case biên", () => {
  // TRIPWIRE — pin hành vi HÔM NAY (=true) của ĐÚNG 4 ô pending A05/A06/A09/A10.
  // ⚠️ XOÁ test này ĐỒNG THỜI với việc gỡ .fails của 4 case trên — trong CÙNG COMMIT của
  // story resolver P5 (US-14/US-15: engine biết relationshipType + FranchiseContract).
  // Lý do tồn tại: nếu ai đó đổi hành vi 4 ô này NGOÀI story P5 (vô tình siết/mở), test
  // này đỏ ngay lập tức thay vì chỉ thấy "expected fail" đổi trạng thái âm thầm.
  it("[US-04-TS04-TRIPWIRE] 4 ô pending hôm nay vẫn =true (engine chưa biết relationshipType)", () => {
    // A05 — ALL (HO→CS-F)
    expect(
      can(matrixActor({ at: "HO", scope: "ALL", effect: "ALLOW" }), MATRIX_KEY, matrixTarget({ at: "CS_F" })),
    ).toBe(true);
    // A06 — UNIT_AND_BELOW (VUNG_A→CS-F)
    expect(
      can(
        matrixActor({ at: "VUNG_A", scope: "UNIT_AND_BELOW", effect: "ALLOW" }),
        MATRIX_KEY,
        matrixTarget({ at: "CS_F" }),
      ),
    ).toBe(true);
    // A09 — ALL (HO→CS-L)
    expect(
      can(matrixActor({ at: "HO", scope: "ALL", effect: "ALLOW" }), MATRIX_KEY, matrixTarget({ at: "CS_L" })),
    ).toBe(true);
    // A10 — UNIT_AND_BELOW (DA_NANG→CS-L)
    expect(
      can(
        matrixActor({ at: "DA_NANG", scope: "UNIT_AND_BELOW", effect: "ALLOW" }),
        MATRIX_KEY,
        matrixTarget({ at: "CS_L" }),
      ),
    ).toBe(true);
  });

  // BIÊN — pin semantics builder (fixture-time path-resolve): grant UNIT_ONLY gán tại
  // REGION → roleCenterScope = [] (REGION không phải cơ sở, "chỉ đơn vị mình" không chứa
  // center nào) ⇒ scope không bao giờ thoả → false. Hành vi CHỦ ĐÍCH, không phải bug.
  it("[US-04-TS04-EDGE] UNIT_ONLY gán tại REGION (DA_NANG→CS1) = false", () => {
    const actor = matrixActor({ at: "DA_NANG", scope: "UNIT_ONLY", effect: "ALLOW" });
    expect(can(actor, MATRIX_KEY, matrixTarget({ at: "CS1" }))).toBe(false);
  });
});
