// @vitest-environment node
/** [CS-*] Câu NHẬP SỐ — hàm thuần: đọc số, chấm với sai số, khuôn nội dung. Mỗi ca ÂM có đối chứng DƯƠNG. */
import { describe, expect, it } from "vitest";
import { cauSoSchema, chamSo, chuanHoaTraLoiSo, docSo, MAX_CHU_SO } from "./cham-so";

const so = (s: string) => {
  const r = docSo(s);
  return r.ok ? r.so : r.lyDo;
};

describe("[CS-01] docSo — dấu thập phân phẩy/chấm, số âm, số thập phân", () => {
  it("đối chứng dương: cùng một số viết nhiều cách", () => {
    for (const s of ["60", "60,0", "60.00", "+60", " 60 ", "060", "60,", "60."]) expect(so(s), s).toBe(60);
    expect(so("0,5")).toBe(0.5);
    expect(so("0.5")).toBe(0.5);
    expect(so(",5")).toBe(0.5);
    expect(so(".5")).toBe(0.5);
    expect(so("-2,75")).toBe(-2.75);
    expect(so("-0")).toBe(-0);
    expect(so("120000")).toBe(120000);
  });
  it("🔴 rỗng / chỉ dấu / ký tự lạ / khoảng trắng giữa / kèm đơn vị ⇒ KHÔNG đoán", () => {
    expect(so("")).toBe("TRONG");
    expect(so("   ")).toBe("TRONG");
    for (const s of ["-", "+", ",", ".", "-,", "abc", "60cm", "6 0", "1e3", "٦٠", "−60"]) expect(so(s), s).toBe("KY_TU_LA");
  });
  it("🔴 hai dấu cùng loại hoặc lẫn hai loại ⇒ KHÔNG đoán nhóm nghìn hay thập phân", () => {
    for (const s of ["3.000.000", "1,000,000", "1.000,5", "1,000.5", "1..2"]) expect(so(s), s).toBe("NHIEU_DAU_THAP_PHAN");
  });
  it("🔴 quá 15 chữ số có nghĩa ⇒ QUA_DAI; đúng 15 thì đọc được (đối chứng dương)", () => {
    expect(so("1".repeat(MAX_CHU_SO))).toBe(Number("1".repeat(MAX_CHU_SO)));
    expect(so("1".repeat(MAX_CHU_SO + 1))).toBe("QUA_DAI");
    expect(so("0000000000000000001")).toBe(1); // số 0 đứng đầu không tính
  });
});

describe("[CS-02] chamSo — sai số ± và số thực", () => {
  const cau = (answer: number, tolerance: number) => ({ answer, tolerance });
  it("đối chứng dương: đúng chính xác, trong sai số (cả hai phía), đúng biên", () => {
    expect(chamSo(cau(60, 0), "60").ketQua).toBe("DUNG");
    expect(chamSo(cau(60, 1), "59,5").ketQua).toBe("DUNG");
    expect(chamSo(cau(60, 1), "60.9").ketQua).toBe("DUNG");
    expect(chamSo(cau(60, 1), "61").ketQua).toBe("DUNG"); // biên
    expect(chamSo(cau(60, 1), "59").ketQua).toBe("DUNG"); // biên
  });
  it("🔴 ngoài sai số, sai số 0 mà lệch một chút ⇒ SAI (kèm độ lệch)", () => {
    const a = chamSo(cau(60, 1), "61,01");
    expect(a).toMatchObject({ ketQua: "SAI" });
    expect(a.ketQua === "SAI" && a.lech).toBeCloseTo(1.01, 9);
    expect(chamSo(cau(60, 0), "60,01").ketQua).toBe("SAI");
    expect(chamSo(cau(60, 0), "-60").ketQua).toBe("SAI"); // đúng độ lớn, sai dấu
  });
  it("số thực: 0.1+0.2 vẫn là 0.3 khi sai số 0 (không chấm hỏng người học vì dấu phẩy động)", () => {
    expect(chamSo(cau(0.1 + 0.2, 0), "0,3").ketQua).toBe("DUNG");
    expect(chamSo(cau(0.3, 0), "0.30000000000000").ketQua).toBe("DUNG"); // 15 chữ số: còn nằm trong giới hạn đọc
    expect(chamSo(cau(0.3, 0), String(0.1 + 0.2))).toEqual({ ketQua: "KHONG_HOP_LE", lyDo: "QUA_DAI" }); // 17 chữ số: quá dài, không đoán
    // đối chứng ÂM: dung sai thực KHÔNG nuốt một sai lệch có nghĩa
    expect(chamSo(cau(0.3, 0), "0,301").ketQua).toBe("SAI");
  });
  it("số âm và số lớn", () => {
    expect(chamSo(cau(-2.5, 0.1), "-2,6").ketQua).toBe("DUNG");
    expect(chamSo(cau(-2.5, 0.1), "-2,7").ketQua).toBe("SAI");
    expect(chamSo(cau(3_000_000, 0), "3000000").ketQua).toBe("DUNG");
    expect(chamSo(cau(3_000_000, 0), "3000001").ketQua).toBe("SAI");
  });
  it("🔴 đầu vào không đọc được ⇒ KHONG_HOP_LE kèm lý do (không phải SAI, không ném)", () => {
    expect(chamSo(cau(60, 1), "sáu mươi")).toEqual({ ketQua: "KHONG_HOP_LE", lyDo: "KY_TU_LA" });
    expect(chamSo(cau(60, 1), "")).toEqual({ ketQua: "KHONG_HOP_LE", lyDo: "TRONG" });
    expect(chamSo(cau(60, 1), "3.000.000")).toEqual({ ketQua: "KHONG_HOP_LE", lyDo: "NHIEU_DAU_THAP_PHAN" });
  });
});

describe("[CS-03] cauSoSchema — khuôn nội dung", () => {
  const OK = { id: "q1", type: "numeric", question: "Robot đi 20 cm mỗi giây. Sau 3 giây robot đi được bao nhiêu cm?", answer: 60, tolerance: 1, unit: "cm", hint: "Nhân tốc độ với thời gian." };
  it("đối chứng dương", () => {
    expect(cauSoSchema.safeParse(OK).success).toBe(true);
    expect(cauSoSchema.safeParse({ ...OK, unit: undefined, hint: undefined }).success).toBe(true);
    expect(cauSoSchema.safeParse({ ...OK, answer: -2.5, tolerance: 0 }).success).toBe(true);
  });
  it("🔴 đáp án không phải số hữu hạn / sai số âm hoặc vô cực / đơn vị quá dài / khoá lạ / thiếu đề ⇒ từ chối", () => {
    for (const bad of [
      { ...OK, answer: "60" },
      { ...OK, answer: Number.NaN },
      { ...OK, answer: Number.POSITIVE_INFINITY },
      { ...OK, tolerance: -1 },
      { ...OK, tolerance: Number.POSITIVE_INFINITY },
      { ...OK, unit: "x".repeat(21) },
      { ...OK, loaiLa: 1 },
      { ...OK, question: "   " },
    ]) {
      expect(cauSoSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("chuanHoaTraLoiSo giữ chuỗi gốc để màn xem lại hiện đúng điều người học gõ", () => {
    expect(chuanHoaTraLoiSo(" 60,5 ")).toEqual({ so: 60.5, goc: "60,5" });
    expect(chuanHoaTraLoiSo("60cm")).toBeNull();
  });
});
