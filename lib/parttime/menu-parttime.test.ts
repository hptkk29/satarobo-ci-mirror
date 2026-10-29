// [MENU-*] — mục Parttime trên menu SITE GIÁO VIÊN chỉ hiện khi cơ sở LIÊN QUAN của người dùng bật Parttime (chủ dự án chốt
// 19/10/2026 — MENU_HIDDEN_WHEN_DISABLED; 20/10/2026 GIỮ cho site GV, ĐẢO cho admin: tab admin luôn hiện kèm "Chưa bật" — ca [NAV-PT-*]
// ở components/admin/cham-cong/module-nav.test.tsx). Ba phần: hàm xét theo cơ sở (`hienMucCongViecCuaToi`, DB giả lập ở đúng ranh giới) · sidebar GV vẽ / ẩn
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
vi.mock("./bang-phan-cong", () => ({ docCongViecCuaToi: async () => [] }));
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

  it("[MENU-W2] hai mục Parttime ('Công việc của tôi', 'Công tháng của tôi') mang cờ `parttime` (href vẫn literal cho nav-coverage)", () => {
    const C = doc("app/(teacher)/teacher/_components/nav-config.ts");
    expect(dem(C, '{ label: "Công việc của tôi", href: "/teacher/phan-cong", icon: ClipboardList, parttime: true }')).toBe(1);
    expect(dem(C, '{ label: "Công tháng của tôi", href: "/teacher/phan-cong/thang", icon: CalendarCheck, parttime: true }')).toBe(1);
  });

  it("[MENU-W3] admin: `loadModuleScope` gắn công tắc STAFFING + ĐỐI SOÁT cho TỪNG khối; hai tab Parttime hiện theo `khoiParttime`, nhãn theo cờ", () => {
    const M = doc("lib/cham-cong/module-scope.ts");
    expect(dem(M, 'Promise.all([boXetCongTac("STAFFING"), boXetCongTac("WORKUNIT_SHADOW")])')).toBe(1);
    expect(dem(M, "parttimeStaffing: parttime.tai({ centerId: b.id })")).toBe(1);
    expect(dem(M, "parttimeShadow: parttimeBong.tai({ centerId: b.id })")).toBe(1);
    const NAV = doc("components/admin/cham-cong/module-nav.tsx");
    // Hai tab Parttime cùng phép hiện: Phân công (GĐ3 26/10/2026 gộp "Phân công buổi" + "Phân công giáo viên") · Công parttime tháng.
    expect(dem(NAV, "show: (s) => khoiParttime(s, null) !== null,")).toBe(2);
    // "Chưa bật" theo công tắc PHÂN CÔNG cho màn Phân công; màn tháng theo công tắc ĐỐI SOÁT.
    expect(dem(NAV, "chuaBat: (b) => !b.parttimeStaffing,")).toBe(1);
    expect(dem(NAV, "chuaBat: (b) => !b.parttimeShadow,")).toBe(1);
    // Hai trang chọn khối bằng CÙNG hàm — không còn bản chép tay.
    // `phan-cong-gv/page.tsx` nay chỉ là stub chuyển hướng 308 (GĐ3) — không chọn khối.
    for (const f of ["app/(admin)/admin/cham-cong/phan-cong/page.tsx", "app/(admin)/admin/cham-cong/phan-cong/thang/page.tsx"]) {
      const P = doc(f);
      expect(dem(P, "const pt = khoiParttime(scope, sp.coSo);")).toBe(1);
      expect(P).not.toContain("khoi.find((b) => b.parttimeStaffing)");
    }
  });

  it("[MENU-07] vào thẳng đường dẫn khi TẮT: hai màn vẫn tự nói 'chưa bật' (không ghi được — cổng `congThaoTacParttime`, ca [FLAG-CENTER-02])", () => {
    const GV = doc("app/(teacher)/teacher/phan-cong/page.tsx");
    expect(dem(GV, "{!bat && (")).toBe(1);
    expect(GV).toContain("Trung tâm chưa bật phân công theo buổi.");
    // "bật" của màn GV = CÙNG hàm quyết mục menu (cơ sở liên quan của người dùng), không "bật ở đâu đó".
    expect(dem(GV, "hienMucCongViecCuaToi(session.user.id, homNay),")).toBe(1);
    expect(GV).not.toContain("congTacBatODau");
    const QL = doc("app/(admin)/admin/cham-cong/phan-cong/page.tsx");
    expect(dem(QL, "{!bat && (")).toBe(1);
    expect(dem(QL, "<ParttimeChuaBat")).toBe(1);
    expect(dem(QL, 'checkPermission("settings:edit"),')).toBe(1);
    expect(dem(QL, "suaDuoc={suaCauHinh}")).toBe(1);
    const ACT = doc("app/(admin)/admin/cham-cong/phan-cong/_actions.ts");
    expect(dem(ACT, "const ct = await congThaoTacParttime(loai, { centerId }, CHUA_BAT[loai]);")).toBe(1);
    // 5: phân / đổi GV / huỷ / dựng mặc định / nhắc lại (đặt yêu cầu TA đã gỡ 20/10/2026).
    expect(dem(ACT, '"STAFFING");')).toBeGreaterThanOrEqual(5);
  });
});

