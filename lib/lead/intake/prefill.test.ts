// lib/lead/intake/prefill.test.ts — luật ĐỌC tham số `?phone=&name=` của trang nhập khách.
//
// Vì sao test tầng này trước tầng giao diện: hai trang (`admin` + `sale`) đều gọi
// đúng một hàm thuần, nên chỗ dễ hỏng nhất KHÔNG phải React mà là phép quyết định
// "chuỗi này có phải SĐT không". Sai ở đây thì lỗi hiện ra dưới dạng ô SĐT chứa
// chuỗi rác — người nhập bấm Lưu và ăn 400 mà không hiểu vì sao.
import { describe, it, expect } from "vitest";
import { docPrefillTuQuery } from "./prefill";

describe("[ZC-PF] đọc prefill từ query của /nhap-khach-hang", () => {
  it("[ZC-PF-01] SĐT hợp lệ ⇒ trả dạng HIỂN THỊ 0…, tên giữ nguyên", () => {
    expect(docPrefillTuQuery({ phone: "0905123456", name: "Chị An" })).toEqual({
      phone: "0905123456",
      parentName: "Chị An",
    });
  });

  it("[ZC-PF-01b] SĐT canonical 84… trong query vẫn ra 0… để người nhập đọc được", () => {
    expect(docPrefillTuQuery({ phone: "84905123456" }).phone).toBe("0905123456");
  });

  it("[ZC-PF-01c] SĐT có khoảng trắng/dấu chấm (dán từ Zalo) vẫn nhận", () => {
    expect(docPrefillTuQuery({ phone: "+84 905.123.456" }).phone).toBe("0905123456");
  });

  it("[ZC-PF-02] query rỗng ⇒ hai ô đều là chuỗi rỗng (form giống hệt EMPTY)", () => {
    expect(docPrefillTuQuery({})).toEqual({ phone: "", parentName: "" });
  });

  it("[ZC-PF-03] SĐT không hợp lệ ⇒ ô để TRỐNG, không đổ chuỗi rác vào form", () => {
    for (const rac of ["abc", "123", "02363123456", "", "0905123", "0905 123 456 789"]) {
      expect(docPrefillTuQuery({ phone: rac }).phone).toBe("");
    }
  });

  it("[ZC-PF-04] tham số lặp (?phone=a&phone=b ⇒ mảng) coi như KHÔNG có", () => {
    expect(docPrefillTuQuery({ phone: ["0905123456", "0905123457"], name: ["A", "B"] })).toEqual({
      phone: "",
      parentName: "",
    });
  });

  it("[ZC-PF-05] tên bị cắt hai đầu và cắt về đúng trần 120 ký tự của validator", () => {
    expect(docPrefillTuQuery({ name: "  Chị An  " }).parentName).toBe("Chị An");
    expect(docPrefillTuQuery({ name: "x".repeat(500) }).parentName).toHaveLength(120);
  });

  it("[ZC-PF-06] khoá tên là `name` — `parentName` KHÔNG được nhận (một khoá duy nhất)", () => {
    expect(docPrefillTuQuery({ parentName: "Chị An" }).parentName).toBe("");
  });

  it("[ZC-PF-07] tham số lạ trong query bị bỏ qua, không lọt vào form", () => {
    const kq = docPrefillTuQuery({
      phone: "0905123456",
      zcrmContactId: "ct-1",
      note: "<script>",
    });
    expect(Object.keys(kq).sort()).toEqual(["parentName", "phone"]);
  });
});
