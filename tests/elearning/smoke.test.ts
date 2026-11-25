/**
 * EL-07 · AC4 + AC6 — smoke của hạ tầng test module đào tạo nội bộ.
 *
 * Bài test này tồn tại để chứng minh MỘT điều: `tests/elearning/**` thật sự ĐƯỢC CHẠY.
 * `vitest.config.ts` khai `include` là bộ lọc CỨNG — không khai thư mục này ở đó thì
 * `vitest run tests/elearning` báo "No test files found" và job CI vẫn XANH dù test
 * viết đúng. Đó là kiểu hỏng câm nguy hiểm nhất: tưởng có lưới an toàn mà không có.
 */
import { describe, expect, it, afterEach } from "vitest";
import { isElearningEnabled } from "@/lib/flags";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("[EL-07] hạ tầng test module e-learning", () => {
  it("thư mục tests/elearning được vitest nhận (AC4)", () => {
    expect(true).toBe(true);
  });
});

describe("[EL-07-T7-05] cờ ELEARNING_ENABLED — chỉ đúng chuỗi 'true' mới bật (AC6)", () => {
  const goc = process.env.ELEARNING_ENABLED;
  afterEach(() => {
    if (goc === undefined) delete process.env.ELEARNING_ENABLED;
    else process.env.ELEARNING_ENABLED = goc;
  });

  it("chưa khai → OFF", () => {
    delete process.env.ELEARNING_ENABLED;
    expect(isElearningEnabled()).toBe(false);
  });

  it.each(["1", "TRUE", "True", "yes", "on", "false", ""])(
    "giá trị %j → OFF (không nhận biến thể)",
    (v) => {
      process.env.ELEARNING_ENABLED = v;
      expect(isElearningEnabled()).toBe(false);
    },
  );

  it("đúng chuỗi 'true' → ON", () => {
    process.env.ELEARNING_ENABLED = "true";
    expect(isElearningEnabled()).toBe(true);
  });
});

describe("EL-01 · khu nội bộ phải noindex — guard trên mã nguồn", () => {
  const LAYOUT = join(process.cwd(), "app/(elearning)/elearning/layout.tsx");

  it("layout khai metadata.robots index:false", () => {
    const src = readFileSync(LAYOUT, "utf8");
    expect(src).toMatch(/robots:\s*\{[^}]*index:\s*false/);
  });

  it("proxy.ts KHÔNG phải nơi duy nhất giữ noindex cho khu này", () => {
    // Vì sao guard này tồn tại: header `X-Robots-Tag` chỉ được gắn ở BRANCH 2 của
    // `proxy.ts`, tức chỉ khi request tới bằng ĐÚNG host thật. Mọi đường khác —
    // localhost, preview, ai đó thêm rewrite mới — không có header đó. Nếu noindex
    // chỉ sống ở middleware thì khu nội bộ hở ra ở mọi đường còn lại mà không có
    // dấu hiệu nào. `metadata` ở layout đi theo route, không theo host.
    const src = readFileSync(LAYOUT, "utf8");
    expect(src).toContain("metadata");
    expect(src).toContain("follow: false");
  });
});
