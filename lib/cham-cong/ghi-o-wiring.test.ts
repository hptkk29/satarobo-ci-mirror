// [GOW-*] — LƯỚI GHIM MÃ NGUỒN cho T04: MỘT service ghi ô, và các dây nối quanh nó.
//
// Luật + hành vi đã có test riêng (`ghi-o-luat.test.ts`, `tests/cham-cong/{ghi-o,day-khung}.spec.ts`). Thứ chúng KHÔNG
// canh là việc ba đường ghi cũ MỌC LẠI: một người thêm `shiftAssignment.create(...)` ở một chỗ thứ tư, đúng như ba chỗ cũ
// (đọc-huỷ-tạo, không khoá, không quan tâm kỳ chốt) — mọi test hành vi vẫn xanh vì chúng không gọi chỗ đó.
// Cách làm theo CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN": bóc chú thích, neo chuỗi HẸP vào LỜI GỌI, đếm số lần khớp.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
const dem = (s: string, x: string) => s.split(x).length - 1;
function than(src: string, ten: string): string {
  // Hàm export HOẶC hàm nội bộ (`dayKhungSauKhiLuu` không export — tệp "use server" chỉ được export hàm async).
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:export )?(?:async )?(?:function|const|type) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}

const GHI = "lib/cham-cong/ghi-o.ts";
// Ngoại lệ DUY NHẤT, có lý do: hoàn tác đơn đã duyệt (đơn từ đợt 11) khôi phục / huỷ ĐÚNG ô mà đơn đã tạo. Nó không thể đi qua `chayLenhO`
// (đó là luật GHI theo nguồn, không phải "trả lại ô cụ thể"), nên phải lấy CÙNG khoá (người, tháng) — ghim ở [GOW-01b].
const HOAN_TAC = "lib/cham-cong/don/hoan-tac.ts";
const CELLS = "lib/cham-cong/cells.ts";
const GEN = "lib/cham-cong/generate-db.ts";
const IMP = "lib/cham-cong/import-core.ts";
const DAY = "lib/cham-cong/day-khung.ts";
const PLAN = "lib/cham-cong/generate.ts";
const KC = "app/(admin)/admin/cham-cong/khung-ca/_actions.ts";
const DM = "app/(admin)/admin/cham-cong/danh-muc-ca/_actions.ts";

const GHI_ASSIGNMENT = /\bshiftAssignment\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/;
const GHI_ASSIGNMENT_G = new RegExp(GHI_ASSIGNMENT.source, "g");

