// @vitest-environment node
/**
 * [KHV-*] — KHOÁ THÊM HỌC VIÊN BẰNG TAY + IMPORT CỦA SALE (chủ dự án chốt 28/10/2026).
 *
 * Sự cố 06/09: Sale vào "Thêm học viên" tạo tay một bé, sáu phút sau lead của bé đó được chốt và
 * sinh hồ sơ thứ hai ⇒ một bé, hai hồ sơ.
 *
 * ⚠️ BẪY CẦN CANH: `students:create` KHÔNG chỉ gác "Thêm học viên" — nó còn gác ĐƯỜNG CHỐT LEAD
 * (`leads/[id]/convert`, `bulk-convert`, nút chốt trên `/leads`). Gỡ nó khỏi Sale là khoá luôn việc
 * chốt lead. Nên thêm khoá RIÊNG `students:create-manual` cho đúng đường tạo tay, và test này đo
 * ba kết quả CÙNG LÚC: Sale bị chặn tạo tay · Sale VẪN chốt được lead · QLCS vẫn tạo tay được.
 *
 * Ma trận gõ tay (không suy từ seed — suy từ seed thì chỉ kiểm seed bằng chính nó). Lên prod phải
 * bấm `seed-prod-roles.yml` (RBAC v2 đọc quyền từ DB; khoá mới chưa có trong DB ⇒ chỉ SUPER_ADMIN).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { can } from "@/lib/auth/permissions";
import { ALL_MODULE_DECLS, collectDescriptors } from "@/lib/permissions/registry";
import { ROLE_SEED } from "../../prisma/seed-roles";

const giu = (code: string): string[] => {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return r.perms.map((p) => p.action);
};

describe("[KHV-01] v1 (ma trận tĩnh): Sale chặn tạo tay + import, VẪN chốt được lead", () => {
  it("Sale KHÔNG thêm học viên tay, KHÔNG import", () => {
    expect(can("SALES_CSM", "students:create-manual")).toBe(false);
    expect(can("SALES_CSM", "students:import")).toBe(false);
  });
  it("⚠️ Sale VẪN qua cổng chốt lead (students:create + enrollments:create)", () => {
    expect(can("SALES_CSM", "students:create")).toBe(true);
    expect(can("SALES_CSM", "enrollments:create")).toBe(true);
  });
  it("đối chứng dương: QLCS và Quản trị tối cao vẫn thêm tay được", () => {
    expect(can("CENTER_MANAGER", "students:create-manual")).toBe(true);
    expect(can("SUPER_ADMIN", "students:create-manual")).toBe(true);
    expect(can("CENTER_MANAGER", "students:import")).toBe(true);
  });
});

describe("[KHV-02] v2 (RoleDef trong seed): cùng một kết quả", () => {
  it("CENTER_SALES_CSM: giữ students:create, KHÔNG có create-manual / import", () => {
    const sale = giu("CENTER_SALES_CSM");
    expect(sale).toContain("students:create");
    expect(sale).not.toContain("students:create-manual");
    expect(sale).not.toContain("students:import");
  });
  it("CENTER_MANAGER: có create-manual + create + import", () => {
    const qlcs = giu("CENTER_MANAGER");
    for (const k of ["students:create-manual", "students:create", "students:import"]) expect(qlcs).toContain(k);
  });
  it("⚠️ đúng MỘT vai giữ create-manual: không vai nào khác vô tình được cấp", () => {
    const ai = ROLE_SEED.filter((r) => r.perms.some((p) => p.action === "students:create-manual")).map((r) => r.code);
    expect(ai).toEqual(["CENTER_MANAGER"]);
  });
  it("khoá có trong registry (deploy tự đồng bộ registry, còn seed vai trên prod thì bấm tay)", () => {
    expect(collectDescriptors(ALL_MODULE_DECLS).has("students:create-manual")).toBe(true);
  });
});

describe("[KHV-03] dây nối: giao diện, trang, server action cùng một khoá", () => {
  const goc = process.cwd();
  /** Gỡ chú thích trước khi soi — chú thích giải thích bản vá có nhắc đúng các chuỗi này. */
  const doc = (p: string) =>
    fs
      .readFileSync(path.join(goc, p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

  it("nút 'Thêm học viên' và 'Import Excel' đi theo khoá RIÊNG, không theo students:create", () => {
    const t = doc("app/(admin)/admin/students/page.tsx");
    expect(t).toMatch(/canThemTay\s*=\s*await checkPermission\("students:create-manual"\)/);
    expect(t).toMatch(/canImport\s*=\s*await checkPermission\("students:import"\)/);
    expect(t).toMatch(/\{canThemTay && \(/);
    expect(t).toMatch(/\{canImport && \(/);
  });
  it("trang /students/new và action createStudent gác bằng create-manual", () => {
    expect(doc("app/(admin)/admin/students/new/page.tsx")).toContain('checkPermission("students:create-manual")');
    expect(doc("app/(admin)/admin/students/_actions.ts")).toMatch(/create:\s*"students:create-manual"/);
  });
  it("trang /students/import có cổng ở SERVER cùng khoá với API (không chỉ API chặn)", () => {
    expect(doc("app/(admin)/admin/students/import/layout.tsx")).toContain('checkPermission("students:import")');
    expect(doc("app/api/admin/import/students/route.ts")).toContain('checkPermission("students:import")');
  });
  it("⚠️ đường CHỐT LEAD vẫn gác bằng students:create — KHÔNG bị kéo sang create-manual", () => {
    // Đọc nguyên văn (không gỡ chú thích): ba tệp này không nhắc `create-manual` ở đâu cả, nên
    // chỉ cần "không có chuỗi" — còn bộ gỡ chú thích dựa trên regex có thể nuốt nhầm đoạn mã.
    const doc = (p: string) => fs.readFileSync(path.join(goc, p), "utf8");
    for (const f of [
      "app/(admin)/admin/leads/[id]/convert/actions.ts",
      "app/(admin)/admin/leads/bulk-convert/_actions.ts",
      "app/(admin)/admin/leads/page.tsx",
      "app/(admin)/admin/leads/[id]/page.tsx",
    ]) {
      const t = doc(f);
      expect(t, f).toMatch(/students:create['"]/);
      expect(t, f).not.toContain("create-manual");
    }
  });
  it("đường chốt lead theo ĐƠN (`/orders/<id>/chuyen-doi`) gác bằng enrollments:create — không dính khoá tạo tay", () => {
    const t = fs.readFileSync(path.join(goc, "app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts"), "utf8");
    expect(t).toContain('checkPermission("enrollments:create")');
    expect(t).not.toContain("create-manual");
  });
  it("createStudent chặn hồ sơ trùng trước khi tạo", () => {
    const t = doc("app/(admin)/admin/students/_actions.ts");
    expect(t.match(/timHocVienTrungKhiTaoTay\(/g)?.length).toBe(1);
  });
});
