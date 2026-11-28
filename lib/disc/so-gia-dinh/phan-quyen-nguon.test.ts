import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * [PQN] LƯỚI NGUỒN — «mọi đường vào dữ liệu sổ DISC đều đi qua cổng PIN ép ở máy chủ» (V8.31). Không thay cho test hành vi (`tests/mobile-api/disc-pin-may-chu.spec.ts`) — nó canh chuyện
 * NGƯỜI SAU THÊM MỘT ĐƯỜNG MỚI mà quên cổng: test hành vi chỉ thử các route đã biết, lưới này LIỆT KÊ lại từ cây mã nguồn.
 *   [PQN-01] mọi hàm dịch vụ Mobile nhận `nguoi: NguoiGoi` đều gọi `baoVeDisc(nguoi` (trừ danh sách khởi tạo có lý do) và hàm nhận `userId: string` thô chỉ có đúng danh sách cho phép
 *   [PQN-02] mọi route Mobile dưới `parent/disc` (+ robot tính cách) chỉ gọi dịch vụ, truyền `nguoi` (không `nguoi.userId` — trừ đường khởi tạo `book`)
 *   [PQN-03] mọi tệp web dưới `portal/disc` có cổng (`yeuCauPhienDisc` / `docPhienDisc` / `voiPhien`) và mọi lời gọi có `phamVi:` TƯỜNG MINH
 *   [PQN-04] chỉ danh sách tệp biết trước được import module đọc/ghi DB của sổ DISC — thêm nơi import mới ⇒ đỏ (phải thêm cổng rồi mới thêm vào danh sách)
 *   [PQN-05] không nơi nào ngoài `mo-khoa.ts`/`ghi-dich-vu` tự đọc hay ghi bảng `discUnlockSession` (một nguồn duy nhất cho hiệu lực phiên)
 */
const GOC = process.cwd();
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");
const tep = (d: string, ra: string[] = []): string[] => {
  for (const t of readdirSync(d)) {
    if (t === "node_modules" || t === ".next") continue;
    const p = join(d, t);
    if (statSync(p).isDirectory()) tep(p, ra);
    else if (/\.(ts|tsx)$/.test(t) && !/\.(test|spec)\.(ts|tsx)$/.test(t)) ra.push(p);
  }
  return ra;
};
const tuongDoi = (p: string) => relative(GOC, p).split(sep).join("/");

/** Cắt thân hàm `export async function ten(` đến `export ` kế tiếp. */
function thanHam(ma: string, ten: string): string {
  const i = ma.indexOf(`export async function ${ten}(`);
  if (i < 0) throw new Error(`không thấy hàm ${ten}`);
  const sau = ma.indexOf("\nexport ", i + 10);
  return ma.slice(i, sau < 0 ? undefined : sau);
}

