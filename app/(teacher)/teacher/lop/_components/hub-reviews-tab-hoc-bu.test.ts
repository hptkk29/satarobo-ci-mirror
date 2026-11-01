/**
 * LƯỚI GHIM MÃ NGUỒN — tab "Nhận xét" của lớp phải hiện nhận xét BUỔI BÙ cho em vắng buổi gốc (18/10/2026).
 *
 * Từ T07 nhận xét buổi bù lưu ở chính mục case dạy bù (`teacherEvaluation`), KHÔNG ghi vào phiếu của buổi gốc, nên bảng này
 * từng chỉ in "Vắng — không nhận xét" cho em đã học bù xong và đã được nhận xét. Hành vi cần DB + RSC nên khoá bằng mã nguồn
 * (mẫu lưới ghim: bỏ chú thích, đếm số lần, không dùng cờ /s).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const nguon = readFileSync(resolve(process.cwd(), "app/(teacher)/teacher/lop/_components/hub-reviews-tab.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string) => nguon.split(s).length - 1;

describe("[HRB] hub-reviews-tab — nhận xét buổi bù", () => {
  it("[HRB-01] tra mục học bù THEO BUỔI GỐC đang xem, chỉ mục đã có kết quả", () => {
    expect(dem("sdb.makeupCaseStudent.findMany(")).toBe(1);
    expect(dem("makeupNeed: { missedSessionId: reviewSessionId }")).toBe(1);
    expect(dem('result: { in: ["COMPLETED", "NOT_COMPLETED"] }')).toBe(1);
  });

  it("[HRB-02] chỉ mục CÓ NỘI DUNG mới hiện (phieuCoNoiDung), và vẫn còn nhãn 'Vắng — không nhận xét' cho em chưa học bù", () => {
    expect(dem("phieuCoNoiDung(m)")).toBe(1);
    expect(dem("buCuaHocVien.has(st.id)")).toBe(1);
    expect(dem("Vắng — không nhận xét")).toBe(1);
  });
});
