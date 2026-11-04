import { describe, expect, it } from "vitest";
import { docTrang, giaiMaTrenUrl, hrefVoi, kepTrang, motGiaTri } from "./url";

describe("[NHH-FE-06] hrefVoi — bộ lọc trên URL", () => {
  it("bỏ giá trị rỗng/null/undefined; không tham số ⇒ trả base trần", () => {
    expect(hrefVoi("/nguon-hoa-hong/nguon")).toBe("/nguon-hoa-hong/nguon");
    expect(hrefVoi("/x", { coSo: null, xem: "", "van-de": undefined })).toBe("/x");
  });

  it("thứ tự cố định bất kể thứ tự khai (cùng trạng thái ⇒ cùng một chuỗi)", () => {
    const a = hrefVoi("/x", { trang: 3, coSo: "cs1", xem: "tat-ca" });
    const b = hrefVoi("/x", { xem: "tat-ca", trang: 3, coSo: "cs1" });
    expect(a).toBe(b);
    expect(a).toBe("/x?coSo=cs1&xem=tat-ca&trang=3");
  });

  it("trang=1 không lên URL (mặc định); trang ≥ 2 thì có", () => {
    expect(hrefVoi("/x", { trang: 1 })).toBe("/x");
    expect(hrefVoi("/x", { trang: "1" })).toBe("/x");
    expect(hrefVoi("/x", { trang: 2 })).toBe("/x?trang=2");
  });

  it("giá trị chỉ có khoảng trắng bị bỏ; khoảng trắng hai đầu bị cắt (không lên URL thành %20)", () => {
    expect(hrefVoi("/x", { coSo: "   " })).toBe("/x");
    expect(hrefVoi("/x", { coSo: " cs1 ", "van-de": "  " })).toBe("/x?coSo=cs1");
  });

  it("mã hoá ký tự đặc biệt, không để query bị tiêm thêm tham số", () => {
    expect(hrefVoi("/x", { coSo: "a&b=c" })).toBe("/x?coSo=a%26b%3Dc");
  });
});

describe("docTrang / motGiaTri — đầu vào lạ không làm sập trang", () => {
  it("docTrang: rác, âm, 0, mảng ⇒ về 1 hoặc phần tử đầu", () => {
    expect(docTrang(undefined)).toBe(1);
    expect(docTrang("abc")).toBe(1);
    expect(docTrang("0")).toBe(1);
    expect(docTrang("-4")).toBe(1);
    expect(docTrang("7")).toBe(7);
    expect(docTrang(["3", "9"])).toBe(3);
  });
  it("motGiaTri: rỗng/khoảng trắng ⇒ null", () => {
    expect(motGiaTri("  ")).toBeNull();
    expect(motGiaTri(undefined)).toBeNull();
    expect(motGiaTri(["x", "y"])).toBe("x");
  });
});

describe("[NHH-FE-06c] kepTrang — ?trang= vượt số trang không để bảng rỗng", () => {
  it("trang trong biên giữ nguyên; vượt ⇒ kẹp về trang CUỐI (ceil, không floor)", () => {
    expect(kepTrang(3, 60, 25)).toBe(3);
    expect(kepTrang(4, 60, 25)).toBe(3);
    expect(kepTrang(99, 30, 25)).toBe(2); // 30 lead = 2 trang (ceil), không phải 1 (floor)
    expect(kepTrang(2, 26, 25)).toBe(2);
    expect(kepTrang(3, 26, 25)).toBe(2);
  });
  it("tổng 0 ⇒ trang 1 (không về 0); trang < 1 ⇒ 1", () => {
    expect(kepTrang(5, 0, 25)).toBe(1);
    expect(kepTrang(1, 0, 25)).toBe(1);
    expect(kepTrang(0, 10, 25)).toBe(1);
    expect(kepTrang(-3, 10, 25)).toBe(1);
  });
});

describe("[NHH-FE-06d] giaiMaTrenUrl — mã trên URL hỏng không làm sập trang bằng URIError", () => {
  it("giải mã %-escape hợp lệ", () => {
    expect(giaiMaTrenUrl("UNKNOWN")).toBe("UNKNOWN");
    expect(giaiMaTrenUrl("nhom%20a")).toBe("nhom a");
    expect(giaiMaTrenUrl("n%C3%B3m")).toBe("nóm");
  });
  it("%-escape sai ⇒ null (để page trả 404), KHÔNG ném", () => {
    expect(giaiMaTrenUrl("%")).toBeNull();
    expect(giaiMaTrenUrl("%E0%A4%A")).toBeNull();
    expect(() => giaiMaTrenUrl("%zz")).not.toThrow();
  });
});
