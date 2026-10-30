// @vitest-environment node
/**
 * [NIC] Lưới chặn TÁI PHÁT cho đường tối ưu ảnh `/_next/image` — issue #1067 (GHSA-2xp9-vwfh-vxw4, GHSA-2464-fhr4-w9xw, GHSA-wq5f-xc86-pv6w).
 *
 * Đường `/_next/image` KHÔNG qua đăng nhập (`proxy.ts` loại nó khỏi matcher; Caddy dồn mọi host vào một container). Nó chỉ an toàn khi hai điều cùng đúng:
 *   (1) mọi host trong `images.remotePatterns` là host DO MÌNH KIỂM SOÁT (không wildcard trên hạ tầng lưu trữ dùng chung như `*.r2.cloudflarestorage.com` — khớp bucket của BẤT KỲ ai);
 *   (2) `next` và `sharp` thực tế được cài đã ở bản vá (next ≥ 16.4.1, sharp ≥ 0.35.5, và KHÔNG còn bản sharp cũ nào cùng tồn tại trong lockfile).
 * Test đọc `next.config.ts`, `package.json`, `pnpm-lock.yaml` (cả ba có trên gương CI). Cấy lỗi: thêm lại wildcard ⇒ đỏ [NIC-01]; hạ `next` ⇒ đỏ [NIC-02]; lockfile còn sharp 0.34.x ⇒ đỏ [NIC-03].
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (tep: string) => readFileSync(resolve(process.cwd(), tep), "utf8").split("\r\n").join("\n");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
/** So sánh semver chỉ xét ba số đầu. */
const soSanh = (a: string, b: string) => {
  const x = a.split(/[.-]/).slice(0, 3).map(Number);
  const y = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

describe("[NIC-01] images.remotePatterns: chỉ host do mình kiểm soát, không wildcard", () => {
  const cfg = boChuThich(doc("next.config.ts"));
  const khoi = cfg.slice(cfg.indexOf("remotePatterns"), cfg.indexOf("]", cfg.indexOf("remotePatterns")) + 1);
  const hosts = [...khoi.matchAll(/hostname:\s*"([^"]+)"/g)].map((m) => m[1]!);

  it("chống rỗng: đọc được các host đã khai (ít nhất cdn.satarobo.vn)", () => {
    expect(hosts).toContain("cdn.satarobo.vn");
    expect(hosts.length).toBeGreaterThanOrEqual(3);
  });

  it("KHÔNG host nào chứa ký tự đại diện (`*`) — wildcard trên lưu trữ dùng chung cho kẻ ngoài chọn byte đầu vào", () => {
    expect(hosts.filter((h) => h.includes("*")), `wildcard trong remotePatterns: ${hosts.join(", ")}`).toEqual([]);
  });

  it("KHÔNG host nào là hạ tầng lưu trữ dùng chung (r2.cloudflarestorage.com, amazonaws.com, blob.core.windows.net, storage.googleapis.com…)", () => {
    const cam = /(cloudflarestorage\.com|amazonaws\.com|blob\.core\.windows\.net|storage\.googleapis\.com|digitaloceanspaces\.com|backblazeb2\.com)$/i;
    expect(hosts.filter((h) => cam.test(h))).toEqual([]);
  });

  it("danh sách host hiện hành là ĐÚNG tập đã duyệt (thêm host mới phải đi qua đây có chủ đích)", () => {
    expect([...hosts].sort()).toEqual(["cdn.satarobo.vn", "images.unsplash.com", "img.youtube.com"]);
  });
});

describe("[NIC-02] phiên bản next đã vá", () => {
  const pkg = JSON.parse(doc("package.json")) as { dependencies: Record<string, string> };

  it("package.json: next >= 16.4.1 (đóng GHSA-2xp9/2464/673q/p3m5…); ghim chính xác, không dải", () => {
    const v = pkg.dependencies.next!;
    expect(v, "ghim chính xác để bản cài không trôi").toMatch(/^\d+\.\d+\.\d+$/);
    expect(soSanh(v, "16.4.1"), `next ${v} < 16.4.1`).toBeGreaterThanOrEqual(0);
  });

  it("lockfile: chỉ MỘT bản next được giải, và >= 16.4.1", () => {
    const lock = doc("pnpm-lock.yaml");
    const bans = [...new Set([...lock.matchAll(/^ {2}next@(\d+\.\d+\.\d+)(?:\(|:)/gm)].map((m) => m[1]!))];
    expect(bans.length, `bản next trong lockfile: ${bans.join(", ")}`).toBe(1);
    expect(soSanh(bans[0]!, "16.4.1")).toBeGreaterThanOrEqual(0);
  });
});

describe("[NIC-03] sharp trong lockfile: chỉ bản vá (>= 0.35.5), không bản cũ cùng tồn tại", () => {
  const lock = doc("pnpm-lock.yaml");
  it("mọi `sharp@x` và `@img/sharp-*@x` đều >= 0.35.5; không còn 0.34.x", () => {
    const sharp = [...new Set([...lock.matchAll(/^ {2}sharp@(\d+\.\d+\.\d+)/gm)].map((m) => m[1]!))];
    const nhiPhan = [...new Set([...lock.matchAll(/^ {2}'@img\/sharp-(?!libvips)[a-z0-9-]+@(\d+\.\d+\.\d+)'/gm)].map((m) => m[1]!))];
    expect(sharp.length, "phải gặp sharp trong lockfile (chống rỗng)").toBeGreaterThan(0);
    expect(nhiPhan.length, "phải gặp nhị phân @img/sharp-* (chống rỗng)").toBeGreaterThan(0);
    for (const v of [...sharp, ...nhiPhan]) expect(soSanh(v, "0.35.5"), `sharp ${v} < 0.35.5`).toBeGreaterThanOrEqual(0);
    expect(sharp.length, `nhiều bản sharp cùng tồn tại: ${sharp.join(", ")}`).toBe(1);
  });
});
