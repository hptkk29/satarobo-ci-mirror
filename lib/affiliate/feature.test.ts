/**
 * [AFF-FLG-*] — cờ Affiliate: phép giải tổ hợp THUẦN + khoá/mặc định trong registry. Không DB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings/service", () => ({ getSetting: vi.fn() }));

import { getSetting } from "@/lib/settings/service";
import { getSettingDef } from "@/lib/settings/registry";
import { KHOA_AFFILIATE, hopCoAffiliate, laAffiliateBatTho } from "./feature";

beforeEach(() => vi.resetAllMocks());

describe("[AFF-FLG-01] hopCoAffiliate — affiliate chỉ bật khi CẢ HAI cờ bật", () => {
  it("bảng chân trị 2×2: duy nhất (nguồn bật ∧ affiliate bật) cho true", () => {
    expect(hopCoAffiliate({ nguon: true, affiliate: true })).toBe(true);
    expect(hopCoAffiliate({ nguon: true, affiliate: false })).toBe(false);
    expect(hopCoAffiliate({ nguon: false, affiliate: true })).toBe(false); // bật cờ con trước cờ tổng không được "rò" ra màn hình
    expect(hopCoAffiliate({ nguon: false, affiliate: false })).toBe(false);
  });
});

describe("[AFF-FLG-02] cờ nằm trong registry, MẶC ĐỊNH TẮT, không theo cơ sở", () => {
  it("khoá `affiliate.enabled`, default false, boolean, centerOverridable=false", () => {
    expect(KHOA_AFFILIATE).toBe("affiliate.enabled");
    const def = getSettingDef(KHOA_AFFILIATE);
    if (!def) throw new Error("affiliate.enabled không có trong registry");
    expect(def.default).toBe(false);
    expect(def.centerOverridable).toBe(false);
    expect(def.schema.safeParse(true).success).toBe(true);
    expect(def.schema.safeParse("true").success).toBe(false);
  });

  it("laAffiliateBatTho đọc ĐÚNG khoá đó và trả nguyên giá trị", async () => {
    vi.mocked(getSetting).mockResolvedValue(true as never);
    expect(await laAffiliateBatTho()).toBe(true);
    expect(getSetting).toHaveBeenCalledWith("affiliate.enabled");
  });
});
