// @vitest-environment node
/**
 * [KMP-*] — QLCS ban hành khuyến mãi (01/11/2026): phép đo phạm vi theo cơ sở + ma trận quyền + dây nối ở action.
 *
 * Bẫy cần canh (CLAUDE.md — "cho một vai mới vào một màn cũ, đo lại mọi giả định người xem thấy được mọi thứ"): màn viết cho
 * Ban lãnh đạo nên action chỉ hỏi "có `promotions:manage` không". Mở quyền cho vai bị giới hạn theo cơ sở mà không đo phạm vi là
 * hai lỗ câm: bỏ trống ô cơ sở = ban hành TOÀN HỆ THỐNG; sửa/thu hồi chính sách của cơ sở khác.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { can } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";
import { duocLamViecVoi, locCoSoChoNguoiDung, phamViKhuyenMai, type ActorPhamViKm } from "./quyen-co-so";

const actor = (o: Partial<ActorPhamViKm> & { perms?: ActorPhamViKm["permissions"] } = {}): ActorPhamViKm => ({
  isSuperAdmin: false,
  grantsAllow: new Set<string>(),
  permissions: o.perms ?? [],
  ...o,
});
const manage = (orgUnitScope?: "ALL" | string[] | null) => ({ action: "promotions:manage", orgUnitScope });

describe("[KMP-01] phamViKhuyenMai — từ quyền của actor", () => {
  it("Quản trị tối cao / grant riêng / neo Hội sở (ALL) ⇒ TẤT CẢ", () => {
    expect(phamViKhuyenMai(actor({ isSuperAdmin: true }))).toBe("TAT_CA");
    expect(phamViKhuyenMai(actor({ grantsAllow: new Set(["promotions:manage"]) }))).toBe("TAT_CA");
    expect(phamViKhuyenMai(actor({ perms: [manage("ALL")] }))).toBe("TAT_CA");
  });
  it("neo ở cơ sở ⇒ đúng tập OrgUnit của quyền ĐÓ; hợp nhiều quyền; bỏ qua quyền khác tên", () => {
    expect(phamViKhuyenMai(actor({ perms: [manage(["cs1"])] }))).toEqual(["cs1"]);
    expect([...(phamViKhuyenMai(actor({ perms: [manage(["cs1"]), manage(["cs2", "cs1"])] })) as string[])].sort()).toEqual(["cs1", "cs2"]);
    expect(phamViKhuyenMai(actor({ perms: [{ action: "promotions:view", orgUnitScope: "ALL" }, manage(["cs1"])] }))).toEqual(["cs1"]);
  });
  it("⚠️ fail-closed: quyền thiếu `orgUnitScope` / null / không có quyền ⇒ [] (KHÔNG BAO GIỜ rơi về TẤT CẢ)", () => {
    expect(phamViKhuyenMai(actor({ perms: [manage(undefined)] }))).toEqual([]);
    expect(phamViKhuyenMai(actor({ perms: [manage(null)] }))).toEqual([]);
    expect(phamViKhuyenMai(actor())).toEqual([]);
  });
});

describe("[KMP-02] duocLamViecVoi — chính sách phải nằm TRỌN trong phạm vi và phải nêu rõ cơ sở", () => {
  it("phạm vi TẤT CẢ làm được mọi thứ, kể cả chính sách toàn hệ thống (rỗng)", () => {
    expect(duocLamViecVoi("TAT_CA", [])).toBe(true);
    expect(duocLamViecVoi("TAT_CA", ["cs1", "cs9"])).toBe(true);
  });
  it("phạm vi hẹp: mọi cơ sở của chính sách ∈ phạm vi ⇒ được", () => {
    expect(duocLamViecVoi(["cs1"], ["cs1"])).toBe(true);
    expect(duocLamViecVoi(["cs1", "cs2"], ["cs2", "cs1"])).toBe(true);
  });
  it("⚠️ phạm vi hẹp: chính sách RỖNG (toàn hệ thống) ⇒ KHÔNG — rỗng không phải 'không cơ sở nào'", () => {
    expect(duocLamViecVoi(["cs1"], [])).toBe(false);
    expect(duocLamViecVoi([], [])).toBe(false);
  });
  it("⚠️ phạm vi hẹp: chỉ cần MỘT cơ sở ngoài phạm vi là bị chặn (không chấp nhận 'giao một phần')", () => {
    expect(duocLamViecVoi(["cs1"], ["cs1", "cs2"])).toBe(false);
    expect(duocLamViecVoi(["cs1"], ["cs2"])).toBe(false);
  });
});

describe("[KMP-03] locCoSoChoNguoiDung — ô chọn cơ sở trên form", () => {
  const ds = [{ id: "cs1" }, { id: "cs2" }, { id: "cs3" }];
  it("TẤT CẢ thấy mọi cơ sở; phạm vi hẹp chỉ thấy cơ sở của mình", () => {
    expect(locCoSoChoNguoiDung("TAT_CA", ds)).toHaveLength(3);
    expect(locCoSoChoNguoiDung(["cs2"], ds)).toEqual([{ id: "cs2" }]);
    expect(locCoSoChoNguoiDung([], ds)).toEqual([]);
  });
});

describe("[KMP-04] ma trận quyền: Quản lý cơ sở có promotions:manage; Sale / kế toán KHÔNG", () => {
  const giu = (code: string) => ROLE_SEED.find((r) => r.code === code)!.perms.map((p) => p.action);
  it("v1 (ma trận tĩnh)", () => {
    expect(can("CENTER_MANAGER", "promotions:manage")).toBe(true);
    expect(can("SUPER_ADMIN", "promotions:manage")).toBe(true);
    for (const r of ["SALES_CSM", "ACCOUNTANT", "MARKETING", "TEACHER"] as const) expect(can(r, "promotions:manage"), r).toBe(false);
  });
  it("v2 (RoleDef trong seed): đúng QLCS + Giám đốc, không vai nào khác", () => {
    const ai = ROLE_SEED.filter((r) => r.perms.some((p) => p.action === "promotions:manage")).map((r) => r.code).sort();
    expect(ai).toEqual(["CENTER_MANAGER", "GIAM_DOC"]);
    expect(giu("CENTER_MANAGER")).toContain("promotions:view");
  });
});

describe("[KMP-05] dây nối: MỌI Server Action đo phạm vi từ DB trước khi gọi nghiệp vụ", () => {
  const goc = process.cwd();
  const NGUON = fs
    .readFileSync(path.join(goc, "app/(admin)/admin/khuyen-mai/_actions.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  const ham = NGUON.split(/export async function /).slice(1).map((p) => ({ ten: p.slice(0, p.indexOf("(")), than: p }));
  const NGHIEP_VU = /\b(banHanhChinhSach|suaChinhSach|thuHoiChinhSach|themVoucher|batTatVoucher)\(/;

  it("đúng 5 action và mỗi action gọi `duocLamViecVoi(` TRƯỚC lời gọi nghiệp vụ", () => {
    expect(ham).toHaveLength(5);
    for (const h of ham) {
      const vi = h.than.indexOf("duocLamViecVoi(");
      const nv = NGHIEP_VU.exec(h.than);
      expect(vi, `${h.ten}: thiếu kiểm phạm vi`).toBeGreaterThan(-1);
      expect(nv, `${h.ten}: không thấy lời gọi nghiệp vụ`).not.toBeNull();
      expect(vi, `${h.ten}: phạm vi phải đứng TRƯỚC nghiệp vụ`).toBeLessThan(nv!.index);
    }
  });
  it("⚠️ chính sách của mã voucher suy từ CHÍNH mã (DB) — không tin id chính sách client gửi kèm", () => {
    const bat = ham.find((h) => h.ten === "batTatVoucherAction")!;
    expect(bat.than).toContain("coSoCuaVoucher(p.data.id)");
    expect(bat.than).not.toMatch(/coSoCuaChinhSach\(\s*chinhSachId/);
  });
  it("sửa kiểm CẢ cơ sở hiện có LẪN cơ sở mới (hai vế)", () => {
    const sua = ham.find((h) => h.ten === "suaAction")!;
    expect(sua.than).toMatch(/duocLamViecVoi\(pv, coSoCu\)\s*&&\s*duocLamViecVoi\(pv, p\.data\.coSo\)/);
  });
  it("ba trang (ban hành · sửa · chi tiết) dùng cùng phép đo — nút chỉ hiện khi làm được thật", () => {
    for (const f of [
      "app/(admin)/admin/khuyen-mai/moi/page.tsx",
      "app/(admin)/admin/khuyen-mai/[id]/sua/page.tsx",
      "app/(admin)/admin/khuyen-mai/[id]/page.tsx",
    ]) {
      expect(fs.readFileSync(path.join(goc, f), "utf8"), f).toContain("phamViKhuyenMai(");
    }
    expect(fs.readFileSync(path.join(goc, "app/(admin)/admin/khuyen-mai/[id]/page.tsx"), "utf8")).toContain("duocLamViecVoi(");
  });
});
