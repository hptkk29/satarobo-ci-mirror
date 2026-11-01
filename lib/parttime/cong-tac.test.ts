// [CT-*] luật THUẦN của bốn công tắc Parttime (`cong-tac-thuan.ts`) + quyền ghi công tắc + dây nối. Phần DB:
// tests/cham-cong/parttime-cong-tac.spec.ts ([FLAG-*], [RBAC-V2-01]).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSettingDef } from "@/lib/settings/registry";
import { duocSuaKhoaCuaCoSo } from "@/lib/settings/quyen-co-so";
import { NHAN_VAN_HANH } from "@/lib/settings/nhan-van-hanh";
import {
  CAN_RBAC_V2,
  KHOA_CONG_TAC,
  LOAI_CONG_TAC,
  LOI_RBAC_V2,
  PHAM_VI_TAT,
  batTai,
  coNoiNaoBat,
  hieuLuc,
  trangThaiCongTac,
  type PhamViCongTac,
} from "./cong-tac-thuan";

const pv = (macDinh: boolean, donVi: [string, boolean][] = [], coSo: [string, boolean][] = []): PhamViCongTac => ({
  macDinh,
  theoDonVi: new Map(donVi),
  theoCoSo: new Map(coSo),
});
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("[CT] công tắc Parttime theo cơ sở", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("[CT-01] tắt mọi nơi ⇒ coNoiNaoBat false; mặc định bật ⇒ true; chỉ một cơ sở ghi đè bật ⇒ true", () => {
    expect(coNoiNaoBat(PHAM_VI_TAT)).toBe(false);
    expect(coNoiNaoBat(pv(true))).toBe(true);
    expect(coNoiNaoBat(pv(false, [["ou1", true]], [["cs1", true]]))).toBe(true);
    expect(coNoiNaoBat(pv(false, [["ou1", false]]))).toBe(false);
  });

  it("[CT-02] ưu tiên: ghi đè theo đơn vị → theo cơ sở → mặc định; không biết nơi ⇒ CHỈ mặc định (không nới thành 'có nơi bật')", () => {
    const p = pv(false, [["ou1", true]], [["cs1", true]]);
    expect(batTai(p, { orgUnitId: "ou1" })).toBe(true);
    expect(batTai(p, { centerId: "cs1" })).toBe(true);
    expect(batTai(p, { centerId: "cs2" })).toBe(false);
    expect(batTai(p, {})).toBe(false);
    expect(batTai(p, { orgUnitId: null, centerId: null })).toBe(false);
    const tatRieng = pv(true, [["ou2", false]], [["cs2", false]]);
    expect(batTai(tatRieng, { centerId: "cs2" })).toBe(false);
    expect(batTai(tatRieng, { centerId: "cs1" })).toBe(true);
  });

  it("[CT-03] RBAC v2 BẮT BUỘC cho ba công tắc có ghi; chấm công theo ngữ cảnh KHÔNG chặn (M-RBAC-01)", () => {
    expect(CAN_RBAC_V2).toEqual({ STAFFING: true, ATTENDANCE_CONTEXT: false, WORKUNIT_SHADOW: true, COMPENSATION: true });
    for (const loai of ["STAFFING", "WORKUNIT_SHADOW", "COMPENSATION"] as const) {
      expect(trangThaiCongTac(loai, true, false), loai).toEqual({ bat: true, chan: LOI_RBAC_V2 });
      expect(hieuLuc(loai, true, false), loai).toBe(false);
      expect(hieuLuc(loai, true, true), loai).toBe(true);
      expect(trangThaiCongTac(loai, false, false), loai).toEqual({ bat: false, chan: null });
    }
    expect(hieuLuc("ATTENDANCE_CONTEXT", true, false)).toBe(true);
    expect(LOI_RBAC_V2).toBe("RBAC_V2_REQUIRED_FOR_PARTTIME");
  });

  it("[CT-04] bốn khoá có trong registry: boolean · mặc định TẮT · ghi đè được theo cơ sở · có nhãn ở màn Cấu hình vận hành", () => {
    expect(LOAI_CONG_TAC).toEqual(["STAFFING", "ATTENDANCE_CONTEXT", "WORKUNIT_SHADOW", "COMPENSATION"]);
    expect(new Set(Object.values(KHOA_CONG_TAC)).size).toBe(4);
    for (const key of Object.values(KHOA_CONG_TAC)) {
      const def = getSettingDef(key);
      expect(def, key).toBeDefined();
      expect(def!.default, key).toBe(false);
      expect(def!.centerOverridable, key).toBe(true);
      expect(def!.schema.safeParse(true).success && !def!.schema.safeParse("true").success, key).toBe(true);
      expect((NHAN_VAN_HANH as Record<string, { tab: string }>)[key]?.tab, key).toBe("cham-cong");
    }
    // Khoá cũ gánh cả bốn hành vi đã GỠ — còn nó là còn đường bật "tất cả một lúc".
    expect(getSettingDef("shift.phanCongNhanLopBat")).toBeUndefined();
  });

  it("[CT-05] AI bật công tắc: Quản lý cơ sở KHÔNG tự bật được cho cơ sở mình (kể cả công tắc tiền) — chỉ Quản trị tối cao", () => {
    const qlcs = { isSuperAdmin: false, orgRoles: [{ orgUnitId: "ou1", roleCode: "CENTER_MANAGER" }] };
    const qttc = { isSuperAdmin: true, orgRoles: [] };
    for (const key of Object.values(KHOA_CONG_TAC)) {
      const def = getSettingDef(key)!;
      expect(duocSuaKhoaCuaCoSo(qlcs, def), key).toBe(false);
      expect(duocSuaKhoaCuaCoSo(qttc, def), key).toBe(true);
    }
  });

  it("[CT-RBAC-W] MỘT nguồn RBAC cho Parttime: `rbacV2ChoParttime` = `isRbacV2Enabled()`; cổng thao tác dùng nó, không đọc env tại chỗ", async () => {
    const { rbacV2ChoParttime } = await import("./cong-tac-doc");
    vi.stubEnv("RBAC_V2_ENABLED", "true");
    expect(rbacV2ChoParttime()).toBe(true);
    vi.stubEnv("RBAC_V2_ENABLED", "false");
    expect(rbacV2ChoParttime()).toBe(false);
    vi.stubEnv("RBAC_V2_ENABLED", "");
    expect(rbacV2ChoParttime()).toBe(false);
    const ct = doc("lib/parttime/cong-tac.ts");
    expect(ct).not.toContain("process.env");
    expect(ct.match(/rbacV2ChoParttime\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(doc("lib/parttime/cong-tac-doc.ts")).toContain("return isRbacV2Enabled();");
  });

  it("[CT-W1] KHÔNG nơi nào đọc khoá công tắc ngoài `cong-tac-doc.ts`; mọi action Parttime đi qua `congThaoTacParttime` với loại đúng", () => {
    const tep = [
      "lib/parttime/phan-cong-db.ts",
      "lib/parttime/dong-bo.ts",
      "lib/parttime/tich-hop.ts",
      "lib/parttime/che-do-huong.ts",
      "lib/parttime/ngu-canh-cham-cong-db.ts",
      "lib/parttime/cong-viec-hop-le-db.ts",
      "lib/parttime/cong-viec-hop-le-an-toan.ts",
      "lib/classes/buoi-ghi.ts",
      "app/(admin)/admin/cham-cong/phan-cong/page.tsx",
      "app/(admin)/admin/cham-cong/phan-cong/thang/page.tsx",
      "app/(teacher)/teacher/phan-cong/page.tsx",
    ];
    for (const t of tep) {
      const s = doc(t);
      for (const key of Object.values(KHOA_CONG_TAC)) expect(s, `${t}: ${key}`).not.toContain(key);
      expect(s, t).not.toContain("phanCongBat(");
    }
    const admin = doc("app/(admin)/admin/cham-cong/phan-cong/_actions.ts");
    expect(admin).toContain("const ct = await congThaoTacParttime(loai, { centerId }, CHUA_BAT[loai]);");
    const gv = doc("app/(teacher)/teacher/phan-cong/_actions.ts");
    // Nhận / từ chối là GHI: cổng đứng TRƯỚC giao dịch ở cả hai action.
    expect(gv.match(/await congNhan\(/g)?.length).toBe(2);
    expect(gv.indexOf("const g = await congNhan(p.data.assignmentId);")).toBeLessThan(gv.indexOf("quyetDinhNhanLop(tx, {\n        assignmentId: p.data.assignmentId"));
    const gvTruc = doc("app/(teacher)/teacher/phan-cong/_actions-truc.ts");
    expect(gvTruc.indexOf('congThaoTacParttime("STAFFING", { centerId: await coSoCuaTruc(p.data.dutyId) }')).toBeGreaterThan(0);
    expect(gvTruc.indexOf('congThaoTacParttime("STAFFING"')).toBeLessThan(gvTruc.indexOf("quyetDinhTruc(tx"));
  });
});
