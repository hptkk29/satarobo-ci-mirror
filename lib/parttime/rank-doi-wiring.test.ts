// [RDW-*] — LƯỚI GHIM DÂY NỐI cho chốt 25/10/2026: "bỏ chờ người khác duyệt — chỉ Giám đốc · QTTC · Đào tạo đổi Rank, áp ngay; màn Rank là
// màn con của mục Giáo viên, không còn ở sidebar". Action ghi chạm DB nên test hành vi không gọi được nó; thứ cần khoá là CỔNG của action và
// việc luồng đề xuất cũ không sống lại ở chỗ nào.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");

function moiTep(goc: string, out: string[] = []): string[] {
  for (const ten of readdirSync(goc)) {
    const p = join(goc, ten);
    if (statSync(p).isDirectory()) {
      if (ten !== "node_modules" && !ten.startsWith(".")) moiTep(p, out);
    } else if (/\.(ts|tsx)$/.test(ten) && !/\.test\.tsx?$/.test(ten)) out.push(p);
  }
  return out;
}

describe("[RDW] đổi Rank áp ngay — cổng + không còn luồng đề xuất", () => {
  const ACTION = "app/(admin)/admin/teachers/rank/_actions.ts";

  it("[RDW-01] doiRankAction gác bằng parttime_rank:approve (GLOBAL — Giám đốc · QTTC · Đào tạo) TRƯỚC khi ghi", () => {
    const s = doc(ACTION);
    const than = s.slice(s.indexOf("export async function doiRankAction"), s.indexOf("export async function capChungNhanAction"));
    const cong = than.indexOf('checkPermission("parttime_rank:approve")');
    const ghi = than.indexOf("doiRank(tx");
    expect(cong).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(cong);
    expect(than).toMatch(/if \(!\(await checkPermission\("parttime_rank:approve"\)\)\) return \{ ok: false/);
  });

  it("[RDW-02] không đường chạy thật nào còn hỏi / cấp parttime_rank:propose, không còn action đề xuất / duyệt", () => {
    const tep = [...moiTep("app"), ...moiTep("lib"), ...moiTep("components"), "prisma/seed-roles.ts"];
    const con = tep.filter((f) => /parttime_rank:propose|deXuatRankAction|quyetRankAction/.test(doc(f)));
    expect(con).toEqual([]);
  });

  it("[RDW-03] sidebar không còn mục Rank riêng; mục Giáo viên mở cho người chỉ có quyền xem Rank", () => {
    const s = doc("components/admin/sidebar.tsx");
    expect(s).not.toMatch(/href: "\/nhan-su\/rank-gv"/);
    expect(s).toMatch(/\{ label: "Giáo viên", href: "\/teachers", icon: UserCog, perm: \["employees:view-all", "parttime_rank:view"\] \}/);
  });

  it("[RDW-04] /teachers đưa người chỉ có quyền Rank sang /teachers/rank (không đá về Dashboard)", () => {
    const s = doc("app/(admin)/admin/teachers/page.tsx");
    expect(s).toMatch(/redirect\(\(await xemRankOMotCoSo\(\)\) \? "\/teachers\/rank" : "\/dashboard"\)/);
  });
});
