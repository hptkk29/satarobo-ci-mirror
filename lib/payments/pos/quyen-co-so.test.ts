// lib/payments/pos/quyen-co-so.test.ts — [QCS] "có quyền ĐÓ ở cơ sở của đơn không" (người đa vai) + lưới dây nối ba cổng. THUẦN, không DB.
// Hành vi trên Postgres + RBAC thật: tests/finance/pos-da-vai-co-so.test.ts ([DVC-*]).
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ActionScopeActor } from "@/lib/lms/report-card-core";
import { QUYEN_KE_TOAN_SAI_MA, QUYEN_THU_THE_POS, quyenTaiCoSoCuaDon } from "./quyen-co-so";

const RBAC_GOC = process.env.RBAC_V2_ENABLED;
afterEach(() => {
  if (RBAC_GOC === undefined) delete process.env.RBAC_V2_ENABLED;
  else process.env.RBAC_V2_ENABLED = RBAC_GOC;
});

type Entry = ActionScopeActor["permissions"][number];
const entry = (action: string, centerScope: "ALL" | string[] | null): Entry =>
  ({ action, scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }) as unknown as Entry;
const actor = (o: { admin?: boolean; grants?: string[]; perms?: Entry[] } = {}): ActionScopeActor => ({
  isSuperAdmin: o.admin ?? false,
  grantsAllow: new Set(o.grants ?? []),
  permissions: o.perms ?? [],
});

