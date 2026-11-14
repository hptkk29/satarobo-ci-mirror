// @vitest-environment jsdom
// Giao diện Cổng phụ huynh/học sinh — lõi THUẦN: contrast guard + đọc/ghi localStorage.
// Dữ liệu trong localStorage do client ghi nên KHÔNG được tin: phải narrow trước khi dùng.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_PRESETS,
  accentContrast,
  accentCssVars,
  accentsEqual,
  contrastRatio,
  defaultAppearance,
  INK_DARK,
  INK_LIGHT,
  inkOn,
  isValidHex,
  loadAppearance,
  needsDarkInk,
  normalizeHex,
  relLuminance,
  resolveDark,
  ROLE_DEFAULT_ACCENT,
  saveAppearance,
  softTint,
  WCAG_AA,
} from "@/lib/portal/appearance";

const STORAGE_KEY = "sata-portal-appearance";
const LEGACY_THEME_KEY = "portal-theme";

// tests/setup.ts cắm sẵn localStorage no-op (getItem luôn null) cho jsdom, nên phải
// stub một bản in-memory thật — cùng cách lib/cookie-consent.test.ts đang làm.
const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
});

describe("contrast guard", () => {
  it("contrastRatio khớp WCAG: trắng/đen = 21:1, cùng màu = 1:1", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#610C8D", "#610C8D")).toBeCloseTo(1, 5);
  });

  it("chọn mực cho tương phản CAO HƠN, không dùng ngưỡng luminance", () => {
    expect(inkOn("#FFFFFF")).toBe(INK_DARK);
    expect(inkOn("#FFFF00")).toBe(INK_DARK);
    expect(inkOn("#000000")).toBe(INK_LIGHT);
    expect(inkOn("#610C8D")).toBe(INK_LIGHT);
  });

  it("cam #FD8F2D phải dùng mực TỐI — ngưỡng 0.42 cũ chọn sai (2.3:1, trượt AA)", () => {
    // Đây là ca bug: luminance 0.407 lọt dưới 0.42 nên bản cũ trả chữ trắng.
    expect(relLuminance("#FD8F2D")).toBeGreaterThan(0.4);
    expect(relLuminance("#FD8F2D")).toBeLessThan(0.42);
    expect(contrastRatio("#FD8F2D", INK_LIGHT)).toBeLessThan(WCAG_AA);
    expect(inkOn("#FD8F2D")).toBe(INK_DARK);
    expect(accentContrast("#FD8F2D")).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it("cả hai màu mặc định đều đạt WCAG AA sau khi chọn mực", () => {
    expect(ROLE_DEFAULT_ACCENT.parent).toBe("#610C8D");
    expect(ROLE_DEFAULT_ACCENT.student).toBe("#FD8F2D");
    // Khớp `--accent-foreground` cứng trong globals.css cho lần paint đầu.
    expect(inkOn(ROLE_DEFAULT_ACCENT.parent)).toBe(INK_LIGHT);
    expect(inkOn(ROLE_DEFAULT_ACCENT.student)).toBe(INK_DARK);
    expect(accentContrast(ROLE_DEFAULT_ACCENT.parent)).toBeGreaterThanOrEqual(WCAG_AA);
    expect(accentContrast(ROLE_DEFAULT_ACCENT.student)).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it("mọi preset gợi ý đều đạt WCAG AA", () => {
    for (const preset of ACCENT_PRESETS) {
      expect(accentContrast(preset.hex), `${preset.name} ${preset.hex}`).toBeGreaterThanOrEqual(
        WCAG_AA,
      );
    }
  });

  it("màu xám giữa dải → không mực nào đạt AA ⇒ UI phải cảnh báo", () => {
    expect(needsDarkInk("#808080")).toBe(true);
    expect(accentContrast("#808080")).toBeLessThan(WCAG_AA);
  });

  it("HEX hỏng → luminance 0 (coi như màu tối), không ném lỗi", () => {
    expect(relLuminance("#GGG")).toBe(0);
    expect(relLuminance("")).toBe(0);
    expect(inkOn("nonsense")).toBe(INK_LIGHT);
  });
});

describe("chuẩn hoá HEX", () => {
  it("isValidHex chấp nhận 6 ký tự, có hoặc không có #", () => {
    expect(isValidHex("#F5788B")).toBe(true);
    expect(isValidHex("f5788b")).toBe(true);
    expect(isValidHex("#FFF")).toBe(false);
    expect(isValidHex("#GGGGGG")).toBe(false);
  });

  it("normalizeHex thêm # và viết hoa", () => {
    expect(normalizeHex("f5788b")).toBe("#F5788B");
    expect(normalizeHex("#f5788b")).toBe("#F5788B");
  });
});

describe("softTint", () => {
  it("trả rgba (đọc được ở cả nền sáng lẫn tối)", () => {
    expect(softTint("#FF0000")).toBe("rgba(255, 0, 0, 0.12)");
    expect(softTint("#FF0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("HEX hỏng → tint đen trung tính thay vì NaN", () => {
    expect(softTint("oops")).toBe("rgba(0, 0, 0, 0.12)");
  });
});

describe("accentCssVars", () => {
  it("gán màu nhấn cho cả --primary lẫn --accent, kèm màu chữ tương phản", () => {
    const vars = accentCssVars("#000000") as unknown as Record<string, string>;
    expect(vars["--primary"]).toBe("#000000");
    expect(vars["--accent"]).toBe("#000000");
    expect(vars["--ring"]).toBe("#000000");
    expect(vars["--primary-foreground"]).toBe("#FFFFFF");
    expect(vars["--accent-foreground"]).toBe("#FFFFFF");
    expect(vars["--accent-soft"]).toBe("rgba(0, 0, 0, 0.12)");
  });
});

describe("resolveDark", () => {
  it("light/dark bỏ qua hệ thống; system bám prefers-color-scheme", () => {
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });
});

describe("accentsEqual", () => {
  it("so sánh theo từng vai trò", () => {
    expect(accentsEqual({ parent: "#A", student: "#B" }, { parent: "#A", student: "#B" })).toBe(true);
    expect(accentsEqual({ parent: "#A", student: "#B" }, { parent: "#A", student: "#C" })).toBe(false);
  });
});

describe("loadAppearance", () => {
  it("chưa có gì → mặc định light + màu mặc định theo vai trò", () => {
    expect(loadAppearance()).toEqual(defaultAppearance());
    expect(loadAppearance().theme).toBe("light");
  });

  it("đọc lại đúng thứ đã lưu", () => {
    const state = { theme: "dark", accents: { parent: "#123456", student: "#ABCDEF" } } as const;
    saveAppearance(state);
    expect(loadAppearance()).toEqual(state);
  });

  it("migrate key `portal-theme` của shell v2 cũ", () => {
    window.localStorage.setItem(LEGACY_THEME_KEY, "dark");
    expect(loadAppearance()).toEqual({ ...defaultAppearance(), theme: "dark" });
  });

  it("key mới thắng key legacy", () => {
    window.localStorage.setItem(LEGACY_THEME_KEY, "dark");
    saveAppearance({ theme: "light", accents: { ...ROLE_DEFAULT_ACCENT } });
    expect(loadAppearance().theme).toBe("light");
  });

  it("JSON hỏng → mặc định, không ném lỗi", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadAppearance()).toEqual(defaultAppearance());
  });

  it("bỏ qua theme lạ và HEX hỏng, giữ phần hợp lệ", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ theme: "neon", accents: { parent: "xxx", student: "#abcdef" } }),
    );
    const loaded = loadAppearance();
    expect(loaded.theme).toBe("light");
    expect(loaded.accents.parent).toBe(ROLE_DEFAULT_ACCENT.parent);
    expect(loaded.accents.student).toBe("#ABCDEF");
  });

  it("accents không phải object → mặc định", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "dark", accents: "nope" }));
    expect(loadAppearance()).toEqual({ ...defaultAppearance(), theme: "dark" });
  });
});

describe("saveAppearance — không đóng đinh màu mặc định", () => {
  it("chỉ bật Tối (chưa đổi màu) → không ghi accent nào", () => {
    saveAppearance({ theme: "dark", accents: { ...ROLE_DEFAULT_ACCENT } });
    expect(JSON.parse(store[STORAGE_KEY]).accents).toEqual({});
  });

  it("người chưa đổi màu vẫn nhận mặc định MỚI khi ta đổi mặc định", () => {
    // Mô phỏng: đã lưu (chỉ theme), sau đó mặc định đổi → load phải trả mặc định
    // hiện hành chứ không phải màu cũ đã đóng băng.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: "dark", accents: {} }));
    expect(loadAppearance().accents).toEqual(ROLE_DEFAULT_ACCENT);
  });

  it("chỉ ghi vai trò có màu khác mặc định", () => {
    saveAppearance({
      theme: "light",
      accents: { parent: "#123456", student: ROLE_DEFAULT_ACCENT.student },
    });
    expect(JSON.parse(store[STORAGE_KEY]).accents).toEqual({ parent: "#123456" });
    expect(loadAppearance().accents).toEqual({
      parent: "#123456",
      student: ROLE_DEFAULT_ACCENT.student,
    });
  });
});
