// [PVW-*] — LƯỚI GHIM MÃ NGUỒN cho T10: phạm vi Sale / giáo viên đi theo người gọi và không action nào quên được.
//
// Test hành vi (`tests/hoc-bu/pham-vi.test.ts`) chứng minh dịch vụ chặn đúng. Thứ nó KHÔNG canh: một Server Action MỚI (hay action cũ bị sửa) gọi dịch vụ với
// người gọi KHÔNG mang phạm vi, hoặc điểm danh mà quên buộc "đúng giáo viên của case" — action đó vẫn xanh mọi test hành vi của nó.
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
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:\/\*\*|export (?:async )?function|(?:async )?function|export const|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
const vi = (s: string, x: string) => {
  const i = s.indexOf(x);
  expect(i, `không thấy "${x}"`).toBeGreaterThanOrEqual(0);
  return i;
};

const CASE = "lib/hoc-bu/case-db.ts";
const ACT = "app/(admin)/admin/hoc-bu/_actions.ts";

describe("[PVW] T10 — phạm vi đi theo người gọi", { timeout: 30_000 }, () => {
  it("[PVW-01] mọi hàm GHI chạm dòng cần bù / case nhận `NguoiHocBu` (không phải `Actor` trần) ⇒ không thể gọi mà quên khai phạm vi; `docDongTheoId` đòi tham số phạm vi", () => {
    const c = ma(CASE);
    for (const ten of ["taoCaseVaXep", "xepVaoCaseCoSan", "goKhoiCase", "goBeKhoiCase", "huyCase", "suaCase", "taoPhiBu", "mienPhiBu"]) {
      expect(than(c, ten).split("\n").slice(0, 4).join(" "), ten).toMatch(/actor: NguoiHocBu/);
    }
    expect(than(c, "kiemDongXep").split("\n").slice(0, 3).join(" ")).toMatch(/actor: NguoiHocBu/);
    const d = ma("lib/hoc-bu/danh-sach-db.ts");
    expect(d).toContain("export async function docDongTheoId(sdb: Sdb, ids: readonly string[], chiCuaSale: string | null)");
    expect(d).toContain("...(chiCuaSale ? { student: hocVienCuaSale(chiCuaSale) } : {})");
  });

  it("[PVW-02] các hàm Sale-giới-hạn gọi cổng sở hữu TRƯỚC phép ghi đầu tiên (trước `$transaction`); cổng dùng ĐÚNG quan hệ phụ trách `hocVienCuaSale`", () => {
    const c = ma(CASE);
    for (const ten of ["goKhoiCase", "goBeKhoiCase"]) {
      const t = than(c, ten);
      expect(vi(t, "chanNeuKhongCuaSale("), ten).toBeLessThan(vi(t, "$transaction("));
    }
    for (const ten of ["huyCase", "suaCase"]) {
      const t = than(c, ten);
      expect(vi(t, "chanNeuCaseCoBeNguoiKhac("), ten).toBeLessThan(vi(t, "$transaction("));
    }
    const g = c.slice(c.indexOf("async function chanNeuKhongCuaSale("), c.indexOf("async function chanNeuCaseCoBeNguoiKhac("));
    expect(g).toContain("if (actor.chiCuaSale === null) return;");
    expect(g).toContain("...hocVienCuaSale(actor.chiCuaSale)");
    expect(g).toContain("if (cua !== duy.length) throw new LoiHocBu(CAU_KHONG_CUA_SALE);");
    // Cổng "case có bé của người khác" nhìn CẢ bé tham gia LẪN mục chưa nâng cấp (case đời cũ).
    const k = c.slice(c.indexOf("async function chanNeuCaseCoBeNguoiKhac("), c.indexOf("async function phanLoaiBu("));
    expect(k).toContain('attendanceStatus: { not: "REMOVED" }');
    expect(k).toContain("participantId: null");
  });

  it("[PVW-03] `cong()` suy phạm vi từ quyền bằng MỘT hàm dùng chung (`phamViTuQuyen`) và đưa vào `actor` + `chiGv`; không action nào tự dựng người gọi khác", () => {
    const a = ma(ACT);
    const cong = than(a, "cong");
    expect(cong).toContain('checkPermission("makeup:view-all")');
    expect(cong).toContain('checkPermission("makeup:manage")');
    expect(cong).toContain("phamViTuQuyen(");
    expect(cong).toContain("nguoiHocBu(await resolveActor(session.user.id), chiCuaSale)");
    expect(a.replace(cong, "")).not.toContain("nguoiHocBu(");
  });

  it("[PVW-04] điểm danh / sửa điểm danh / đánh giá / gửi bài ở action ADMIN đều buộc `chiGiaoVien: n.chiGv` (giáo viên thường chỉ case mình dạy); gửi bài không còn `chiGiaoVien: null` cứng", () => {
    const a = ma(ACT);
    for (const ten of ["diemDanhBuAction", "nhanXetBuAction", "diemDanhBeAction", "suaDiemDanhBeAction"]) {
      expect(than(a, ten), ten).toContain("chiGiaoVien: n.chiGv");
    }
    const gui = than(a, "guiBaiKiemTraBuAction");
    expect(gui).toContain("chiGiaoVien: n.chiGv ?? null");
    expect(gui).not.toContain("chiGiaoVien: null,");
  });

  it("[PVW-05] TẠO PHÍ BÙ đòi `orders:create` (quyền có sẵn) TRƯỚC khi gọi `taoPhiBu`; miễn phí vẫn `makeup:waive`", () => {
    const a = ma(ACT);
    const t = than(a, "taoPhiBuAction");
    expect(vi(t, 'checkPermission("orders:create")')).toBeLessThan(vi(t, "taoPhiBu("));
    expect(vi(t, 'cong("makeup:manage")')).toBeLessThan(vi(t, 'checkPermission("orders:create")'));
    expect(than(a, "mienPhiBuAction")).toContain('cong("makeup:waive")');
    expect(than(a, "goMienPhiBuAction")).toContain('cong("makeup:waive")');
  });
});
