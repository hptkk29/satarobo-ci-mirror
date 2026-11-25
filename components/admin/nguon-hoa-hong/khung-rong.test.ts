// @vitest-environment node
/**
 * [KR-*] — khung nội dung của module «Nguồn Lead & Hoa hồng» phải căn GIỮA và mở rộng theo màn (phản ánh 13/10/2026: màn 2K nội dung dính mép trái, nửa phải trống).
 *
 *   [KR-01] hằng `KHUNG_NOI_DUNG`: có `mx-auto` + `w-full` (căn giữa, màn nhỏ lấp đầy) và bậc mở rộng cho 1536 / 1920 / 2560 / 3840px
 *   [KR-02] không tệp nào của module còn dùng `max-w-6xl` TRẦN (không `mx-auto`) làm khung trang — khung thật, khung tải và khung lỗi cùng dùng MỘT hằng
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KHUNG_NOI_DUNG } from "./khung-rong";

describe("[KR-01] hằng khung nội dung", () => {
  it("căn giữa + lấp đầy + bậc mở rộng đến màn 4K/8K", () => {
    const lop = KHUNG_NOI_DUNG.split(/\s+/);
    expect(lop).toContain("mx-auto");
    expect(lop).toContain("w-full");
    expect(lop).toContain("max-w-6xl"); // đáy: đúng bề ngang cũ ở màn thường
    for (const bac of ["min-[1536px]:", "min-[1920px]:", "min-[2560px]:", "min-[3840px]:"]) {
      expect(lop.some((c) => c.startsWith(bac)), bac).toBe(true);
    }
  });
});

describe("[KR-02] mọi khung của module dùng chung hằng", () => {
  const goc = process.cwd();
  const tep = execFileSync("git", ["ls-files", "--", "components/admin/nguon-hoa-hong", "app/(admin)/admin/nguon-hoa-hong"], { cwd: goc, encoding: "utf8" })
    .split("\n")
    .filter((t) => /\.tsx$/.test(t) && !/\.test\./.test(t));
  it("có tệp để quét (đối chứng)", () => {
    expect(tep.length).toBeGreaterThan(30);
  });
  it('không còn className="max-w-6xl" trần', () => {
    const vi = tep.filter((t) => /className="max-w-6xl"/.test(readFileSync(resolve(goc, t), "utf8")));
    expect(vi).toEqual([]);
  });
  it("khung thật · khung tải · khung lỗi đều import KHUNG_NOI_DUNG", () => {
    for (const t of ["components/admin/nguon-hoa-hong/khung-module.tsx", "components/admin/nguon-hoa-hong/skeletons.tsx", "components/admin/nguon-hoa-hong/route-error.tsx"]) {
      expect(readFileSync(resolve(goc, t), "utf8"), t).toContain("KHUNG_NOI_DUNG");
    }
  });
});
