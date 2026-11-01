// Kanban lead — số thẻ mỗi cột (28/08/2026, chủ dự án chốt).
//
// Vì sao có test cho một con số: `docSoTheMoiCot` dùng CHUNG tham số `?size=` với bảng
// nhưng MẶC ĐỊNH khác (10 vs 20). Ai đó "dọn trùng lặp" bằng cách gọi thẳng `docSoDong`
// sẽ làm Kanban lặng lẽ nhảy lên 20 thẻ/cột — không đỏ ở đâu cả, chỉ là trang dài gấp đôi.
import { describe, it, expect } from "vitest";
import {
  docSoDong,
  docSoTheMoiCot,
  MUC_SO_DONG,
  MUC_THE_MOI_COT,
  SO_DONG_MAC_DINH,
  SO_THE_MOI_COT_MAC_DINH,
} from "./phan-trang";

describe("số thẻ mỗi cột Kanban", () => {
  it("mặc định 5 — KHÁC mặc định 20 của bảng", () => {
    expect(SO_THE_MOI_COT_MAC_DINH).toBe(5);
    expect(docSoTheMoiCot(undefined)).toBe(5);
    expect(docSoDong(undefined)).toBe(SO_DONG_MAC_DINH);
    expect(SO_THE_MOI_COT_MAC_DINH).not.toBe(SO_DONG_MAC_DINH);
  });

  it("nhận đủ 5 mức 5/10/20/50/100", () => {
    expect([...MUC_THE_MOI_COT]).toEqual([5, 10, 20, 50, 100]);
    for (const n of MUC_THE_MOI_COT) expect(docSoTheMoiCot(String(n))).toBe(n);
  });

  it("mặc định PHẢI nằm trong danh sách mức — nếu không ô chọn hiện giá trị không có mục", () => {
    expect([...MUC_THE_MOI_COT]).toContain(SO_THE_MOI_COT_MAC_DINH);
    expect([...MUC_SO_DONG]).toContain(SO_DONG_MAC_DINH);
  });

  // Ngưỡng hiện thanh phân trang của MỌI bảng đọc `MUC_SO_DONG[0]`. Nhét mức 5 vào
  // danh sách dùng chung là đổi ngưỡng đó từ 10 xuống 5 trên toàn hệ — đúng thứ test
  // này chặn.
  it("mức 5 KHÔNG lọt vào danh sách của bảng", () => {
    expect([...MUC_SO_DONG]).not.toContain(5);
    expect(MUC_SO_DONG[0]).toBe(10);
    expect(docSoDong("5")).toBe(SO_DONG_MAC_DINH);
  });

  it("giá trị lạ / gõ tay trên URL → về mặc định, không thành take khổng lồ", () => {
    for (const xau of ["99999", "0", "-5", "abc", "", undefined]) {
      expect(docSoTheMoiCot(xau)).toBe(SO_THE_MOI_COT_MAC_DINH);
    }
  });

  it("mảng (?size=10&size=50) lấy phần tử đầu — khớp hành vi của bảng", () => {
    expect(docSoTheMoiCot(["50", "10"])).toBe(50);
  });
});
