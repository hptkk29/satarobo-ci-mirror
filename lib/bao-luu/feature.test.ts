// lib/bao-luu/feature.test.ts — HÀNH VI của `coNoiNaoBatBaoLuu` (công tắc `pause.enabled` theo cơ sở).
//
// Vì sao có: chốt 11/10/2026 — cấp Hội sở thấy menu "Bảo lưu" khi cờ bật ở ÍT NHẤT MỘT cơ sở (BGĐ + Kế toán HO phải theo dõi được cơ sở thí điểm). Bản đầu của
// bản vá menu cho Hội sở truyền `[]` ⇒ chỉ đọc cờ TOÀN HỆ ⇒ thí điểm một cơ sở (CenterSetting) mà Hội sở không thấy menu. Hàm phải: danh sách rỗng ⇒ cờ toàn hệ;
// danh sách có đơn vị ⇒ BẬT nếu bất kỳ đơn vị nào bật, kể cả khi toàn hệ TẮT.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ batTheoDonVi: new Map<string | null, boolean>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (_khoa: string, opts?: { orgUnitId?: string | null }) => h.batTheoDonVi.get(opts?.orgUnitId ?? null) ?? h.batTheoDonVi.get(null) ?? false),
}));

import { coNoiNaoBatBaoLuu } from "./feature";

describe("[BLF] coNoiNaoBatBaoLuu", () => {
  beforeEach(() => h.batTheoDonVi.clear());

  it("[BLF-01] danh sách rỗng ⇒ đọc công tắc TOÀN HỆ", async () => {
    h.batTheoDonVi.set(null, false);
    expect(await coNoiNaoBatBaoLuu([])).toBe(false);
    h.batTheoDonVi.set(null, true);
    expect(await coNoiNaoBatBaoLuu([])).toBe(true);
  });

  it("[BLF-02] toàn hệ TẮT + MỘT cơ sở bật ⇒ người thấy cả hai (cấp Hội sở) THẤY — đúng ca thí điểm", async () => {
    h.batTheoDonVi.set(null, false);
    h.batTheoDonVi.set("cs1", true);
    expect(await coNoiNaoBatBaoLuu(["ho", "cs1", "cs2"])).toBe(true);
  });

  it("[BLF-03] người chỉ thấy cơ sở TẮT ⇒ KHÔNG thấy, dù cơ sở khác đang thí điểm", async () => {
    h.batTheoDonVi.set(null, false);
    h.batTheoDonVi.set("cs1", true);
    expect(await coNoiNaoBatBaoLuu(["cs2"])).toBe(false);
  });

  it("[BLF-04] toàn hệ BẬT + cơ sở bị gỡ ⇒ người chỉ thấy cơ sở đó KHÔNG thấy; người thấy thêm cơ sở khác thì thấy", async () => {
    h.batTheoDonVi.set(null, true);
    h.batTheoDonVi.set("cs2", false);
    expect(await coNoiNaoBatBaoLuu(["cs2"])).toBe(false);
    expect(await coNoiNaoBatBaoLuu(["cs1", "cs2"])).toBe(true);
  });
});
