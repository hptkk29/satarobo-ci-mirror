import { describe, it, expect } from "vitest";
import {
  laLopTheoKhung,
  thuocCase,
  laHocCaLop,
  laChuaXepCase,
  LOP_CU_WHERE,
} from "./nghia-null";

const KHUNG = { theoKhung: true };
const CU = { theoKhung: false };
const CASE_A = "case-a";
const CASE_B = "case-b";
const KHONG_HUY = new Set<string>();

describe("[NN-01] loại lớp — đọc cột đánh dấu, KHÔNG đoán từ giờ", () => {
  it("theoKhung = true ⇒ lớp theo khung; false ⇒ lớp cũ", () => {
    expect(laLopTheoKhung(KHUNG)).toBe(true);
    expect(laLopTheoKhung(CU)).toBe(false);
  });
  it("[NN-01b] lớp CŨ tạo trước 28/08 VẪN mang giờ cấp lớp — không được nhận là theo khung", () => {
    // Hình dạng dữ liệu thật trên prod: migration 28/08 chỉ DROP NOT NULL, giữ nguyên
    // giờ của lớp cũ. Hàm cũ (đoán từ startTime+endTime) trả TRUE ở đây — đúng lỗi đo
    // được trên lớp UAT `uat-lopthu-CS1-1`.
    const lopTruoc2808 = { theoKhung: false, startTime: "14:00", endTime: "19:00" };
    expect(laLopTheoKhung(lopTruoc2808)).toBe(false);
  });
  it("bản `where` khớp ĐÚNG laLopTheoKhung", () => {
    expect(LOP_CU_WHERE).toEqual({ theoKhung: false });
  });
});

describe("[NN-02] thuộc case — NGHĨA NULL PHỤ THUỘC LOẠI LỚP", () => {
  it("xếp đúng case ⇒ thuộc, ở mọi loại lớp", () => {
    expect(thuocCase({ scheduledSessionId: CASE_A }, CASE_A, true)).toBe(true);
    expect(thuocCase({ scheduledSessionId: CASE_A }, CASE_A, false)).toBe(true);
  });
  it("xếp case KHÁC ⇒ không thuộc, ở mọi loại lớp", () => {
    // Đây là cổng chống điểm danh một bé ở hai case (sinh hai dòng có mặt, thổi số
    // buổi đã dự và tự đẩy trạng thái lead).
    expect(thuocCase({ scheduledSessionId: CASE_A }, CASE_B, true)).toBe(false);
    expect(thuocCase({ scheduledSessionId: CASE_A }, CASE_B, false)).toBe(false);
  });
  it("[NN-02c] NULL ở lớp THEO KHUNG ⇒ KHÔNG thuộc case nào (chưa xếp case)", () => {
    expect(thuocCase({ scheduledSessionId: null }, CASE_A, true)).toBe(false);
  });
  it("[NN-02d] NULL ở lớp CŨ ⇒ thuộc MỌI buổi (học cả lớp, chốt 28/08)", () => {
    // Nếu ca này đỏ thì gần như mọi bé trên prod (ghi danh từ 28/08 đều NULL) biến
    // khỏi bảng điểm danh và khỏi site giáo viên.
    expect(thuocCase({ scheduledSessionId: null }, CASE_A, false)).toBe(true);
    expect(thuocCase({ scheduledSessionId: null }, CASE_B, false)).toBe(true);
  });
});

describe("[NN-03] học cả lớp — chỉ ở lớp cũ", () => {
  it("NULL ở lớp cũ ⇒ học cả lớp", () => {
    expect(laHocCaLop({ scheduledSessionId: null }, false)).toBe(true);
  });
  it("NULL ở lớp theo khung ⇒ KHÔNG phải học cả lớp", () => {
    expect(laHocCaLop({ scheduledSessionId: null }, true)).toBe(false);
  });
  it("đã xếp case ⇒ không phải học cả lớp", () => {
    expect(laHocCaLop({ scheduledSessionId: CASE_A }, false)).toBe(false);
  });
});

describe("[NN-04] chưa xếp case", () => {
  it("NULL + ACTIVE ở lớp theo khung ⇒ chưa xếp", () => {
    expect(laChuaXepCase({ scheduledSessionId: null, status: "ACTIVE" }, true, KHONG_HUY)).toBe(true);
  });
  it("NULL ở lớp cũ ⇒ KHÔNG phải chưa xếp (bé học cả lớp)", () => {
    expect(laChuaXepCase({ scheduledSessionId: null, status: "ACTIVE" }, false, KHONG_HUY)).toBe(false);
  });
  it("[NN-04c] trỏ vào case ĐÃ HUỶ ⇒ chưa xếp, ở MỌI loại lớp", () => {
    // Thiếu vế này thì bé kẹt trong thẻ case đã huỷ: không khối nào nhận, không ô nào
    // chuyển đi được — đo được 23/09 (huỷ case không đụng ghi danh).
    const huy = new Set([CASE_A]);
    expect(laChuaXepCase({ scheduledSessionId: CASE_A, status: "ACTIVE" }, true, huy)).toBe(true);
    expect(laChuaXepCase({ scheduledSessionId: CASE_A, status: "ACTIVE" }, false, huy)).toBe(true);
  });
  it("trỏ vào case còn sống ⇒ không phải chưa xếp", () => {
    const huy = new Set([CASE_B]);
    expect(laChuaXepCase({ scheduledSessionId: CASE_A, status: "ACTIVE" }, true, huy)).toBe(false);
  });
  it("không còn ACTIVE (đã học xong / đã rút) ⇒ không đòi xếp nữa", () => {
    const huy = new Set([CASE_A]);
    for (const status of ["COMPLETED", "WITHDRAWN"]) {
      expect(laChuaXepCase({ scheduledSessionId: null, status }, true, KHONG_HUY)).toBe(false);
      expect(laChuaXepCase({ scheduledSessionId: CASE_A, status }, true, huy)).toBe(false);
    }
  });
});
