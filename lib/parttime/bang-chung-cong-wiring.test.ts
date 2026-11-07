// [P4-W*] lưới ghim mã nguồn cho dây nối P4 (gắn chấm công vào phân công) — thứ ca hành vi khó chạm: lớp đọc dùng ĐÚNG các
// định nghĩa dùng chung, không tự dựng lại (luật 12b).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("[P4-W] dây nối P4", () => {
  const loader = doc("lib/parttime/bang-chung-cong-db.ts");
  const engine = doc("lib/parttime/bang-chung-cong.ts");

  it("[P4-W1] lượt quẹt đọc qua `LUOT_CON_TINH` (một định nghĩa) — không tự lọc `result`/`reviewStatus`", () => {
    expect(loader).toMatch(/staffTimeLog\.findMany\(\{[\s\S]{0,200}\.\.\.LUOT_CON_TINH/);
    expect(loader).not.toMatch(/result: "ACCEPTED"|reviewStatus:/);
  });

  it("[P4-W2] tình trạng + mặc định buổi qua `macDinhCuaBuoi` cho CẢ BA nguồn; người dạy lớp qua `giaoVienDuocQuyCong`", () => {
    for (const n of ["CLASS_SESSION", "MAKEUP_CASE", "TRIAL_SESSION"]) expect(loader).toContain(`macDinhCuaBuoi({ sourceType: "${n}"`);
    expect(loader).toContain("const dl = giaoVienDuocQuyCong(s);");
    expect(loader).not.toMatch(/actualTeacherId \?\? /);
  });

  it("[P4-W3] đọc `db` trần (lượt quẹt nằm trong scope theo cơ sở QUẸT) — không `scopedDb`", () => {
    expect(loader).toContain('import { db } from "@/lib/db";');
    expect(loader).not.toContain("scopedDb");
  });

  it("[P4-W4] khoảng có mặt ghép bằng ĐÚNG đường của bảng công (`dedupeTaps` → `pairLogs`); engine không đọc đồng hồ", () => {
    expect(engine).toMatch(/const \{ kept \} = dedupeTaps\(engine, bamTrungPhut\);[\s\S]{0,80}const \{ pairs \} = pairLogs\(kept\);/);
    expect(engine).not.toMatch(/new Date\(\)|Date\.now\(\)/);
  });

  it("[P4-W5] dung sai đi muộn / ra sớm là setting RIÊNG của parttime (không mượn 30' của bảng công ngày)", () => {
    expect(loader).toContain('getSetting("shift.parttimeTreVaoPhut", o)');
    expect(loader).toContain('getSetting("shift.parttimeVeSomPhut", o)');
    expect(loader).not.toContain("shift.lateGraceMinutes");
  });

  it("[P4-W6] \"Công việc của tôi\" chỉ ĐỌC lượt quẹt của chính người đó — engine vốn gắn theo userId nên bỏ lọc không đổi kết quả, nhưng quét lượt của cả công ty vào bộ nhớ mỗi lần GV mở màn", () => {
    const ham = loader.slice(loader.indexOf("export async function docBangChungCuaToi("));
    expect(ham.split("db.staffTimeLog.findMany({ where: { userId: p.userId,").length - 1).toBe(1);
    expect(ham.split("db.sessionStaffAssignment.findMany({").length - 1).toBe(1);
    expect(ham).toMatch(/where: \{ userId: p\.userId, ngay:/);
  });
});
