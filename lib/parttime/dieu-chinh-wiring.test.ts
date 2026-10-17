// [P5-AW*] — lưới ghim dây nối P5c (điều chỉnh tiền tách khỏi sự thật công việc).
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

const DB = doc("lib/parttime/dieu-chinh-db.ts");
const LUAT = doc("lib/parttime/dieu-chinh.ts");
const ACT = doc("app/(admin)/admin/cham-cong/phan-cong/_actions-dieu-chinh.ts");

describe("[P5-AW] dây nối điều chỉnh tiền", () => {
  it("[P5-AW1] TÁCH BẠCH: dịch vụ điều chỉnh KHÔNG ghi WorkUnit / StaffTimeLog / StudentSessionFeedback / WorkConfirmation", () => {
    expect(DB).not.toMatch(/\b(workUnit|staffTimeLog|studentSessionFeedback|workConfirmation)\.(create|update|updateMany|upsert|delete|deleteMany)\b/);
  });

  it("[P5-AW2] chỉ HAI nơi ĐỔI CompensationAdjustment: dịch vụ điều chỉnh (`dieu-chinh-db.ts`) và bước RÚT đề xuất khi đơn vị bị VOID / thành cũ (`dieu-chinh-rut.ts`, gọi TRONG giao dịch của workunit-db)", () => {
    const tep = [...quet("lib"), ...quet("app")].filter((f) => /compensationAdjustment\.(create|update|updateMany|upsert|delete)/.test(doc(f)));
    expect(tep.map((f) => f.replace(/\\/g, "/")).sort()).toEqual(["lib/parttime/dieu-chinh-db.ts", "lib/parttime/dieu-chinh-rut.ts"]);
    // Bước rút chỉ được HUỶ đề xuất — không tạo, không đụng khoản đã xác nhận.
    const rut = doc("lib/parttime/dieu-chinh-rut.ts");
    expect(rut).not.toMatch(/compensationAdjustment\.(create|upsert|delete)/);
    expect(dem(rut, 'updateMany({ where: { id: a.id, status: "PROPOSED" }, data: { status: "CANCELLED"')).toBe(1);
  });

  it("[P5-AW3] số tiền đến từ MỘT bảng nháp; khung giữa của đi muộn KHÔNG có số (không đoán)", () => {
    expect(dem(DB, "deXuatDieuChinh(")).toBe(1);
    expect(DB).not.toMatch(/-?\s?\d{2}[_.]?000\b/);
    expect(LUAT).toMatch(/\{ maLuat: "LATE_MIDDLE_UNRESOLVED", tuPhutLonHon: 15, denPhut: 30, soTien: null, cauHoi: "Q10" \}/);
    expect(LUAT).not.toMatch(/-30_000, cauHoi: "Q10"|LATE_15_30/);
  });

  it("[P5-AW4] chỉ mục DE_XUAT thành dòng (amount !== null); khoản ĐÃ quyết không bao giờ bị rút tự động", () => {
    const t = than(DB, "dongBoDeXuat");
    expect(t).toContain('if (m.trangThai === "DE_XUAT") canCo.set(');
    // Chỉ đọc dòng PROPOSED để rút — dòng CONFIRMED / REJECTED không bao giờ vào vòng rút.
    expect(t).toMatch(/const dangDeXuat = await db\.compensationAdjustment\.findMany\(\{\s*where: \{ centerId: p\.centerId, workDate: \{[^}]*\}, status: "PROPOSED" \}/);
    expect(dem(t, 'updateMany({ where: { id: a.id, status: "PROPOSED" }')).toBe(1);
  });

  it("[P5-AW5] quyết khoản trừ lương hỏi `hr_attendance:approve` ở cơ sở TRA TỪ DB; dựng đề xuất hỏi `hr_attendance:assign`", () => {
    expect(than(ACT, "quyetDieuChinhAction")).toContain('await congDieuChinh("hr_attendance:approve", await coSoCuaDieuChinh(p.data.id))');
    expect(than(ACT, "dongBoDeXuatAction")).toContain('await congDieuChinh("hr_attendance:assign", p.data.centerId)');
    expect(ACT).toMatch(/checkPermission\(quyen, \{ centerId \}\)/);
  });

  it("[P5-AW6] trạng thái nhận xét qua MỘT hàm `danhGiaNhanXet`, học viên 'có mặt' theo định nghĩa sẵn có (FEEDBACK_ATTENDED_STATUSES)", () => {
    expect(dem(DB, "danhGiaNhanXet(")).toBe(2);
    expect(DB).toContain("const ATTENDED = new Set<string>(FEEDBACK_ATTENDED_STATUSES);");
  });
});
