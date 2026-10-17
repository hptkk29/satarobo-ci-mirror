// [P5-W*] — lưới ghim dây nối P5a: luật cần khoá là "ai gọi gì, theo thứ tự nào", test hành vi không chạm tới được.
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

const ACT = doc("app/(admin)/admin/cham-cong/phan-cong/_actions.ts");
const DB = doc("lib/parttime/workunit-db.ts");
const thanHam = (s: string, ten: string) => {
  const i = s.indexOf(`export async function ${ten}(`);
  const j = s.indexOf("\nexport ", i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};

describe("[P5-W] dây nối WorkUnit", () => {
  it("[P5-W1] hai action mới đều qua `cong(await coSoCuaPhanCong(` (quyền ở cơ sở CỦA BUỔI tra từ DB + công tắc) TRƯỚC khi gọi dịch vụ", () => {
    for (const ten of ["xacNhanThucHienAction", "xacNhanHangLoatAction"]) {
      const t = thanHam(ACT, ten);
      expect(t.indexOf("await cong(await coSoCuaPhanCong("), ten).toBeGreaterThan(0);
      expect(t.indexOf("await cong(await coSoCuaPhanCong("), ten).toBeLessThan(t.indexOf("xacNhanThucHien({"));
    }
  });

  it("[P5-W2] hàng loạt: quyền hỏi TỪNG MỤC (không nhận cơ sở từ client) và luôn gọi dịch vụ với hangLoat: true", () => {
    const t = thanHam(ACT, "xacNhanHangLoatAction");
    expect(t).not.toMatch(/centerId:\s*z\./);
    expect(dem(t, "const g = await cong(await coSoCuaPhanCong(m.assignmentId));")).toBe(1);
    expect(t).toContain('quyetDinh: "CONFIRMED", lyDo: null, hangLoat: true');
  });

  it("[P5-W3] xác nhận: cổng `kiemXacNhan` chạy TRƯỚC giao dịch; xếp loại chỉ có MỘT chỗ gọi `xetUngVien`", () => {
    const t = thanHam(DB, "xacNhanThucHien");
    expect(t.indexOf("const loiCong = kiemXacNhan({")).toBeGreaterThan(0);
    expect(t.indexOf("if (loiCong) return { ok: false, loi: loiCong };")).toBeLessThan(t.indexOf("db.$transaction("));
    expect(dem(DB, "xetUngVien(")).toBe(1);
  });

  it("[P5-W4] KHÔNG đổi phân công khi xác nhận (status nằm trong dấu vân P4 — đổi là tự làm cũ đơn vị vừa sinh)", () => {
    expect(DB).not.toMatch(/sessionStaffAssignment\.(update|updateMany|upsert|delete)/);
  });

  it("[P5-W5] chỉ HAI dịch vụ được TẠO WorkUnit / WorkConfirmation: dạy (`workunit-db.ts`) và trực (`truc-van-hanh-db.ts`) — quét lib + app", () => {
    const tep = [...quet("lib"), ...quet("app")].filter((f) => /workUnit\.create|workConfirmation\.create/.test(doc(f)));
    expect(tep.map((f) => f.replace(/\\/g, "/")).sort()).toEqual(["lib/parttime/truc-van-hanh-db.ts", "lib/parttime/workunit-db.ts"]);
  });

  it("[P5-W6] trạng thái hiệu lực đọc qua MỘT luật (`trangThaiHieuLuc` / `lyDoCu` của workunit.ts) — đối soát không tự so dấu vân", () => {
    const ghep = DB.slice(DB.indexOf("function ghepDoiSoat("), DB.indexOf("export type KetQuaXacNhan"));
    expect(dem(ghep, "hieuLuc: trangThaiHieuLuc(dv, ht, khoa),")).toBe(1);
    expect(ghep).not.toMatch(/w\.(evidenceFingerprint|assignmentVersion)\s*[!=]==/);
  });
});
