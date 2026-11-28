// [DLM-*] Lối "chỉ đặt lại MẬT KHẨU tài khoản uat.*" (20/10/2026): phần chia nhóm là hàm THUẦN; phần còn lại là lưới ghim mã nguồn (luật 11: neo lời gọi, đếm số lần, bỏ chú thích).
// Ca chạm Postgres thật: tests/hoa-hong/uat-dat-lai-mat-khau.spec.ts ([DLM-DB-*]).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { phanLoaiDatLai, type HangMatKhau } from "./00-tai-khoan";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

const hang = (local: string, rieng: Partial<HangMatKhau> = {}): HangMatKhau => ({ id: `id-${local}`, email: `${local}@satarobo.vn`, password: "$2a$10$cu", deletedAt: null, isActive: true, accountStatus: "ACTIVE", ...rieng });

describe("[DLM] phanLoaiDatLai", () => {
  it("[DLM-01] tài khoản uat.* còn đăng nhập được: mật khẩu chưa khớp ⇒ datLai; đã khớp ⇒ daKhop (không ghi lại)", () => {
    const ds = [hang("uat.admin"), hang("uat.sale1"), hang("uat.giamdoc")];
    const r = phanLoaiDatLai(ds, new Set(["uat.sale1@satarobo.vn"]));
    expect(r.datLai.map((x) => x.email)).toEqual(["uat.admin@satarobo.vn", "uat.giamdoc@satarobo.vn"]);
    expect(r.daKhop.map((x) => x.email)).toEqual(["uat.sale1@satarobo.vn"]);
    expect(r.boQua).toEqual([]);
  });

  it("[DLM-02] email KHÔNG thuộc DANH_SACH uat.* (kể cả trông giống uat.*) bị loại hẳn — không vào nhóm nào", () => {
    const ds = [hang("uat.admin"), hang("uat.khongco"), hang("admin"), { ...hang("x"), email: null }, { ...hang("y"), email: "uat.admin@satarobo.vn.evil.com" }];
    const r = phanLoaiDatLai(ds, new Set());
    expect(r.datLai.map((x) => x.email)).toEqual(["uat.admin@satarobo.vn"]);
    expect(r.daKhop).toEqual([]);
    expect(r.boQua).toEqual([]);
  });

  it("[DLM-03] đã xoá mềm / isActive=false / accountStatus≠ACTIVE ⇒ boQua kèm lý do, KHÔNG nằm trong datLai (không sống lại tài khoản)", () => {
    const ds = [
      hang("uat.sale1", { deletedAt: new Date("2026-01-01T00:00:00.000Z") }),
      hang("uat.sale2", { isActive: false }),
      hang("uat.sale3", { accountStatus: "DISABLED" }),
      hang("uat.sale4", { accountStatus: "PENDING_ACTIVATION" }),
    ];
    const r = phanLoaiDatLai(ds, new Set());
    expect(r.datLai).toEqual([]);
    expect(r.boQua.map((b) => [b.hang.email, b.lyDo])).toEqual([
      ["uat.sale1@satarobo.vn", "DA_XOA_MEM"],
      ["uat.sale2@satarobo.vn", "BI_KHOA"],
      ["uat.sale3@satarobo.vn", "KHONG_ACTIVE"],
      ["uat.sale4@satarobo.vn", "KHONG_ACTIVE"],
    ]);
  });

  it("[DLM-04] dòng không có mật khẩu (password null) coi là CHƯA khớp dù email nằm trong tập khớp; không có dòng nào ⇒ tất cả rỗng", () => {
    const r = phanLoaiDatLai([hang("uat.admin", { password: null })], new Set(["uat.admin@satarobo.vn"]));
    expect(r.datLai).toHaveLength(1);
    expect(r.daKhop).toEqual([]);
    expect(phanLoaiDatLai([], new Set())).toEqual({ datLai: [], daKhop: [], boQua: [] });
  });
});

