/**
 * [NHH-FE-09] — danh sách cơ sở của ScopeBar lấy từ TẦM NHÌN SCOPE, không phải từ `can(action, { centerId })`.
 *
 * docs/source-commission/05 §1.5, 06 §4.3. Key của module seed `GLOBAL`, nên `can()` trả `true` cho MỌI
 * `centerId` (lib/auth/can.ts: scope GLOBAL luôn khớp). Chép khuôn `loadModuleScope` của chấm công
 * (`has(action, centerId)`) là bày chip CS2 cho QLCS CS1 — đúng lỗi "bày mọi cơ sở" của màn Cấu hình vận
 * hành 24/09. Ca này đo ĐÚNG hành vi đó, trên Actor THẬT đi qua `getModelVisibleCenterIds` thật:
 *   · QLCS neo CS1 ⇒ chip CHỈ CS1;
 *   · Kế toán HO ⇒ cả hai (đối chứng dương: nếu cả hai cùng rỗng thì ca chỉ đo "actor không thấy gì");
 *   · và `can()` thật của chính QLCS đó trả TRUE cho CS2 — chứng minh cái bẫy tồn tại (nếu có ngày seed đổi
 *     sang CENTER thì ca này ĐỎ để người sửa biết khuôn cũ lại dùng được).
 */
import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { getModelVisibleCenterIds } from "@/lib/db-scope";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { MODULE_KEYS, dungNguonHoaHongScope, laCoSoVanHanh, type CoSoThoXem, type ModuleKey } from "./scope";
import { TAB_HREF, TAB_KEYS } from "./tab";

const CS1: CoSoThoXem = { id: "cs1-id", code: "CS1", name: "Trụ sở chính - Nguyễn Hữu Thọ" };
const CS2: CoSoThoXem = { id: "cs2-id", code: "CS2", name: "114 Hoàng Diệu" };
const TAT_CA = [CS1, CS2];

