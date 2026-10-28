// [NHH-FLG-10..12] — CỜ ENGINE HOA HỒNG MỚI `hoaHong.engineBat`: DB, mặc định TẮT, đọc ở ĐÚNG MỘT hàm.
// Đặc tả: docs/source-commission/05 §2.2–§2.3. Khuôn: lib/finance/hoa-don/feature.test.ts.
// Test viết TRƯỚC hiện thực (luật cứng Nền hệ thống #5).
//
// `hoaHong.kyCutover` (mốc kỳ) KHÔNG phải cờ thường: nó CÓ trong registry nhưng `ghiQuaActionRieng` — chỉ `datMocCutover` ghi được (PR5c, §2.2c). Xem [NHH-FLG-12].
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({ gia: new Map<string, unknown>(), goi: [] as string[] }));
vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string) => {
    h.goi.push(key);
    if (!h.gia.has(key)) throw new Error(`test chưa đặt giá trị cho ${key}`);
    return h.gia.get(key);
  }),
}));

import { SETTINGS } from "@/lib/settings/registry";
import { NHAN_VAN_HANH } from "@/lib/settings/nhan-van-hanh";
import { KHOA_ENGINE_HOA_HONG, KHOA_XUAT_LUONG, laEngineHoaHongBat, laXuatLuongBat } from "./feature";

beforeEach(() => {
  h.gia.clear();
  h.goi.length = 0;
});

describe("[NHH-FLG-10] khai báo `hoaHong.engineBat`", () => {
  it("khoá đúng tên, boolean thật, mặc định TẮT, KHÔNG cho cơ sở lệch", () => {
    expect(KHOA_ENGINE_HOA_HONG).toBe("hoaHong.engineBat");
    const d = SETTINGS[KHOA_ENGINE_HOA_HONG];
    // Mặc định `true` lọt vào đây là bật cron quét ghi sổ hoa hồng mới cho toàn prod ngay lần deploy sau.
    expect(d.default).toBe(false);
    expect(d.centerOverridable).toBe(false);
    expect(d.schema.safeParse(true).success).toBe(true);
    expect(d.schema.safeParse("true").success).toBe(false);
  });

  it("có nhãn vận hành ở tab Hoa hồng, đánh dấu CẨN THẬN (bật là ghi sổ tiền)", () => {
    const n = NHAN_VAN_HANH[KHOA_ENGINE_HOA_HONG];
    expect(n.tab).toBe("hoa-hong");
    expect(n.canThan).toBe(true);
    expect(n.ten.length).toBeGreaterThan(0);
  });

  it("[NHH-FLG-12] `hoaHong.kyCutover` có trong registry NHƯNG `ghiQuaActionRieng` (đường ghi chung bị từ chối); null mặc định; không ghi đè theo cơ sở; chỉ nhận YYYY-MM", () => {
    const d = SETTINGS["hoaHong.kyCutover"];
    expect(d.ghiQuaActionRieng).toBe(true);
    expect(d.default).toBeNull();
    expect(d.centerOverridable).toBe(false);
    for (const ok of [null, "2026-10", "2027-01"]) expect(d.schema.safeParse(ok).success, String(ok)).toBe(true);
    for (const sai of ["2026-13", "2026-00", "26-10", "2026-1", "", 202610, true]) expect(d.schema.safeParse(sai).success, String(sai)).toBe(false);
  });

  it("[NHH-FLG-12b] MỘT khoá duy nhất mang `ghiQuaActionRieng` — thêm khoá thứ hai là một quyết định phải có chủ đích", () => {
    const cac = Object.values(SETTINGS)
      .filter((d) => (d as { ghiQuaActionRieng?: boolean }).ghiQuaActionRieng === true)
      .map((d) => d.key);
    expect(cac).toEqual(["hoaHong.kyCutover"]);
  });

  it("[NHH-FLG-12c] nhãn vận hành của mốc: tab Hoa hồng, đánh dấu CẨN THẬN, câu giải thích nói rõ KHÔNG sửa ở đây", () => {
    const n = NHAN_VAN_HANH["hoaHong.kyCutover"];
    expect(n.tab).toBe("hoa-hong");
    expect(n.canThan).toBe(true);
    expect(n.giaiThich).toMatch(/không sửa ở đây/i);
  });
});

describe("[NHH-FLG-11] `laEngineHoaHongBat` đọc đúng khoá", () => {
  it("bật ⇒ true, tắt ⇒ false; chỉ đọc MỘT khoá", async () => {
    h.gia.set("hoaHong.engineBat", true);
    expect(await laEngineHoaHongBat()).toBe(true);
    h.gia.set("hoaHong.engineBat", false);
    expect(await laEngineHoaHongBat()).toBe(false);
    expect([...new Set(h.goi)]).toEqual(["hoaHong.engineBat"]);
  });

  it("độc lập với cờ nguồn: engine bật mà `nguon.enabled` tắt vẫn là bật (05 §2.2 — hai cờ riêng)", async () => {
    h.gia.set("hoaHong.engineBat", true);
    h.gia.set("nguon.enabled", false);
    expect(await laEngineHoaHongBat()).toBe(true);
    expect(h.goi).not.toContain("nguon.enabled");
  });
});