describe("[MENU-GV] lối vào Công Parttime ở khu vực Chấm công / Tổng quan của site GV — cùng hàm với menu", () => {
  it("[MENU-GV1] Bảng công: đã mở ⇒ hai THẺ (Công việc / Công tháng); chưa mở ⇒ câu giải thích, KHÔNG thẻ nào", () => {
    const B = doc("app/(teacher)/teacher/bang-cong/page.tsx");
    expect(dem(B, "hienMucCongViecCuaToi(session.user.id, vnYmd(new Date())).catch(() => false),")).toBe(1);
    const mo = B.slice(B.indexOf("{parttime ? ("), B.indexOf(") : (", B.indexOf("{parttime ? (")));
    expect(dem(mo, 'href="/teacher/phan-cong"')).toBe(1);
    expect(dem(mo, 'href="/teacher/phan-cong/thang"')).toBe(1);
    const dong = B.slice(B.indexOf(") : (", B.indexOf("{parttime ? (")), B.indexOf("<NavLink", B.indexOf("{parttime ? (")));
    expect(dong).toContain("chưa mở ở cơ sở của bạn");
    expect(dong).not.toContain("href=");
  });

  it("[MENU-GV2] Công việc của tôi ⇄ Công tháng của tôi nối nhau bằng THẺ (không phải liên kết chữ)", () => {
    const CV = doc("app/(teacher)/teacher/phan-cong/page.tsx");
    // Lối sang tháng là THẺ, và là lối DUY NHẤT tới `/teacher/phan-cong/thang` trong màn (liên kết chữ cũ đã gỡ). 05/11/2026 (GĐ6):
    // thêm thẻ THỨ HAI "Ô công cần xem" ⇒ hai thẻ; thẻ tháng vẫn đứng TRƯỚC và vẫn là lối duy nhất tới `/thang`.
    expect(dem(CV, "<TheDieuHuong")).toBe(2);
    expect(dem(CV, 'href="/teacher/phan-cong/cong-o"')).toBe(1);
    expect(dem(CV, 'href="/teacher/phan-cong/thang"')).toBe(1);
    expect(CV.indexOf("<TheDieuHuong")).toBeLessThan(CV.indexOf('href="/teacher/phan-cong/thang"'));
    const CT = doc("app/(teacher)/teacher/phan-cong/thang/page.tsx");
    expect(dem(CT, '<TheDieuHuong href="/teacher/phan-cong" icon={ClipboardList} title="Công việc của tôi"')).toBe(1);
    expect(dem(CT, "hienMucCongViecCuaToi(session.user.id, vnYmd(now)),")).toBe(1);
  });

  it("[MENU-GV3] Tổng quan: dải 'chờ xác nhận' đếm bằng `demChoXacNhanCuaToi` (cùng `chiaTab` với tab)", () => {
    const T = doc("app/(teacher)/teacher/page.tsx");
    expect(dem(T, "demChoXacNhanCuaToi(session.user.id, vnYmd(now)).catch(() => null),")).toBe(1);
    expect(dem(T, 'href="/teacher/phan-cong?tab=can-xac-nhan"')).toBe(1);
  });

  it("[MENU-08] demChoXacNhanCuaToi: chưa mở ⇒ null (không câu tra nào); mở ⇒ số (0 khi không có gì chờ)", async () => {
    const { demChoXacNhanCuaToi } = await import("./menu-parttime-db");
    expect(await demChoXacNhanCuaToi("u", "2026-10-20")).toBeNull();
    expect(st.goi).toBe(0);
    st.pv = chiBat("cs1");
    expect(await demChoXacNhanCuaToi("u", "2026-10-20")).toBe(0);
  });
});
