// @vitest-environment node
/**
 * LƯỚI DÂY NỐI — "không có đường vòng" cho id người do client gửi (hotfix 26/10/2026, mục 8 của brief).
 *
 * Hai trường được ghi từ id do giao diện gửi: `TrnProgram.contentOwnerUserId` và `TrnEvalLinkConfig.hrApprovedByUserId`.
 * Mỗi đường GHI chúng phải đi qua cổng server (`xacMinhNguoiDuocChon` / `xacMinhNguoiNhanSuDuyet`) và ghi giá trị ĐÃ XÁC MINH,
 * không phải `input.*` thô. Test hành vi (tests/elearning/chon-nguoi-server.test.ts, Postgres thật) chứng minh cổng ĐÚNG; lưới này
 * chứng minh KHÔNG ai ghi hai bảng đó mà không qua cổng — thêm một đường ghi mới (action khác, API route, nhân bản chương trình…)
 * là đỏ ở đây, buộc người thêm quyết định thay vì lặng lẽ mở lại đúng lỗ vừa vá.
 *
 * Neo vào LỜI GỌI và VỊ TRÍ, không neo vào chỗ đặt chữ `await` (bài học `[NDC-07]`/`[QCS-03]`).
 * Chưa cấy lỗi thì coi như vô dụng: xem tập phép cấy ở mô tả PR.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const GOC = process.cwd();

/** Bỏ chú thích — chú thích giải thích bản vá thường chứa đúng chuỗi lưới đang tìm. */
const chiMa = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function duyet(thuMuc: string, kq: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten === ".next") continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) duyet(p, kq);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.tsx?$/.test(ten)) kq.push(p);
  }
  return kq;
}

const rel = (p: string) => relative(GOC, p).split(sep).join("/");
const TAT_CA = [...duyet(join(GOC, "lib")), ...duyet(join(GOC, "app"))].map((p) => ({ tep: rel(p), ma: chiMa(readFileSync(p, "utf8")) }));

