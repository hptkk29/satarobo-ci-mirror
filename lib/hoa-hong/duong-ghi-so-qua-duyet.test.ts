// @vitest-environment node
/**
 * [WRT-*] — KIỂM KÊ MỌI ĐƯỜNG GHI vào sổ hoa hồng (`CommissionTransaction`) và chứng minh KHÔNG còn đường "một người → Áp dụng → ghi sổ" cho tiền do ĐỔI NGUỒN / KHIẾU NẠI (08 §17.v4.Q mục 9).
 * Đọc MÃ NGUỒN (hành vi từng đường đã có ca Postgres ở `tests/hoa-hong/*`); test hành vi không bắt được việc "ai đó nối thêm một đường ghi". Neo hẹp, bỏ chú thích TRƯỚC khi đếm, đếm SỐ LẦN.
 *
 *   [WRT-01] `commissionTransaction.create*` chỉ ở `ghi-so.ts`; không SQL thô ghi vào sổ
 *   [WRT-02] `ghiChenhLech(` (INPUT_CORRECTION / SOURCE_CORRECTION): ba chỗ gọi — hai ở `giai-hang-cho.ts` (hàng chờ), MỘT ở `quet-khoan.ts` (nhánh đã qua duyệt)
 *   [WRT-03] `ghiKhoiPhucHoanLegacy(` — ĐƯỜNG KHÔI PHỤC HOÀN (kiểu dòng mượn tên DISPUTE_ADJUSTMENT) — chỉ ở `giai-hang-cho.ts`; KHÔNG phải tiền khiếu nại
 *   [WRT-04] `giaiHangCho` (đường MỘT người duy nhất còn lại) KHÔNG có nơi gọi nào ngoài test: không Server Action, không trang, không cron, không script thư viện
 *   [WRT-05] `h.ghiDong(` chỉ ở `quet-khoan.ts` (engine) và `khieu-nai.ts` (đúng HAI lần: một người dưới ngưỡng · cấp hai); mọi nơi ghi tiền khiếu nại đi sau `quyetDinhQuanTriTrongTx`
 *   [WRT-06] hai cron hoa hồng chỉ gọi engine ở chế độ QUÉT: không import đường ghi/duyệt, không truyền `cheDo`
 *
 * Hệ quả cho người nối nút "Áp dụng" sau này: [WRT-04] sẽ ĐỎ — đó là chủ ý. Nối nó phải kèm: tách nhiệm, ngưỡng, và đi qua đề xuất (08 §17.x mục 2, §17.v4.Q).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const dem = (s: string, mau: RegExp): number => (s.match(new RegExp(mau.source, mau.flags.includes("g") ? mau.flags : `${mau.flags}g`)) ?? []).length;

/** Mọi tệp .ts/.tsx KHÔNG phải test dưới các thư mục (đường dẫn dạng `a/b/c.ts`, dấu `/`). */
function tepMa(...thuMuc: string[]): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const ten of readdirSync(d)) {
      if (ten === "node_modules" || ten === ".next") continue;
      const p = resolve(d, ten);
      if (statSync(p).isDirectory()) di(p);
      else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.(ts|tsx)$/.test(ten)) ra.push(relative(GOC, p).split(sep).join("/"));
    }
  };
  for (const t of thuMuc) di(resolve(GOC, t));
  return ra;
}
const MA = tepMa("lib", "app", "components");
const boNho = new Map<string, string>(); // quét cả cây nhiều lần (mỗi mẫu một lượt) — đọc + bỏ chú thích mỗi tệp đúng một lần
const doc = (p: string): string => {
  let ma = boNho.get(p);
  if (ma === undefined) {
    ma = boChuThich(readFileSync(resolve(GOC, p), "utf8").replace(/\r\n/g, "\n"));
    boNho.set(p, ma);
  }
  return ma;
};
/** Số lần khớp `mau` theo từng tệp (chỉ tệp có ≥ 1). */
function theoTep(mau: RegExp): Record<string, number> {
  const ra: Record<string, number> = {};
  for (const f of MA) {
    const n = dem(doc(f), mau);
    if (n > 0) ra[f] = n;
  }
  return ra;
}

