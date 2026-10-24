// 27/08 — Sale lấy phiếu đánh giá NGAY TRÊN DÒNG ĐIỂM DANH.
//
// Bối cảnh: khối "Phiếu đánh giá buổi học" (hệ SESSION_EVAL) đã gỡ khỏi màn Lớp Trial.
// Nó là CỬA THỨ HAI cho cùng một việc — giáo viên thật sự chấm bằng phiếu rubric ở site
// giáo viên (`TrialRubricEval`), và chính phiếu đó mới là thứ Sale in đưa phụ huynh.
// Hai hệ song song thì Sale mở khối kia ra luôn thấy trống dù giáo viên đã chấm xong.
//
// Nay mỗi dòng điểm danh có một nút, đặt TRƯỚC ô ghi chú:
//   · đã có phiếu  → "Xuất PDF", mở thẳng file;
//   · chưa có      → bấm vào báo "chưa được đánh giá".
import { describe, it, expect } from "vitest";
import {
  duongDanPdfPhieu,
  nhanNutPhieu,
  LOI_CHUA_DANH_GIA,
} from "./phieu-danh-gia";

describe("[GĐ4] nút phiếu đánh giá trên dòng điểm danh", () => {
  it("đã đánh giá → nhãn Xuất PDF, có đường dẫn mở file", () => {
    expect(nhanNutPhieu(true)).toBe("Xuất PDF");
  });

  it("chưa đánh giá → nhãn Nhận phiếu đánh giá", () => {
    expect(nhanNutPhieu(false)).toBe("Nhận phiếu đánh giá");
  });

  it("đường dẫn PDF mang THEO BUỔI, không chỉ theo ca", () => {
    // GĐ4 khoá phiếu theo cặp (ca, buổi): một ca có nhiều phiếu. Thiếu `sessionId` là
    // dòng buổi 1 in ra phiếu buổi 2 — sai phiếu mà trông vẫn bình thường.
    expect(duongDanPdfPhieu("enr-1", "ses-9")).toBe(
      "/lop-trial/pdf/enr-1?sessionId=ses-9",
    );
  });

  it("id có ký tự lạ vẫn được mã hoá — không vỡ query", () => {
    expect(duongDanPdfPhieu("a b&c", "s?1")).toBe(
      "/lop-trial/pdf/a%20b%26c?sessionId=s%3F1",
    );
  });

  it("có một câu báo lỗi DUY NHẤT cho trường hợp chưa chấm", () => {
    // Route PDF và nút bấm phải nói cùng một câu; hai câu khác nhau cho cùng một tình
    // huống là người dùng tưởng gặp hai lỗi khác nhau.
    expect(LOI_CHUA_DANH_GIA).toMatch(/chưa được giáo viên đánh giá/i);
  });
});
