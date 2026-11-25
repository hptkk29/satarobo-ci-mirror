import { describe, expect, it } from "vitest";
import { chonRobot, timDiemCuaBe, NOI_DUNG, TEN_ROBOT, type LichSuNguoiTho } from "./hv-tinh-cach-thuan";

describe("robot tính cách", () => {
  it("[HVT-10] kiểu chính/phụ là hai điểm cao nhất", () => {
    const r = chonRobot({ D: 34, I: 78, S: 64, C: 30 });
    expect(r?.chinh).toBe("I");
    expect(r?.phu).toBe("S");
    expect(r?.thanh).toEqual({ D: 34, I: 78, S: 64, C: 30 });
  });
  it("[HVT-11] bằng điểm giữ thứ tự D, I, S, C (tất định)", () => {
    expect(chonRobot({ D: 50, I: 50, S: 10, C: 10 })).toMatchObject({ chinh: "D", phu: "I" });
    expect(chonRobot({ D: 10, I: 10, S: 60, C: 60 })).toMatchObject({ chinh: "S", phu: "C" });
  });
  it("[HVT-12] cả bốn bằng nhau hoặc toàn 0 ⇒ KHÔNG gán nhãn cho em nhỏ", () => {
    expect(chonRobot({ D: 25, I: 25, S: 25, C: 25 })).toBeNull();
    expect(chonRobot({ D: 0, I: 0, S: 0, C: 0 })).toBeNull();
  });
  it("[HVT-13] điểm ngoài khoảng hoặc NaN bị kẹp, không làm hỏng thanh", () => {
    const r = chonRobot({ D: 150, I: -5, S: Number.NaN, C: 20 });
    expect(r?.thanh).toEqual({ D: 100, I: 0, S: 0, C: 20 });
    expect(r?.chinh).toBe("D");
  });
  it("[HVT-14] mỗi kiểu đều có tên robot và đủ ba thẻ lời", () => {
    for (const k of ["D", "I", "S", "C"] as const) {
      expect(TEN_ROBOT[k]).toMatch(/^Robot /);
      expect(NOI_DUNG[k].manh).toHaveLength(3);
      expect(NOI_DUNG[k].tot).toHaveLength(3);
      expect(NOI_DUNG[k].meo).toHaveLength(3);
    }
  });
});

describe("khớp kết quả DISC với đúng em", () => {
  const d = (v: number) => ({ D: v, I: 1, S: 1, C: 1 });
  const ls: LichSuNguoiTho[] = [
    { vaiTro: "PHU_HUYNH", hoTen: "Nguyễn Văn Ba", moc: [{ diem: d(90) }] },
    { vaiTro: "HOC_SINH", hoTen: "Nguyễn Bảo An", moc: [{ diem: d(10) }, { diem: d(20) }] },
    { vaiTro: "HOC_SINH", hoTen: "Nguyễn Minh Khôi", moc: [{ diem: d(30) }] },
  ];
  it("[HVT-15] khớp theo vai học sinh + tên chuẩn hoá, lấy lần làm MỚI NHẤT", () => {
    expect(timDiemCuaBe(ls, "  nguyễn  bảo AN ")?.D).toBe(20);
    expect(timDiemCuaBe(ls, "Nguyễn Minh Khôi")?.D).toBe(30);
  });
  it("[HVT-16] không khớp ai ⇒ null; tên trùng người LỚN không được lấy điểm của phụ huynh", () => {
    expect(timDiemCuaBe(ls, "Trần Gia Hân")).toBeNull();
    expect(timDiemCuaBe(ls, "Nguyễn Văn Ba")).toBeNull();
  });
  it("[HVT-17] hai học sinh trùng tên (mơ hồ) ⇒ null, không đoán", () => {
    const trung: LichSuNguoiTho[] = [
      { vaiTro: "HOC_SINH", hoTen: "Lê An", moc: [{ diem: d(1) }] },
      { vaiTro: "HOC_SINH", hoTen: "lê  an", moc: [{ diem: d(2) }] },
    ];
    expect(timDiemCuaBe(trung, "Lê An")).toBeNull();
    expect(timDiemCuaBe([{ vaiTro: "HOC_SINH", hoTen: "Lê An", moc: [] }], "Lê An")).toBeNull();
  });
});
