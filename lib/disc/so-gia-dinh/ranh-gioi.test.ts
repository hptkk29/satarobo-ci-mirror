import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * RANH GIỚI MÁY CHỦ / TRÌNH DUYỆT của sổ gia đình DISC — bổ sung cho [ENG-P09] (tests/disc-engine/parity.test.ts).
 *
 * Vì sao cần: [ENG-P09] chỉ soi chuỗi `engine-goc` NGAY TRONG file 'use client'. Một file client import `lib/disc/so-gia-dinh/ghi.ts`
 * (hoặc `ngan-hang/*`) thì không có chuỗi đó, nhưng kéo cả bộ câu hỏi CÓ KHOÁ CHẤM (trục, chiều đảo) vào bundle trình duyệt — im lặng, không test nào đỏ.
 * Lưới này đi theo import của file client và chỉ cho đi tới những module ĐÃ KIỂM là không chạm engine.
 */

const GOC = process.cwd();

function* duyet(thuMuc: string): Generator<string> {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten === ".next" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) yield* duyet(p);
    else if (/\.(ts|tsx)$/.test(ten)) yield p;
  }
}

const laClient = (nd: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(nd);
const rel = (f: string) => f.slice(GOC.length + 1).replace(/\\/g, "/");

/** Module của so-gia-dinh mà client ĐƯỢC import GIÁ TRỊ — mỗi cái phải sạch engine (kiểm ở ca [SG-RG-02]). */
const CLIENT_DUOC_LAY = new Set(["kieu", "vai", "chi-so", "dinh-tuyen-bai", "quyen", "han-lam-lai"]);

const IMPORT = /import\s+(type\s+)?([^;]*?)\s+from\s+["'](@\/lib\/disc\/[^"']+)["']/g;

describe("[SG-RG] khoá chấm không vào bundle trình duyệt", () => {
  const client: { f: string; nd: string }[] = [];
  for (const t of ["app", "components"]) {
    for (const f of duyet(join(GOC, t))) {
      if (/\.test\.tsx?$/.test(f)) continue;
      const nd = readFileSync(f, "utf8");
      if (laClient(nd)) client.push({ f: rel(f), nd });
    }
  }

  it("[SG-RG-01] bộ quét có thấy file client; file client chỉ import GIÁ TRỊ từ danh sách module sạch của so-gia-dinh, không bao giờ ngan-hang / engine-goc / ghi / doc", () => {
    expect(client.length).toBeGreaterThan(20);
    const vi: string[] = [];
    for (const { f, nd } of client) {
      for (const m of nd.matchAll(IMPORT)) {
        const [, laType, , dich] = m as unknown as [string, string | undefined, string, string];
        if (laType) continue; // import type: bị xoá khi biên dịch
        if (/^@\/lib\/disc\/(ngan-hang|engine-goc)(\/|$)/.test(dich)) vi.push(`${f} → ${dich}`);
        const t = /^@\/lib\/disc\/so-gia-dinh\/([^/]+)$/.exec(dich);
        if (t && !CLIENT_DUOC_LAY.has(t[1]!)) vi.push(`${f} → ${dich}`);
      }
    }
    expect(vi).toEqual([]);
  });

  it("[SG-RG-02] mỗi module client ĐƯỢC lấy đều sạch: không import engine-goc / ngan-hang / db / server-only (kể cả gián tiếp qua module khác của so-gia-dinh ngoài danh sách)", () => {
    for (const ten of CLIENT_DUOC_LAY) {
      const nd = readFileSync(join(GOC, "lib/disc/so-gia-dinh", `${ten}.ts`), "utf8");
      for (const m of nd.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
        const dich = m[1]!;
        expect(dich, `${ten}.ts import ${dich}`).not.toMatch(/engine-goc|ngan-hang|@\/lib\/db|server-only|node:/);
        if (dich.startsWith("./")) expect(CLIENT_DUOC_LAY.has(dich.slice(2)), `${ten}.ts import ${dich} ngoài danh sách sạch`).toBe(true);
      }
    }
  });

  it("[SG-RG-03] mọi module chạm DB / khoá / engine của so-gia-dinh khai 'server-only' (hoặc thuộc phần thuần chỉ import trong máy chủ)", () => {
    for (const ten of ["doc", "ghi", "pin"]) {
      expect(readFileSync(join(GOC, "lib/disc/so-gia-dinh", `${ten}.ts`), "utf8"), ten).toMatch(/^import "server-only";$/m);
    }
  });

  it("[SG-RG-04] Server Action của sổ chỉ nhận userId từ PHIÊN: không action nào đọc userId từ input", () => {
    const nd = readFileSync(join(GOC, "app/(portal)/portal/disc/_actions-so.ts"), "utf8");
    const khongChu = nd.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // Mọi hàm export async phải đi qua voiPhien (cổng phiên) và không có tham số tên userId.
    const hamExport = [...khongChu.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
    expect(hamExport.length).toBeGreaterThanOrEqual(12);
    for (const [, ten, tham] of hamExport) {
      expect(tham, ten).not.toMatch(/userId/);
      const than = khongChu.slice(khongChu.indexOf(`export async function ${ten}(`)).split("export async function")[1] ?? "";
      expect(than, ten).toMatch(/voiPhien\(/);
    }
  });
});
