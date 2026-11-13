// [PCG2-W*] Lưới ghim DÂY NỐI của action giao / gỡ GĐ2 (mẫu "lưới ghim mã nguồn", CLAUDE.md). Hành vi của lớp DB có bộ Postgres
// thật (`tests/cham-cong/phan-cong-gop-giao-go.spec.ts`); thứ bộ đó KHÔNG thấy là cổng ở tầng action (cần phiên đăng nhập).
// Mã TRƯỚC bản vá không có — đây là action mới; lưới canh cho nó khỏi bị gỡ cổng về sau.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/cham-cong/phan-cong/_actions-gop.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const dem = (re: RegExp) => (src.match(re) ?? []).length;

describe("[PCG2-W] action giao / gỡ — cổng ở tầng action", () => {
  it("[PCG2-W1] hỏi quyền phân công TẠI cơ sở + công tắc STAFFING, trong MỘT hàm cổng mà cả BA action đều gọi (giao/gỡ · trực · áp khung)", () => {
    expect(dem(/await checkPermission\(ASSIGN, \{ centerId \}\)/g)).toBe(1);
    expect(dem(/congThaoTacParttime\("STAFFING", \{ centerId \}/g)).toBe(1);
    expect(dem(/const g = await cong\(/g)).toBe(3);
    expect(dem(/if \(!g\.ok\) return g;/g)).toBe(3);
  });
  it("[PCG2-W2] `homNay` do máy chủ tính (giờ VN) — schema KHÔNG nhận homNay từ client", () => {
    expect(dem(/const homNay = vnYmd\(new Date\(\)\);/g)).toBe(3);
    expect(src).not.toMatch(/homNay:\s*z\./);
  });
  it("[PCG2-W3] người được giao phải là GV của cơ sở (cả hai action, chỉ khi GIAO)", () => {
    expect(dem(/await kiemNguoi\(/g)).toBe(2);
  });
});

// Chốt lượt 2 điểm 2 (27/10): ba action CŨ của bảng theo buổi (`?xem=buoi`) cũng ghi phân công đứng chính học bù / Trial ⇒ phải đi
// qua `ghiGvNguonGoc` TRONG cùng giao dịch. Mã TRƯỚC bản vá: `trongGiaoDich((tx) => phanCongVaoBuoi(…))` / `thayGiaoVienChinh(…)` /
// `huyPhanCong(…)` trần — chỉ ghi phân công, cột GV gốc lệch.
const cu = readFileSync(resolve(process.cwd(), "app/(admin)/admin/cham-cong/phan-cong/_actions.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const demCu = (re: RegExp) => (cu.match(re) ?? []).length;

describe("[PCG2-W4] action cũ ghi cột GV gốc học bù / Trial cùng giao dịch", () => {
  it("[PCG2-W4] phân công (chỉ khi đứng chính) · đổi GV chính · huỷ phân công đứng chính — ba lời gọi `ghiGvNguonGoc`, đều trong `trongGiaoDich`", () => {
    expect(demCu(/await ghiGvNguonGoc(NeuDungChinh)?\(tx, /g)).toBe(3);
    expect(demCu(/await ghiGvNguonGocNeuDungChinh\(tx, n, p\.data\.role, p\.data\.userId\)/g)).toBe(1);
    expect(demCu(/await ghiGvNguonGoc\(tx, n, p\.data\.userId\)/g)).toBe(1);
    expect(demCu(/if \(a\) await ghiGvNguonGocNeuDungChinh\(tx, \{ sourceType: a\.sourceType, sourceId: a\.sourceId \}, a\.role, null, a\.userId\)/g)).toBe(1);
    expect(demCu(/trongGiaoDich\(\(tx\) => (phanCongVaoBuoi|thayGiaoVienChinh|huyPhanCong)\(/g)).toBe(0);
  });
});

// Chiều NGƯỢC (27/10): module gốc đổi GV đứng chính học bù / Trial ⇒ `dongBoDungChinhTuNguonGoc` TRONG cùng giao dịch với phép ghi cột.
// Mã TRƯỚC bản vá: chỉ ghi cột rồi đánh dấu đồng bộ sau commit — mà đồng bộ không thay dòng giao tay (`danXuatDuoc`) ⇒ lệch.
const docMa = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/^\s*\/\/.*$/gm, "");

describe("[PCG2-W5] module gốc đổi GV ⇒ phân công đứng chính đổi theo, cùng giao dịch", () => {
  it("[PCG2-W5] sửa case học bù (khi đổi GV) · sửa buổi Trial (khi đổi GV) — mỗi nơi đúng một lời gọi, nằm trong giao dịch", () => {
    const hb = docMa("lib/hoc-bu/case-db.ts");
    expect((hb.match(/if \(teacherId !== c\.teacherId\) await dongBoDungChinhTuNguonGoc\(tx, /g) ?? []).length).toBe(1);
    const tr = docMa("app/(admin)/admin/lop-trial/_actions.ts");
    const i = tr.indexOf("await trongGiaoDich(async (tx) => {\n    await tx.trialClassSession.update(");
    const j = tr.indexOf("await dongBoDungChinhTuNguonGoc(tx, {", i);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(tr.slice(i, j)).toContain("if (gvMoi !== ses.teacherId) {");
  });
});
