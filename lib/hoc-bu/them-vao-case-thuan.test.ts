import { describe, expect, it } from "vitest";
import { TOI_DA_BAI_MOI_CASE } from "./case-nhieu-bai-thuan";
import { tongBaiSauKhiThem, vuotTranNeuChon, type DongThem } from "./them-vao-case-thuan";

// [TVC] đếm bài khi thêm học viên vào case đã tạo. Case dạy 1 bài (bài 5); trần 3.
const d = (id: string, lessonId: string, trongBoBai = false): DongThem => ({ id, lessonId, trongBoBai });
const TRAN = TOI_DA_BAI_MOI_CASE;

describe("[TVC-01] tongBaiSauKhiThem", () => {
  it("không chọn gì ⇒ không bài mới, tổng giữ nguyên", () => {
    expect(tongBaiSauKhiThem(1, [])).toEqual({ baiMoi: [], tong: 1 });
  });
  it("dòng vắng bài case ĐÃ dạy không nới bộ bài", () => {
    expect(tongBaiSauKhiThem(1, [d("a", "b5", true), d("b", "b5", true)])).toEqual({ baiMoi: [], tong: 1 });
  });
  it("hai dòng cùng một bài MỚI chỉ kéo MỘT bài", () => {
    expect(tongBaiSauKhiThem(1, [d("a", "b6"), d("b", "b6")])).toEqual({ baiMoi: ["b6"], tong: 2 });
  });
  it("hai bài mới khác nhau ⇒ cộng cả hai", () => {
    expect(tongBaiSauKhiThem(1, [d("a", "b6"), d("b", "b7")])).toEqual({ baiMoi: ["b6", "b7"], tong: 3 });
  });
});

describe("[TVC-02] vuotTranNeuChon — trần là phép tính TỔ HỢP, không phải của từng dòng", () => {
  it("còn chỗ ⇒ chọn được", () => {
    expect(vuotTranNeuChon({ soBaiCase: 1, tran: TRAN, dsChon: [], r: d("a", "b6") })).toBe(false);
  });
  it("đã chọn đủ bài mới đến trần ⇒ dòng vắng bài mới THỨ BA (tổng 4) bị khoá", () => {
    expect(vuotTranNeuChon({ soBaiCase: 1, tran: TRAN, dsChon: [d("a", "b6"), d("b", "b7")], r: d("c", "b8") })).toBe(true);
  });
  it("…nhưng dòng cùng bài mới ĐÃ được chọn (b7) vẫn chọn được — không thêm bài nào", () => {
    expect(vuotTranNeuChon({ soBaiCase: 1, tran: TRAN, dsChon: [d("a", "b6"), d("b", "b7")], r: d("c", "b7") })).toBe(false);
  });
  it("…và dòng vắng bài case ĐÃ dạy luôn chọn được dù case đã đủ bài", () => {
    expect(vuotTranNeuChon({ soBaiCase: 3, tran: TRAN, dsChon: [], r: d("c", "b5", true) })).toBe(false);
  });
  it("case đã đủ 3 bài ⇒ mọi dòng vắng bài MỚI bị khoá", () => {
    expect(vuotTranNeuChon({ soBaiCase: 3, tran: TRAN, dsChon: [], r: d("c", "b8") })).toBe(true);
  });
  it("dòng ĐÃ chọn luôn gỡ được (không bao giờ tự khoá chính nó)", () => {
    const chon = [d("a", "b6"), d("b", "b7")];
    expect(vuotTranNeuChon({ soBaiCase: 1, tran: TRAN, dsChon: chon, r: chon[1]! })).toBe(false);
  });
  it("trần đọc từ một hằng: TOI_DA_BAI_MOI_CASE = 3", () => {
    expect(TRAN).toBe(3);
  });
});
