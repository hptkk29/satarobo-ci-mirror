import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { gocCongKhai } from "./goc-cong-khai";

const req = (host = "evil.example") => new Request(`https://${host}/api/mobile/v1/x`);

describe("[SEC10] gốc URL công khai — không suy từ header Host ở production", () => {
  it("[SEC10-01] biến cấu hình hợp lệ THẮNG: MOBILE_API_PUBLIC_BASE trước NEXT_PUBLIC_APP_URL; Host giả không ảnh hưởng", () => {
    expect(gocCongKhai(req(), { NODE_ENV: "production", MOBILE_API_PUBLIC_BASE: "https://api.satarobo.vn", NEXT_PUBLIC_APP_URL: "https://x.vn" })).toBe("https://api.satarobo.vn");
    expect(gocCongKhai(req(), { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: " https://test.satarobo.vn " })).toBe("https://test.satarobo.vn");
    expect(gocCongKhai(req("attacker.test"), { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://test.satarobo.vn" })).not.toContain("attacker");
  });

  it("[SEC10-02] production thiếu CẢ HAI biến (hoặc biến sai dạng / không phải http(s)) ⇒ 503 SERVER — KHÔNG rơi về Host của yêu cầu", () => {
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", MOBILE_API_PUBLIC_BASE: "   " }, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "javascript:alert(1)" }, { NODE_ENV: "production", MOBILE_API_PUBLIC_BASE: "khong-phai-url" }]) {
      expect(() => gocCongKhai(req(), env), JSON.stringify(env)).toThrowError(expect.objectContaining({ code: "SERVER", status: 503 }) as never);
    }
  });

  it("[SEC10-03] ngoài production (dev/test cục bộ không có biến) mới rơi về gốc của yêu cầu", () => {
    expect(gocCongKhai(req("localhost:3223"), { NODE_ENV: "development" })).toBe("https://localhost:3223");
    expect(gocCongKhai(req("localhost:3223"), {})).toBe("https://localhost:3223");
  });

  it("[SEC10-W1] lưới ghim mã: KHÔNG route/dịch vụ di động nào tự suy gốc từ `new URL(req.url).origin` (mọi URL tuyệt đối đi qua `gocCongKhai`)", () => {
    const quet = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? quet(p) : /\.tsx?$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
      });
    const viPham = [...quet(join(process.cwd(), "app/api/mobile")), ...quet(join(process.cwd(), "lib/mobile-api"))].filter((f) => {
      const ma = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      return /new URL\(\s*req(uest)?\.url\s*\)\.origin|req(uest)?\.nextUrl\.origin/.test(ma) && !f.endsWith("goc-cong-khai.ts");
    });
    expect(viPham).toEqual([]);
  });
});
