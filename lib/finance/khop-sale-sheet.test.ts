// lib/finance/khop-sale-sheet.test.ts — MAP TÊN SALE TRONG SHEET SANG TÀI KHOẢN.
//
// Chủ dự án 14/09/2026: "khi nhập vào đơn hàng thiếu quá nhiều thông tin: NGƯỜI TẠO PHẢI
// GÁN CHO SALE, lúc tạo phải lấy đúng ngày trong sheet."
//
// Đo trên file thật 14/09/2026 (136 dòng dùng được): cột "Sales" có ĐÚNG 6 tên —
// Diệu 50 · Liên 31 · Nhật Hạ 28 · Vân 16 · My 7 · Toại 4, và 0 dòng để trống. Nên việc
// gán là 6 lần chọn, không phải 136 — đó là lý do có `gomTenSale`.
//
// ⚠️ KHÔNG BAO GIỜ TỰ CHỌN HỘ, kể cả khi chỉ có một ứng viên. Cùng luật với
// `khopHocVien` ở doi-chieu-hoc-vien.ts: chọn sai ở đây là hoa hồng và thành tích của
// người khác chạy vào tài khoản này, và không ai phát hiện vì đơn vẫn tạo thành công.
// `goiYSale` chỉ XẾP THỨ TỰ ứng viên, không trả "người được chọn".
import { describe, it, expect } from "vitest";
import { goiYSale, gomTenSale, thangCuaSheet } from "./khop-sale-sheet";

const TK = [
  { id: "u1", name: "Nguyễn Thị Diệu", centerId: "cs1" },
  { id: "u2", name: "Trần Nhật Hạ", centerId: "cs1" },
  { id: "u3", name: "Lê Thị Liên", centerId: "cs2" },
  { id: "u4", name: "Phạm Hoàng Diệu Anh", centerId: "cs2" },
];

describe("[KSS-01] gomTenSale — 6 lần chọn, không phải 136", () => {
  it("gộp theo tên, đếm dòng và cộng tiền", () => {
    const r = gomTenSale([
      { sale: "Diệu", hocPhi: 1000 },
      { sale: "Diệu", hocPhi: 2000 },
      { sale: "Liên", hocPhi: 500 },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ ten: "Diệu", soDong: 2, tien: 3000 });
    expect(r[1]).toEqual({ ten: "Liên", soDong: 1, tien: 500 });
  });

  it("khoảng trắng thừa và hoa/thường là CÙNG một người", () => {
    const r = gomTenSale([
      { sale: "Nhật  Hạ", hocPhi: 1 },
      { sale: "nhật hạ ", hocPhi: 1 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.soDong).toBe(2);
  });

  it("dòng KHÔNG có sale gom vào một mục rỗng để màn hình nói ra", () => {
    // Đo được 0 dòng như vậy trong file hiện tại, nhưng file tháng sau thì không hứa —
    // và nuốt lặng mất chính là cách 136 đơn cùng mang tên một người.
    const r = gomTenSale([{ sale: null, hocPhi: 900 }, { sale: "   ", hocPhi: 100 }]);
    expect(r).toHaveLength(1);
    expect(r[0]!.ten).toBe("");
    expect(r[0]!.soDong).toBe(2);
  });
});

describe("[KSS-02] goiYSale — XẾP THỨ TỰ, tuyệt đối không chọn hộ", () => {
  it("tên sheet là TỪ CUỐI của tên tài khoản → đứng đầu danh sách", () => {
    const r = goiYSale("Diệu", TK);
    expect(r[0]!.id).toBe("u1");
    expect(r[0]!.goiY).toBe(true);
  });

  it('"Nhật Hạ" khớp cụm hai từ cuối', () => {
    const r = goiYSale("Nhật Hạ", TK);
    expect(r[0]!.id).toBe("u2");
    expect(r[0]!.goiY).toBe(true);
  });

  it("bỏ dấu vẫn khớp — hai bên gõ khác nhau", () => {
    const r = goiYSale("dieu", TK);
    expect(r[0]!.id).toBe("u1");
  });

  it("KHÔNG khớp GIỮA tên: 'Diệu' không được gợi ý 'Diệu Anh'", () => {
    // Nếu khớp lỏng theo "chứa chuỗi" thì `u4` (Phạm Hoàng Diệu Anh) cũng lên đầu, và
    // người bấm nhanh sẽ gán 50 đơn cho nhầm người. Chỉ khớp TỪ CUỐI.
    const r = goiYSale("Diệu", TK);
    expect(r.find((x) => x.id === "u4")!.goiY).toBe(false);
  });

  it("không ai khớp → vẫn trả ĐỦ danh sách, không gợi ý ai", () => {
    const r = goiYSale("Toại", TK);
    expect(r).toHaveLength(TK.length);
    expect(r.every((x) => !x.goiY)).toBe(true);
  });

  it("trả về id chứ KHÔNG trả 'người được chọn' — chọn là việc của người bấm", () => {
    const r = goiYSale("Diệu", TK);
    // Hai người cùng được gợi ý thì cũng không có ai thắng: hàm không có khái niệm đó.
    expect(Object.keys(r[0]!).sort()).toEqual(["centerId", "goiY", "id", "name"]);
  });
});

describe("[KSS-03] thangCuaSheet — 23/136 dòng KHÔNG có ngày", () => {
  it("đọc tháng từ tên sheet, trả về NGÀY 1 của tháng đó", () => {
    const d = thangCuaSheet("Tháng 82026 CS1")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // tháng 8
    expect(d.getDate()).toBe(1);
  });

  it("tháng một chữ số", () => {
    expect(thangCuaSheet("Tháng 62026")!.getMonth()).toBe(5);
  });

  it("tháng hai chữ số — 4 số CUỐI là năm, phần còn lại là tháng", () => {
    const d = thangCuaSheet("Tháng 122026")!;
    expect(d.getMonth()).toBe(11);
    expect(d.getFullYear()).toBe(2026);
  });

  it("bỏ dấu / viết thường vẫn đọc được", () => {
    expect(thangCuaSheet("thang 92026 CS2")!.getMonth()).toBe(8);
  });

  it("tháng ngoài 1–12 → null, KHÔNG bịa", () => {
    expect(thangCuaSheet("Tháng 132026")).toBeNull();
    expect(thangCuaSheet("Tháng 02026")).toBeNull();
  });

  it("tên sheet không theo khuôn → null", () => {
    expect(thangCuaSheet("Thuê Robot")).toBeNull();
    expect(thangCuaSheet("")).toBeNull();
  });

  it("KHÔNG đọc đồng hồ thật — cùng đầu vào, hai lượt gọi ra cùng một ngày", () => {
    // Luật 19 (docs/luat-doc-so-va-ket-luan.md): hàm rơi về `new Date()` là ca hẹn giờ nổ.
    // Đây là lý do `thangCuaSheet` tồn tại: chỗ gọi cũ để `?? new Date()` thì 23 đơn
    // của 5 tháng dồn hết vào hôm nay.
    expect(thangCuaSheet("Tháng 72026 CS1")!.getTime()).toBe(
      thangCuaSheet("Tháng 72026 CS1")!.getTime(),
    );
  });
});