describe("[DLM-W] lưới ghim mã nguồn", () => {
  const tk = boChuThich(doc("prisma/seed-uat/00-tai-khoan.ts"));
  const script = boChuThich(doc("prisma/seed-uat/chay-dat-lai-mat-khau.ts"));
  const batDau = tk.indexOf("export async function datLaiMatKhau");
  const ghi = tk.slice(batDau);

  it("[DLM-W1] phép GHI chỉ đổi đúng hai cột `password` + `mustChangePassword`, trên bảng User, qua hàm băm dùng chung; điều kiện where lặp lại cả 'còn đăng nhập được' + tập email uat.*", () => {
    expect(batDau).toBeGreaterThan(-1);
    expect(dem(ghi, /data: \{ password: hash, mustChangePassword: false \}/g)).toBe(1);
    expect(dem(ghi, /\bdata:/g)).toBe(1);
    expect(dem(ghi, /\btx\.\w+\.\w+\(/g)).toBe(1);
    expect(ghi).toMatch(/tx\.user\.updateMany\(/);
    expect(dem(ghi, /where: \{ id: h\.id, email: \{ in: emails \}, deletedAt: null, isActive: true, accountStatus: "ACTIVE" \}/g)).toBe(1);
    expect(dem(ghi, /\bawait bamMatKhauUat\(\)/g)).toBe(1);
    expect(ghi).not.toMatch(/bcrypt\./);
    expect(dem(tk, /bcrypt\.hash\(/g)).toBe(1);
  });

  it("[DLM-W2] phần ĐỌC lọc theo DANH_SACH uat.* ngay trong câu tra, và bảng nào khác không bị chạm ở khối đặt lại", () => {
    const doc2 = tk.slice(tk.indexOf("export async function docDatLaiMatKhau"), batDau);
    expect(dem(doc2, /email: \{ in: DANH_SACH\.map\(emailCua\) \}/g)).toBe(1);
    expect(dem(doc2, /\bdb\.\w+\./g)).toBe(1);
    expect(dem(doc2, /\bdb\.user\.findMany\(/g)).toBe(1);
    const khoi = tk.slice(tk.indexOf("export function phanLoaiDatLai"));
    expect(khoi).not.toMatch(/\.(create|upsert|delete|deleteMany|createMany)\(/);
    expect(khoi).not.toMatch(/\$executeRaw|\$queryRaw/);
  });

  it("[DLM-W3] script riêng: dry-run mặc định (đọc --apply đúng một lần, cổng `!apply` đứng TRƯỚC lời gọi ghi), qua assertSeedAllowed, không kéo seedNen / index / tầng seed khác", () => {
    expect(script).not.toMatch(/seedNen|\.\/index|seedCrm|seedHocVu|seedTaiChinh|seedNoiLead|seedTaiKhoan/);
    expect(dem(script, /process\.argv\.includes\("--apply"\)/g)).toBe(1);
    expect(dem(script, /\bassertSeedAllowed\(\)/g)).toBe(1);
    expect(dem(script, /\bdatLaiMatKhau\(/g)).toBe(1);
    const iApply = script.indexOf("if (!apply)");
    expect(iApply).toBeGreaterThan(-1);
    expect(iApply).toBeLessThan(script.indexOf("datLaiMatKhau("));
    expect(script.indexOf("assertSeedAllowed()")).toBeLessThan(script.indexOf("docDatLaiMatKhau()"));
    // không in mật khẩu / băm
    expect(script).not.toMatch(/\.password\b|process\.env\.UAT_PASSWORD/);
  });

  it("[DLM-W4] index.ts (đường đầy đủ) không gọi lối đặt lại; seedTaiKhoan vẫn dùng hàm băm chung", () => {
    const index = boChuThich(doc("prisma/seed-uat/index.ts"));
    expect(index).not.toMatch(/datLaiMatKhau|docDatLaiMatKhau|chay-dat-lai-mat-khau/);
    expect(dem(tk, /\bawait bamMatKhauUat\(\)/g)).toBe(2);
  });
});
