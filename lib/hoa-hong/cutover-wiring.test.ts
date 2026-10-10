// @vitest-environment node
/**
 * LƯỚI GHIM MÃ NGUỒN của CUTOVER (PR5c). Ca hành vi (Postgres thật) ở `tests/hoa-hong/cutover.spec.ts`; lưới này canh những thứ test hành vi KHÔNG chạm tới:
 *
 *   [NHH-W1]   cổng cutover có mặt ở CẢ NĂM hàm `lib` của đường cũ, đúng MỘT lần, đứng TRƯỚC phép đọc/ghi đầu tiên:
 *              `chotKyHoaHong` · `setStatementLines` · `approveStatement` · `reopenStatement` · `ensureCommissionStatement` · `recordTrialTeacherCommission`
 *   [NHH-W2]   `convertLeadV2`: cổng đứng TRƯỚC `ensureCommissionStatement(now)` (ngoài transaction) và `recordTrialTeacherCommission` chỉ chạy khi có bảng kê
 *   [NHH-W9]   phép GHI `SystemSetting` cho `hoaHong.kyCutover` chỉ có ở `lib/hoa-hong/cutover.ts`; khoá khai `ghiQuaActionRieng` trong registry
 *   [NHH-W9b]  cặp khoá advisory của mốc: `datMocCutover` giữ độc quyền TRƯỚC khi đọc; `chayTrongKhoa` giữ chia sẻ TRƯỚC khi đọc mốc
 *   [NHH-W9c]  manifest: `chotKyHoaHong` truyền `manifest` cho `setStatementLines`, và `setStatementLines` ghi `paymentIds` vào audit
 *
 * Quy tắc viết lưới (CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN", luật 11/14): neo vào LỜI GỌI, bỏ chú thích trước khi so, đếm số lần khớp, không cờ `/s`;
 * mỗi lưới có phép tự-kiểm "đã tìm thấy hàm" để một lần quét rỗng không thành xanh giả. Cấy gỡ từng cổng ⇒ đúng ca của nó đỏ (ghi ở báo cáo PR).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const boChuThich = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));
const dem = (s: string, m: RegExp): number => (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length;

/** Thân một hàm cấp tệp: từ dòng khai báo tới dòng khai báo hàm cấp tệp KẾ TIẾP (hoặc hết tệp). */
function thanHam(code: string, ten: string): string {
  const re = new RegExp(`^(?:export )?(?:async )?function ${ten}\\b`, "m");
  const m = re.exec(code);
  if (!m) throw new Error(`Không tìm thấy hàm ${ten}`);
  const tu = m.index;
  const sau = code.slice(tu + m[0].length);
  const ke = /^(?:export )?(?:async )?function \w+|^export (?:const|type|class|interface) /m.exec(sau);
  return code.slice(tu, ke ? tu + m[0].length + ke.index : undefined);
}

