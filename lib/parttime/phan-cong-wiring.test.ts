// lib/parttime/phan-cong-wiring.test.ts — lưới GHIM MÃ NGUỒN cho dây nối phân công (SR.QD.238 · P2).
// Thứ ca hành vi không chạm được: server action `deleteSession` (cần phiên đăng nhập) phải HỎI cổng phân công và DÙNG
// kết quả. Mã TRƯỚC bản vá: chỉ có cổng `kiemPhuThuocHocBu`, xoá cứng buổi đã có phân công ⇒ phân công mồ côi.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function than(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}(`);
  if (i < 0) throw new Error(`không thấy ${ten}`);
  const j = src.indexOf("\nexport ", i + 1);
  return src.slice(i, j < 0 ? undefined : j);
}

describe("[PT2-W] dây nối phân công", () => {
  it("[PT2-W1] deleteSession hỏi `chanXoaBuoiCoPhanCong` TRƯỚC khi xoá và trả lỗi khi bị chặn", () => {
    const t = than(doc("app/(admin)/admin/sessions/_actions.ts"), "deleteSession");
    const m = /const (\w+) = await chanXoaBuoiCoPhanCong\(id\);/.exec(t);
    expect(m, "thiếu lời gọi cổng").not.toBeNull();
    const bien = m![1];
    expect(t).toContain(`if (${bien}) return { error: ${bien} };`);
    expect(t.indexOf("chanXoaBuoiCoPhanCong(")).toBeLessThan(t.indexOf(".delete("));
  });

  it("[PT2-W2] luồng ĐƠN gọi adjust/cancel với dongBoPhanCong: false (đơn tự phân công kèm mã đơn); màn lớp + mở lại buổi: true", () => {
    const don = doc("lib/cham-cong/don/lop-hoc.ts") + doc("lib/cham-cong/don/hoan-tac.ts");
    expect(don.match(/dongBoPhanCong: true/g) ?? []).toHaveLength(0);
    expect((don.match(/dongBoPhanCong: false/g) ?? []).length).toBe(4);
    const man = doc("app/(admin)/admin/classes/[id]/_curriculum-actions.ts") + doc("lib/classes/mo-lai-buoi.ts");
    expect(man.match(/dongBoPhanCong: false/g) ?? []).toHaveLength(0);
    expect((man.match(/dongBoPhanCong: true/g) ?? []).length).toBe(3);
  });

  it("[PT2-W3] màn QLCS: MỌI action đi qua cổng `cong(...)` hỏi `hr_attendance:assign` Ở CƠ SỞ TRA TỪ DB; KHÔNG có đường xác nhận thay", () => {
    const t = doc("app/(admin)/admin/cham-cong/phan-cong/_actions.ts");
    expect(t).toMatch(/checkPermission\(ASSIGN, \{ centerId \}\)/);
    const actions = [...t.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(actions.sort()).toEqual(["doiGvChinhAction", "dungMacDinhAction", "huyPhanCongAction", "nhacLaiAction", "phanCongAction", "suaBuoiDaQuaAction", "xacNhanHangLoatAction", "xacNhanThucHienAction"]);
    // Hai dạng cùng một luật (cơ sở TRA TỪ DB rồi mới vào cổng): gọi lồng, hoặc giữ `centerId` lại để cổng kiểm người được phân dùng
    // (phân / đổi GV chính — 20/10/2026).
    for (const a of actions) expect(than(t, a), a).toMatch(/await cong\(await coSoCua(Nguon|PhanCong|Lop)\(|const centerId = await coSoCuaNguon\(n\);\s*const g = await cong\(centerId, /);
    expect(t).not.toContain("quyetDinhNhanLop");
  });

  it("[PT2-W4] màn GV: người bấm lấy từ PHIÊN — schema không nhận `userId`/`nguoiBam` từ client", () => {
    const t = doc("app/(teacher)/teacher/phan-cong/_actions.ts");
    expect(t).not.toMatch(/userId:\s*z\./);
    expect(t).not.toMatch(/nguoiBam:\s*z\./);
    expect((t.match(/nguoiBam: ai/g) ?? []).length).toBe(2);
    expect(t).toMatch(/const session = await auth\(\);[\s\S]{0,120}id: session\.user\.id/);
  });
});
