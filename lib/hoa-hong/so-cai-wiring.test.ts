// @vitest-environment node
/**
 * LƯỚI GHIM MÃ NGUỒN của SỔ HOA HỒNG BẤT BIẾN (PR5a). Ba trigger của DB là lưới dưới cùng; lưới này là lớp TRÊN: mã ứng dụng không được
 * VIẾT một câu lệnh mà DB sẽ chỉ chặn ở phút chót (rollback) — và quan trọng hơn, không được có MỘT ĐƯỜNG GHI THỨ HAI qua mặt cổng `ghiDong`.
 *
 *   [NHH-W5]   `commissionTransaction.create/createMany` chỉ ở ghi-so.ts (1 lời gọi, `createMany`, không `skipDuplicates`);
 *              không `update`/`upsert`/`delete`/`deleteMany` lên sổ; `updateMany` chỉ chạm cột TRẠNG THÁI CHI (payout*)
 *   [NHH-W5b]  SQL thô không UPDATE/DELETE bảng sổ; ô tính chỉ được `update` hai cột theo dõi, không xoá/upsert
 *   [NHH-W5c]  cổng `KY_CHUA_KHOA` đứng TRƯỚC `createMany` trong ghi-so.ts
 *   [NHH-FRD-08] module (lib/nguon, lib/hoa-hong, màn nguon-hoa-hong, hai cron) không sửa/xoá AuditLog
 *   [NHH-SEC-07w] mỗi hàm GHI lên kỳ gọi `batPhamViKy` (đúng 1 lần) TRƯỚC phép ghi đầu tiên; [NHH-SEC-08w] mọi `writeAudit` của dịch vụ kỳ truyền `tx`
 *   [NHH-W8]   hai cron hoa-hong-* đi qua `withCron` và có công tắc `TAT` (cờ tắt ⇒ no-op) trước khi đọc bảng nghiệp vụ
 *   [NHH-W15]  dây nối vòng sửa sau rà độc lập 08/10: cắt đối soát công bằng · Q6 chân hoàn · `hienTongTiLe` · xuất lô theo người trong lô + holdKey có lô
 *
 * Quy tắc viết lưới (CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN", luật 11/14): neo vào LỜI GỌI, bỏ chú thích trước khi so, đếm số lần khớp,
 * không cờ `/s`; mỗi lưới có phép tự-kiểm "đã quét đủ tệp" để một lần quét rỗng không thành xanh giả.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const boChuThich = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dem = (s: string, m: string | RegExp) =>
  typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length;

type Tep = { ten: string; code: string };

/** Mọi tệp mã chạy (không test, không .d.ts) dưới lib/ app/ scripts/ — kể cả tệp mới chưa add. */
function maChayToanCay(): Tep[] {
  const ds = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "lib", "app", "scripts", "components"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter((d) => /\.(ts|tsx|mjs|cjs)$/.test(d) && !/\.(test|spec)\.(ts|tsx)$/.test(d) && !d.endsWith(".d.ts"))
    .filter((d) => existsSync(resolve(process.cwd(), d)));
  return ds.map((ten) => ({ ten, code: boChuThich(readFileSync(resolve(process.cwd(), ten), "utf8")) }));
}

const TEP = maChayToanCay();
const TRAN_QUET_MS = 30_000;