describe("[WRT] kiểm kê đường ghi sổ hoa hồng", () => {
  it("[WRT-01] chỉ `ghi-so.ts` THÊM dòng vào sổ; chỗ khác chỉ `updateMany` cột trạng thái chi trả (payout*); không xoá; không SQL thô ghi bảng sổ", () => {
    expect(Object.keys(theoTep(/commissionTransaction\.(create|createMany|upsert)\(/))).toEqual(["lib/hoa-hong/ghi-so.ts"]);
    expect(theoTep(/commissionTransaction\.(delete|deleteMany)\(/)).toEqual({});
    expect(theoTep(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"CommissionTransaction"/i)).toEqual({});
    // mọi `update/updateMany` chỉ đụng cột chi trả — KHÔNG sửa số tiền / người hưởng / kiểu dòng (trigger DB cũng chặn; đây là lưới ở tầng mã)
    const COT_CHI_TRA = new Set(["payoutStatus", "payoutStatusAt", "payoutBatchId"]);
    let soLenh = 0;
    for (const f of MA) {
      for (const m of doc(f).matchAll(/commissionTransaction\.(?:update|updateMany)\(\{[\s\S]*?data: \{([^}]*)\}/g)) {
        soLenh += 1;
        const cot = [...m[1]!.matchAll(/(\w+)\s*:/g)].map((x) => x[1]!);
        expect(cot.length, f).toBeGreaterThan(0);
        for (const c of cot) expect(COT_CHI_TRA.has(c), `${f}: cột ${c}`).toBe(true);
      }
    }
    expect(soLenh).toBe(3); // ky-service (duyệt chi) · xuat-ky (xuất lô · đánh dấu đã chi)
  });

  it("[WRT-02] `ghiChenhLech(` — INPUT_CORRECTION ở hàng chờ (2) · SOURCE_CORRECTION chỉ ở nhánh đã qua duyệt của engine (1 + định nghĩa); không ai khác gọi", () => {
    expect(theoTep(/\bghiChenhLech\(/)).toEqual({ "lib/hoa-hong/giai-hang-cho.ts": 2, "lib/hoa-hong/quet-khoan.ts": 2 });
    const quet = doc("lib/hoa-hong/quet-khoan.ts");
    expect(dem(quet, /await ghiChenhLech\(h, \{\s*loai: "SOURCE_CORRECTION"/)).toBe(1);
    expect(dem(quet, /loai: "INPUT_CORRECTION",/)).toBe(0); // engine không có lời gọi INPUT_CORRECTION nào (chỉ có trong kiểu của tham số)
    // lời gọi SOURCE_CORRECTION nằm TRONG nhánh duyệt, sau cổng "gói giống hệt gói đã duyệt"
    const vt = quet.indexOf('loai: "SOURCE_CORRECTION",');
    expect(quet.lastIndexOf('if (che.cheDo === "DOI_NGUON_CO_QUYEN") {', vt)).toBeGreaterThan(-1);
    expect(quet.lastIndexOf("goiGiongNhau(che.duyet.goi, deXuat)", vt)).toBeGreaterThan(-1);
  });

  it("[WRT-03] `ghiKhoiPhucHoanLegacy(` (khôi phục khoản hoàn bị bác — tên kiểu DISPUTE_ADJUSTMENT chỉ là mượn) chỉ ở `giai-hang-cho.ts`; không có đường khiếu nại nào dùng nó", () => {
    expect(theoTep(/\bghiKhoiPhucHoanLegacy\(/)).toEqual({ "lib/hoa-hong/giai-hang-cho.ts": 1, "lib/hoa-hong/quet-khoan.ts": 1 });
    expect(doc("lib/hoa-hong/khieu-nai.ts")).not.toMatch(/ghiKhoiPhucHoanLegacy/);
  });

  it("[WRT-04] `giaiHangCho` không có nơi gọi nào ngoài chính tệp và test — đường 'Áp dụng' một người là CODE CHẾT ở môi trường chạy thật", () => {
    const nhap = MA.filter((f) => f !== "lib/hoa-hong/giai-hang-cho.ts").filter((f) => /from "[^"]*giai-hang-cho"|import\("[^"]*giai-hang-cho"\)/.test(doc(f)));
    expect(nhap).toEqual([]);
    const goi = MA.filter((f) => f !== "lib/hoa-hong/giai-hang-cho.ts").filter((f) => /\bgiaiHangCho\(/.test(doc(f)));
    expect(goi).toEqual([]);
  });

  it("[WRT-05] `h.ghiDong(` ở lib/hoa-hong: engine (`quet-khoan.ts`) và khiếu nại (`khieu-nai.ts` đúng HAI lần); tiền khiếu nại đi sau `quyetDinhQuanTriTrongTx`", () => {
    const ghi = Object.fromEntries(Object.entries(theoTep(/\bh\.ghiDong\(/)).filter(([f]) => f.startsWith("lib/hoa-hong/")));
    expect(Object.keys(ghi).sort()).toEqual(["lib/hoa-hong/khieu-nai.ts", "lib/hoa-hong/quet-khoan.ts"]);
    expect(ghi["lib/hoa-hong/khieu-nai.ts"]).toBe(2);
    const kn = doc("lib/hoa-hong/khieu-nai.ts");
    // đường MỘT người: phép ghi đầu tiên đứng SAU quyết quản trị (có nhánh CHO_CAP_HAI trả về trước nó); đường cấp hai: nằm trong `duyetCapHaiKhieuNai` (đề xuất đã APPROVED_L1 do người khác)
    expect(kn.indexOf("quyetDinhQuanTriTrongTx(tx")).toBeGreaterThan(-1);
    expect(kn.indexOf("quyetDinhQuanTriTrongTx(tx")).toBeLessThan(kn.indexOf("await h.ghiDong("));
    expect(kn.indexOf('r[0]!.status !== "APPROVED_L1"')).toBeGreaterThan(kn.indexOf("export async function duyetCapHaiKhieuNai"));
    expect(kn.indexOf('r[0]!.status !== "APPROVED_L1"')).toBeLessThan(kn.lastIndexOf("await h.ghiDong("));
  });

  it("[WRT-06] hai cron hoa hồng (quét · đối soát) chỉ đi qua `quetKy` / `doiSoatNen` — không import đường ghi/duyệt, không truyền chế độ ghi", () => {
    for (const f of ["app/api/cron/hoa-hong-quet/route.ts", "app/api/cron/hoa-hong-doi-soat/route.ts"]) {
      const ma = doc(f);
      expect(ma, f).not.toMatch(/giai-hang-cho|duyet-de-xuat|khieu-nai|ghi-so|doi-nguon-sau-thu|cheDo/);
    }
    // và tầng dưới của chúng: `quet-ky.ts` không truyền `cheDo` (⇒ mặc định QUET, chế độ KHÔNG BAO GIỜ ghi chênh lệch lên ô đã có)
    expect(doc("lib/hoa-hong/quet-ky.ts")).not.toMatch(/cheDo/);
  });
});
