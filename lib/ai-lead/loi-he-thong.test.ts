import { describe, expect, it } from "vitest";
import { laLoiTamThoi, maLoiNoiBo } from "./loi-he-thong";
import { ChayLaiGiaoDich } from "./dich-vu/idempotency";

describe("[AIL-LHT-01] phân loại lỗi hạ tầng: tạm thời (503 TEMP_UNAVAILABLE) hay lỗi thật (500)", () => {
  it.each(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034"])("mã Prisma %s ⇒ tạm thời", (code) => {
    expect(laLoiTamThoi(Object.assign(new Error("x"), { code }))).toBe(true);
  });

  it("hết số lần thử lại giao dịch (ChayLaiGiaoDich) ⇒ tạm thời, KHÔNG phải 500 (review độc lập 27/10)", () => {
    expect(laLoiTamThoi(new ChayLaiGiaoDich("version đổi giữa chừng"))).toBe(true);
  });

  it("lỗi lập trình / ràng buộc dữ liệu ⇒ KHÔNG tạm thời (đối chứng: Agent không được bảo thử lại mãi một lỗi thật)", () => {
    expect(laLoiTamThoi(new TypeError("boom"))).toBe(false);
    expect(laLoiTamThoi(Object.assign(new Error("x"), { code: "P2002" }))).toBe(false);
    expect(laLoiTamThoi("chuỗi")).toBe(false);
    expect(laLoiTamThoi(null)).toBe(false);
  });

  it("maLoiNoiBo chỉ trả MÃ/tên lớp, không bao giờ trả message (message Prisma có thể kèm SĐT/tên)", () => {
    expect(maLoiNoiBo(Object.assign(new Error("phone=0905123456"), { code: "P2002" }))).toBe("P2002");
    expect(maLoiNoiBo(new TypeError("phone=0905123456"))).toBe("TypeError");
  });
});
