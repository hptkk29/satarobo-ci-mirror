// [NHH-FLG-*] — CỜ module "Nguồn lead": khai trong registry setting (DB), đọc ở ĐÚNG MỘT hàm.
// Đặc tả: docs/source-commission/05 §2.1–§2.3 (tên cờ chốt 08/10/2026: `nguon.enabled` THAY
// `nguon.quanLyNguonBat`). Khuôn: lib/finance/hoa-don/feature.test.ts (`[HDF-*]`).
//
// Test viết TRƯỚC hiện thực (luật cứng Nền hệ thống #5) — commit đầu là ĐỎ.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({
  gia: new Map<string, unknown>(),
  goi: [] as { key: string; orgUnitId: string | null }[],
}));
vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string, opts?: { orgUnitId?: string | null }) => {
    h.goi.push({ key, orgUnitId: opts?.orgUnitId ?? null });
    if (!h.gia.has(key)) throw new Error(`test chưa đặt giá trị cho ${key}`);
    return h.gia.get(key);
  }),
}));

import { SETTINGS } from "@/lib/settings/registry";
import { NHAN_VAN_HANH } from "@/lib/settings/nhan-van-hanh";
import {
  KHOA_NGUON,
  hopCoNguon,
  coConMoCoi,
  cachXuLyNhanLa,
  laQuanLyNguonBat,
  laTuDongGanNguonBat,
  laPageMappingBat,
  laReferralBat,
  laManualReviewBat,
  laEpChonNguon,
  layCoNguonHieuLuc,
  layCuaSoGhiCongNgay,
  layNhomNhanSuMacDinh,
  layBangNguonTheoPage,
  type CoNguonTho,
} from "./feature";

const TAT_CA_TAT: CoNguonTho = {
  enabled: false,
  autoAttribution: false,
  pageMapping: false,
  referral: false,
  manualReview: false,
};

beforeEach(() => {
  h.gia.clear();
  h.goi.length = 0;
});