describe("[NHH-W5] sổ hoa hồng chỉ có MỘT đường ghi", () => {
  it("[NHH-W5] tự-kiểm: đã quét đủ cây mã (nếu `git ls-files` rỗng thì mọi lưới dưới đây xanh giả)", () => {
    expect(TEP.length).toBeGreaterThan(500);
    expect(TEP.some((t) => t.ten === "lib/hoa-hong/ghi-so.ts")).toBe(true);
  });

  it("[NHH-W5] `commissionTransaction.create/createMany` xuất hiện ĐÚNG MỘT lần trong cả cây — ở lib/hoa-hong/ghi-so.ts, là `createMany` không `skipDuplicates`", () => {
    const co = TEP.map((t) => ({ ten: t.ten, n: dem(t.code, /\bcommissionTransaction\.(?:create|createMany)\(/) })).filter((x) => x.n > 0);
    expect(co).toEqual([{ ten: "lib/hoa-hong/ghi-so.ts", n: 1 }]);
    const g = TEP.find((t) => t.ten === "lib/hoa-hong/ghi-so.ts")!.code;
    expect(dem(g, /\bcommissionTransaction\.createMany\(\{\s*data:\s*moi\s*\}\)/)).toBe(1);
    expect(dem(g, "skipDuplicates")).toBe(0);
  }, TRAN_QUET_MS);

  it("[NHH-W5] không `commissionTransaction.update(` / `upsert` / `delete` / `deleteMany` ở bất cứ đâu; `updateMany` chỉ ở ky-service.ts + xuat-ky.ts và `data` chỉ gồm cột payout*", () => {
    for (const t of TEP) {
      expect(dem(t.code, /\bcommissionTransaction\.(?:update|upsert|delete|deleteMany)\(/), t.ten).toBe(0);
    }
    const cacLan: { ten: string; data: string }[] = [];
    for (const t of TEP) {
      for (const m of t.code.matchAll(/\bcommissionTransaction\.updateMany\(\{([^;]*?)\}\)\s*;/g)) {
        const data = /data:\s*\{([^}]*)\}/.exec(m[1]!)?.[1] ?? "";
        cacLan.push({ ten: t.ten, data });
      }
    }
    expect(cacLan.map((x) => x.ten).sort()).toEqual(["lib/hoa-hong/ky-service.ts", "lib/hoa-hong/xuat-ky.ts", "lib/hoa-hong/xuat-ky.ts"]);
    for (const l of cacLan) {
      // mỗi khoá trong `data` phải là cột TRẠNG THÁI CHI; số tiền / người hưởng / kỳ / băm KHÔNG bao giờ có mặt ở đây
      const khoa = [...l.data.matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map((m) => m[1]!);
      expect(khoa.length, l.ten).toBeGreaterThan(0);
      for (const k of khoa) expect(["payoutStatus", "payoutStatusAt", "payoutBatchId", "paidAt"], `${l.ten}: ${k}`).toContain(k);
    }
  }, TRAN_QUET_MS);
});

describe("[NHH-W5b] SQL thô và ô tính", () => {
  it("[NHH-W5b] không SQL thô UPDATE/DELETE lên \"CommissionTransaction\" (trigger sẽ chặn, nhưng mã không được viết ra)", () => {
    for (const t of TEP) {
      expect(dem(t.code, /\b(?:UPDATE|DELETE\s+FROM)\s+"CommissionTransaction"/i), t.ten).toBe(0);
      expect(dem(t.code, /\bTRUNCATE\b[^;]*"CommissionTransaction"/i), t.ten).toBe(0);
    }
  }, TRAN_QUET_MS);

  it("[NHH-W5b] ô tính: không xoá/upsert; `update` chỉ đặt `lastCheckedAt` (+ `lastMatchedHash` khi băm khớp lại) — `netBase`/`firstInputHash` là BẤT BIẾN", () => {
    for (const t of TEP) {
      expect(dem(t.code, /\bcommissionCalcSlot\.(?:delete|deleteMany|upsert|updateMany)\(/), t.ten).toBe(0);
    }
    const lan: { ten: string; data: string }[] = [];
    for (const t of TEP) for (const m of t.code.matchAll(/\bcommissionCalcSlot\.update\(\{[^;]*?data:\s*\{([^;]*?)\}\s*\}\)\s*;/g)) lan.push({ ten: t.ten, data: m[1]! });
    expect(lan.map((x) => x.ten)).toEqual(["lib/hoa-hong/quet-khoan.ts"]);
    expect(dem(lan[0]!.data, /\bnetBase\b|\bfirstInputHash\b|\boriginalLineCount\b|\bpaymentId\b/)).toBe(0);
    expect(dem(lan[0]!.data, "lastCheckedAt")).toBe(1);
  }, TRAN_QUET_MS);
});

describe("[NHH-W5c] cổng khoá kỳ đứng trước phép ghi", () => {
  it("[NHH-W5c] ghi-so.ts: `KY_CHUA_KHOA` (đúng 1) đứng TRƯỚC `createMany` (đúng 1), và khoá advisory theo khoản lấy bằng `$executeRaw`", () => {
    const g = TEP.find((t) => t.ten === "lib/hoa-hong/ghi-so.ts")!.code;
    expect(dem(g, '"KY_CHUA_KHOA"')).toBe(1);
    expect(dem(g, "createMany(")).toBe(1);
    expect(g.indexOf('"KY_CHUA_KHOA"')).toBeLessThan(g.indexOf("createMany("));
    expect(dem(g, /\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(\$\{"hoa-hong:khoan:" \+ paymentId\}\)::bigint\)`/)).toBe(1);
    expect(dem(g, /\$queryRaw`SELECT pg_advisory/)).toBe(0);
  });
});

describe("[NHH-FRD-08] AuditLog", () => {
  it("[NHH-FRD-08] lib/nguon, lib/hoa-hong, màn nguon-hoa-hong và hai cron không sửa/xoá AuditLog (chỉ `create`)", () => {
    const cua = TEP.filter((t) => t.ten.startsWith("lib/nguon/") || t.ten.startsWith("lib/hoa-hong/") || t.ten.startsWith("app/(admin)/admin/nguon-hoa-hong/") || t.ten.startsWith("app/api/cron/hoa-hong-"));
    expect(cua.length).toBeGreaterThan(30);
    expect(cua.some((t) => t.ten.startsWith("lib/nguon/"))).toBe(true);
    for (const t of cua) expect(dem(t.code, /\bauditLog\.(?:update|updateMany|delete|deleteMany|upsert)\(/), t.ten).toBe(0);
  });
});

describe("[NHH-W8] cron hoa-hong-*", () => {
  const route = (ten: string) => TEP.find((t) => t.ten === `app/api/cron/${ten}/route.ts`)?.code ?? "";
  it.each(["hoa-hong-quet", "hoa-hong-doi-soat"])("[NHH-W8] %s: đi qua withCron đúng tên, và công tắc `TAT` đứng TRƯỚC mọi đọc bảng nghiệp vụ", (ten) => {
    const c = route(ten);
    expect(c.length, `${ten}: không thấy tệp`).toBeGreaterThan(0);
    expect(dem(c, new RegExp(`withCron\\("${ten}"`))).toBe(1);
    expect(dem(c, /b\.loai === "TAT"/)).toBe(1);
    const iTat = c.indexOf('b.loai === "TAT"');
    for (const doc of [/\bdb\.orgUnit\./, /\bdb\.commission\w+\./, /\bdb\.payment\./, /\bquetKy\(/, /\bdoiSoatNen\(/]) {
      const m = doc.exec(c);
      if (m) expect(m.index, `${ten}: ${doc} đứng trước công tắc TAT`).toBeGreaterThan(iTat);
    }
  });
});

describe("[NHH-SEC-07w] phạm vi GHI lên kỳ", () => {
  /** Thân từ `export (async )?function <ten>(` (hoặc `async function <ten>(` không export) tới khai báo cấp tệp kế tiếp. */
  const than = (code: string, ten: string): string => {
    const a = code.search(new RegExp(`(?:export )?(?:async )?function ${ten}\\(`));
    expect(a, ten).toBeGreaterThan(-1);
    const b = code.slice(a + 10).search(/\n(?:export |async function |function |type |const )/);
    return code.slice(a, b === -1 ? undefined : a + 10 + b);
  };
  const ky = () => TEP.find((t) => t.ten === "lib/hoa-hong/ky-service.ts")!.code;
  const xuat = () => TEP.find((t) => t.ten === "lib/hoa-hong/xuat-ky.ts")!.code;

  it("[NHH-SEC-07w] tinhKy · doiHangChoSangKySau · chuyen: `batPhamViKy` đúng 1 lần, đứng TRƯỚC `$transaction`/phép ghi đầu", () => {
    for (const ten of ["tinhKy", "doiHangChoSangKySau", "chuyen"]) {
      const t = than(ky(), ten);
      expect(dem(t, "batPhamViKy("), ten).toBe(1);
      const iGhi = t.search(/\$transaction\(|\.update\(|\.updateMany\(|\.create\(/);
      expect(iGhi, ten).toBeGreaterThan(-1);
      expect(t.indexOf("batPhamViKy("), `${ten}: cổng phạm vi phải đứng trước phép ghi`).toBeLessThan(iGhi);
    }
  });

  it("[NHH-SEC-07w] xuatBangChi (lọc kỳ theo phạm vi) và danhDauDaChi (cổng TRƯỚC `updateMany`) gọi `batPhamViKy` đúng 1 lần", () => {
    const x = than(xuat(), "xuatBangChi");
    expect(dem(x, "batPhamViKy("), "xuatBangChi").toBe(1);
    expect(x.indexOf("batPhamViKy(")).toBeLessThan(x.indexOf("$transaction("));
    const d = than(xuat(), "danhDauDaChi");
    expect(dem(d, "batPhamViKy("), "danhDauDaChi").toBe(1);
    expect(d.indexOf("batPhamViKy(")).toBeLessThan(d.indexOf("commissionTransaction.updateMany("));
  });

  it("[NHH-SEC-07w] `NguoiThaoTacKy.quyen` là trường BẮT BUỘC (không `?`) — để tsc liệt kê chỗ gọi quên truyền", () => {
    expect(dem(ky(), /export type NguoiThaoTacKy = \{[^}]*\bquyen: Actor\b[^}]*\}/)).toBe(1);
  });
});

describe("[NHH-SEC-08w] audit cùng transaction", () => {
  it("[NHH-SEC-08w] mọi lời gọi `writeAudit({…})` trong ky-service.ts / xuat-ky.ts truyền `tx` (audit NGOÀI tx = audit còn lại khi thao tác rollback)", () => {
    for (const ten of ["lib/hoa-hong/ky-service.ts", "lib/hoa-hong/xuat-ky.ts"]) {
      const code = TEP.find((t) => t.ten === ten)!.code;
      const cacLan = code.match(/writeAudit\(\{[\s\S]*?\n\s*\}\);/g) ?? [];
      expect(cacLan.length, ten).toBeGreaterThanOrEqual(2);
      for (const l of cacLan) expect(dem(l, /\btx,?\s*\n/), `${ten}: ${l.slice(0, 80)}`).toBe(1);
      expect(dem(code, "writeAudit("), ten).toBe(cacLan.length); // không lời gọi nào lọt khỏi bộ so khớp
    }
  });
});

// ── Vòng rà độc lập 08/10: bốn dây nối mà test hành vi không với tới (hoặc rất đắt để với) ───────────────────────────────────────────────
describe("[NHH-W15] dây nối của vòng sửa sau rà độc lập", () => {
  const ma = (ten: string) => TEP.find((t) => t.ten === ten)?.code ?? "";

  it("[NHH-W15] đối soát nền cắt theo `chonKhoanKhiBiCat` (đúng 1 lời gọi), KHÔNG `slice(0, p.gioiHan)` trên tập đã sắp theo ngày thu (cắt cùng một đầu mỗi tuần)", () => {
    const q = ma("lib/hoa-hong/quet-ky.ts");
    expect(q.length).toBeGreaterThan(0);
    expect(dem(q, /\bchonKhoanKhiBiCat\(sap,/)).toBe(1);
    expect(dem(q, /\.slice\(0,\s*p\.gioiHan\)/)).toBe(0);
  });

  it("[NHH-W15] Q6 có chân HOÀN ở CẢ HAI nơi (tập quét kỳ và đối soát nền): `commissionTransaction.findMany` lọc `entryKind` ∈ {REVERSAL, LEGACY_REVERSAL} + `payment: { OR: DIEU_KIEN_RUT }` (khoản hoàn của gốc sổ cũ bị bác cũng phải bị nhặt)", () => {
    const q = ma("lib/hoa-hong/quet-ky.ts");
    expect(dem(q, /entryKind:\s*\{\s*in:\s*\["REVERSAL",\s*"LEGACY_REVERSAL"\]\s*\},\s*payment:\s*\{\s*OR:\s*DIEU_KIEN_RUT\s*\}/)).toBe(2);
    expect(dem(q, /entryKind:\s*"REVERSAL"/)).toBe(0); // không còn chân nào chỉ nhìn REVERSAL
  });

  it("[NHH-W15] `quetKhongConThucThu` không còn BO_QUA khi khoản không có ô: nó đi `quetHoanBiRut`; hàng chờ của khoản hoàn mang mã PAYMENT_WITHDRAWN", () => {
    const k = ma("lib/hoa-hong/quet-khoan.ts");
    expect(dem(k, /if \(!slot\) return quetHoanBiRut\(client, bc, p\);/)).toBe(1);
    expect(dem(k, /code:\s*"PAYMENT_WITHDRAWN"/)).toBe(2); // một cho khoản thu, một cho khoản hoàn
  });

  it("[NHH-W15] `docViSao` truyền `hienTongTiLe` (không mặc định) và chỉ khi tầm nhìn cơ sở phủ cơ sở của dòng; `dungViSao` khai tham số BẮT BUỘC", () => {
    const d = ma("lib/hoa-hong/doc-so.ts");
    // Điều kiện sống ở MỘT hàm (`duocXemTongTiLe`, 08/10/2026) mà docViSao và docViSaoDayDu (ngăn "Vì sao" của tab Sổ) cùng gọi.
    expect(dem(d, /const hienTongTiLe = duocXemTongTiLe\(tamCoSo, d\.centerId\);/)).toBe(1);
    expect(dem(d, /return tamCoSo === "ALL" \|\| \(tamCoSo !== null && tamCoSo\.includes\(centerId\)\);/)).toBe(1);
    expect(dem(d, /\},\s*hienTongTiLe\);/)).toBe(1);
    expect(dem(ma("lib/hoa-hong/vi-sao.ts"), /export function dungViSao\(d: DongChoViSao, hienTongTiLe: boolean\): ViSao/)).toBe(1);
  });

  it("[NHH-W15] xuatBangChi: âm kết chuyển chỉ của người CÓ DÒNG trong lô (`nguoiTrongLo`), và `holdKey` mang id lô — hai thứ cùng chặn P2002 / cuốn nợ cơ sở khác", () => {
    const x = ma("lib/hoa-hong/xuat-ky.ts");
    expect(dem(x, /const nguoiTrongLo = new Set\(cua\.map\(khoaNguoi\)\);/)).toBe(1);
    expect(dem(x, /nguoiTrongLo\.has\(dt\.nguoi\)/)).toBe(1);
    expect(dem(x, /holdKey:\s*`NEGATIVE_BALANCE:\$\{input\.kind\}:\$\{input\.thang\}:\$\{lo\.id\}:\$\{a\.nguoi\}`/)).toBe(1);
  });
});
