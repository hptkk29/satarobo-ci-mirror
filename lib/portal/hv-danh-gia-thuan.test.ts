import { describe, expect, it } from "vitest";
import { demCauThieu, kieuCau, nhanConThieu, nhanLuaChon, type CauTho } from "./hv-danh-gia-thuan";

const q = (id: string, type: CauTho["type"], p: Partial<CauTho> = {}): CauTho => ({ id, type, label: id, options: [], required: true, ...p });

describe("đánh giá thầy cô — kiểu câu", () => {
  it("[HVD-01] RADIO đúng 5 lựa chọn ⇒ hàng mặt cười; số lựa chọn khác ⇒ nút chọn một", () => {
    expect(kieuCau({ type: "RADIO", options: ["a", "b", "c", "d", "e"] })).toBe("mat");
    expect(kieuCau({ type: "RADIO", options: ["a", "b", "c", "d"] })).toBe("chon-mot");
    expect(kieuCau({ type: "RADIO", options: [] })).toBe("chon-mot");
  });
  it("[HVD-02] sao / chọn nhiều / văn bản", () => {
    expect(kieuCau({ type: "STAR_RATING", options: [] })).toBe("sao");
    expect(kieuCau({ type: "CHECKBOX", options: ["x"] })).toBe("chon-nhieu");
    expect(kieuCau({ type: "TEXTBOX", options: [] })).toBe("van-ban");
  });
});

describe("đánh giá thầy cô — câu còn thiếu", () => {
  const cau = [
    q("mat", "RADIO", { options: ["1", "2", "3", "4", "5"] }),
    q("sao", "STAR_RATING"),
    q("thich", "CHECKBOX", { options: ["a", "b"], required: false }),
    q("loi", "TEXTBOX", { required: false }),
    q("bat-buoc-chu", "TEXTBOX"),
  ];
  it("[HVD-03] chỉ đếm câu BẮT BUỘC còn trống; câu không bắt buộc không bao giờ tính", () => {
    expect(demCauThieu(cau, {})).toBe(3);
    expect(demCauThieu(cau, { mat: { options: ["3"] }, sao: { number: 4 }, "bat-buoc-chu": { text: "ok" } })).toBe(0);
  });
  it("[HVD-04] sao 0 chưa tính là đã chọn; văn bản toàn khoảng trắng chưa tính; chọn rỗng chưa tính", () => {
    expect(demCauThieu(cau, { mat: { options: [] }, sao: { number: 0 }, "bat-buoc-chu": { text: "   " } })).toBe(3);
  });
  it("[HVD-05] câu nhắc dưới nút Gửi", () => {
    expect(nhanConThieu(2)).toBe("Còn 2 câu chưa chọn");
    expect(nhanConThieu(0)).toBe("Đủ rồi, em bấm Gửi nhé!");
  });
  it("[HVD-06] bỏ emoji đầu lựa chọn, giữ nguyên chữ nếu không có", () => {
    expect(nhanLuaChon("😞 Chán")).toBe("Chán");
    expect(nhanLuaChon("Rất vui")).toBe("Rất vui");
  });
});
