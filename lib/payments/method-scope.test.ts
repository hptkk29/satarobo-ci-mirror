import { describe, it, expect } from "vitest";
import {
  methodServesCenter,
  methodAllowsOrderType,
  methodUsableForOrder,
  filterMethodsForCenter,
} from "./method-scope";

const base = {
  canBuyCourse: true,
  canBuyPackage: true,
  canBuyExam: true,
  canBuyProduct: false,
};

const chung = { ...base, centerId: null };
const cs1 = { ...base, centerId: "co-so-nguyen-huu-tho" };
const cs2 = { ...base, centerId: "co-so-hoang-dieu" };

describe("[PTTT-CS-01] methodServesCenter — cách ly cơ sở", () => {
  it("phương thức DÙNG CHUNG (centerId null) hợp lệ ở mọi cơ sở", () => {
    expect(methodServesCenter(chung, "co-so-nguyen-huu-tho")).toBe(true);
    expect(methodServesCenter(chung, "co-so-hoang-dieu")).toBe(true);
  });

  it("phương thức của CS1 KHÔNG dùng được cho đơn của CS2 — đây là yêu cầu gốc", () => {
    expect(methodServesCenter(cs1, "co-so-hoang-dieu")).toBe(false);
    expect(methodServesCenter(cs2, "co-so-nguyen-huu-tho")).toBe(false);
  });

  it("phương thức của CS1 dùng được cho đơn CS1", () => {
    expect(methodServesCenter(cs1, "co-so-nguyen-huu-tho")).toBe(true);
  });

  it("đơn KHÔNG gắn cơ sở chỉ dùng được phương thức chung — không phải 'rỗng hết'", () => {
    // Mục "— Không gán —" của form tạo đơn là ca có thật; trả false cho mọi thứ
    // là khoá luôn đường tạo đơn đó.
    expect(methodServesCenter(chung, null)).toBe(true);
    expect(methodServesCenter(chung, undefined)).toBe(true);
    expect(methodServesCenter(cs1, null)).toBe(false);
  });

  it("centerId undefined trên phương thức (hàng select thiếu cột) coi như dùng chung", () => {
    expect(methodServesCenter({ centerId: undefined as never }, "co-so-hoang-dieu")).toBe(true);
  });
});

describe("[PTTT-CS-02] methodAllowsOrderType — gộp 4 bản chép cũ", () => {
  it("map đúng từng loại đơn về đúng cờ", () => {
    expect(methodAllowsOrderType(base, "COURSE")).toBe(true);
    expect(methodAllowsOrderType(base, "PACKAGE")).toBe(true);
    expect(methodAllowsOrderType(base, "EXAM")).toBe(true);
    expect(methodAllowsOrderType(base, "PRODUCT")).toBe(false);
  });

  it("loại đơn lạ → fail-closed (chặn), không phải cho qua", () => {
    expect(methodAllowsOrderType(base, "SOMETHING_NEW")).toBe(false);
  });
});

describe("[PTTT-CS-03] methodUsableForOrder — hai luật phải cùng đạt", () => {
  it("đúng cơ sở nhưng sai loại đơn → chặn", () => {
    expect(methodUsableForOrder(cs1, "co-so-nguyen-huu-tho", "PRODUCT")).toBe(false);
  });

  it("đúng loại đơn nhưng sai cơ sở → chặn", () => {
    expect(methodUsableForOrder(cs1, "co-so-hoang-dieu", "COURSE")).toBe(false);
  });

  it("đúng cả hai → cho qua", () => {
    expect(methodUsableForOrder(cs1, "co-so-nguyen-huu-tho", "COURSE")).toBe(true);
  });
});

describe("[PTTT-CS-04] filterMethodsForCenter", () => {
  const all = [chung, cs1, cs2];

  it("đơn CS1 thấy phương thức chung + của CS1, KHÔNG thấy của CS2", () => {
    const got = filterMethodsForCenter(all, "co-so-nguyen-huu-tho");
    expect(got).toEqual([chung, cs1]);
  });

  it("đơn CS2 thấy phương thức chung + của CS2", () => {
    const got = filterMethodsForCenter(all, "co-so-hoang-dieu");
    expect(got).toEqual([chung, cs2]);
  });

  it("đơn không cơ sở chỉ thấy phương thức chung", () => {
    expect(filterMethodsForCenter(all, null)).toEqual([chung]);
  });

  it("giữ nguyên thứ tự đầu vào (displayOrder đã sắp ở tầng query)", () => {
    const got = filterMethodsForCenter([cs1, chung], "co-so-nguyen-huu-tho");
    expect(got).toEqual([cs1, chung]);
  });
});
