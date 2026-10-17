// [P5-OW*] — lưới ghim dây nối P5b (trực vận hành tường minh, D-Q3 / D-N1).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, x: string) => s.split(x).length - 1;
function quet(goc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(resolve(process.cwd(), goc))) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(goc, ten);
    if (statSync(resolve(process.cwd(), p)).isDirectory()) quet(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.test\.tsx?$/.test(ten)) ra.push(p);
  }
  return ra;
}
const than = (s: string, ten: string) => {
  const i = s.indexOf(`export async function ${ten}(`);
  const j = s.indexOf("\nexport ", i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};

const LOI = doc("lib/parttime/truc-van-hanh.ts");
const DB = doc("lib/parttime/truc-van-hanh-db.ts");
const QL = doc("app/(admin)/admin/cham-cong/phan-cong/_actions-truc.ts");
const GV = doc("app/(teacher)/teacher/phan-cong/_actions-truc.ts");

describe("[P5-OW] dây nối trực vận hành", () => {
  it("[P5-OW1] KHÔNG SUY TRỰC TỪ Ô CA: lõi + lớp đọc/ghi trực không chạm ShiftAssignment / ShiftTemplate / lịch làm việc", () => {
    for (const [ten, t] of [["truc-van-hanh.ts", LOI], ["truc-van-hanh-db.ts", DB]] as const) expect(t, ten).not.toMatch(/shiftAssignment|shiftTemplate|ShiftAssignment|lich-lam-viec/);
  });

  it("[P5-OW2] chỉ `truc-van-hanh-db.ts` được TẠO dòng trực / nhận trực / đơn vị OPERATIONS_DUTY (quét lib + app)", () => {
    const tep = [...quet("lib"), ...quet("app")].filter((f) => /operationsDutyAssignment\.create|operationsDutyAcceptance\.create|workUnitType: "OPERATIONS_DUTY",/.test(doc(f)));
    expect(tep.map((f) => f.replace(/\\/g, "/"))).toEqual(["lib/parttime/truc-van-hanh-db.ts"]);
  });

  it("[P5-OW3] QLCS: ba action qua `congTruc(` (hr_attendance:assign ở cơ sở) TRƯỚC dịch vụ; huỷ / xác nhận tra cơ sở TỪ DB; không có đường nhận thay", () => {
    expect(QL).toMatch(/checkPermission\(ASSIGN, \{ centerId \}\)/);
    for (const [ten, goi] of [["giaoTrucAction", "giaoTruc(tx"], ["huyTrucAction", "huyTruc(tx"], ["xacNhanTrucAction", "xacNhanTruc({"]] as const) {
      const t = than(QL, ten);
      expect(t.indexOf("await congTruc("), ten).toBeGreaterThan(0);
      expect(t.indexOf("await congTruc("), ten).toBeLessThan(t.indexOf(goi));
    }
    expect(dem(QL, "await congTruc(await coSoCuaTruc(p.data.dutyId))")).toBe(2);
    expect(QL).not.toContain("quyetDinhTruc");
  });

  it("[P5-OW4] người trực: người bấm lấy từ PHIÊN — schema không nhận userId / nguoiBam từ client", () => {
    expect(GV).not.toMatch(/userId:\s*z\./);
    expect(GV).not.toMatch(/nguoiBam:\s*z\./);
    expect(GV).toMatch(/const nguoiBam = \{ id: session\.user\.id,/);
  });

  it("[P5-OW5] tiết trong ca đọc từ đối soát P5a (MỘT định nghĩa) và đơn vị trả từ MỘT hàm `danhGiaTruc`", () => {
    expect(dem(DB, "docDoiSoatThucHien({")).toBe(1);
    expect(dem(DB, "danhGiaTruc(")).toBe(1);
    expect(DB).toMatch(/const quyet: TietTrongNgay\["quyet"\] = d\.ungVien\.lyDo\.includes\("THOI_LUONG_KHONG_CHUAN"\)\s*\? "Q1_KHONG_CHUAN"\s*: d\.donVi\?\.hieuLuc === "CONFIRMED"/);
  });

  it("[P5-OW6] xác nhận trực đi qua CÙNG cổng `kiemXacNhan` với xác nhận dạy, TRƯỚC giao dịch", () => {
    const t = than(DB, "xacNhanTruc");
    expect(t.indexOf("const loi = kiemXacNhan({")).toBeGreaterThan(0);
    expect(t.indexOf("if (loi) return { ok: false, loi };")).toBeLessThan(t.indexOf("db.$transaction("));
  });
});
