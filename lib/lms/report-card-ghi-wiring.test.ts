/**
 * Ca [RCG-W*] — LƯỚI GHIM DÂY NỐI của đợt "seed thử lấy từ giáo viên nhập" (26/09/2026).
 *
 * Hành vi của hàm lõi đã có ca R7 chạy Postgres thật ([RC-CORE-*], [SFB-07]). Phần lưới này canh
 * thứ R7 KHÔNG chạm được vì cần phiên Next: (1) hai server action học bạ thật sự đi qua hàm lõi
 * — không ai chép lại luật vào action; (2) màn giáo viên vẫn GỬI email phụ huynh (tham số bắt buộc
 * mới mà truyền nhầm `false` là phụ huynh thật im lặng mất email, không ca nào đỏ); (3) hai script
 * seed thử KHÔNG ghi thẳng bảng — đúng yêu cầu "phải lấy từ giáo viên nhập".
 * Luật 11: bỏ chú thích trước khi so, neo chuỗi hẹp, đếm số lần khớp.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function docMa(tep: string): string {
  return readFileSync(resolve(process.cwd(), tep), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}
const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;
function thanHam(ma: string, ten: string): string {
  const dau = ma.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  const sau = ma.indexOf("export async function ", dau + 10);
  return ma.slice(dau, sau < 0 ? undefined : sau);
}

describe("[RCG-W1] action học bạ = vỏ auth() + hàm lõi", () => {
  const ma = docMa("app/(admin)/admin/report-cards/_actions.ts");

  it("saveReportCardAction gọi luuHocBaCore đúng một lần và không tự ghi học bạ", () => {
    const f = thanHam(ma, "saveReportCardAction");
    expect(dem(f, /luuHocBaCore\(/)).toBe(1);
    expect(f).not.toMatch(/\.reportCard(Score)?\.(create|update|upsert|delete)/);
  });

  it("transitionReportCardAction gọi chuyenTrangThaiHocBaCore đúng một lần và không tự ghi", () => {
    const f = thanHam(ma, "transitionReportCardAction");
    expect(dem(f, /chuyenTrangThaiHocBaCore\(/)).toBe(1);
    expect(f).not.toMatch(/\.reportCard(Score)?\.(create|update|upsert|delete)|publishEvent\(/);
  });
});

describe("[RCG-W2] email phụ huynh khi giáo viên nhận xét", () => {
  it("màn giáo viên (saveSessionEval) truyền guiEmailPhuHuynh: true", () => {
    const f = thanHam(docMa("app/(admin)/admin/sessions/[id]/_actions.ts"), "saveSessionEval");
    expect(dem(f, /saveSessionEvalCore\(/)).toBe(1);
    expect(dem(f, /guiEmailPhuHuynh:\s*true/)).toBe(1);
    expect(f).not.toMatch(/guiEmailPhuHuynh:\s*false/);
  });

  it("core chỉ xếp email NEW_FEEDBACK khi cờ bật", () => {
    // 29/09/2026 — thân phiếu dời vào `luuPhieuNhanXet` (dùng chung với nhận xét HỌC BÙ). Luật
    // không đổi: `saveSessionEvalCore` vẫn đi qua CỔNG buổi ("KIEM") rồi mới tới phép ghi + email.
    const src = docMa("app/(admin)/admin/sessions/[id]/_feedback-core.ts");
    expect(thanHam(src, "saveSessionEvalCore")).toMatch(/luuPhieuNhanXet\(user, input, tuyChon, "KIEM"\)/);
    const dau = src.indexOf("async function luuPhieuNhanXet(");
    expect(dau).toBeGreaterThan(-1);
    const f = src.slice(dau);
    expect(dem(f, /if \(tuyChon\.guiEmailPhuHuynh && comment && commentChanged\)/)).toBe(1);
  });
});

describe("[RCG-W3] seed thử đi ĐÚNG đường giáo viên, không ghi thẳng bảng", () => {
  it("seed nhận xét: gọi saveSessionEvalCore (email TẮT), không create/upsert phiếu", () => {
    const f = docMa("scripts/seed-thu-nhan-xet-giao-vien.ts");
    expect(dem(f, /saveSessionEvalCore\(/)).toBe(1);
    expect(dem(f, /guiEmailPhuHuynh:\s*false/)).toBe(1);
    expect(f).not.toMatch(/studentSessionFeedback\.(create|createMany|upsert|update)\(/);
  });

  it("seed học bạ: gọi luuHocBaCore + chuyenTrangThaiHocBaCore, không create/update học bạ", () => {
    const f = docMa("scripts/seed-thu-hoc-ba-giao-vien.ts");
    expect(dem(f, /luuHocBaCore\(/)).toBe(1);
    expect(dem(f, /chuyenTrangThaiHocBaCore\(/)).toBe(2);
    expect(f).not.toMatch(/reportCard(Score)?\.(create|createMany|upsert|update)\(/);
  });
});
