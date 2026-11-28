/** [TVP-*] Màn nộp bài tập — phần trình bày thuần. Ngày TUYỆT ĐỐI (luật 19). */
import { describe, expect, it } from "vitest";
import { buocTienTrinh, diemTieuChiGon, tomTatKetQua, type LuotRut } from "./task-view-pure";

const NOP = new Date("2026-11-14T03:22:00.000Z"); // 10:22 VN
const HAN = new Date("2026-11-19T03:22:00.000Z");
const CHAM = new Date("2026-11-16T08:00:00.000Z"); // 15:00 VN
const luot = (o: Partial<LuotRut>): LuotRut => ({
  status: "SUBMITTED", submittedAt: NOP, dueGradeAt: HAN, gradedAt: null, nguoiCham: null, score: null, passed: null, ...o,
});

describe("[TVP-01] buocTienTrinh", () => {
  it("chờ chấm: bước 2 là hiện tại và có HẠN chấm; chưa có tên người chấm (chưa phân công — không bịa)", () => {
    const b = buocTienTrinh(luot({}));
    expect(b.map((x) => [x.id, x.xong, x.hienTai])).toEqual([["nop", true, false], ["cho-cham", false, true], ["co-diem", false, false]]);
    expect(b[0]!.chiTiet).toBe("14/11, 10:22");
    expect(b[1]!.chiTiet).toBe("Hạn chấm 19/11/2026");
    expect(b[2]!.chiTiet).toBeNull();
  });
  it("đã chấm: cả ba xong, ghi người chấm + lúc chấm", () => {
    const b = buocTienTrinh(luot({ status: "GRADED", gradedAt: CHAM, nguoiCham: "Ngô Thảo Vy", score: 10, passed: true }));
    expect(b.every((x) => x.xong)).toBe(true);
    expect(b[2]).toMatchObject({ nhan: "Có điểm", chiTiet: "Người chấm: Ngô Thảo Vy · 16/11, 15:00" });
    expect(b[1]!.chiTiet).toBeNull(); // hết hạn chấm khi đã chấm — không in hạn cũ
  });
  it("trả về để sửa: nhãn nói đúng điều đó, không gọi là 'Có điểm'", () => {
    const b = buocTienTrinh(luot({ status: "NEEDS_REVISION", gradedAt: CHAM, nguoiCham: null }));
    expect(b[2]).toMatchObject({ nhan: "Đã chấm — trả về để sửa", xong: true });
    expect(b.map((x) => x.xong)).toEqual([true, true, true]); // bước "chờ chấm" đã qua
    expect(b[2]!.chiTiet).toBe("16/11, 15:00"); // không đọc được tên ⇒ chỉ in lúc, không in 'null'
  });
  it("nháp / trạng thái lạ: không bịa tiến trình", () => {
    const b = buocTienTrinh(luot({ status: "DRAFT", submittedAt: null, dueGradeAt: null }));
    expect(b.map((x) => x.xong)).toEqual([false, false, false]);
    expect(b[0]!.hienTai).toBe(true);
  });
});

describe("[TVP-02] tomTatKetQua", () => {
  it("đạt / chưa đạt kèm điểm", () => {
    expect(tomTatKetQua({ status: "GRADED", score: 10, passed: true }, 12)).toBe("Đạt 10/12");
    expect(tomTatKetQua({ status: "GRADED", score: 4, passed: false }, 12)).toBe("Chưa đạt 4/12");
  });
  it("trả về để sửa hoặc chờ chấm ⇒ KHÔNG có điểm cuối (null)", () => {
    expect(tomTatKetQua({ status: "NEEDS_REVISION", score: null, passed: null }, 12)).toBeNull();
    expect(tomTatKetQua({ status: "NEEDS_REVISION", score: 3, passed: false }, 12)).toBeNull(); // chống lộ điểm lượt chưa thành kết quả
    expect(tomTatKetQua({ status: "SUBMITTED", score: null, passed: null }, 12)).toBeNull();
  });
});

describe("[TVP-03] diemTieuChiGon", () => {
  it("'2/4'; không biết mẫu số thì chỉ điểm", () => {
    expect(diemTieuChiGon(2, 4)).toBe("2/4");
    expect(diemTieuChiGon(2, null)).toBe("2");
  });
});
