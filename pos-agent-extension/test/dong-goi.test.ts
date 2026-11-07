/**
 * Script đóng gói: biên dịch `src/**` ⇒ JS cho Chrome (content script phải là SCRIPT CỔ ĐIỂN —
 * Chrome không nạp content script dạng module), viết manifest theo môi trường, nén `.zip`
 * để cài bằng "Load unpacked". Kiểm trên thư mục tạm, không ghi vào repo.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import JSZip from "jszip";
import { dongGoi } from "../scripts/dong-goi";
import { dungManifest } from "../src/manifest";
import { PHIEN_BAN } from "../src/lib/hang-so";

const TAM = mkdtempSync(join(tmpdir(), "pos-agent-dong-goi-"));
afterAll(() => rmSync(TAM, { recursive: true, force: true }));

function cacImport(ma: string): string[] {
  const ra: string[] = [];
  for (const m of ma.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g)) ra.push(m[1]);
  for (const m of ma.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) ra.push(m[1]);
  for (const m of ma.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) ra.push(m[1]);
  return ra;
}

describe("Đóng gói extension", () => {
  it("[EXT-DG-01] PROD + TEST: đủ tệp, manifest đúng môi trường, không lọt .ts / test / script", async () => {
    for (const moiTruong of ["PROD", "TEST"] as const) {
      const kq = await dongGoi({ moiTruong, thuMucRa: TAM });
      expect(kq.tepZip.endsWith(`satarobo-pos-agent-${PHIEN_BAN}-${moiTruong.toLowerCase()}.zip`)).toBe(true);
      for (const tep of ["manifest.json", "background.js", "content-main.js", "content-isolated.js", "options.html", "options.js", "options.css"]) {
        expect(kq.danhSach).toContain(tep);
      }
      expect(kq.danhSach.some((t) => t.endsWith(".ts") || t.includes("test") || t.startsWith("scripts/"))).toBe(false);
      const mf = JSON.parse(readFileSync(join(kq.thuMuc, "manifest.json"), "utf8"));
      expect(mf).toEqual(JSON.parse(JSON.stringify(dungManifest(moiTruong))));
    }
  });

  it("[EXT-DG-02] content script là SCRIPT CỔ ĐIỂN (không import/export) — biên dịch được bằng vm.Script", async () => {
    const kq = await dongGoi({ moiTruong: "PROD", thuMucRa: TAM });
    for (const tep of ["content-main.js", "content-isolated.js"]) {
      const ma = readFileSync(join(kq.thuMuc, tep), "utf8");
      expect(() => new vm.Script(ma, { filename: tep })).not.toThrow();
      expect(cacImport(ma)).toEqual([]);
      expect(ma).not.toMatch(/^\s*export\s/m);
    }
  });

  it("[EXT-DG-03] module (background, options, lib) chỉ import tệp CÓ trong gói, đường tương đối kết thúc .js, không thư viện Node", async () => {
    const kq = await dongGoi({ moiTruong: "PROD", thuMucRa: TAM });
    const moduleJs = kq.danhSach.filter((t) => t.endsWith(".js") && !t.startsWith("content-"));
    expect(moduleJs.length).toBeGreaterThan(5);
    for (const tep of moduleJs) {
      const ma = readFileSync(join(kq.thuMuc, tep), "utf8");
      for (const spec of cacImport(ma)) {
        expect(spec.startsWith("./") || spec.startsWith("../")).toBe(true);
        expect(spec.endsWith(".js")).toBe(true);
        const dich = posix.normalize(posix.join(posix.dirname(tep), spec));
        expect(kq.danhSach).toContain(dich);
        expect(existsSync(join(kq.thuMuc, dirname(tep), spec))).toBe(true);
      }
      expect(ma).not.toMatch(/\bnode:|\bprocess\.env\b|\brequire\(/);
    }
  });

  it("[EXT-DG-05] module trong gói NẠP ĐƯỢC bằng bộ nạp ESM thật của Node (không chỉ đúng cú pháp)", async () => {
    const kq = await dongGoi({ moiTruong: "PROD", thuMucRa: TAM });
    // Chrome coi service worker `type: module` + `<script type=module>` là ESM; Node cần được nói rõ
    // (không phụ thuộc cơ chế tự đoán cú pháp của từng phiên bản Node). Chỉ ghi vào bản tạm của test.
    writeFileSync(join(kq.thuMuc, "package.json"), '{"type":"module"}');
    // background.js đụng `chrome` ngay khi nạp ⇒ bỏ; mọi module còn lại thuần hoặc tự bỏ qua khi không có `chrome`.
    const moduleJs = kq.danhSach.filter((t) => t.endsWith(".js") && !t.startsWith("content-") && t !== "background.js");
    const ma = moduleJs.map((t) => `await import(${JSON.stringify(pathToFileURL(join(kq.thuMuc, t)).href)});`).join("\n");
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `${ma}\nconsole.log("NAP_DU");`], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe("NAP_DU");
    expect(r.status).toBe(0);
  });

  it("[EXT-DG-04] tệp .zip chứa ĐÚNG danh sách tệp của gói, manifest ở gốc", async () => {
    const kq = await dongGoi({ moiTruong: "TEST", thuMucRa: TAM });
    const zip = await JSZip.loadAsync(readFileSync(kq.tepZip));
    const trongZip = Object.keys(zip.files).filter((k) => !zip.files[k].dir).sort();
    expect(trongZip).toEqual([...kq.danhSach].sort());
    const mf = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(mf.host_permissions).toEqual(["https://merchant.techcombank.com/*", "https://test.satarobo.vn/*"]);
  });

  it("[EXT-DG-06] cùng mã nguồn ⇒ cùng tệp .zip (SHA-256 không đổi giữa hai lần nén) — so được bản chép sang máy agent", async () => {
    const a = await dongGoi({ moiTruong: "PROD", thuMucRa: join(TAM, "lan-1") });
    const b = await dongGoi({ moiTruong: "PROD", thuMucRa: join(TAM, "lan-2") });
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.sha256).toBe(a.sha256);
  });
});