describe("[PQN] mọi đường vào dữ liệu sổ DISC đi qua cổng PIN máy chủ", () => {
  const DV = boChuThich(doc("lib/mobile-api/dich-vu/disc.ts"));

  it("[PQN-01] dịch vụ Mobile: hàm nhận `nguoi` đều gọi baoVeDisc(nguoi …); hàm nhận userId thô chỉ trong danh sách cho phép", () => {
    // Đường khởi tạo / quản trị PIN: tự xử lý quyền bên trong `mo-khoa.ts` (đặt/đổi/mở/khoá/trạng thái) — không thể đòi «đã mở khoá» để MỞ KHOÁ.
    const KHOI_TAO_PIN = ["docTrangThaiPinSo", "datPinSo", "xacNhanPinSo", "khoaLaiSo", "cheDoTreEmSo"];
    const ham = [...DV.matchAll(/export async function (\w+)\((\w+): ([\w<>]+)/g)];
    expect(ham.length).toBeGreaterThanOrEqual(20); // phép liệt kê có dữ liệu thật
    const thieu: string[] = [];
    const thoUserId: string[] = [];
    for (const [, ten, tham, kieu] of ham) {
      if (kieu === "NguoiGoi") {
        if (KHOI_TAO_PIN.includes(ten!)) continue;
        if (!new RegExp(`baoVeDisc\\(${tham}\\b`).test(thanHam(DV, ten!))) thieu.push(ten!);
      } else if (tham === "userId") {
        thoUserId.push(ten!);
      }
    }
    expect(thieu, "hàm dịch vụ nhận `nguoi` mà KHÔNG gọi baoVeDisc").toEqual([]);
    // `taoSoGiaDinh`: chưa có sổ ⇒ chưa có PIN để bảo vệ. `docBaoCaoCaNhanKhongKiem`: CHỈ gọi sau `baoVeDisc` ở robot-tinh-cach (kiểm ở dưới).
    expect(thoUserId.sort()).toEqual(["docBaoCaoCaNhanKhongKiem", "taoSoGiaDinh"]);
    const robot = boChuThich(doc("lib/mobile-api/dich-vu/robot-tinh-cach.ts"));
    // Robot: `docRobotCuaHocVien` (đọc báo cáo qua `docBaoCaoCaNhanKhongKiem`, KHÔNG tự kiểm quyền) chỉ có HAI nơi gọi — (1) đường phụ huynh SAU `baoVeDisc(nguoi`, (2) đường Student (D1) SAU `kiemHocVienCuaPhuHuynh`.
    const goi = [...robot.matchAll(/docRobotCuaHocVien\(hs, /g)].map((m) => m.index!);
    expect(goi, "docRobotCuaHocVien phải có đúng hai nơi gọi").toHaveLength(2);
    expect(robot.indexOf("baoVeDisc(nguoi"), "đường phụ huynh phải qua baoVeDisc").toBeGreaterThan(-1);
    expect(robot.slice(0, goi[0]!)).toContain("baoVeDisc(nguoi");
    expect(robot.slice(robot.indexOf("export async function layRobotChoHocSinh"), goi[1]!)).toContain("kiemHocVienCuaPhuHuynh(nguoi.userId, nguoi.hocSinhId)");
    expect(robot.slice(robot.indexOf("export async function layRobotChoHocSinh"), goi[1]!)).toContain("if (!nguoi.hocSinhId) throw");
    // `docBaoCaoCaNhanKhongKiem` không được dùng ở bất kỳ nơi nào khác
    const dungKhongKiem = tep(resolve(GOC, "app")).concat(tep(resolve(GOC, "lib"))).filter((p) => boChuThich(readFileSync(p, "utf8")).includes("docBaoCaoCaNhanKhongKiem(")).map(tuongDoi).sort();
    expect(dungKhongKiem).toEqual(["lib/mobile-api/dich-vu/disc.ts", "lib/mobile-api/dich-vu/robot-tinh-cach.ts"]);
  });

  it("[PQN-02] route Mobile: chỉ gọi dịch vụ và truyền `nguoi` (không bóc userId) trừ đường khởi tạo; liệt kê từ cây thư mục", () => {
    const goc = resolve(GOC, "app/api/mobile/v1/parent/disc");
    const route = tep(goc).filter((p) => p.endsWith("route.ts")).concat([resolve(GOC, "app/api/mobile/v1/students/[studentId]/personality-robot/route.ts")]);
    expect(route.length).toBeGreaterThanOrEqual(20); // 16 route cũ + pin/verify + pin/lock + pin/kid-mode + robot (pin/status dùng chung `pin/route.ts`)
    const KHOI_TAO = new Set(["book/route.ts"]); // tạo sổ: chưa có sổ ⇒ chưa có PIN
    for (const p of route) {
      const ma = boChuThich(readFileSync(p, "utf8"));
      const t = relative(goc, p).split(sep).join("/");
      expect(ma, `${t}: phải gọi dịch vụ`).toMatch(/dich-vu\/(disc|robot-tinh-cach)"/);
      expect(ma, `${t}: không import DB/miền trực tiếp`).not.toMatch(/@\/lib\/db|@\/lib\/disc\//);
      if (KHOI_TAO.has(t)) continue;
      expect(ma, `${t}: không bóc nguoi.userId ra gọi dịch vụ (mất sessionId ⇒ mất cổng)`).not.toMatch(/nguoi\.userId/);
      expect(ma, `${t}: phải truyền nguoi`).toMatch(/\(nguoi\b|nguoi,|, nguoi\)/);
    }
  });

  it("[PQN-03] tệp web dưới portal/disc: có cổng, mọi lời gọi cổng khai phamVi tường minh; mọi Server Action của sổ đi qua voiPhien(phamVi)", () => {
    const goc = resolve(GOC, "app/(portal)/portal/disc");
    const can = tep(goc).filter((p) => /(page\.tsx|route\.ts|_actions[\w-]*\.ts)$/.test(p) && !p.includes(`${sep}mo-khoa${sep}`));
    expect(can.length).toBeGreaterThanOrEqual(8);
    for (const p of can) {
      const ma = boChuThich(readFileSync(p, "utf8"));
      const t = tuongDoi(p);
      expect(ma, `${t}: thiếu cổng PIN máy chủ`).toMatch(/yeuCauPhienDisc\(|docPhienDisc\(|voiPhien\(/);
      // `voiPhien(yc, fn)` của _actions-so chuyển tiếp `yc` (đã khai phamVi ở từng action — kiểm ngay dưới) nên bỏ qua đúng một dạng đó.
      for (const m of ma.matchAll(/(?:yeuCauPhienDisc|docPhienDisc)\(([^)]*)\)/g)) if (m[1]!.trim() !== "yc") expect(m[1], `${t}: lời gọi cổng thiếu phamVi`).toMatch(/phamVi:/);
    }
    const so = boChuThich(doc("app/(portal)/portal/disc/_actions-so.ts"));
    const hamExport = [...so.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]!);
    expect(hamExport.length).toBeGreaterThanOrEqual(14);
    for (const ten of hamExport) expect(thanHam(so, ten), `${ten}: không qua voiPhien({ phamVi: … })`).toMatch(/voiPhien\(\s*\{\s*phamVi:/);
    // Hai tệp action CŨ (lịch sử lượt / báo cáo DISC cũ) cũng đi qua cổng: kiểm riêng vì không dùng voiPhien
    expect(boChuThich(doc("app/(portal)/portal/disc/_actions.ts"))).toMatch(/docPhienDisc\(\s*\{\s*phamVi:\s*"GHI"/);
    expect(boChuThich(doc("app/(portal)/portal/disc/lam-bai/_actions.ts"))).toMatch(/docPhienDisc\(\s*\{\s*phamVi:\s*"GHI"/);
  });

  it("[PQN-04] chỉ danh sách tệp biết trước được import module DISC sổ có chạm DB; thêm nơi import mới ⇒ phải qua cổng rồi mới thêm vào đây", () => {
    const mod = join(GOC, "lib/disc/so-gia-dinh");
    const chamDb = tep(mod).filter((p) => /@\/lib\/db\b|scopedDb|portalDb/.test(boChuThich(readFileSync(p, "utf8")))).map((p) => p.slice(p.lastIndexOf(sep) + 1).replace(/\.tsx?$/, ""));
    expect(chamDb.length).toBeGreaterThanOrEqual(4);
    expect(chamDb).toContain("mo-khoa");
    const re = new RegExp(`from\\s+["']@/lib/disc/so-gia-dinh/(${chamDb.join("|")})["']`);
    const DUOC_PHEP = [
      "app/(portal)/portal/disc/_actions-so.ts", // Server Action web: mọi hàm qua voiPhien (PQN-03)
      "app/(portal)/portal/disc/_lib/phien-disc.ts", // cổng web (mo-khoa)
      "app/(portal)/portal/disc/mo-khoa/page.tsx", // trang mở khoá (bootstrap, phamVi KHONG)
      "app/(portal)/portal/disc/lam-bai/page.tsx", // yeuCauPhienDisc DOC
      "app/(portal)/portal/disc/page.tsx", // yeuCauPhienDisc DOC
      "lib/mobile-api/dich-vu/disc.ts", // dịch vụ Mobile: baoVeDisc (PQN-01)
      "lib/push/thu-hoi.ts", // đăng xuất ⇒ thu hồi phiên (chỉ import động mo-khoa)
    ];
    const lech: string[] = [];
    for (const goc of ["app", "lib", "components"]) {
      for (const p of tep(resolve(GOC, goc))) {
        const t = tuongDoi(p);
        if (t.startsWith("lib/disc/so-gia-dinh/")) continue;
        const ma = boChuThich(readFileSync(p, "utf8")).replace(/import type[^;]*;/g, ""); // `import type` không chạy mã ⇒ không phải đường vào dữ liệu
        if ((re.test(ma) || /import\(\s*["']@\/lib\/disc\/so-gia-dinh\//.test(ma)) && !DUOC_PHEP.includes(t)) lech.push(t);
      }
    }
    expect(lech, "nơi MỚI import module DB của sổ DISC — phải có cổng PIN rồi thêm vào DUOC_PHEP").toEqual([]);
  });

  it("[PQN-05] hiệu lực phiên mở khoá có MỘT nguồn: chỉ mo-khoa.ts đọc/ghi bảng discUnlockSession", () => {
    const co: string[] = [];
    for (const goc of ["app", "lib", "components"]) for (const p of tep(resolve(GOC, goc))) if (/discUnlockSession/.test(boChuThich(readFileSync(p, "utf8")))) co.push(tuongDoi(p));
    expect(co.sort()).toEqual(["lib/disc/so-gia-dinh/mo-khoa.ts"]);
  });
});