describe("[NHH-FLG-01] khai báo trong registry", () => {
  it("tên khoá đúng chốt 08/10 — `nguon.enabled`, KHÔNG phải `nguon.quanLyNguonBat`", () => {
    expect(KHOA_NGUON.enabled).toBe("nguon.enabled");
    expect(Object.keys(SETTINGS)).not.toContain("nguon.quanLyNguonBat");
    expect(Object.values(KHOA_NGUON).sort()).toEqual(
      [
        "nguon.enabled",
        "nguon.autoAttribution",
        "nguon.pageMapping",
        "nguon.referral",
        "nguon.manualReview",
        "nguon.epChonNguon",
        "nguon.cuaSoGhiCongNgay",
        "nguon.bangNguonTheoPage",
        "nguon.nhomNhanSuMacDinh",
      ].sort(),
    );
  });

  it("năm cờ bật/tắt: boolean thật, mặc định TẮT, KHÔNG cho cơ sở lệch (dữ liệu attribution phải đủ 100%)", () => {
    // Một mặc định `true` lọt vào đây là bật ghi attribution cho TOÀN prod ngay lần deploy kế tiếp.
    for (const k of [
      KHOA_NGUON.enabled,
      KHOA_NGUON.autoAttribution,
      KHOA_NGUON.pageMapping,
      KHOA_NGUON.referral,
      KHOA_NGUON.manualReview,
    ]) {
      const d = SETTINGS[k];
      expect(d.default, k).toBe(false);
      expect(d.centerOverridable, k).toBe(false);
      expect(d.schema.safeParse(true).success, k).toBe(true);
      expect(d.schema.safeParse("true").success, `${k} phải boolean thật, không phải chuỗi`).toBe(false);
    }
  });

  it("`nguon.epChonNguon`: TẮT mặc định, cơ sở lệch được, QLCS KHÔNG tự bật/gỡ (khai tường minh `false`)", () => {
    const d = SETTINGS[KHOA_NGUON.epChonNguon];
    expect(d.default).toBe(false);
    expect(d.centerOverridable).toBe(true);
    // Tường minh `=== false`, không phải "vắng mặt": vắng mặt cũng là false hôm nay, nhưng chỉ khai
    // tường minh mới ghim được chủ ý "QLCS không tự gỡ cổng của chính mình" ([NHH-SEC-11]).
    expect((d as { qlcsSuaDuoc?: boolean }).qlcsSuaDuoc).toBe(false);
    expect(d.schema.safeParse("true").success).toBe(false);
  });

  it("`nguon.cuaSoGhiCongNgay`: số NGUYÊN, mặc định 90, nhỏ nhất 1", () => {
    const d = SETTINGS[KHOA_NGUON.cuaSoGhiCongNgay];
    expect(d.default).toBe(90);
    expect(d.centerOverridable).toBe(false);
    expect(d.schema.safeParse(90).success).toBe(true);
    expect(d.schema.safeParse(1).success).toBe(true);
    expect(d.schema.safeParse(0).success, "0 ngày = không ghi công được ai").toBe(false);
    expect(d.schema.safeParse(-5).success).toBe(false);
    expect(d.schema.safeParse(30.5).success, "ngày là số nguyên").toBe(false);
    expect(d.schema.safeParse("90").success).toBe(false);
  });

  it("[DYN-FLG-01] `nguon.nhomNhanSuMacDinh`: chuỗi mã nhóm KHÔNG rỗng, mặc định EMPLOYEE_REFERRAL, toàn hệ (không cơ sở lệch)", () => {
    const d = SETTINGS[KHOA_NGUON.nhomNhanSuMacDinh];
    expect(d.default).toBe("EMPLOYEE_REFERRAL");
    expect(d.centerOverridable).toBe(false);
    expect(d.schema.safeParse("TRUONG_HOC").success).toBe(true);
    expect(d.schema.safeParse("  ").success, "rỗng ⇒ không nhóm nào").toBe(false);
    expect(d.schema.safeParse("").success).toBe(false);
    expect(d.schema.safeParse(5).success).toBe(false);
    expect(NHAN_VAN_HANH[KHOA_NGUON.nhomNhanSuMacDinh].ten.length).toBeGreaterThan(0);
  });

  it("`nguon.bangNguonTheoPage`: map pageId → { groupCode, campaignCode? }, mặc định RỖNG {}", () => {
    const d = SETTINGS[KHOA_NGUON.bangNguonTheoPage];
    expect(d.default).toEqual({});
    expect(d.centerOverridable).toBe(false);
    expect(d.schema.safeParse({}).success).toBe(true);
    expect(d.schema.safeParse({ "1234": { groupCode: "FB_PAGE" } }).success).toBe(true);
    expect(
      d.schema.safeParse({ "1234": { groupCode: "FB_PAGE", campaignCode: "HE2026" } }).success,
    ).toBe(true);
    // Đối chứng âm: thiếu groupCode, groupCode rỗng, trường lạ, sai kiểu.
    expect(d.schema.safeParse({ "1234": {} }).success).toBe(false);
    expect(d.schema.safeParse({ "1234": { groupCode: "" } }).success).toBe(false);
    expect(d.schema.safeParse({ "1234": { groupCode: "X", sourceId: "abc" } }).success).toBe(false);
    expect(d.schema.safeParse({ "1234": "FB_PAGE" }).success).toBe(false);
    expect(d.schema.safeParse([]).success).toBe(false);
  });

  it("mọi khoá có nhãn vận hành; cờ master + cờ ép chọn đánh dấu CẨN THẬN", () => {
    for (const k of Object.values(KHOA_NGUON)) {
      const n = NHAN_VAN_HANH[k];
      expect(n, `thiếu nhãn ${k}`).toBeDefined();
      expect(n.ten.length).toBeGreaterThan(0);
    }
    for (const k of [KHOA_NGUON.enabled, KHOA_NGUON.epChonNguon]) {
      expect(NHAN_VAN_HANH[k].canThan, k).toBe(true);
    }
    expect(NHAN_VAN_HANH[KHOA_NGUON.cuaSoGhiCongNgay].donVi).toBe("ngày");
  });
});

