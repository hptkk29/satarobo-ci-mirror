// [GVCS-*] — "giáo viên của cơ sở" cho màn Phân công buổi (20/10/2026). Đo prod CS2: lọc theo `User.centerId` bỏ sót 4 giáo viên
// đang dạy / có vai GV ở CS2 mà `centerId` trống. DB giả lập ở đúng ranh giới (bốn câu đọc), mỗi ca "không có" kèm đối chứng.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; name: string; centerId: string | null; teacher: boolean; active?: boolean };
const st = vi.hoisted(() => ({
  ous: [] as { id: string; centerId: string }[],
  lop: [] as { centerId: string; teacherId: string | null; assistantId: string | null }[],
  uor: [] as { userId: string; orgUnitId: string }[],
  users: [] as U[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    orgUnit: { findMany: async ({ where }: { where: { centerId: { in: string[] } } }) => st.ous.filter((o) => where.centerId.in.includes(o.centerId)) },
    class: { findMany: async ({ where }: { where: { centerId: { in: string[] } } }) => st.lop.filter((l) => where.centerId.in.includes(l.centerId)) },
    userOrgRole: { findMany: async ({ where }: { where: { orgUnitId: { in: string[] } } }) => st.uor.filter((r) => where.orgUnitId.in.includes(r.orgUnitId)) },
    user: {
      // Mô phỏng ĐÚNG điều kiện `where` của hàm: active + giáo viên + (nhà thuộc cơ sở HOẶC id trong ứng viên).
      findMany: async ({ where }: { where: { AND: [unknown, { OR: [{ centerId: { in: string[] } }, { id: { in: string[] } }] }] } }) => {
        const [nha, ung] = where.AND[1].OR;
        return st.users
          .filter((u) => (u.active ?? true) && u.teacher && ((u.centerId && nha.centerId.in.includes(u.centerId)) || ung.id.in.includes(u.id)))
          .sort((a, b) => a.name.localeCompare(b.name));
      },
    },
  },
}));

const { docGiaoVienCuaCoSo, laGiaoVienCuaCoSo, nhomTheoCoSo } = await import("./giao-vien-co-so");

beforeEach(() => {
  st.ous = [{ id: "ou1", centerId: "cs1" }, { id: "ou2", centerId: "cs2" }];
  st.lop = [{ centerId: "cs2", teacherId: "thuan", assistantId: "my" }];
  st.uor = [{ userId: "tuan", orgUnitId: "ou2" }];
  st.users = [
    { id: "tra", name: "Bích Trà", centerId: "cs2", teacher: true },
    { id: "thuan", name: "Nhật Thuận", centerId: null, teacher: true },
    { id: "my", name: "Trà My", centerId: null, teacher: true },
    { id: "tuan", name: "Đức Tuấn", centerId: null, teacher: true },
    { id: "a1", name: "An CS1", centerId: "cs1", teacher: true },
    { id: "sale", name: "Sale CS2", centerId: "cs2", teacher: false },
  ];
});

describe("[GVCS] docGiaoVienCuaCoSo", () => {
  it("[GVCS-01] CS2: cơ sở nhà ∪ vai GV tại đơn vị ∪ GV/TA của lớp — đủ 4 người (trước chỉ 1); không lấy người không phải GV", async () => {
    const ds = await docGiaoVienCuaCoSo(["cs2"]);
    expect(ds.map((g) => g.id).sort()).toEqual(["my", "thuan", "tra", "tuan"]);
    expect(ds.find((g) => g.id === "sale")).toBeUndefined();
  });
  it("[GVCS-02] QLCS chỉ CS2 KHÔNG thấy GV chỉ thuộc CS1 (đối chứng: quản lý cả CS1 ⇒ thấy, nhóm CS1)", async () => {
    expect((await docGiaoVienCuaCoSo(["cs2"])).some((g) => g.id === "a1")).toBe(false);
    const ca2 = await docGiaoVienCuaCoSo(["cs2", "cs1"]);
    expect(ca2.find((g) => g.id === "a1")?.coSo).toEqual(["cs1"]);
  });
  it("[GVCS-03] người dạy hai cơ sở nằm ở nhóm cơ sở ĐANG XEM (đứng đầu đầu vào)", async () => {
    st.lop.push({ centerId: "cs1", teacherId: "tra", assistantId: null });
    const ds = await docGiaoVienCuaCoSo(["cs1", "cs2"]);
    expect(ds.find((g) => g.id === "tra")?.coSo).toEqual(["cs1", "cs2"]);
    const n = nhomTheoCoSo(ds, ["cs1", "cs2"]);
    expect(n[0].centerId).toBe("cs1");
    expect(n[0].ds.map((g) => g.id)).toContain("tra");
    expect(n.flatMap((x) => x.ds).filter((g) => g.id === "tra")).toHaveLength(1);
  });
  it("[GVCS-04] cổng ghi: người ngoài cơ sở quản lý ⇒ false; trong ⇒ true; danh sách cơ sở rỗng ⇒ false (fail-closed)", async () => {
    expect(await laGiaoVienCuaCoSo("a1", ["cs2"])).toBe(false);
    expect(await laGiaoVienCuaCoSo("thuan", ["cs2"])).toBe(true);
    expect(await laGiaoVienCuaCoSo("thuan", [])).toBe(false);
  });
});

describe("[GVCS-W] dây nối", () => {
  const doc = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8").replace(/^\s*\/\/.*$/gm, "");
  it("[GVCS-W1] màn Phân công buổi lấy danh sách bằng docGiaoVienCuaCoSo trên cơ sở đang xem + cơ sở phân công được", () => {
    const P = doc("app/(admin)/admin/cham-cong/phan-cong/page.tsx");
    expect(P.split("docGiaoVienCuaCoSo(coSoPhan),").length - 1).toBe(1);
    expect(P).toContain("scope.blocksWith(ASSIGN)");
    expect(P).not.toContain("getAssignableTeachers");
  });
  it("[GVCS-W2] HAI action nhận userId (phân + đổi GV chính) đều qua kiemNguoiDuocPhan TRƯỚC giao dịch", () => {
    const A = doc("app/(admin)/admin/cham-cong/phan-cong/_actions.ts");
    expect(A.split("const kn = await kiemNguoiDuocPhan(p.data.userId, centerId!, g.actor.id);").length - 1).toBe(2);
    // Thứ ba: "Sửa buổi đã qua" (20/10/2026) kiểm TỪNG người được chọn (GV chính · TA · người thực dạy) trong một vòng.
    expect(A.split("if (!kn.ok) return kn;").length - 1).toBe(3);
    expect(A).toContain("const kn = await kiemNguoiDuocPhan(u, centerId!, g.actor.id);");
    expect(A).toContain("if (await laGiaoVienCuaCoSo(userId, [centerIdBuoi, ...quanLy])) return { ok: true };");
  });
});
