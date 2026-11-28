import { describe, it, expect } from "vitest";
import { NOI_QUY_MAC_DINH, coDuVaoRa, nhanCa, thongKeNguoi, tyLeDat, type NgayCong } from "./noi-quy";

/** Cặp ĐÃ ĐÓNG đúng hình dạng `pairLogs` sinh ra. */
const capDong = [{ inId: "a", outId: "b", start: 480, end: 1020, open: false }];
/** Vào mà không có ra — `pairLogs` vẫn giữ trong mảng, `open: true`. */
const capHo = [{ inId: "a", outId: null, start: 480, end: 480, open: true }];

function ngay(p: Partial<NgayCong> = {}): NgayCong {
  return {
    dayType: "WORK",
    dayCreditExpected: 1,
    arrivalDeltaMinutes: 0,
    lateApprovedMinutes: 0,
    pairs: capDong,
    flags: [],
    absenceStatus: null,
    templateCode: "S",
    ...p,
  };
}

describe("coDuVaoRa — đếm bằng chứng có mặt, không đếm số phần tử", () => {
  it("cặp đã đóng là đủ", () => {
    expect(coDuVaoRa(capDong)).toBe(true);
  });

  it("vào mà không có ra thì KHÔNG đủ — dù mảng vẫn có phần tử", () => {
    // Đây là chỗ dễ sai nhất: `pairLogs` GIỮ lượt vào lẻ trong mảng (kèm cờ THIEU_LUOT_RA),
    // nên `pairs.length > 0` không hề có nghĩa là đã quét đủ.
    expect(capHo.length).toBe(1);
    expect(coDuVaoRa(capHo)).toBe(false);
  });

  it("dữ liệu lạ / rỗng / null đều là chưa đủ, không ném lỗi", () => {
    for (const x of [null, undefined, [], {}, "xin chào", [{ in: 1, out: 2 }]]) {
      expect(coDuVaoRa(x)).toBe(false);
    }
  });
});

