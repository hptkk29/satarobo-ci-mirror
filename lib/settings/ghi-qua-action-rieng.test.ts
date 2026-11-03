// @vitest-environment node
/**
 * [NHH-PER-03e] — khoá `ghiQuaActionRieng` (hiện: `hoaHong.kyCutover`) KHÔNG ghi được qua đường cài đặt chung. THUẦN (giả lập `db`).
 *
 * Lỗ cần bịt (05 §2.2c): `saveGlobalSettingAction` nhận BẤT KỲ key nào, `setGlobalSetting` chỉ kiểm `isSuperAdmin` + zod. Đặt "cổng" ở action riêng là vô nghĩa nếu đường
 * chung ghi được cùng khoá. Ca đo ở tầng `service` (nơi thật sự ghi), không ở action — action chỉ là một trong nhiều đường gọi.
 *
 * Mỗi ca có ĐỐI CHỨNG DƯƠNG cạnh nó (một khoá thường ghi được): ca chỉ khẳng định "từ chối" luôn đạt khi service hỏng hoàn toàn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  goi: [] as string[],
}));
vi.mock("@/lib/db", () => {
  const ghi = (ten: string) => async (...a: unknown[]) => {
    h.goi.push(ten);
    return a.length ? null : null;
  };
  return {
    db: {
      systemSetting: { findUnique: async () => null, upsert: ghi("systemSetting.upsert") },
      centerSetting: { findUnique: async () => null, upsert: ghi("centerSetting.upsert"), delete: ghi("centerSetting.delete") },
    },
  };
});
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/cache/safe-cache", () => ({ safeCache: (f: unknown) => f, safeUpdateTag: () => undefined }));

import type { Actor } from "@/lib/auth/actor";
import { clearCenterSetting, setCenterSetting, setGlobalSetting } from "./service";

const SA = { userId: "u1", isSuperAdmin: true, centerScope: "ALL", visibleCenterIds: [], visibleOrgUnitIds: [], isHoLevel: true, roles: [], perms: [] } as unknown as Actor;
const CS = "ou-1";

beforeEach(() => {
  h.goi.length = 0;
});

describe("[NHH-PER-03e] setGlobalSetting", () => {
  it("TỪ CHỐI `hoaHong.kyCutover` (VALIDATION) TRƯỚC mọi phép ghi — kể cả với SUPER_ADMIN và giá trị hợp lệ", async () => {
    const r = await setGlobalSetting(SA, { key: "hoaHong.kyCutover", value: "2026-12", reason: "đặt mốc thử", actorName: "SA" });
    expect(r).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(h.goi).toEqual([]);
  });

  it("đối chứng dương: khoá thường (`hoaHong.engineBat`) ghi được ⇒ upsert được gọi", async () => {
    const r = await setGlobalSetting(SA, { key: "hoaHong.engineBat", value: true, reason: "bật thử", actorName: "SA" });
    expect(r).toEqual({ ok: true });
    expect(h.goi).toEqual(["systemSetting.upsert"]);
  });
});

describe("[NHH-PER-03e] setCenterSetting / clearCenterSetting", () => {
  it("setCenterSetting TỪ CHỐI khoá `ghiQuaActionRieng` bằng chính cờ đó (không chỉ vì nó không `centerOverridable`)", async () => {
    const r = await setCenterSetting(SA, { orgUnitId: CS, key: "hoaHong.kyCutover", value: "2026-12", reason: "thử", actorName: "SA" });
    expect(r).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(r.ok === false && r.error.message).toMatch(/thao tác riêng/);
    expect(h.goi).toEqual([]);
  });

  it("clearCenterSetting TỪ CHỐI khoá `ghiQuaActionRieng`", async () => {
    const r = await clearCenterSetting(SA, { orgUnitId: CS, key: "hoaHong.kyCutover", reason: "gỡ thử", actorName: "SA" });
    expect(r).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(h.goi).toEqual([]);
  });
});
