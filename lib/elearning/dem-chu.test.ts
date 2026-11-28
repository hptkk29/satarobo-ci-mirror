/** [DC-*] Đếm chữ câu trả lời tự luận / trả lời ngắn — phần thuần. */
import { describe, expect, it } from "vitest";
import { TRAN_KY_TU_CAU_CHU, demTu, dongDemChu } from "./nop-bai-thi-pure";

describe("[DC-01] demTu", () => {
  it("rỗng/toàn khoảng trắng = 0; tách theo mọi khoảng trắng kể cả xuống dòng; không đếm khoảng trắng thừa", () => {
    expect(demTu("")).toBe(0);
    expect(demTu("   \n\t ")).toBe(0);
    expect(demTu("một")).toBe(1);
    expect(demTu("  một   hai\nba\tbốn  ")).toBe(4);
    expect(demTu("a\nb")).toBe(2); // xuống dòng/tab là ranh giới từ, không chỉ dấu cách
    expect(demTu("a    b")).toBe(2); // nhiều dấu cách liền nhau không sinh "từ rỗng"
  });
});

describe("[DC-02] dongDemChu", () => {
  it("in số từ và ký tự theo điểm mã (tiếng Việt có dấu / emoji không đếm đôi)", () => {
    expect(dongDemChu("Xin chào").chu).toBe(`2 từ · 8/${TRAN_KY_TU_CAU_CHU} ký tự`);
    expect(dongDemChu("😀😀").chu).toBe(`1 từ · 2/${TRAN_KY_TU_CAU_CHU} ký tự`);
  });
  it("đúng bằng trần thì chưa quá; vượt 1 ký tự thì quá", () => {
    expect(dongDemChu("a".repeat(TRAN_KY_TU_CAU_CHU)).quaTran).toBe(false);
    expect(dongDemChu("a".repeat(TRAN_KY_TU_CAU_CHU + 1)).quaTran).toBe(true);
  });
});
