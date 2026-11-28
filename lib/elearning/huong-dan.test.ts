// @vitest-environment node
/** [ELHD-*] P8 — dữ liệu hướng dẫn sử dụng: cấu trúc, tách khu, và LỜI HƯỚNG DẪN KHÔNG HỨA thứ ứng dụng chưa có. */
import { describe, expect, it } from "vitest";
import { DANH_SACH_HUONG_DAN, DUONG_HUONG_DAN, HUONG_DAN_NHAN_VIEN, HUONG_DAN_QUAN_TRI, timHuongDan } from "./huong-dan";

describe("[ELHD-01] cấu trúc", () => {
  it("nhân viên 4 bài, quản trị 5 bài; slug duy nhất trong từng khu; mỗi bài ≥ 3 bước, mỗi bước có đủ tiêu đề + mô tả", () => {
    expect(HUONG_DAN_NHAN_VIEN).toHaveLength(4);
    expect(HUONG_DAN_QUAN_TRI).toHaveLength(5);
    for (const ds of Object.values(DANH_SACH_HUONG_DAN)) {
      expect(new Set(ds.map((b) => b.slug)).size).toBe(ds.length);
      for (const b of ds) {
        expect(b.buoc.length, b.slug).toBeGreaterThanOrEqual(3);
        expect(b.phut, b.slug).toBeGreaterThan(0);
        for (const x of b.buoc) expect(x.tieuDe.trim() && x.moTa.trim(), `${b.slug}: ${x.tieuDe}`).toBeTruthy();
      }
    }
  });
});

describe("[ELHD-02] timHuongDan", () => {
  it("🔴 trả bài + bài trước/sau trong ĐÚNG khu; bài đầu không có trước, bài cuối không có sau", () => {
    const dau = timHuongDan("nhan-vien", "hoc-khoa")!;
    expect(dau.truoc).toBeNull();
    expect(dau.tiep?.slug).toBe("kiem-tra");
    const cuoi = timHuongDan("nhan-vien", "chung-nhan")!;
    expect(cuoi.tiep).toBeNull();
    expect(cuoi.truoc?.slug).toBe("bai-tap");
  });
  it("🔴 slug của khu KIA ⇒ null (không lộ nội dung quản trị qua đường nhân viên, và ngược lại); slug lạ ⇒ null", () => {
    expect(timHuongDan("nhan-vien", "soan-khoa")).toBeNull();
    expect(timHuongDan("quan-tri", "hoc-khoa")).toBeNull();
    expect(timHuongDan("nhan-vien", "khong-co")).toBeNull();
  });
  it("hai khu có đường dẫn khác nhau", () => {
    expect(DUONG_HUONG_DAN["nhan-vien"]).not.toBe(DUONG_HUONG_DAN["quan-tri"]);
  });
});

describe("[ELHD-03] lời hướng dẫn KHÔNG hứa thứ ứng dụng chưa có (chốt 19/11/2026)", () => {
  const tatCa = [...HUONG_DAN_NHAN_VIEN, ...HUONG_DAN_QUAN_TRI].flatMap((b) => [b.tieuDe, b.moTa, ...b.buoc.flatMap((x) => [x.tieuDe, x.moTa])]).join(" | ").toLocaleLowerCase("vi-VN");
  // Mỗi mẫu là một điều thiết kế nói mà ứng dụng CHƯA làm: thêm tính năng thật thì SỬA có chủ đích cả mẫu này lẫn nội dung.
  const CHUA_CO: [string, RegExp][] = [
    ["ổ khoá / học tuần tự (Q7)", /ổ khoá|ổ khóa|xong bài trước mới mở/],
    ["bấm 'Câu tiếp' / ô số câu (runner từng câu)", /câu tiếp|ô số/],
    ["quay video / rút bài đã nộp", /quay video|quay bằng|rút bài/],
    ["ảnh/âm thanh trong câu hỏi", /thêm ảnh|âm thanh/],
    ["chọn mẫu chứng nhận (P7)", /chọn mẫu|mẫu chứng nhận/],
    ["học viên online (P9)", /học viên online|khoá online|cửa hàng/],
    ["xem như người học", /xem như người học/],
  ];
  for (const [ten, mau] of CHUA_CO) {
    it(`không nhắc: ${ten}`, () => expect(tatCa).not.toMatch(mau));
  }
});
