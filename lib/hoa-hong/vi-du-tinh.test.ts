// @vitest-environment node
// [NHH-FE-VD-*] — TÍNH VÍ DỤ ở bước "Thử tính" của builder (thuần, không DB). Đây KHÔNG phải thử tính 3 tháng (chưa có):
// chỉ là phép nhân tỉ lệ vừa gõ với MỘT khoản thu người dùng nhập, để họ thấy 3% của 10.000.000 là 300.000. Hai điều phải
// đúng: tiền làm tròn bằng ĐÚNG hàm của engine (`tienPhanTram`), và tổng so trần bằng SỐ NGUYÊN trên tỉ lệ, không trên tiền.
import { describe, expect, it } from "vitest";
import { formRong, type FormChinhSach } from "./chinh-sach-form";
import { tongTheoLoai, viDuTinh } from "./vi-du-tinh";

const form = (p: Partial<FormChinhSach> = {}): FormChinhSach => ({
  ...formRong(),
  loaiGd: ["NEW"],
  vai: ["SALE", "SALE_ADMIN"],
  o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "3" }, "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "1,5" } },
  ...p,
});

describe("[NHH-FE-VD-01] viDuTinh", () => {
  it("3% của 10.000.000 = 300.000; 1,5% = 150.000; tổng 450.000", () => {
    const r = viDuTinh(form(), 10_000_000, 0.09);
    expect(r).toHaveLength(1);
    expect(r[0]!.vai.map((v) => [v.code, v.tien])).toEqual([["SALE", 300_000], ["SALE_ADMIN", 150_000]]);
    expect(r[0]!.tongTien).toBe(450_000);
    expect(r[0]!.tongPhanTram).toBe("4,5");
    expect(r[0]!.vuotTran).toBe(false);
  });

  it("làm tròn kiểu engine (nửa lên, MỘT lần mỗi vai): 1.234.550 × 4% = 49.382, × 1% = 12.346 (12.345,5 lên)", () => {
    const r = viDuTinh(form({ o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" }, "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "1" } } }), 1_234_550, 0.09);
    expect(r[0]!.vai.map((v) => v.tien)).toEqual([49_382, 12_346]);
  });

  it("EXCLUDE ⇒ 0đ và đánh dấu 'loại trừ'; ô trống hoặc gõ dở ⇒ bỏ (không đoán)", () => {
    const r = viDuTinh(
      form({ vai: ["SALE", "SALE_ADMIN", "MARKETING"], o: { "NEW|SALE": { kieu: "EXCLUDE", phanTram: "" }, "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "abc" }, "NEW|MARKETING": { kieu: "PERCENT", phanTram: "" } } }),
      10_000_000,
      0.09,
    );
    expect(r[0]!.vai).toEqual([{ code: "SALE", tien: 0, loaiTru: true }]);
  });

  it("vượt trần tính trên TỈ LỆ: 9% đúng bằng trần ⇒ không vượt; 9,0001% ⇒ vượt (dù tiền làm tròn bằng nhau)", () => {
    const chin = form({ vai: ["SALE", "SALE_ADMIN"], o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" }, "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "5" } } });
    expect(viDuTinh(chin, 100, 0.09)[0]!.vuotTran).toBe(false);
    const hon = form({ o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" }, "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "5,0001" } } });
    const r = viDuTinh(hon, 100, 0.09)[0]!;
    expect(r.vuotTran).toBe(true);
    expect(r.tongPhanTram).toBe("9,0001");
  });

  it("chỉ loại giao dịch và vai ĐANG chọn; chưa biết trần (null) ⇒ không kết luận vượt/không", () => {
    const r = viDuTinh(form({ loaiGd: ["RENEWAL"], o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "3" } } }), 10_000_000, null);
    expect(r).toEqual([]);
    expect(viDuTinh(form(), 10_000_000, null)[0]!.vuotTran).toBeNull();
  });

  it("cơ sở tính không hợp lệ (0, âm, lẻ) ⇒ ném (không tính ra số tiền lạ)", () => {
    for (const x of [0, -5, 1.5]) expect(() => viDuTinh(form(), x, 0.09), String(x)).toThrow();
  });
});

describe("[NHH-FE-VD-02] tongTheoLoai — tổng tỉ lệ ngay khi gõ (chưa cần lưu)", () => {
  it("cộng PERCENT của vai × loại đang chọn; ô gõ dở không tính", () => {
    const r = tongTheoLoai(form({ o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "4" }, "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "x" } } }), 0.09);
    expect(r).toEqual([{ loai: "NEW", tongPhanTram: "4", vuotTran: false }]);
  });

  it("vượt trần được cờ; trần null ⇒ vuotTran null", () => {
    const f = form({ o: { "NEW|SALE": { kieu: "PERCENT", phanTram: "6" }, "NEW|SALE_ADMIN": { kieu: "PERCENT", phanTram: "4" } } });
    expect(tongTheoLoai(f, 0.09)[0]).toMatchObject({ tongPhanTram: "10", vuotTran: true });
    expect(tongTheoLoai(f, null)[0]).toMatchObject({ vuotTran: null });
  });
});