describe("[GOW] T04 — một service ghi ô lưới ca", () => {
  it("[GOW-01] CHỈ `ghi-o.ts` được ghi `ShiftAssignment` — mọi tệp mã nguồn khác (kể cả script, seed, action) không có lệnh ghi nào", () => {
    const tep = execFileSync("git", ["ls-files", "--", "*.ts", "*.tsx"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter((f) => f && !/\.(test|spec)\.tsx?$/.test(f) && !f.startsWith("tests/"));
    expect(tep.length, "quét ra quá ít tệp — sai cwd? lưới đang không chạm tới gì").toBeGreaterThan(500);
    const vi = tep.filter((f) => f !== GHI && f !== HOAN_TAC && GHI_ASSIGNMENT.test(boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"))));
    expect(vi, `tệp ghi ShiftAssignment ngoài service: ${vi.join(", ")}`).toEqual([]);
    // Và SQL thô: không `UPDATE/INSERT/DELETE "ShiftAssignment"`.
    const thoCoGhi = tep.filter((f) => /(UPDATE|INSERT INTO|DELETE FROM)\s+"ShiftAssignment"/i.test(boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"))));
    expect(thoCoGhi).toEqual([]);
    // Đối chứng: lưới THẤY chính service (nếu regex hỏng thì dòng dưới đỏ, không phải xanh vì "không tìm thấy gì").
    expect(GHI_ASSIGNMENT.test(ma(GHI))).toBe(true);
  }, 60_000); // quét CẢ cây `git ls-files` — trần mặc định 5 s không đủ khi vitest chạy song song nhiều file (đo 08/10: quá hạn ở máy dev)

  it("[GOW-01b] ngoại lệ hoan-tac.ts: lấy khoá (người, tháng) CỦA ghi-o.ts trước khi đọc ô, và mọi phép ghi ô đều có điều kiện", () => {
    const t = ma(HOAN_TAC);
    const khoa = t.indexOf("khoaOTrongTx(tx, o.userId, ngay)");
    expect(khoa, "thiếu khoá").toBeGreaterThan(-1);
    expect(khoa).toBeLessThan(t.indexOf("tx.shiftAssignment.findFirst("));
    expect(khoa).toBeLessThan(t.indexOf("tx.shiftAssignment.updateMany("));
    expect(ma(GHI)).toContain("export async function khoaOTrongTx(");
    // Đúng hai phép ghi: huỷ ô của đơn (updateMany có điều kiện) + khôi phục ô cũ (đã kiểm CANCELLED ngay trước).
    expect((t.match(GHI_ASSIGNMENT_G) ?? []).length).toBe(2);
    expect(t).toMatch(/updateMany\(\{ where: \{ id: o\.sauId, status: "ACTIVE" \}/);
  });

  it("[GOW-02] ba đường ghi cũ mỗi nơi gọi ĐÚNG MỘT `chayLenhO(` và không còn tự đọc ô bằng client đã lọc", () => {
    for (const f of [CELLS, GEN, IMP]) {
      const t = ma(f);
      expect(dem(t, "chayLenhO("), f).toBe(1);
      expect(t, f).not.toMatch(GHI_ASSIGNMENT);
    }
    // `applyImport`: không còn đọc từng ô (`findFirst` trong vòng lặp ngày) — N+1 và đọc qua client lọc cơ sở.
    expect(than(ma(IMP), "applyImport")).not.toMatch(/shiftAssignment\.findFirst\(/);
  });

  it("[GOW-03] service: KHOÁ trước khi ĐỌC ô; khoá theo (người, tháng) bằng advisory lock; transaction có trần tường minh; đọc bằng client TRẦN", () => {
    const t = ma(GHI);
    const lo = t.slice(t.indexOf("async function xuLyLo("));
    expect(dem(lo, "khoaNguoiThang(")).toBe(1);
    expect(lo.indexOf("khoaNguoiThang(")).toBeLessThan(lo.indexOf("c.shiftAssignment.findMany("));
    expect(t).toContain("pg_advisory_xact_lock(hashtext(");
    expect(t).toMatch(/\$executeRaw`SELECT pg_advisory_xact_lock/); // $executeRaw, KHÔNG $queryRaw (hàm trả void)
    expect(t).not.toMatch(/\$queryRaw`SELECT pg_advisory_xact_lock/);
    expect(t).toMatch(/\$transaction\(\(tx\) => xuLyLo\(tx, opts\.ctx, lo, true\), \{ timeout: 120_000, maxWait: 15_000 \}\)/);
    // Không có ô nào đọc qua `scopedDb` — service không import nó.
    expect(t).not.toContain("scopedDb");
  });

  it("[GOW-04] service: thứ tự khoá cố định (người ↑, tháng ↑) — chống deadlock giữa hai lượt chồng nhau", () => {
    const t = ma(GHI);
    expect(t).toContain("[...new Set(lenhs.map((l) => l.userId))].sort()");
    expect(t).toMatch(/\.map\(\(l\) => thang\(l\.workDate\)\)\)\]\.sort\(\)/);
  });

  it("[GOW-05] service: lệnh PATTERN thiếu `homNay` ném lỗi (luật 19); mọi cờ nguy hiểm của ngữ cảnh KHÔNG có giá trị mặc định (luật 7)", () => {
    const t = ma(GHI);
    expect(t).toContain('throw new Error("ghi-o: lệnh nguồn PATTERN cần `homNay`');
    const kieu = t.slice(t.indexOf("export type NguCanhGhiO"), t.indexOf("export type KetO"));
    expect(kieu).toMatch(/homNay: Date \| null;/);
    expect(kieu).toMatch(/ghiDeNhapTay: boolean;/);
    expect(kieu).toMatch(/boQuaKyDaChot: boolean;/);
    expect(kieu).not.toMatch(/\?:/); // không trường nào tuỳ chọn
  });

  it("[GOW-06] kế hoạch (generate.ts) hỏi `duocGhiDe` chứ KHÔNG giữ danh sách bảo vệ riêng — công tắc ở tầng trên mới tới được ô", () => {
    const t = ma(PLAN);
    expect(t).toContain('!duocGhiDe("PATTERN", ex.source, input.ghiDeNhapTay)');
    expect(t).not.toMatch(/\bconst PROTECTED\b|PROTECTED\.has\(/); // `SKIP_PROTECTED` (tên hành động) vẫn được phép
    expect(t).toMatch(/ghiDeNhapTay: boolean;/);
  });

  it("[GOW-07] đẩy khung: lõi KHÔNG có phép ghi nào, KHÔNG có đường vượt kỳ chốt, KHÔNG lọc theo khối, và quá khứ bị kẹp về ngày mai", () => {
    const t = ma(DAY);
    expect(t).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect(t).not.toContain("$executeRaw");
    expect(dem(t, "boQuaKyDaChot: false")).toBeGreaterThanOrEqual(2); // dayKhung + lechKhung
    expect(than(t, "dayKhung")).not.toContain("centerIds:");
    expect(t).toContain("muonTu.getTime() < mai.getTime() ? mai : muonTu");
    expect(than(t, "dayKhung")).toContain("generateMonthAssignments(");
  });

  it("[GOW-08] ba action sửa khung đều ĐẨY xuống lưới; thêm hàng loạt đẩy MỘT lần ở cuối (lời gọi trong vòng là CHI_KHUNG)", () => {
    const k = ma(KC);
    expect(dem(than(k, "savePatternCellAction"), "dayKhungSauKhiLuu(")).toBe(1);
    expect(dem(than(k, "addPeopleToBlockAction"), "dayKhungSauKhiLuu(")).toBe(1);
    expect(dem(than(k, "removePersonFromBlockAction"), "dayKhungSauKhiLuu(")).toBe(1);
    const them = than(k, "addPeopleToBlockAction");
    expect(them).toContain('phamViDay: "CHI_KHUNG"');
    expect(them.indexOf('phamViDay: "CHI_KHUNG"')).toBeLessThan(them.indexOf("dayKhungSauKhiLuu("));
    // Mặc định khi không gửi = đẩy mọi ngày chưa khoá (quyết định 07/10).
    expect(than(k, "dayKhungSauKhiLuu")).toContain('p.phamViDay ?? "MOI_NGAY_CHUA_KHOA"');
  });

  it("[GOW-09] 'Ghi đè ô nhập thủ công' cần quyền Hội sở + lý do TRƯỚC khi chạm engine — ở CẢ hai đường (đẩy khung và Sinh)", () => {
    const k = ma(KC);
    const day = than(k, "dayKhungSauKhiLuu");
    const quyen = day.indexOf('checkPermission("hr_attendance:close-period", { centerId: HO_CENTER_ID })');
    expect(quyen).toBeGreaterThan(-1);
    expect(quyen).toBeLessThan(day.indexOf("dayKhung({"));
    expect(day).toContain("tối thiểu 5 ký tự");
    const gen = k.slice(k.indexOf("async function chayGenerate("));
    const quyen2 = gen.indexOf('checkPermission("hr_attendance:close-period", { centerId: HO_CENTER_ID })', gen.indexOf("const ghiDeNhapTay"));
    expect(quyen2).toBeGreaterThan(-1);
    expect(quyen2).toBeLessThan(gen.indexOf("generateMonthAssignments({"));
    // Cờ chỉ truyền xuống khi đã qua cổng.
    // Đúng THỨ TỰ trong lời gọi engine — `ghiDeNhapTay,` đứng riêng cũng có mặt ở dòng audit nên không đủ.
    expect(gen).toContain("ghiThat,\n    ghiDeNhapTay,\n    boQuaKyDaChot: vuotKyChot,");
    expect(gen).toContain("const vuotKyChot = kyDaChot.length > 0 && p.data.boQuaKyDaChot === true;");
  });

  it("[GOW-10] đổi mã ca: bộ đếm 'đang dùng' KHÔNG lọc cơ sở và đếm CẢ khung ca tuần", () => {
    const t = than(ma(DM), "updateShiftTemplateAction");
    expect(t).toContain("scopedDb(actor, { bypass: true })");
    expect(t).toContain("khongLoc.shiftAssignment.count(");
    expect(t).toContain("khongLoc.shiftWeeklyPattern.count(");
    expect(t).toContain("templateCode: existing.code");
  });
});
