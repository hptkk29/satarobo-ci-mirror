// @vitest-environment node
// [BL6B-W] LƯỚI GHIM DÂY NỐI: hai màn admin còn tự dựng "học viên của lớp" phải đi qua bộ lọc bảo lưu của Phiên 4 (`lib/bao-luu/roster.ts`).
//
// Vì sao ghim bằng đọc mã: cả hai là trang RSC gọi `sdb.enrollment.findMany` — không có chỗ cấy lỗi bằng test hành vi, và quên lọc thì KHÔNG ca
// nào đỏ (triệu chứng nằm ở người dùng):
//   · `sessions/[id]/page.tsx` dựng danh sách em cho trình soạn nhận xét; bấm Lưu thì server (`getSessionRosterStudentIds`, đã loại em bảo lưu ở
//     Phiên 4) từ chối CẢ LÔ "Có học viên không thuộc danh sách" — lớp nào có một em bảo lưu là KHÔNG LƯU ĐƯỢC nhận xét;
//   · `attendance/page.tsx` dựng roster mà `sessionWorkState` so với điểm danh: em bảo lưu không có bản ghi ⇒ buổi "thiếu 1 em" MÃI MÃI (đúng bệnh
//     mà chú thích của chính trang ấy cảnh báo: hai nơi đếm sĩ số khác nhau ⇒ không buổi nào xong).
// Neo vào LỜI GỌI (có dấu mở ngoặc) và SỐ LẦN khớp, trên mã đã bỏ chú thích (luật 11: chú thích giải thích bản vá hay chứa đúng chuỗi cần canh).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/ .*$/gm, "");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[BL6B-W] màn admin dùng bộ lọc bảo lưu của Phiên 4", () => {
  it("[BL6B-W1] sessions/[id]/page.tsx: danh sách em của trình nhận xét lọc theo NGÀY CỦA BUỔI (`trongLop(…, sess.date)`), đúng một lần", () => {
    const s = doc("app/(admin)/admin/sessions/[id]/page.tsx");
    expect(dem(s, /trongLop\(/g)).toBe(1);
    expect(s).toMatch(/\},\s*sess\.date,?\s*\)/);
  });

  it("[BL6B-W2] attendance/page.tsx: roster mỗi buổi loại em bảo lưu tại NGÀY BUỔI ĐÓ (`rosterTai(s.date)` → `laDangBaoLuuTheoQuyChe(r, ngay)`), nạp hồ sơ qua `CHON_HO_SO_BAO_LUU`", () => {
    const s = doc("app/(admin)/admin/attendance/page.tsx");
    expect(dem(s, /laDangBaoLuuTheoQuyChe\(/g)).toBe(1);
    // roster được hỏi THEO NGÀY TỪNG BUỔI (không một Set chung cho cả lớp) và hàm lọc nhận đúng ngày đó
    expect(s).toMatch(/laDangBaoLuuTheoQuyChe\(\s*r\s*,\s*ngay\s*\)/);
    expect(dem(s, /rosterTai\(s\.date\)/g)).toBe(1);
    expect(dem(s, /\.\.\.CHON_HO_SO_BAO_LUU/g)).toBe(1);
  });

  it("[BL6B-W3] attendance/page.tsx: cột sĩ số của danh sách lớp (`_count.enrollments`) cũng qua `trongLop(…)`, đúng một lần", () => {
    const s = doc("app/(admin)/admin/attendance/page.tsx");
    expect(dem(s, /trongLop\(/g)).toBe(1);
  });

  it("[BL6B-W4] roster cả lớp KHÔNG còn là một Set dựng một lần cho mọi buổi (bản cũ `new Set(rosterRows.map(`)", () => {
    const s = doc("app/(admin)/admin/attendance/page.tsx");
    expect(dem(s, /new Set\(rosterRows\.map\(/g)).toBe(0);
  });
});