/** Lời gọi cổng cutover (một trong ba hàm cùng đọc MỘT câu hỏi "tháng thuộc sổ mới / đã đặt mốc"). */
const CONG = /\b(?:chanThangThuocSoMoi|chanMoLaiKyCu|docThangThuocSoMoi)\(/g;
/** Truy cập DB đầu tiên của hàm (đọc HOẶC ghi): `db.x` / `tx.x` — không tính đối số truyền cổng (`chanThangThuocSoMoi(db, …)` không có dấu chấm). */
const DB_DAU = /\b(?:db|tx)\.[A-Za-z$]+/;

function kiemCong(code: string, ten: string) {
  const than = thanHam(code, ten);
  const idxCong = than.search(new RegExp(CONG.source));
  const idxDb = than.search(DB_DAU);
  return { than, soCong: dem(than, CONG), idxCong, idxDb };
}

const NAM_HAM: { tep: string; ham: string; ma: string }[] = [
  { tep: "lib/crm/commission-run.ts", ham: "chotKyHoaHong", ma: "PER-03a" },
  { tep: "lib/crm/commission-statement.ts", ham: "setStatementLines", ma: "PER-03i" },
  { tep: "lib/crm/commission-statement.ts", ham: "approveStatement", ma: "PER-03f" },
  { tep: "lib/crm/commission-statement.ts", ham: "reopenStatement", ma: "PER-03d" },
  { tep: "lib/crm/trial-teacher-commission.ts", ham: "ensureCommissionStatement", ma: "PER-03i" },
  { tep: "lib/crm/trial-teacher-commission.ts", ham: "recordTrialTeacherCommission", ma: "PER-04" },
];

describe("[NHH-W1] cổng cutover có mặt ở CẢ NĂM hàm lib của đường cũ (+ chỗ ghi GV Trial)", () => {
  for (const { tep, ham, ma } of NAM_HAM) {
    it(`[NHH-W1] ${ham} (${ma}): ĐÚNG MỘT lời gọi cổng, đứng TRƯỚC truy cập DB đầu tiên`, () => {
      const r = kiemCong(doc(tep), ham);
      expect(r.soCong, `${ham}: số lời gọi cổng`).toBe(1);
      expect(r.idxCong).toBeGreaterThanOrEqual(0);
      expect(r.idxDb, `${ham}: tự-kiểm — hàm phải có truy cập DB để so thứ tự`).toBeGreaterThan(0);
      expect(r.idxCong, `${ham}: cổng phải đứng TRƯỚC truy cập DB đầu tiên`).toBeLessThan(r.idxDb);
    });
  }

  it("[NHH-W1] reopenStatement dùng cổng RIÊNG `chanMoLaiKyCu` (mọi kỳ APPROVED khi mốc ≠ null), không phải cổng 'tháng thuộc sổ mới'", () => {
    const than = thanHam(doc("lib/crm/commission-statement.ts"), "reopenStatement");
    expect(dem(than, /\bchanMoLaiKyCu\(/)).toBe(1);
    expect(dem(than, /\bchanThangThuocSoMoi\(/)).toBe(0);
  });

  it("[NHH-W1] chotKyHoaHong cũng gọi cổng TRƯỚC khi đọc Payment (không chỉ trông vào cổng của setStatementLines)", () => {
    const than = thanHam(doc("lib/crm/commission-run.ts"), "chotKyHoaHong");
    const iCong = than.search(new RegExp(CONG.source));
    // ≥ 0: gỡ cổng thì `search` trả −1 và `−1 < chỉ số` luôn ĐÚNG — bản đầu của ca này xanh khi cổng đã biến mất (cấy G1, 09/10).
    expect(iCong, "chotKyHoaHong phải có lời gọi cổng").toBeGreaterThanOrEqual(0);
    expect(than.indexOf("db.payment.findMany"), "tự-kiểm: phải thấy lần đọc Payment").toBeGreaterThan(0);
    expect(iCong).toBeLessThan(than.indexOf("db.payment.findMany"));
  });

  it("[NHH-W1] recordTrialTeacherCommission: cổng đứng TRƯỚC cả nhánh `statement-approved` lẫn phép upsert", () => {
    const than = thanHam(doc("lib/crm/trial-teacher-commission.ts"), "recordTrialTeacherCommission");
    const iCong = than.search(new RegExp(CONG.source));
    expect(iCong).toBeGreaterThanOrEqual(0);
    expect(iCong).toBeLessThan(than.indexOf("statement.approved"));
    expect(iCong).toBeLessThan(than.indexOf("commissionLine.upsert"));
  });
});

describe("[NHH-W2] convertLeadV2 — cổng đứng TRƯỚC ensureCommissionStatement, recordTrialTeacherCommission chỉ chạy khi có bảng kê", () => {
  const code = doc("lib/crm/convert-lead-v2.ts");

  it("[NHH-W2] đúng MỘT lời gọi `docThangThuocSoMoi(db, …)`, trước `ensureCommissionStatement(now)`, ngoài mọi `$transaction`", () => {
    expect(dem(code, /\bdocThangThuocSoMoi\(db,/)).toBe(1);
    expect(dem(code, /\bensureCommissionStatement\(now\)/)).toBe(1);
    const iCong = code.search(/\bdocThangThuocSoMoi\(db,/);
    const iEnsure = code.search(/\bensureCommissionStatement\(now\)/);
    expect(iCong).toBeGreaterThan(0);
    expect(iCong).toBeLessThan(iEnsure);
    // Lưới có sẵn `trial-teacher-commission.test.ts`: ensure… phải đứng TRƯỚC `db.$transaction` — cổng mới không được dời nó vào trong.
    expect(iEnsure).toBeLessThan(code.indexOf("db.$transaction"));
  });

  it("[NHH-W2] `needsCommission` phủ định kết quả cổng; `ensureCommissionStatement` chỉ nằm trong `if (needsCommission)`", () => {
    expect(dem(code, /const needsCommission = !thangThuocSoMoi &&/)).toBe(1);
    const iIf = code.search(/if \(needsCommission\) \{/);
    const iEnsure = code.search(/\bensureCommissionStatement\(now\)/);
    expect(iIf).toBeGreaterThan(0);
    expect(iIf).toBeLessThan(iEnsure);
  });

  it("[NHH-W2] `recordTrialTeacherCommission(` chỉ được gọi dưới nhánh `commissionStatement` có thật (bảng kê chỉ có khi cổng cho qua)", () => {
    expect(dem(code, /\brecordTrialTeacherCommission\(/)).toBe(1);
    const iGoi = code.search(/\brecordTrialTeacherCommission\(/);
    const iDk = code.lastIndexOf("if (trial.teacherUserId && commissionStatement)", iGoi);
    expect(iDk).toBeGreaterThan(0);
    expect(iGoi - iDk).toBeLessThan(200);
  });
});

describe("[NHH-W9] mốc cutover chỉ ghi ở MỘT chỗ", () => {
  const TRAN = 30_000;
  const ghiSetting = /\bsystemSetting\.(?:upsert|update|updateMany|create|createMany|delete|deleteMany)\(/;
  const sqlThoGhi = /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"SystemSetting"/i;

  it(
    "[NHH-W9] đúng MỘT tệp vừa nhắc khoá `hoaHong.kyCutover` vừa ghi SystemSetting: lib/hoa-hong/cutover.ts",
    () => {
      const ds = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app", "lib", "scripts"], {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      })
        .split(/\r?\n/)
        .filter((d) => /\.(ts|tsx|mjs|cjs)$/.test(d) && !/\.(test|spec)\.(ts|tsx|mjs|cjs)$/.test(d))
        .filter((d) => existsSync(resolve(process.cwd(), d)));
      expect(ds.length, "tự-kiểm: phép quét phải đọc được cây mã").toBeGreaterThan(500);
      const nhacKhoa = (c: string) => c.includes("hoaHong.kyCutover") || c.includes("KHOA_KY_CUTOVER");
      const co = ds.filter((d) => {
        const c = boChuThich(readFileSync(resolve(process.cwd(), d), "utf8"));
        return nhacKhoa(c) && (ghiSetting.test(c) || sqlThoGhi.test(c));
      });
      expect(co).toEqual(["lib/hoa-hong/cutover.ts"]);
    },
    TRAN,
  );

  it("[NHH-W9] khoá khai `ghiQuaActionRieng: true` trong registry, và service từ chối nó ở CẢ BA đường ghi (global · cơ sở · gỡ cơ sở)", () => {
    const reg = doc("lib/settings/registry.ts");
    const khoi = reg.slice(reg.indexOf('"hoaHong.kyCutover": def({'));
    expect(khoi.slice(0, khoi.indexOf("}),")), "khai trong registry").toContain("ghiQuaActionRieng: true");
    const svc = doc("lib/settings/service.ts");
    expect(dem(svc, /\.ghiQuaActionRieng\b/)).toBe(3);
  });

  it("[NHH-W9] `datMocCutover` chạy trong MỘT `$transaction`, đọc mốc bằng `docMocCutover(tx)` (không `getSetting`), ghi audit cùng tx rồi mới xoá cache", () => {
    const than = thanHam(doc("lib/hoa-hong/cutover.ts"), "datMocCutover");
    expect(dem(than, /\bclient\.\$transaction\(/)).toBe(1);
    expect(dem(than, /\bdocMocCutover\(tx\)/)).toBe(1);
    expect(dem(than, /\bgetSetting\(/)).toBe(0);
    expect(dem(than, /\bwriteAudit\(\{/)).toBe(1);
    expect(than).toMatch(/\btx,\s*\n\s*\}\);/);
    expect(than.indexOf("clearSettingsCache()")).toBeGreaterThan(than.indexOf("client.$transaction("));
  });
});

describe("[NHH-W14] consumer của `nguon.da-doi-sau-thanh-toan` được ĐĂNG KÝ", () => {
  // `khop-phat-nghe.test.ts` chỉ quét `on("…")` trong mã nguồn: gỡ lời gọi `registerNguonDoiSauThuHandlers()` khỏi register.ts thì `on(` vẫn nằm trong tệp handler ⇒ lưới đó XANH
  // trong khi consumer KHÔNG BAO GIỜ chạy (đổi nguồn sau thu im lặng không ra dòng điều chỉnh nào). Lưới này canh đúng khoảng hở đó.
  it("[NHH-W14] lib/events/register.ts import VÀ gọi `registerNguonDoiSauThuHandlers()` đúng một lần; tệp handler đăng ký ĐÚNG tên sự kiện PR2 phát", () => {
    const reg = doc("lib/events/register.ts");
    expect(dem(reg, /\bregisterNguonDoiSauThuHandlers\b/)).toBe(2); // import + lời gọi
    expect(dem(reg, /\n\s*registerNguonDoiSauThuHandlers\(\);/)).toBe(1);
    const h = doc("lib/hoa-hong/_handlers/doi-nguon-sau-thu.ts");
    expect(dem(h, /\bon\("nguon\.da-doi-sau-thanh-toan",\s*onNguonDaDoiSauThanhToan\)/)).toBe(1);
    const phat = doc("lib/nguon/doi-nguon-lead.ts");
    expect(dem(phat, /publishEvent\(\s*"nguon\.da-doi-sau-thanh-toan"/)).toBe(1);
  });
});

describe("[NHH-W9d] màn Cấu hình vận hành truyền `chiDoc` từ REGISTRY (không từ nhãn)", () => {
  it("[NHH-W9d] page.tsx gắn `chiDoc: SETTINGS[key]?.ghiQuaActionRieng === true` đúng MỘT lần; trình sửa nhận `chiDoc` và rẽ sang `HangChiDoc` đúng MỘT chỗ", () => {
    expect(dem(doc("app/(admin)/admin/cau-hinh-van-hanh/page.tsx"), /chiDoc:\s*SETTINGS\[key\]\?\.ghiQuaActionRieng === true/)).toBe(1);
    const ed = doc("app/(admin)/admin/cau-hinh-van-hanh/_components/settings-editor.tsx");
    expect(dem(ed, /p\.row\.chiDoc \? <HangChiDoc row=\{p\.row\} \/>/)).toBe(1);
  });
});

describe("[NHH-W9b] cặp khoá advisory của mốc", () => {
  it("[NHH-W9b] datMocCutover giữ khoá ĐỘC QUYỀN trước khi đọc mốc/đếm dòng sổ; chayTrongKhoa giữ khoá CHIA SẺ trước khi đọc mốc", () => {
    const cut = thanHam(doc("lib/hoa-hong/cutover.ts"), "datMocCutover");
    const iDocQuyen = cut.search(/pg_advisory_xact_lock\(hashtext/);
    expect(iDocQuyen).toBeGreaterThan(0);
    expect(iDocQuyen).toBeLessThan(cut.indexOf("docMocCutover(tx)"));
    expect(iDocQuyen).toBeLessThan(cut.indexOf("docDauVaoDatMoc("));

    const ghi = thanHam(doc("lib/hoa-hong/ghi-so.ts"), "chayTrongKhoa");
    expect(dem(ghi, /\bkhoaChungMocCutover\(tx\)/)).toBe(1);
    expect(ghi.search(/\bkhoaChungMocCutover\(tx\)/)).toBeLessThan(ghi.search(/\bdocMocCutover\(tx\)/));
    expect(doc("lib/hoa-hong/cutover.ts")).toMatch(/pg_advisory_xact_lock_shared\(hashtext/);
  });
});

describe("[NHH-W9c] manifest chủ sở hữu bút toán (PR0m)", () => {
  it("[NHH-W9c] chotKyHoaHong truyền `manifest` = TOÀN BỘ id đã nạp (không cắt) · setStatementLines ghi `paymentIds` vào audit chốt", () => {
    const run = thanHam(doc("lib/crm/commission-run.ts"), "chotKyHoaHong");
    expect(dem(run, /manifest:\s*\{\s*paymentIds:\s*rows\.map\(\(r\) => r\.id\)/)).toBe(1);
    const st = thanHam(doc("lib/crm/commission-statement.ts"), "setStatementLines");
    expect(dem(st, /paymentIds:\s*\[\.\.\.input\.manifest\.paymentIds\]/)).toBe(1);
    expect(st).not.toMatch(/slice\(0,\s*20\)/);
  });
});