const GHI_CHUONG_TRINH = /\btrnProgram\.(create|createMany|update|updateMany|upsert)\(/;
const GHI_MUC = /\btrnEvalLinkConfig\.(create|createMany|update|updateMany|upsert)\(/;

describe("🔴 đường ghi hai trường id người — chỉ đúng hai lõi, và cả hai qua cổng", () => {
  it("[XMN-W1] chỉ `program-create.ts` ghi TrnProgram, chỉ `eval-link.ts` ghi TrnEvalLinkConfig (đường ghi mới = phải qua cổng)", () => {
    expect(TAT_CA.filter((f) => GHI_CHUONG_TRINH.test(f.ma)).map((f) => f.tep)).toEqual(["lib/elearning/program-create.ts"]);
    expect(TAT_CA.filter((f) => GHI_MUC.test(f.ma)).map((f) => f.tep)).toEqual(["lib/elearning/eval-link.ts"]);
  });

  it("[XMN-W2] không SQL thô nào ghi hai cột đó (đường vòng qua $executeRaw)", () => {
    const vi = TAT_CA.filter(
      (f) => /\$(executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)/.test(f.ma) && /"contentOwnerUserId"|"hrApprovedByUserId"/.test(f.ma),
    ).map((f) => f.tep);
    expect(vi).toEqual([]);
  });

  it("[XMN-W3] trong `lib/`, chỉ validator + hai lõi nhắc tới hai trường như một giá trị gán", () => {
    const co = TAT_CA.filter((f) => f.tep.startsWith("lib/") && /\b(contentOwnerUserId|hrApprovedByUserId)\s*:/.test(f.ma)).map((f) => f.tep);
    expect(co.sort()).toEqual(
      ["lib/elearning/eval-link.ts", "lib/elearning/program-create.ts", "lib/validators/elearning.ts"].sort(),
    );
  });

  it("[XMN-W4] program-create: gọi cổng đúng 1 lần, TRƯỚC phép ghi, và ghi giá trị ĐÃ XÁC MINH (không `input.contentOwnerUserId` thô)", () => {
    const ma = TAT_CA.find((f) => f.tep === "lib/elearning/program-create.ts")!.ma;
    const goi = [...ma.matchAll(/xacMinhNguoiDuocChon\(\s*db\s*,\s*input\.contentOwnerUserId/g)];
    expect(goi, "số lời gọi cổng").toHaveLength(1);
    const ghi = ma.search(GHI_CHUONG_TRINH);
    expect(ghi, "có phép ghi").toBeGreaterThan(-1);
    expect(goi[0]!.index!, "cổng đứng trước phép ghi").toBeLessThan(ghi);
    expect(ma).toMatch(/contentOwnerUserId:\s*chuNoiDung\.userId/);
    expect(ma).not.toMatch(/contentOwnerUserId:\s*input\./);
  });

  it("[XMN-W5] eval-link: gọi cổng đúng 1 lần với `actor` + centerId của CHƯƠNG TRÌNH, TRƯỚC phép ghi, ghi giá trị ĐÃ XÁC MINH", () => {
    const ma = TAT_CA.find((f) => f.tep === "lib/elearning/eval-link.ts")!.ma;
    const goi = [...ma.matchAll(/xacMinhNguoiNhanSuDuyet\(\s*db\s*,\s*actor\s*,\s*input\.hrApprovedByUserId\s*,\s*\{\s*centerId:\s*ct\.centerId/g)];
    expect(goi, "số lời gọi cổng").toHaveLength(1);
    const ghi = [...ma.matchAll(new RegExp(GHI_MUC.source, "g"))].map((m) => m.index!);
    expect(ghi.length, "có phép ghi").toBeGreaterThan(0);
    for (const g of ghi) expect(goi[0]!.index!, "cổng đứng trước MỌI phép ghi").toBeLessThan(g);
    expect(ma).toMatch(/hrApprovedByUserId:\s*nguoiDuyet\?\.userId/);
    expect(ma).not.toMatch(/hrApprovedByUserId:\s*input\./);
    // `centerId` của cấu hình đến từ chương trình, không từ giao diện.
    expect(ma).toMatch(/centerId:\s*ct\.centerId\s*\?\?\s*null/);
    expect(ma).not.toMatch(/centerId:\s*input\.centerId/);
  });

  it("[XMN-W6] ô chọn và cổng server cùng dùng MỘT vị từ `dieuKienNhanSuChon` (không điều kiện thứ hai)", () => {
    const ds = TAT_CA.find((f) => f.tep === "lib/elearning/nhan-su-chon.ts")!.ma;
    const xm = TAT_CA.find((f) => f.tep === "lib/elearning/nhan-su-chon-xac-minh.ts")!.ma;
    // Định nghĩa + `napNhanSuChon` ở tệp danh sách; cổng server gọi lại đúng hàm đó.
    expect([...ds.matchAll(/dieuKienNhanSuChon\(/g)].length, "định nghĩa + ô chọn").toBeGreaterThanOrEqual(2);
    expect([...xm.matchAll(/dieuKienNhanSuChon\(/g)].length, "cổng server").toBeGreaterThanOrEqual(1);
    // Điều kiện trạng thái chỉ khai ở MỘT nơi; cổng server không tự viết lại.
    expect(ds.match(/status:\s*"ACTIVE"/g) ?? [], "chỉ MỘT nơi khai `status: ACTIVE`").toHaveLength(1);
    expect(ds.match(/accountStatus:\s*"ACTIVE"/g) ?? [], "chỉ MỘT nơi khai `accountStatus`").toHaveLength(1);
    expect(xm).not.toMatch(/status:\s*"ACTIVE"/);
    expect(xm).not.toMatch(/accountStatus/);
  });

  it("[XMN-W7] `nhan-su-chon.ts` CLIENT-SAFE: chỉ `import type` (component client import hằng từ đây; import lúc chạy kéo `next/headers` vào bundle và `next build` đỏ)", () => {
    const goc = readFileSync(join(GOC, "lib/elearning/nhan-su-chon.ts"), "utf8");
    const dongImport = chiMa(goc).split("\n").filter((l) => /^\s*import\b/.test(l));
    expect(dongImport.length, "có import để kiểm").toBeGreaterThan(0);
    for (const l of dongImport) expect(l, "import lúc chạy trong tệp client-safe").toMatch(/^\s*import type\b/);
  });

  it("[XMN-W9] không test DB nào của `tests/elearning` gọi `resetDb()` (CI chạy các bộ DB tuần tự trên CÙNG một database; TRUNCATE xoá danh mục do migration seed và làm đỏ bộ hoa hồng/lead-intake chạy sau — sự cố 26/10/2026)", () => {
    const dir = join(GOC, "tests", "elearning");
    const vi = readdirSync(dir)
      .filter((f) => /\.(test|spec)\.ts$/.test(f))
      .filter((f) => /\bresetDb\s*\(/.test(chiMa(readFileSync(join(dir, f), "utf8"))))
      .map((f) => `tests/elearning/${f}`);
    expect(vi).toEqual([]);
  });

  it("[XMN-W8] không component `\"use client\"` nào import tệp xác minh phía server", () => {
    const vi = [...duyet(join(GOC, "app")), ...duyet(join(GOC, "components"))]
      .map((p) => ({ tep: rel(p), goc: readFileSync(p, "utf8") }))
      .filter((f) => /^\s*["']use client["']/.test(f.goc))
      .filter((f) => /nhan-su-chon-xac-minh/.test(chiMa(f.goc)))
      .map((f) => f.tep);
    expect(vi).toEqual([]);
  });
});
