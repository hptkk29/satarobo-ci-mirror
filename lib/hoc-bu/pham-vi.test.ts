// [PV-*] — MA TRẬN QUYỀN → PHẠM VI của module Học bù (T10). THUẦN: đọc thẳng `ROLE_SEED` (nguồn của prod sau khi bấm `seed-prod-roles.yml`), không cần DB.
//
// Bảng dưới là THỨ ĐANG ĐÚNG hôm nay — đo từ seed 08/10/2026. Đổi quyền của một vai là đổi bảng này CÓ CHỦ ĐÍCH (test đỏ buộc người đổi nhìn vào), không phải
// một chỉnh sửa seed lặng lẽ nới hay siết quyền học bù. Vai không có trong bảng PHẢI không có quyền học bù nào (ca [PV-03]).
import { describe, expect, it } from "vitest";
import { ROLE_SEED } from "@/prisma/seed-roles";
import { phamViTuQuyen } from "@/lib/hoc-bu/pham-vi";

const QUYEN = ["makeup:view", "makeup:view-all", "makeup:manage", "makeup:attend", "makeup:waive", "orders:create"] as const;
type Quyen = (typeof QUYEN)[number];

const CO = (...q: Quyen[]) => new Set<string>(q);

/** Vai → quyền liên quan học bù (+ tạo đơn). SUPER_ADMIN qua `isSuperAdmin`, PARENT không qua RBAC v2 của admin. */
const MA_TRAN: Record<string, Set<string>> = {
  CENTER_MANAGER: CO("makeup:view", "makeup:view-all", "makeup:manage", "makeup:attend", "makeup:waive", "orders:create"),
  CENTER_CLASS_MANAGER: CO("makeup:view", "makeup:view-all", "makeup:manage", "makeup:attend"),
  CENTER_SALES_CSM: CO("makeup:view", "makeup:manage", "orders:create"),
  TEACHER: CO("makeup:attend"),
  HO_ACCOUNTANT: CO("orders:create"),
};

const quyenCuaVai = (code: string): Set<string> => {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`không có vai ${code} trong ROLE_SEED`);
  return new Set(r.perms.map((p) => p.action).filter((a): a is Quyen => (QUYEN as readonly string[]).includes(a)));
};

describe("[PV] ma trận quyền → phạm vi học bù", () => {
  it("[PV-01] bảng quyền học bù (+ orders:create) của từng vai khớp seed", () => {
    for (const [vai, mong] of Object.entries(MA_TRAN)) expect([...quyenCuaVai(vai)].sort(), vai).toEqual([...mong].sort());
  });

  it("[PV-02] vai KHÔNG có trong bảng không có quyền học bù nào, và không ai ngoài hai vai tạo-đơn-được có `orders:create` mà lại có `makeup:manage`", () => {
    for (const r of ROLE_SEED) {
      if (r.code in MA_TRAN) continue;
      const q = quyenCuaVai(r.code);
      expect([...q].filter((a) => a.startsWith("makeup:")), `${r.code} có quyền học bù ngoài bảng`).toEqual([]);
      expect(q.has("orders:create"), `${r.code} có orders:create ngoài bảng`).toBe(false);
    }
  });

  it("[PV-03] phạm vi suy từ quyền: Sale (không view-all) chỉ học viên mình; giáo viên thường (không manage) chỉ case mình dạy; quản lý không bị buộc", () => {
    const pv = (vai: string) => phamViTuQuyen({ xemTatCa: quyenCuaVai(vai).has("makeup:view-all"), quanLy: quyenCuaVai(vai).has("makeup:manage") }, "u1");
    expect(pv("CENTER_MANAGER")).toEqual({ chiCuaSale: null, chiGv: undefined });
    expect(pv("CENTER_CLASS_MANAGER")).toEqual({ chiCuaSale: null, chiGv: undefined });
    expect(pv("CENTER_SALES_CSM")).toEqual({ chiCuaSale: "u1", chiGv: undefined }); // Sale: giới hạn học viên; điểm danh vốn không phải việc của Sale (không có makeup:attend)
    expect(pv("TEACHER")).toEqual({ chiCuaSale: "u1", chiGv: "u1" });
    expect(phamViTuQuyen({ xemTatCa: true, quanLy: true }, "u2")).toEqual({ chiCuaSale: null, chiGv: undefined });
    expect(phamViTuQuyen({ xemTatCa: false, quanLy: false }, "u2")).toEqual({ chiCuaSale: "u2", chiGv: "u2" });
  });

  it("[PV-04] TẠO PHÍ BÙ đòi CẢ `makeup:manage` LẪN `orders:create`: quản lý cơ sở và tư vấn được; quản lý lớp (không tạo được đơn), giáo viên, kế toán (không manage) thì không", () => {
    const tao = (vai: string) => quyenCuaVai(vai).has("makeup:manage") && quyenCuaVai(vai).has("orders:create");
    expect(tao("CENTER_MANAGER")).toBe(true);
    expect(tao("CENTER_SALES_CSM")).toBe(true);
    expect(tao("CENTER_CLASS_MANAGER")).toBe(false);
    expect(tao("TEACHER")).toBe(false);
    expect(tao("HO_ACCOUNTANT")).toBe(false);
  });

  it("[PV-05] MIỄN PHÍ ngoại lệ vẫn chỉ quản lý cơ sở (+ quản trị): không vai nào khác có `makeup:waive`", () => {
    const co = ROLE_SEED.filter((r) => quyenCuaVai(r.code).has("makeup:waive")).map((r) => r.code);
    expect(co).toEqual(["CENTER_MANAGER"]);
  });
});