describe("thongKeNguoi — chốt của chủ dự án 06/09", () => {
  it("ca thực tế đếm ngày ĐỦ CẢ vào lẫn ra", () => {
    const t = thongKeNguoi(
      [ngay(), ngay(), ngay({ pairs: capHo, flags: ["THIEU_LUOT_RA"] })],
      NOI_QUY_MAC_DINH,
    );
    expect(t.caQuyDinh).toBe(3);
    expect(t.caThucTe).toBe(2); // ngày quên quét ra KHÔNG được tính
    expect(nhanCa(t)).toBe("2 / 3");
    expect(tyLeDat(t)).toBeCloseTo(2 / 3, 5);
  });

  it("trễ tính từ phút thứ 15 — 15 phút chẵn CHƯA tính", () => {
    const duoi = thongKeNguoi([ngay({ arrivalDeltaMinutes: 15 })], NOI_QUY_MAC_DINH);
    const tren = thongKeNguoi([ngay({ arrivalDeltaMinutes: 16 })], NOI_QUY_MAC_DINH);
    expect(duoi.soLanTre).toBe(0);
    expect(tren.soLanTre).toBe(1);
  });

  it("ngưỡng trễ là THAM SỐ, không phải hằng trong mã", () => {
    const d = [ngay({ arrivalDeltaMinutes: 10 })];
    expect(thongKeNguoi(d, NOI_QUY_MAC_DINH).soLanTre).toBe(0);
    expect(thongKeNguoi(d, { ...NOI_QUY_MAC_DINH, latePenaltyGraceMinutes: 5 }).soLanTre).toBe(1);
  });

  it("nghỉ không phép CHỈ tính khi quản lý đã xác nhận", () => {
    // Ngày vắng chưa ai kết luận: vào cột "chờ kết luận", KHÔNG trừ đồng nào. Đây là điểm
    // chốt quan trọng nhất — cờ KHONG_CO_LUOT còn do quên quét, quầy hỏng, đi công tác.
    const cho = thongKeNguoi([ngay({ pairs: [], flags: ["KHONG_CO_LUOT"] })], NOI_QUY_MAC_DINH);
    expect(cho.ngayChoKetLuan).toBe(1);
    expect(cho.ngayKhongPhep).toBe(0);
    expect(cho.phanTramTru).toBe(0);

    const chot = thongKeNguoi(
      [ngay({ pairs: [], flags: ["KHONG_CO_LUOT"], absenceStatus: "UNAUTHORISED" })],
      NOI_QUY_MAC_DINH,
    );
    expect(chot.ngayKhongPhep).toBe(1);
    expect(chot.phanTramTru).toBe(2);
  });

  it("xác nhận CÓ LÝ DO thì ngày đó ra khỏi mọi phép đếm phạt", () => {
    const t = thongKeNguoi(
      [ngay({ pairs: [], flags: ["KHONG_CO_LUOT"], absenceStatus: "EXCUSED" })],
      NOI_QUY_MAC_DINH,
    );
    expect(t.ngayKhongPhep).toBe(0);
    expect(t.ngayChoKetLuan).toBe(0);
    expect(t.phanTramTru).toBe(0);
    expect(t.caQuyDinh).toBe(1); // vẫn nằm trong mẫu số: hôm đó vẫn là ngày phải đi làm
  });

  it("cộng đúng hai khoản trừ", () => {
    const t = thongKeNguoi(
      [
        ngay({ arrivalDeltaMinutes: 20 }),
        ngay({ arrivalDeltaMinutes: 40 }),
        ngay({ pairs: [], flags: ["KHONG_CO_LUOT"], absenceStatus: "UNAUTHORISED" }),
      ],
      NOI_QUY_MAC_DINH,
    );
    expect(t.soLanTre).toBe(2);
    expect(t.ngayKhongPhep).toBe(1);
    expect(t.phanTramTru).toBe(3); // 2×0,5 + 1×2
  });

  it("ngày nghỉ tuần / lễ không vào mẫu số", () => {
    const t = thongKeNguoi(
      [ngay(), ngay({ dayType: "WEEKLY_OFF", dayCreditExpected: 0, pairs: [] }), ngay({ dayType: "HOLIDAY", dayCreditExpected: 0, pairs: [] })],
      NOI_QUY_MAC_DINH,
    );
    expect(t.caQuyDinh).toBe(1);
    expect(t.caThucTe).toBe(1);
    expect(t.ngayChoKetLuan).toBe(0);
  });

  it("ca KHÔNG ĐÒI QUÉT (LD/NG/D1/D2) không vào mẫu số", () => {
    // Người đi công tác ngoài cả tháng: engine cố ý không gắn cờ thiếu lượt cho mã NG, nên nếu
    // đưa vào mẫu số thì ra "0 / 22 · 0%" mà cột "chờ kết luận" cũng bằng 0 — một con số tệ mà
    // không ai giải thích được và không ai chữa được.
    const congTac = thongKeNguoi(
      [ngay({ templateCode: "NG", pairs: [] }), ngay({ templateCode: "LD", pairs: [] })],
      NOI_QUY_MAC_DINH,
    );
    expect(congTac.caQuyDinh).toBe(0);
    expect(nhanCa(congTac)).toBe("—");
    expect(congTac.ngayChoKetLuan).toBe(0);

    // Ca thường vẫn vào mẫu số như cũ.
    expect(thongKeNguoi([ngay({ templateCode: "CG" })], NOI_QUY_MAC_DINH).caQuyDinh).toBe(1);
  });

  it("vắng nguyên nửa ngày ⇒ KHÔNG tính đủ ca, dù có cặp quét đóng", () => {
    // Ca gãy sáng+chiều, người chỉ quét buổi chiều: có cặp đóng nên `coDuVaoRa` đúng, nhưng để
    // vậy thì bỏ cả buổi sáng vẫn đủ ca — trong khi người làm trọn ngày mà quên quét ra thì mất
    // trọn ca. Lệch đúng ngược chiều chốt của chủ dự án.
    const t = thongKeNguoi([ngay({ flags: ["THIEU_BUOI_SANG"] })], NOI_QUY_MAC_DINH);
    expect(t.caQuyDinh).toBe(1);
    expect(t.caThucTe).toBe(0);
  });

  it("EXCUSED vẫn tính ca nếu ngày đó ĐÃ quét đủ", () => {
    // Quản lý kết luận "có lý do", sau đó đơn chỉnh công được duyệt và sinh mốc giờ. Bỏ qua
    // thẳng thì tỷ lệ của người vừa được minh oan lại giảm.
    const t = thongKeNguoi([ngay({ absenceStatus: "EXCUSED" })], NOI_QUY_MAC_DINH);
    expect(t.caQuyDinh).toBe(1);
    expect(t.caThucTe).toBe(1);
    expect(t.phanTramTru).toBe(0);
  });

  it("người chưa có ca nào: không chia cho 0", () => {
    const t = thongKeNguoi([], NOI_QUY_MAC_DINH);
    expect(nhanCa(t)).toBe("—");
    expect(tyLeDat(t)).toBeNull();
    expect(t.phanTramTru).toBe(0);
  });

  it("trễ vẫn tính dù hôm đó quên quét ra", () => {
    // Mất ca thực tế là một chuyện; đã đến muộn thì vẫn là đến muộn.
    const t = thongKeNguoi(
      [ngay({ pairs: capHo, flags: ["THIEU_LUOT_RA"], arrivalDeltaMinutes: 30 })],
      NOI_QUY_MAC_DINH,
    );
    expect(t.caThucTe).toBe(0);
    expect(t.soLanTre).toBe(1);
  });
});