describe("[NHH-FLG-02] tổ hợp cờ — cờ con chỉ có nghĩa khi master bật (hàm thuần)", () => {
  const BON_CON = ["autoAttribution", "pageMapping", "referral", "manualReview"] as const;

  it("master TẮT ⇒ MỌI cờ con hiệu lực = false, dù DB để true", () => {
    const tho: CoNguonTho = { ...TAT_CA_TAT, autoAttribution: true, pageMapping: true, referral: true, manualReview: true };
    expect(hopCoNguon(tho)).toEqual(TAT_CA_TAT);
  });

  it("master BẬT ⇒ cờ con giữ nguyên giá trị của nó (từng cờ một, không kéo theo nhau)", () => {
    for (const con of BON_CON) {
      const tho: CoNguonTho = { ...TAT_CA_TAT, enabled: true, [con]: true };
      const ra = hopCoNguon(tho);
      expect(ra.enabled).toBe(true);
      for (const khac of BON_CON) expect(ra[khac], `${con} bật ⇒ ${khac}`).toBe(khac === con);
    }
  });

  it("master BẬT, mọi con TẮT ⇒ chỉ master hiệu lực (ghi attribution thủ công, không tự quy nguồn)", () => {
    expect(hopCoNguon({ ...TAT_CA_TAT, enabled: true })).toEqual({ ...TAT_CA_TAT, enabled: true });
  });

  it("hàm thuần: không đổi đầu vào", () => {
    const tho: CoNguonTho = { ...TAT_CA_TAT, autoAttribution: true };
    const truoc = JSON.stringify(tho);
    hopCoNguon(tho);
    expect(JSON.stringify(tho)).toBe(truoc);
  });

  it("`coConMoCoi` — liệt kê cờ con ĐANG BẬT mà master tắt (để cảnh báo người vận hành, không để lặng lẽ vô hiệu)", () => {
    expect(coConMoCoi({ ...TAT_CA_TAT, referral: true, manualReview: true }).sort()).toEqual(
      ["manualReview", "referral"],
    );
    // Master bật ⇒ không có cờ nào mồ côi; master tắt + con tắt ⇒ không có gì để cảnh báo.
    expect(coConMoCoi({ ...TAT_CA_TAT, enabled: true, referral: true })).toEqual([]);
    expect(coConMoCoi(TAT_CA_TAT)).toEqual([]);
  });
});

describe("[NHH-FLG-03] tổ hợp cờ × nhãn lạ (05 §2.2b) — `cachXuLyNhanLa`", () => {
  it("master TẮT ⇒ không ghi nguồn, bất kể ép chọn (ép chọn vô nghĩa khi master tắt)", () => {
    expect(cachXuLyNhanLa({ nguonBat: false, epChonNguon: false })).toBe("KHONG_GHI_NGUON");
    expect(cachXuLyNhanLa({ nguonBat: false, epChonNguon: true })).toBe("KHONG_GHI_NGUON");
  });
  it("master BẬT + ép chọn TẮT ⇒ nhãn lạ thành UNKNOWN kèm cờ xem tay, KHÔNG chặn", () => {
    expect(cachXuLyNhanLa({ nguonBat: true, epChonNguon: false })).toBe("UNKNOWN_XEM_TAY");
  });
  it("master BẬT + ép chọn BẬT ⇒ CHẶN nhập nhãn lạ", () => {
    expect(cachXuLyNhanLa({ nguonBat: true, epChonNguon: true })).toBe("CHAN_NHAP");
  });
});

describe("[NHH-FLG-04] đọc cờ — qua getSetting, MỘT chỗ", () => {
  const datTatCa = (v: Partial<Record<string, unknown>>) => {
    for (const k of Object.values(KHOA_NGUON)) h.gia.set(k, SETTINGS[k].default);
    for (const [k, x] of Object.entries(v)) h.gia.set(k, x);
  };

  it("`laQuanLyNguonBat` đọc `nguon.enabled`", async () => {
    datTatCa({ "nguon.enabled": true });
    expect(await laQuanLyNguonBat()).toBe(true);
    datTatCa({ "nguon.enabled": false });
    expect(await laQuanLyNguonBat()).toBe(false);
  });

  it("cờ con = master ∧ con — master TẮT thì cờ con true vẫn trả false (đối chứng âm), bật cả hai thì true (đối chứng dương)", async () => {
    const ca = [
      ["nguon.autoAttribution", laTuDongGanNguonBat],
      ["nguon.pageMapping", laPageMappingBat],
      ["nguon.referral", laReferralBat],
      ["nguon.manualReview", laManualReviewBat],
    ] as const;
    for (const [khoa, ham] of ca) {
      datTatCa({ "nguon.enabled": false, [khoa]: true });
      expect(await ham(), `${khoa}: master tắt`).toBe(false);
      datTatCa({ "nguon.enabled": true, [khoa]: true });
      expect(await ham(), `${khoa}: cả hai bật`).toBe(true);
      datTatCa({ "nguon.enabled": true, [khoa]: false });
      expect(await ham(), `${khoa}: chỉ master bật`).toBe(false);
    }
  });

  it("`layCoNguonHieuLuc` trả đúng kết quả của `hopCoNguon` trên giá trị DB", async () => {
    datTatCa({ "nguon.enabled": true, "nguon.referral": true, "nguon.pageMapping": true });
    expect(await layCoNguonHieuLuc()).toEqual({
      enabled: true,
      autoAttribution: false,
      pageMapping: true,
      referral: true,
      manualReview: false,
    });
  });

  it("`laEpChonNguon(orgUnitId)` truyền orgUnitId cho ĐÚNG khoá ép chọn; master đọc ở mức toàn hệ", async () => {
    datTatCa({ "nguon.enabled": true, "nguon.epChonNguon": true });
    expect(await laEpChonNguon("ou-cs1")).toBe(true);
    const epChon = h.goi.filter((g) => g.key === "nguon.epChonNguon");
    expect(epChon).toEqual([{ key: "nguon.epChonNguon", orgUnitId: "ou-cs1" }]);
    const master = h.goi.filter((g) => g.key === "nguon.enabled");
    expect(master.every((g) => g.orgUnitId === null), "master chỉ có mức toàn hệ").toBe(true);
  });

  it("`laEpChonNguon`: master TẮT ⇒ false dù cơ sở khai ép chọn; `null` ⇒ chỉ giá trị toàn hệ", async () => {
    datTatCa({ "nguon.enabled": false, "nguon.epChonNguon": true });
    expect(await laEpChonNguon("ou-cs1")).toBe(false);
    datTatCa({ "nguon.enabled": true, "nguon.epChonNguon": true });
    expect(await laEpChonNguon(null)).toBe(true);
    expect(h.goi.at(-1)).toEqual({ key: "nguon.epChonNguon", orgUnitId: null });
  });

  it("[DYN-FLG-02] `layNhomNhanSuMacDinh` trả đúng giá trị DB (đổi cấu hình ⇒ đổi nhóm đích, không sửa mã)", async () => {
    datTatCa({ "nguon.nhomNhanSuMacDinh": "TRUONG_HOC" });
    expect(await layNhomNhanSuMacDinh()).toBe("TRUONG_HOC");
    datTatCa({ "nguon.nhomNhanSuMacDinh": "EMPLOYEE_REFERRAL" });
    expect(await layNhomNhanSuMacDinh()).toBe("EMPLOYEE_REFERRAL");
  });

  it("`layCuaSoGhiCongNgay` + `layBangNguonTheoPage` trả đúng giá trị DB", async () => {
    datTatCa({ "nguon.cuaSoGhiCongNgay": 45, "nguon.bangNguonTheoPage": { "99": { groupCode: "FB_PAGE" } } });
    expect(await layCuaSoGhiCongNgay()).toBe(45);
    expect(await layBangNguonTheoPage()).toEqual({ "99": { groupCode: "FB_PAGE" } });
  });
});