describe("[NHH-FLG-11b] LƯỚI: không ai đọc `hoaHong.engineBat` ngoài `lib/hoa-hong/feature.ts`", () => {
  const TRAN_QUET_MS = 30_000;
  function bocChuThich(v: string): string {
    return v
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((d) => d.replace(/\/\/[^\n]*$/, ""))
      .join("\n");
  }
  it("0 tệp nào khác nhắc chuỗi khoá", { timeout: TRAN_QUET_MS }, () => {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app", "components", "scripts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split(/\r?\n/)
      .filter((d) => /\.(ts|tsx|mjs|cjs)$/.test(d))
      .filter((d) => !/\.(test|spec)\.(ts|tsx|mjs|cjs)$/.test(d))
      .filter((d) => d !== "lib/hoa-hong/feature.ts")
      .filter((d) => d !== "lib/settings/registry.ts")
      .filter((d) => d !== "lib/settings/nhan-van-hanh.ts")
      .filter((d) => existsSync(resolve(process.cwd(), d)));
    expect(ra.length, "phép quét không đọc được tệp nào").toBeGreaterThan(200);
    const viPham = ra.filter((d) =>
      bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8")).includes(KHOA_ENGINE_HOA_HONG),
    );
    expect(viPham, `Đọc cờ ngoài lib/hoa-hong/feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });
});

// ── hoaHong.xuatLuongBat (PR9 — cờ có ĐƯỜNG GỌI THẬT: nút Xuất bảng chi / Đánh dấu đã chi + cổng ở service) ────────────────────
describe("[NHH-KY-FLG-01] khai báo `hoaHong.xuatLuongBat`", () => {
  it("khoá đúng tên, boolean thật, mặc định TẮT (kỳ dừng ở LOCKED), KHÔNG cho cơ sở lệch", () => {
    expect(KHOA_XUAT_LUONG).toBe("hoaHong.xuatLuongBat");
    const d = SETTINGS[KHOA_XUAT_LUONG];
    expect(d.default).toBe(false);
    expect(d.centerOverridable).toBe(false);
    expect(d.schema.safeParse(true).success).toBe(true);
    expect(d.schema.safeParse("true").success).toBe(false);
  });

  it("có nhãn vận hành ở tab Hoa hồng, đánh dấu CẨN THẬN (bật là cho xuất bảng chi tiền thật)", () => {
    const n = NHAN_VAN_HANH[KHOA_XUAT_LUONG];
    expect(n.tab).toBe("hoa-hong");
    expect(n.canThan).toBe(true);
    expect(n.giaiThich).toMatch(/khoá/i);
  });

  it("`laXuatLuongBat` đọc đúng MỘT khoá, độc lập với cờ engine", async () => {
    h.gia.set("hoaHong.xuatLuongBat", true);
    h.gia.set("hoaHong.engineBat", false);
    expect(await laXuatLuongBat()).toBe(true);
    h.gia.set("hoaHong.xuatLuongBat", false);
    expect(await laXuatLuongBat()).toBe(false);
    expect([...new Set(h.goi)]).toEqual(["hoaHong.xuatLuongBat"]);
  });
});

describe("[NHH-KY-FLG-02] LƯỚI: không ai đọc `hoaHong.xuatLuongBat` ngoài `lib/hoa-hong/feature.ts`", () => {
  function bocChuThich(v: string): string {
    return v
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((d) => d.replace(/\/\/[^\n]*$/, ""))
      .join("\n");
  }
  it("0 tệp nào khác nhắc chuỗi khoá (quyết định nút và cổng server cùng đi qua `laXuatLuongBat`)", { timeout: 30_000 }, () => {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app", "components", "scripts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split(/\r?\n/)
      .filter((d) => /\.(ts|tsx|mjs|cjs)$/.test(d))
      .filter((d) => !/\.(test|spec)\.(ts|tsx|mjs|cjs)$/.test(d))
      .filter((d) => d !== "lib/hoa-hong/feature.ts" && d !== "lib/settings/registry.ts" && d !== "lib/settings/nhan-van-hanh.ts")
      .filter((d) => existsSync(resolve(process.cwd(), d)));
    expect(ra.length, "phép quét không đọc được tệp nào").toBeGreaterThan(200);
    const viPham = ra.filter((d) => bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8")).includes(KHOA_XUAT_LUONG));
    expect(viPham, `Đọc cờ ngoài lib/hoa-hong/feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });
});
