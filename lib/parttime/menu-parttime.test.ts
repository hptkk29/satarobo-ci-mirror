// [MENU-*] — mục Parttime trên menu chỉ hiện khi cơ sở LIÊN QUAN của người dùng bật Parttime (chủ dự án chốt 19/10/2026 —
// MENU_HIDDEN_WHEN_DISABLED). Ba phần: hàm xét theo cơ sở (`hienMucCongViecCuaToi`, DB giả lập ở đúng ranh giới) · sidebar GV vẽ / ẩn
// (render thật) · lưới DÂY NỐI layout → AppShell → CẢ HAI bản sidebar → SidebarNav và `loadModuleScope` → tab admin (luật 11: prop cờ
// không ai truyền là lỗi câm). Mọi ca "ẩn" có đối chứng dương.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { batTai, coNoiNaoBat, type PhamViCongTac } from "./cong-tac-thuan";

const st = vi.hoisted(() => ({
  pv: { macDinh: false, theoDonVi: new Map(), theoCoSo: new Map() } as PhamViCongTac,
  user: { centerId: "cs1" } as { centerId: string | null } | null,
  lop: [] as { centerId: string | null }[],
  pc: [] as { centerId: string }[],
  goi: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("./cong-tac", () => ({
  boXetCongTac: async () => ({ coNoiNao: coNoiNaoBat(st.pv), tai: (noi: { centerId?: string | null }) => coNoiNaoBat(st.pv) && batTai(st.pv, noi) }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: async () => (st.goi++, st.user) },
    class: { findMany: async () => (st.goi++, st.lop) },
    sessionStaffAssignment: { findMany: async () => (st.goi++, st.pc) },
  },
}));

const { hienMucCongViecCuaToi } = await import("./menu-parttime-db");
const chiBat = (...coSo: string[]): PhamViCongTac => ({ macDinh: false, theoDonVi: new Map(coSo.map((c) => [`ou-${c}`, true])), theoCoSo: new Map(coSo.map((c) => [c, true])) });

beforeEach(() => {
  st.pv = { macDinh: false, theoDonVi: new Map(), theoCoSo: new Map() };
  st.user = { centerId: "cs1" };
  st.lop = [];
  st.pc = [];
  st.goi = 0;
});

describe("[MENU] hienMucCongViecCuaToi — xét theo CƠ SỞ liên quan của người dùng", () => {
  it("[MENU-01] mọi công tắc TẮT ⇒ ẩn, KHÔNG câu tra DB nào (GV khi tắt không trả giá)", async () => {
    expect(await hienMucCongViecCuaToi("u", "2026-10-19")).toBe(false);
    expect(st.goi).toBe(0);
  });

  it("[MENU-03] CS2 BẬT, GV nhà CS2 ⇒ hiện", async () => {
    st.pv = chiBat("cs2");
    st.user = { centerId: "cs2" };
    expect(await hienMucCongViecCuaToi("u", "2026-10-19")).toBe(true);
  });

  it("[MENU-04] CS2 BẬT, GV nhà CS1 không lớp / phân công ở CS2 ⇒ ẩn (đối chứng: cùng GV đứng lớp ở CS2 ⇒ hiện)", async () => {
    st.pv = chiBat("cs2");
    expect(await hienMucCongViecCuaToi("u", "2026-10-19")).toBe(false);
    st.lop = [{ centerId: "cs2" }];
    expect(await hienMucCongViecCuaToi("u", "2026-10-19")).toBe(true);
  });

  it("[MENU-04B] GV CS1 được phân DẠY THAY ở CS2 (phân công Parttime ở CS2) ⇒ hiện", async () => {
    st.pv = chiBat("cs2");
    st.pc = [{ centerId: "cs2" }];
    expect(await hienMucCongViecCuaToi("u", "2026-10-19")).toBe(true);
  });

  it("[MENU-04C] bật toàn hệ thống nhưng CS1 ghi đè TẮT ⇒ GV chỉ ở CS1 bị ẩn", async () => {
    st.pv = { macDinh: true, theoDonVi: new Map([["ou-cs1", false]]), theoCoSo: new Map([["cs1", false]]) };
    expect(await hienMucCongViecCuaToi("u", "2026-10-19")).toBe(false);
    st.user = { centerId: "cs2" };
    expect(await hienMucCongViecCuaToi("u", "2026-10-19")).toBe(true);
  });
});

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
const dem = (s: string, x: string) => s.split(x).length - 1;

describe("[MENU-W] dây nối", () => {
  it("[MENU-W1] layout GV tính cờ bằng `hienMucCongViecCuaToi` và truyền vào AppShell; AppShell đưa xuống CẢ HAI bản sidebar (desktop + drawer)", () => {
    const L = doc("app/(teacher)/teacher/layout.tsx");
    expect(dem(L, "await hienMucCongViecCuaToi(session.user.id,")).toBe(1);
    expect(dem(L, "parttime={parttime}")).toBe(1);
    const A = doc("app/(teacher)/teacher/_components/app-shell.tsx");
    expect(dem(A, "parttime={parttime}")).toBe(2);
    const S = doc("app/(teacher)/teacher/_components/sidebar.tsx");
    expect(dem(S, "parttime={parttime}")).toBe(2);
    const N = doc("app/(teacher)/teacher/_components/sidebar-nav.tsx");
    expect(dem(N, "parttime={parttime}")).toBe(1);
    expect(dem(N, "group.items.filter((item) => !item.parttime || parttime)")).toBe(1);
  });

  it("[MENU-W2] mục 'Công việc của tôi' mang cờ `parttime` (href vẫn literal cho nav-coverage)", () => {
    const C = doc("app/(teacher)/teacher/_components/nav-config.ts");
    expect(dem(C, '{ label: "Công việc của tôi", href: "/teacher/phan-cong", icon: ClipboardList, parttime: true }')).toBe(1);
  });

  it("[MENU-W3] admin: `loadModuleScope` gắn công tắc STAFFING cho TỪNG khối; tab Phân công buổi xét khối", () => {
    const M = doc("lib/cham-cong/module-scope.ts");
    expect(dem(M, 'await boXetCongTac("STAFFING")')).toBe(1);
    expect(dem(M, "parttimeStaffing: parttime.tai({ centerId: b.id })")).toBe(1);
    const NAV = doc("components/admin/cham-cong/module-nav.tsx");
    expect(dem(NAV, "show: (s) => s.blocks.some((b) => b.parttimeStaffing && (b.perms[ASSIGN] || b.perms[VIEW]))")).toBe(1);
  });

  it("[MENU-07] vào thẳng đường dẫn khi TẮT: hai màn vẫn tự nói 'chưa bật' (không ghi được — cổng `congThaoTacParttime`, ca [FLAG-CENTER-02])", () => {
    const GV = doc("app/(teacher)/teacher/phan-cong/page.tsx");
    expect(dem(GV, "{!bat && (")).toBe(1);
    expect(GV).toContain("Trung tâm chưa bật phân công theo buổi.");
    const QL = doc("app/(admin)/admin/cham-cong/phan-cong/page.tsx");
    expect(dem(QL, "{!bat && (")).toBe(1);
    expect(QL).toContain("Phân công theo buổi chưa bật ở cơ sở này.");
    const ACT = doc("app/(admin)/admin/cham-cong/phan-cong/_actions.ts");
    expect(dem(ACT, "const ct = await congThaoTacParttime(loai, { centerId }, CHUA_BAT[loai]);")).toBe(1);
    expect(dem(ACT, '"STAFFING");')).toBeGreaterThanOrEqual(6);
  });
});
