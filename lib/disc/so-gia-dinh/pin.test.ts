import { describe, expect, it } from "vitest";

import { PHUT_KHOA_PIN, SO_LAN_SAI_TOI_DA, bamPin, dangKhoaPin, kiemPin, sauLanSai } from "./pin";
import { checkinSchema, nopBaiSchema, pinSchema, taoKeHoachSchema, thanhVienSchema, xoaThanhVienSchema } from "./validators";

describe("PIN chế độ trẻ em", () => {
  it("[SG-PIN-01] băm có muối: hai lần băm cùng PIN khác nhau, nhưng đều kiểm đúng; không chứa PIN trong chuỗi lưu", () => {
    const a = bamPin("4821");
    const b = bamPin("4821");
    expect(a).not.toBe(b);
    expect(a).not.toContain("4821");
    expect(kiemPin("4821", a)).toBe(true);
    expect(kiemPin("4821", b)).toBe(true);
    expect(kiemPin("4822", a)).toBe(false);
    expect(kiemPin("", a)).toBe(false);
  });

  it("[SG-PIN-02] chuỗi lưu hỏng ⇒ false, không ném", () => {
    for (const x of ["", "abc", "a.b.c", ".", "!!!.???"]) expect(kiemPin("1234", x)).toBe(false);
  });

  it("[SG-PIN-03] sai 5 lần ⇒ khoá 15 phút; hết hạn ⇒ mở; chưa chạm ngưỡng thì chỉ tăng bộ đếm", () => {
    const t0 = new Date("2026-11-02T03:00:00.000Z");
    let t = { pinSai: 0, khoaDen: null as Date | null };
    for (let i = 1; i < SO_LAN_SAI_TOI_DA; i++) {
      t = sauLanSai(t, t0);
      expect(t).toEqual({ pinSai: i, khoaDen: null });
      expect(dangKhoaPin(t, t0)).toBe(false);
    }
    t = sauLanSai(t, t0);
    expect(t.pinSai).toBe(0);
    expect(t.khoaDen?.getTime()).toBe(t0.getTime() + PHUT_KHOA_PIN * 60_000);
    expect(dangKhoaPin(t, t0)).toBe(true);
    expect(dangKhoaPin(t, new Date(t0.getTime() + PHUT_KHOA_PIN * 60_000))).toBe(false);
  });
});

describe("zod đầu vào", () => {
  it("[SG-ZOD-01] PIN đúng 4 chữ số", () => {
    expect(pinSchema.safeParse({ pin: "0123" }).success).toBe(true);
    for (const pin of ["123", "12345", "12a4", "", " 123"]) expect(pinSchema.safeParse({ pin }).success, pin).toBe(false);
  });

  it("[SG-ZOD-02] thành viên: tên bắt buộc + cắt khoảng trắng + tối đa 30; vai/lớp ngoài danh sách bị từ chối; năm sinh phi lý bị từ chối", () => {
    const ok = thanhVienSchema.safeParse({ ten: "  Bin ", vaiTro: "con", lop: "5", namSinh: 2016 });
    expect(ok.success && ok.data.ten).toBe("Bin");
    for (const x of [
      { ten: "", vaiTro: "con" },
      { ten: "x".repeat(31), vaiTro: "con" },
      { ten: "A", vaiTro: "hacker" },
      { ten: "A", vaiTro: "con", lop: "13" },
      { ten: "A", vaiTro: "con", namSinh: 1800 },
      { ten: "A", vaiTro: "con", namSinh: 2016.5 },
    ]) expect(thanhVienSchema.safeParse(x).success, JSON.stringify(x)).toBe(false);
  });

  it("[SG-ZOD-03] xoá thành viên: chế độ xử lý bài BẮT BUỘC, không mặc định", () => {
    expect(xoaThanhVienSchema.safeParse({ id: "a" }).success).toBe(false);
    expect(xoaThanhVienSchema.safeParse({ id: "a", cheDo: "xoa-het" }).success).toBe(false);
    expect(xoaThanhVienSchema.safeParse({ id: "a", cheDo: "giu-bai" }).success).toBe(true);
    expect(xoaThanhVienSchema.safeParse({ id: "a", cheDo: "xoa-bai" }).success).toBe(true);
  });

  it("[SG-ZOD-04] nộp bài: câu trả lời là số nguyên 1–7, khoá là chỉ số; ngày kế hoạch đúng dạng", () => {
    const co = { thanhVienId: "t", cachLam: "TU_LAM", ve: "x".repeat(40) };
    expect(nopBaiSchema.safeParse({ ...co, traLoi: { "0": 3, "12": 5 } }).success).toBe(true);
    for (const traLoi of [{ "0": 2.5 }, { "0": 0 }, { "0": 8 }, { a: 3 }, { "-1": 3 }, { "0": "3" }]) {
      expect(nopBaiSchema.safeParse({ ...co, traLoi }).success, JSON.stringify(traLoi)).toBe(false);
    }
    expect(taoKeHoachSchema.safeParse({ ky: "NGAY_7", batDau: "2026-11-03" }).success).toBe(true);
    expect(taoKeHoachSchema.safeParse({ ky: "NGAY_7", batDau: "03/11/2026" }).success).toBe(false);
    expect(taoKeHoachSchema.safeParse({ ky: "NGAY_30", batDau: "2026-11-03" }).success).toBe(false);
  });

  it("[SG-ZOD-05] check-in: điểm 1–5, mỗi người một điểm, cặp gồm hai id", () => {
    const co = { keHoachId: "k", tuan: 1, diem: [{ thanhVienId: "a", diem: 4 }] };
    expect(checkinSchema.safeParse(co).success).toBe(true);
    expect(checkinSchema.safeParse({ ...co, diem: [{ thanhVienId: "a", diem: 6 }] }).success).toBe(false);
    expect(checkinSchema.safeParse({ ...co, diem: [] }).success).toBe(false);
    expect(checkinSchema.safeParse({ ...co, capDeChiu: ["a"] }).success).toBe(false);
    expect(checkinSchema.safeParse({ ...co, capDeChiu: ["a", "b"] }).success).toBe(true);
  });
});
