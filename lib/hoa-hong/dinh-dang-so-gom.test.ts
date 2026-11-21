// @vitest-environment node
/**
 * [NHH-DD-GOM-*] — LƯỚI GHIM MÃ NGUỒN: số và tiền của module Nguồn lead & Hoa hồng chỉ được in qua `dinhDangDong` / `dinhDangSo` (lib/hoa-hong/vi-sao.ts).
 *
 * Vì sao: `Intl.NumberFormat("vi-VN")` và `toLocaleString("vi-VN")` ra chữ KHÁC nhau theo ICU của runtime (Node build small-icu, trình duyệt cũ, Postgres/Docker khác máy dev),
 * và không có dấu trừ thật (−). Năm tệp đã tự dựng bộ định dạng riêng — mỗi nơi một kiểu — đến khi hai màn in hai chuỗi cho cùng một con số.
 * Neo HẸP trên mã đã bỏ chú thích (luật 11), ĐẾM số lần khớp, có đối chứng dương (quét được đủ tệp, không quét một tập rỗng).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();

function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function cacTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(resolve(GOC, thuMuc))) {
    const duong = join(thuMuc, ten);
    if (statSync(resolve(GOC, duong)).isDirectory()) cacTep(duong, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.test\.(ts|tsx)$/.test(ten)) ra.push(duong.replace(/\\/g, "/"));
  }
  return ra;
}

const THU_MUC = ["app/(admin)/admin/nguon-hoa-hong", "components/admin/nguon-hoa-hong", "lib/hoa-hong", "lib/nguon-hoa-hong"];
const TEP = THU_MUC.flatMap((t) => cacTep(t));
const MA = new Map(TEP.map((t) => [t, boChuThich(readFileSync(resolve(GOC, t), "utf8"))]));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[NHH-DD-GOM-01] không bộ định dạng số cục bộ trong module", () => {
  it("đối chứng dương: quét đủ tệp của module và có tệp dùng dinhDangDong / dinhDangSo", () => {
    expect(TEP.length).toBeGreaterThan(100);
    expect(TEP.filter((t) => /\bdinhDangDong\(/.test(MA.get(t)!)).length).toBeGreaterThan(10);
    expect(TEP.filter((t) => /\bdinhDangSo\(/.test(MA.get(t)!)).length).toBeGreaterThan(0);
  });

  it("không `new Intl.NumberFormat(` ở tệp nào", () => {
    const vi = TEP.filter((t) => dem(MA.get(t)!, /\bIntl\.NumberFormat\b/g) > 0);
    expect(vi).toEqual([]);
  });

  it("không `.toLocaleString(` ở tệp nào (số)", () => {
    const vi = TEP.filter((t) => dem(MA.get(t)!, /\.toLocaleString\(/g) > 0);
    expect(vi).toEqual([]);
  });
});