describe("[NHH-FLG-05] LƯỚI: không ai đọc khoá `nguon.*` ngoài `lib/nguon/feature.ts`", () => {
  const TRAN_QUET_MS = 30_000;
  function bocChuThich(v: string): string {
    return v
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((d) => d.replace(/\/\/[^\n]*$/, ""))
      .join("\n");
  }
  // `git ls-files` chứ không `readdirSync` — lý do ở `[FEAT-03]`: cây tệp sống có tệp tạm thoáng qua.
  function quetMa(): { duong: string; noiDung: string }[] {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app", "components", "scripts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split(/\r?\n/)
      .filter((d) => /\.(ts|tsx|mjs|cjs)$/.test(d))
      .filter((d) => !/\.(test|spec)\.(ts|tsx|mjs|cjs)$/.test(d))
      .filter((d) => d !== "lib/nguon/feature.ts")
      .filter((d) => d !== "lib/nguon/khoa-setting.ts") // lá chứa chính các khoá (feature.ts xuất lại) — gỡ vòng settings ↔ nguon
      .filter((d) => d !== "lib/settings/registry.ts") // nơi KHAI khoá
      .filter((d) => d !== "lib/settings/nhan-van-hanh.ts") // nhãn cho người vận hành
      .filter((d) => existsSync(resolve(process.cwd(), d)))
      .map((d) => ({ duong: d, noiDung: bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8")) }));
    expect(ra.length, "phép quét không đọc được tệp nào — `git ls-files` hỏng?").toBeGreaterThan(200);
    return ra;
  }

  it("0 tệp nào khác nhắc chuỗi khoá `nguon.<cờ>`", { timeout: TRAN_QUET_MS }, () => {
    const khoa = Object.values(KHOA_NGUON);
    const viPham = quetMa()
      .filter((f) => khoa.some((k) => f.noiDung.includes(`"${k}"`) || f.noiDung.includes(`'${k}'`)))
      .map((f) => f.duong);
    expect(viPham, `Đọc cờ ngoài lib/nguon/feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });

  it("phép bóc chú thích THẬT SỰ bóc — và đường gọi thật thì KHÔNG bị bóc", () => {
    expect(bocChuThich(`// "nguon.enabled" chỉ là chú thích\r\nconst x = 1;`)).not.toContain("nguon.enabled");
    expect(bocChuThich(`getSetting("nguon.enabled")`)).toContain("nguon.enabled");
  });
});
