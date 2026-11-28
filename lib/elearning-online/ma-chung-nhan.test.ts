// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sinhMaChungNhan, sinhMaChungNhanMoi } from "./chung-nhan";
import { MA_THU, boCucMacDinh, chonCoChu, dongChu } from "./cn-mau";
import { BANG_MA, chuanHoaMaChungNhan, hienThiMaChungNhan } from "./ma-chung-nhan";

const MOI = "SRONK7M2N9P4Q8"; // dạng lưu cấp từ C10
const CU = "K7M2N9P4Q8"; // dạng cấp trước C10

describe("[ONL-MCN] C10 — mã chứng nhận Online: lưu SRON…, hiển thị SR-ON-…, mã cũ giữ nguyên", () => {
  it("[ONL-MCN-01] hiển thị: mã mới đổi sang SR-ON-…; mã cũ và chuỗi không đúng dạng mới giữ NGUYÊN", () => {
    expect(hienThiMaChungNhan(MOI)).toBe("SR-ON-K7M2N9P4Q8");
    for (const giu of [CU, "SRONK7M2N9P4Q", "SRONK7M2N9P4Q8X", "SRONK7M2N9P4Q0", "ABCDE12345", ""]) expect(hienThiMaChungNhan(giu), giu).toBe(giu);
  });

  it("[ONL-MCN-02] tra cứu nhận CẢ dạng lưu lẫn dạng hiển thị (hoa/thường, khoảng trắng hai đầu); mã cũ chỉ in hoa; không tự bỏ gạch ở chỗ khác", () => {
    for (const nhap of [MOI, "SR-ON-K7M2N9P4Q8", "  sr-on-k7m2n9p4q8 ", MOI.toLowerCase()]) expect(chuanHoaMaChungNhan(nhap), nhap).toBe(MOI);
    expect(chuanHoaMaChungNhan(` ${CU.toLowerCase()} `)).toBe(CU);
    expect(chuanHoaMaChungNhan("K7M2-N9P4Q8")).toBe("K7M2-N9P4Q8");
    expect(chuanHoaMaChungNhan(hienThiMaChungNhan(MOI))).toBe(MOI);
  });

  it("[ONL-MCN-03] 🔴 mã cũ KHÔNG THỂ trùng tiền tố mới: bảng mã không có chữ O ⇒ đuôi ngẫu nhiên không bao giờ bắt đầu bằng SRON", () => {
    expect(BANG_MA).not.toContain("O");
    const moiByte = Uint8Array.from({ length: 256 }, (_, i) => i); // mọi giá trị byte ⇒ mọi ký tự có thể sinh
    expect(sinhMaChungNhan(256, () => moiByte)).not.toContain("O");
  });

  it("[ONL-MCN-04] mã cấp MỚI: SRON + 10 ký tự trong bảng mã, ngẫu nhiên (không số thứ tự)", () => {
    const ds = Array.from({ length: 200 }, () => sinhMaChungNhanMoi());
    for (const m of ds) expect(m).toMatch(new RegExp(`^SRON[${BANG_MA}]{10}$`));
    expect(new Set(ds).size).toBe(ds.length);
  });

  it("[ONL-MCN-05] dòng chữ trên giấy in dạng hiển thị; giấy cấp trước C10 in nguyên mã cũ; mã xem thử là dạng DÀI NHẤT và vừa khuôn mặc định", () => {
    const du = { hoTen: "A", tenKhoa: "B", finalScore: null, capLuc: new Date(Date.UTC(2026, 10, 21)) };
    expect(dongChu({ ...du, code: MOI }).ngayMa).toContain("Mã chứng nhận SR-ON-K7M2N9P4Q8");
    expect(dongChu({ ...du, code: MOI }).ngayMa).not.toContain("SRONK");
    expect(dongChu({ ...du, code: CU }).ngayMa).toContain(`Mã chứng nhận ${CU}`);
    expect(hienThiMaChungNhan(MA_THU)).toBe(`SR-ON-${MA_THU.slice(4)}`);
    expect(chonCoChu(dongChu({ ...du, code: MA_THU }).ngayMa, boCucMacDinh().ngayMa)).toMatchObject({ vua: true, heSo: 1 });
  });
});