describe("[QCS] quyenTaiCoSoCuaDon", () => {
  it("[QCS-01] v1 (mặc định local/CI · rollback): luôn true — không đổi hành vi đường cũ, kể cả actor KHÔNG có dòng quyền nào", () => {
    delete process.env.RBAC_V2_ENABLED;
    expect(quyenTaiCoSoCuaDon(actor(), QUYEN_THU_THE_POS, "cs1")).toBe(true);
    process.env.RBAC_V2_ENABLED = "false";
    expect(quyenTaiCoSoCuaDon(actor(), QUYEN_KE_TOAN_SAI_MA, null)).toBe(true);
  });

  it("[QCS-02] v2: bảng sự thật theo nơi neo vai — đúng cơ sở ⇒ true, cơ sở khác / không có dòng ⇒ false; ALL · SUPER_ADMIN · grant ALLOW ⇒ true", () => {
    process.env.RBAC_V2_ENABLED = "true";
    const q = QUYEN_THU_THE_POS;
    const bang: Array<[string, ActionScopeActor, string | null, boolean]> = [
      ["vai ở CS1, đơn CS1", actor({ perms: [entry(q, ["cs1"])] }), "cs1", true],
      ["vai ở CS1, đơn CS2", actor({ perms: [entry(q, ["cs1"])] }), "cs2", false],
      ["vai ở CS1 và CS2 (hai dòng cùng quyền), đơn CS2", actor({ perms: [entry(q, ["cs1"]), entry(q, ["cs2"])] }), "cs2", true],
      ["không có dòng quyền nào", actor(), "cs1", false],
      ["dòng của quyền KHÁC (kế toán@CS2 có manage, không có pos-check), đơn CS2", actor({ perms: [entry(QUYEN_KE_TOAN_SAI_MA, ["cs2"])] }), "cs2", false],
      ["centerScope = null (vai quan hệ — fail-closed)", actor({ perms: [entry(q, null)] }), "cs1", false],
      ["ALL (vai neo tại HO)", actor({ perms: [entry(q, "ALL")] }), "cs9", true],
      ["ALL, đơn không có cơ sở", actor({ perms: [entry(q, "ALL")] }), null, true],
      ["vai ở CS1, đơn KHÔNG có cơ sở ⇒ fail-closed", actor({ perms: [entry(q, ["cs1"])] }), null, false],
      ["SUPER_ADMIN", actor({ admin: true }), "cs7", true],
      ["grant ALLOW riêng", actor({ grants: [q] }), "cs7", true],
    ];
    for (const [ten, a, cs, mong] of bang) expect(quyenTaiCoSoCuaDon(a, q, cs), ten).toBe(mong);
  });

  it("[QCS-03] v2: hai quyền KHÔNG lẫn nhau — kế toán@CS2 duyệt được đơn CS2 nhưng không 'qua cổng POS' ở CS2; sale@CS1 qua cổng POS ở CS1 nhưng không duyệt", () => {
    process.env.RBAC_V2_ENABLED = "true";
    const multi = actor({ perms: [entry(QUYEN_THU_THE_POS, ["cs1"]), entry(QUYEN_KE_TOAN_SAI_MA, ["cs2"])] });
    expect(quyenTaiCoSoCuaDon(multi, QUYEN_THU_THE_POS, "cs1")).toBe(true);
    expect(quyenTaiCoSoCuaDon(multi, QUYEN_THU_THE_POS, "cs2")).toBe(false);
    expect(quyenTaiCoSoCuaDon(multi, QUYEN_KE_TOAN_SAI_MA, "cs2")).toBe(true);
    expect(quyenTaiCoSoCuaDon(multi, QUYEN_KE_TOAN_SAI_MA, "cs1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LƯỚI DÂY NỐI: ba cổng PHẢI gọi hàm này. Mọi test action đều mock quyền / actor MỘT cơ sở nên quên gọi là KHÔNG ca hành vi nào đỏ (ngoài
// `tests/finance/pos-da-vai-co-so.test.ts` — chỉ chạy khi có Postgres). Neo BIỂU THỨC (quyền + cơ sở của đơn), không neo thứ tự thuộc tính / chỗ xuống dòng.
// ─────────────────────────────────────────────────────────────────────────────
const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].length;

describe("[QCS-W] dây nối ba cổng thu thẻ POS", () => {
  it("[QCS-W1] `congXemPhieuPos` (kiểm tra · báo admin · huỷ phiếu thẻ) và `congSaiMa` (tìm · gửi) hỏi quyền `pos-check` Ở CƠ SỞ CỦA ĐƠN — mỗi tệp đúng một lần", () => {
    for (const p of ["app/(admin)/admin/orders/_actions.ts", "app/(admin)/admin/orders/_pos-sai-ma-actions.ts"]) {
      const ma = doc(p);
      expect(dem(ma, /quyenTaiCoSoCuaDon\(actor, QUYEN_THU_THE_POS, order\.centerId\)/), p).toBe(1);
      expect(dem(ma, /checkPermission\("payments:pos-check"\)/), `${p}: vẫn còn cổng trần (lint authz đòi)`).toBeGreaterThanOrEqual(1);
    }
  });

  it("[QCS-W2] `congKeToanSaiMa` (duyệt · từ chối) hỏi quyền `manage` Ở CƠ SỞ CỦA ĐƠN — đúng một lần", () => {
    const ma = doc("app/(admin)/admin/bien-dong-so-du/_pos-sai-ma-actions.ts");
    expect(dem(ma, /quyenTaiCoSoCuaDon\(actor, QUYEN_KE_TOAN_SAI_MA, order\.centerId\)/)).toBe(1);
    expect(dem(ma, /checkPermission\("payments:manage"\)/)).toBeGreaterThanOrEqual(1);
  });

  it("[QCS-W3] hàm KHÔNG đọc `visibleCenterIds` / model prefix (đó là phép HỢP — đúng thứ gây lỗ) mà đọc `actionCenterScope` của ĐÚNG quyền", () => {
    const ma = doc("lib/payments/pos/quyen-co-so.ts");
    expect(dem(ma, /actionCenterScope\(actor, action\)/)).toBe(1);
    expect(dem(ma, /visibleCenterIds|getModelVisibleCenterIds|passesScope/)).toBe(0);
  });
});