function actor(p: Partial<Actor> & { quyen: string[]; centerScope: "ALL" | string[] }): Actor {
  return {
    userId: "u-test",
    isSuperAdmin: false,
    isHoLevel: p.isHoLevel ?? false,
    orgRoles: [],
    permissions: p.quyen.map((action) => ({
      action,
      scopeType: "GLOBAL" as const,
      orgUnitId: "ou-test",
      roleCode: "TEST",
      centerScope: p.centerScope,
      orgUnitScope: null,
    })),
    visibleCenterIds: p.visibleCenterIds ?? (p.centerScope === "ALL" ? [] : p.centerScope),
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

const KEYS_QLCS = ["sources:view", "commission_policies:view", "commission:view-self", "commission:view-center"];

describe("[NHH-FE-09] chip cơ sở theo TẦM NHÌN scope, không theo can()", () => {
  const qlcsCs1 = actor({ quyen: KEYS_QLCS, centerScope: [CS1.id], visibleCenterIds: [CS1.id] });
  const ketoanHo = actor({ quyen: KEYS_QLCS, centerScope: "ALL", isHoLevel: true });

  it("cái bẫy CÓ THẬT: can() của QLCS CS1 trả TRUE cho cơ sở CS2 (key seed GLOBAL)", () => {
    expect(can(qlcsCs1, "commission:view-center", { centerId: CS2.id })).toBe(true);
  });

  for (const model of ["Lead", "CommissionPeriod", "CommissionTransaction"] as const) {
    it(`${model}: QLCS CS1 ⇒ chip CHỈ CS1; Kế toán HO ⇒ cả hai`, () => {
      const a = dungNguonHoaHongScope({
        quyen: new Set<ModuleKey>(["sources:view", "commission:view-center"]),
        co: { nguon: true, engine: true },
        centerIds: { [model]: getModelVisibleCenterIds(model, qlcsCs1) } as never,
        cacCoSo: TAT_CA,
      });
      expect(a.coSoCua(model).map((c) => c.code)).toEqual(["CS1"]);

      const b = dungNguonHoaHongScope({
        quyen: new Set<ModuleKey>(["sources:view", "commission:view-center"]),
        co: { nguon: true, engine: true },
        centerIds: { [model]: getModelVisibleCenterIds(model, ketoanHo) } as never,
        cacCoSo: TAT_CA,
      });
      expect(b.coSoCua(model).map((c) => c.code)).toEqual(["CS1", "CS2"]);
    });
  }

  it("cấy: dựng chip bằng can(action,{centerId}) cho ra CẢ HAI cơ sở với QLCS CS1 — đó chính là lỗi bị cấm", () => {
    const sai = TAT_CA.filter((c) => can(qlcsCs1, "commission:view-center", { centerId: c.id }));
    expect(sai.map((c) => c.code)).toEqual(["CS1", "CS2"]); // bẫy: hai cơ sở
    const dung = TAT_CA.filter((c) => {
      const ids = getModelVisibleCenterIds("CommissionTransaction", qlcsCs1);
      return ids === "ALL" || ids.includes(c.id);
    });
    expect(dung.map((c) => c.code)).toEqual(["CS1"]);
  });

  it("pick: ?coSo= ngoài tầm nhìn bị bỏ qua (về cơ sở đầu tiên được thấy), không bao giờ nhận cơ sở lạ", () => {
    const s = dungNguonHoaHongScope({
      quyen: new Set<ModuleKey>(["commission:view-center"]),
      co: { nguon: false, engine: true },
      centerIds: { Lead: [CS1.id], CommissionPeriod: [CS1.id], CommissionTransaction: [CS1.id] },
      cacCoSo: TAT_CA,
    });
    expect(s.chonCoSo("cs2-id", "CommissionTransaction")?.code).toBe("CS1"); // CS2 ngoài tầm nhìn
    expect(s.chonCoSo("cs1-id", "CommissionTransaction")?.code).toBe("CS1");
    expect(s.chonCoSo(null, "CommissionTransaction")?.code).toBe("CS1");
  });

  it("timCoSo: cơ sở ngoài tầm nhìn ⇒ null, KHÔNG rơi về cơ sở khác (chế độ \"Tất cả cơ sở\" không bị lẫn)", () => {
    const s = dungNguonHoaHongScope({
      quyen: new Set<ModuleKey>(["sources:view"]),
      co: { nguon: true, engine: false },
      centerIds: { Lead: [CS1.id], CommissionPeriod: [CS1.id], CommissionTransaction: [CS1.id] },
      cacCoSo: TAT_CA,
    });
    expect(s.timCoSo("cs2-id", "Lead")).toBeNull();
    expect(s.timCoSo("cs1-id", "Lead")?.code).toBe("CS1");
    expect(s.timCoSo(undefined, "Lead")).toBeNull();
  });

  it("tầm nhìn rỗng (không có cơ sở nào) ⇒ chip rỗng và chonCoSo null — fail-closed, KHÔNG rơi về 'tất cả'", () => {
    const s = dungNguonHoaHongScope({
      quyen: new Set<ModuleKey>(["commission:view-self"]),
      co: { nguon: false, engine: true },
      centerIds: { Lead: [], CommissionPeriod: [], CommissionTransaction: [] },
      cacCoSo: TAT_CA,
    });
    expect(s.coSoCua("CommissionTransaction")).toEqual([]);
    expect(s.chonCoSo("cs1-id", "CommissionTransaction")).toBeNull();
  });
});

describe("[NHH-FE-09b] bản ghi Hội sở mồ côi không phải cơ sở của lead/hoa hồng", () => {
  it("Center(hoi-so, code HO) KHÔNG thành chip dù tầm nhìn là ALL; đối chứng dương: CS1 + CS2 vẫn có", () => {
    const HO: CoSoThoXem = { id: "hoi-so", code: "HO", name: "Hội sở" };
    const s = dungNguonHoaHongScope({
      quyen: new Set<ModuleKey>(["sources:view"]),
      co: { nguon: true, engine: false },
      centerIds: { Lead: "ALL", CommissionPeriod: "ALL", CommissionTransaction: "ALL" },
      cacCoSo: [CS1, CS2, HO],
    });
    expect(s.coSoCua("Lead").map((c) => c.code)).toEqual(["CS1", "CS2"]);
    expect(s.timCoSo("hoi-so", "Lead")).toBeNull();
    expect(laCoSoVanHanh(HO)).toBe(false);
    expect(laCoSoVanHanh(CS1)).toBe(true);
  });
});

describe("dungNguonHoaHongScope — has/any/co", () => {
  it("has/any đọc đúng tập quyền; tab hiện theo cả cờ", () => {
    const s = dungNguonHoaHongScope({
      quyen: new Set<ModuleKey>(["sources:view", "commission:view-self"]),
      co: { nguon: true, engine: false },
      centerIds: { Lead: "ALL", CommissionPeriod: "ALL", CommissionTransaction: "ALL" },
      cacCoSo: TAT_CA,
    });
    expect(s.has("sources:view")).toBe(true);
    expect(s.has("sources:manage")).toBe(false);
    expect(s.any(["sources:manage", "commission:view-self"])).toBe(true);
    expect(s.tabMoDuoc("nguon")).toBe(true);
    expect(s.tabMoDuoc("so")).toBe(false); // có key view-self nhưng engine tắt
    expect(s.tabUngVien()).toEqual(["nguon"]);
  });
});

describe("[NHH-FE-09d] laCoSoVanHanh — Hội sở mồ côi bị loại theo CẢ hai dấu hiệu, không chỉ một", () => {
  it("code 'HO' (id lạ) ⇒ loại; id 'hoi-so' (code khác/null) ⇒ loại; cơ sở thường ⇒ giữ", () => {
    // Fixture của [NHH-FE-09b] mang CẢ HAI dấu hiệu cùng lúc nên một vế bị gỡ vẫn xanh (đợt cấy 08/10, U24/U25).
    expect(laCoSoVanHanh({ id: "id-bat-ky", code: "HO" })).toBe(false);
    expect(laCoSoVanHanh({ id: "hoi-so", code: "KHAC" })).toBe(false);
    expect(laCoSoVanHanh({ id: "hoi-so", code: null })).toBe(false);
    expect(laCoSoVanHanh({ id: "cs1-id", code: "CS1" })).toBe(true);
    expect(laCoSoVanHanh({ id: "cs3-id", code: null })).toBe(true); // chưa có code ≠ Hội sở
  });
});

describe("[NHH-FE-10c] MODULE_KEYS — mọi key mà một cổng/nút của module hỏi đều được NẠP", () => {
  // `loadNguonHoaHongScope` chỉ hỏi các key trong MODULE_KEYS; key thiếu ⇒ `has()` luôn false ⇒ tab/nút biến mất
  // với MỌI người, kể cả Quản trị tối cao — đúng lớp lỗi 'mục menu biến mất' (CLAUDE.md luật 11).
  it("hợp mọi key của PAGE_GATES (năm tab + gốc) ⊆ MODULE_KEYS", () => {
    const can = new Set<string>(MODULE_KEYS);
    const gate = new Set<string>([
      ...PAGE_GATES["/nguon-hoa-hong"],
      ...TAB_KEYS.flatMap((k) => [...PAGE_GATES[TAB_HREF[k]]]),
    ]);
    expect(gate.size).toBeGreaterThan(3); // chống cổng rỗng
    expect([...gate].filter((k) => !can.has(k))).toEqual([]);
  });

  it("key mà TabHoaHongKhung hỏi để hiện chip cơ sở (`commission:view-center`) cũng được nạp", () => {
    expect(MODULE_KEYS).toContain("commission:view-center");
    expect(new Set(MODULE_KEYS).size).toBe(MODULE_KEYS.length); // không trùng
  });
});
