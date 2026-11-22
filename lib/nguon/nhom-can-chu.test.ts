/**
 * Ca [NCC-*] — nguồn nào THẬT SỰ cần chủ nguồn (cổng backfill). THUẦN.
 * Định nghĩa phải CÙNG với cổng kích hoạt chính sách (`guardrail-kich-hoat.ts`): rule SOURCE_OWNER ở SOURCE_GROUP ⇒ nguồn đó; ở phạm vi khác ⇒ mọi nguồn; UNKNOWN không bao giờ.
 */
import { describe, expect, it } from "vitest";
import { nhomNguonCanChu } from "./nhom-can-chu";

const NHOM = [
  { id: "g1", code: "PAID_ADS" },
  { id: "g2", code: "EMPLOYEE_REFERRAL" },
  { id: "g3", code: "PARENT_REFERRAL" },
  { id: "g4", code: "WALK_IN" },
  { id: "g5", code: "CENTER_ORGANIC" },
  { id: "gU", code: "UNKNOWN" },
];
const codes = (s: ReadonlySet<string>) => [...s].sort();

describe("[NCC-01] không rule SOURCE_OWNER nào đang hiệu lực ⇒ KHÔNG nguồn nào cần chủ", () => {
  it("tập rỗng", () => {
    expect(codes(nhomNguonCanChu([], NHOM))).toEqual([]);
  });
});

describe("[NCC-02] rule ở phạm vi SOURCE_GROUP ⇒ chỉ nguồn đó", () => {
  it("một nguồn", () => {
    expect(codes(nhomNguonCanChu([{ scopeType: "SOURCE_GROUP", scopeSourceGroupId: "g1" }], NHOM))).toEqual(["PAID_ADS"]);
  });
  it("hai nguồn; trùng không đổi nghĩa", () => {
    const r = [
      { scopeType: "SOURCE_GROUP", scopeSourceGroupId: "g1" },
      { scopeType: "SOURCE_GROUP", scopeSourceGroupId: "g3" },
      { scopeType: "SOURCE_GROUP", scopeSourceGroupId: "g1" },
    ];
    expect(codes(nhomNguonCanChu(r, NHOM))).toEqual(["PAID_ADS", "PARENT_REFERRAL"]);
  });
  it("id nhóm không còn trong danh mục ⇒ bỏ qua (không bịa mã)", () => {
    expect(codes(nhomNguonCanChu([{ scopeType: "SOURCE_GROUP", scopeSourceGroupId: "khong-co" }], NHOM))).toEqual([]);
  });
});

describe("[NCC-03] rule ở phạm vi KHÁC (chung · đơn vị · vai · người · campaign…) áp MỌI nguồn — nhưng không bao giờ UNKNOWN", () => {
  it.each(["GLOBAL", "ORG_UNIT", "ROLE", "PERSON", "AFFILIATE", "CAMPAIGN", "EVENT", "SOURCE"])("%s ⇒ 5 nguồn thật", (scopeType) => {
    const r = nhomNguonCanChu([{ scopeType, scopeSourceGroupId: null }], NHOM);
    expect(codes(r)).toEqual(["CENTER_ORGANIC", "EMPLOYEE_REFERRAL", "PAID_ADS", "PARENT_REFERRAL", "WALK_IN"]);
    expect(r.has("UNKNOWN")).toBe(false);
  });
});

describe("[NCC-04] fail-closed với dữ liệu hỏng", () => {
  it("SOURCE_GROUP mà thiếu id nhóm ⇒ coi như áp mọi nguồn (không bỏ qua im lặng)", () => {
    expect(codes(nhomNguonCanChu([{ scopeType: "SOURCE_GROUP", scopeSourceGroupId: null }], NHOM))).toHaveLength(5);
  });
  it("UNKNOWN không bao giờ vào tập kể cả khi rule trỏ thẳng vào nó", () => {
    expect(codes(nhomNguonCanChu([{ scopeType: "SOURCE_GROUP", scopeSourceGroupId: "gU" }], NHOM))).toEqual([]);
  });
});
