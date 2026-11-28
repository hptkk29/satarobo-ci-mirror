import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// [BTV-W] 20/10/2026 — "Dạy thêm bài khác" khi tạo case CHỈ liệt kê buổi VẮNG, không liệt kê cả giáo trình.
// `layLuaChonCaseAction` chạm DB + phiên đăng nhập nên hành vi của nó không dựng được ở bộ thuần; phần ĐỌC đã có test Postgres thật
// (`tests/hoc-bu/them-bai-chi-buoi-vang.test.ts`). Lưới này ghim DÂY NỐI: action phải đi qua đúng hàm đó với đúng ba tham số, và không còn
// đường nào lôi cả giáo trình ra (xoá lời gọi thì không ca hành vi nào đỏ).
//
// Đọc mã ĐÃ BỎ chú thích (chú thích giải thích bản vá chứa đúng những chuỗi đang tìm).
const ma = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const than = (src: string, ten: string) => {
  const dau = src.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const cuoi = src.indexOf("\n}\n", dau);
  expect(cuoi).toBeGreaterThan(dau);
  return src.slice(dau, cuoi);
};

describe("[BTV-W] layLuaChonCaseAction — bài thêm = buổi vắng của chính các bé đã chọn", () => {
  const act = ma("app/(admin)/admin/hoc-bu/_actions.ts");
  const f = than(act, "layLuaChonCaseAction");

  it("[BTV-W1] KHÔNG còn đọc cả giáo trình của khoá (`lesson.findMany` theo `curriculum`)", () => {
    expect(f).not.toMatch(/\.lesson\.findMany\(/);
    expect(f).not.toContain("curriculum:");
  });

  it("[BTV-W2] đọc qua `docDongCanBuTheoKhoa` với ĐỦ: cơ sở + khoá của nhóm, phạm vi Sale, đúng các bé đã chọn, loại bài đã có", () => {
    const i = f.indexOf("docDongCanBuTheoKhoa(sdb, {");
    expect(i, "thiếu lời gọi").toBeGreaterThan(-1);
    const goi = f.slice(i, f.indexOf("})", i));
    for (const t of [
      "centerId: nhom.centerId",
      "courseId: nhom.courseId",
      "chiCuaSale: n.actor.chiCuaSale",
      "studentIds: [...new Set(dong.map((d) => d.studentId))]",
      "loaiTruBai: baiCuaNhom.map((b) => b.id)",
    ]) {
      expect(goi, t).toContain(t);
    }
  });

  it("[BTV-W3] bài chỉ toàn dòng KHÔNG xếp được (hết lượt / phải thu phí) bị loại — `gomDongCungBe` sẽ bỏ qua chúng nên bài đó dạy không ai", () => {
    expect(f).toMatch(/if \(!d\.lessonId \|\| !d\.xep\.ok\) continue;/);
  });

  it("[BTV-W4] trần số bài lấy từ MỘT hằng (`TOI_DA_BAI_MOI_CASE`), không số 3 chép tay", () => {
    expect(f).toContain("TOI_DA_BAI_MOI_CASE - baiCuaNhom.length");
    expect(f).not.toMatch(/\b3 - baiCuaNhom/);
  });
});
