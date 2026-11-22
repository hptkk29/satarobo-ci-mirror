import { describe, expect, it } from "vitest";
import {
  cauChao,
  LOI_DAN_MAC_DINH,
  conBuoiToiDemo,
  nhanConNgayEm,
  nhanHanBai,
  nhanNgayHomNay,
  nhanNgayNgan,
  noiDungLoiDan,
  phanTram,
  rutGonLoi,
  thuDayDu,
  viTriHocPhan,
} from "./hv-hom-nay-thuan";

// 05/11/2026 là Thứ Năm. 20:30 UTC ngày 05/11 = 03:30 ngày 06/11 giờ VN.
const NAM_11 = new Date("2026-11-05T03:00:00Z"); // 10:00 giờ VN, Thứ Năm 05/11

describe("Hôm nay — nhãn ngày theo lịch VN", () => {
  it("[HVH-01] nhãn hôm nay và nhãn ngắn của buổi", () => {
    expect(nhanNgayHomNay(NAM_11)).toBe("THỨ NĂM, 05/11");
    expect(nhanNgayNgan("2026-11-07T13:00:00Z")).toBe("T7, 07/11");
    expect(thuDayDu("2026-11-07T13:00:00Z")).toBe("Thứ Bảy");
    expect(nhanNgayNgan("rác")).toBe("");
  });
  it("[HVH-02] 20:30 UTC đã là sáng hôm sau ở VN — không lùi một ngày", () => {
    expect(nhanNgayHomNay(new Date("2026-11-05T20:30:00Z"))).toBe("THỨ SÁU, 06/11");
  });
  it("[HVH-03] chip còn bao nhiêu ngày tính theo ngày LỊCH", () => {
    expect(nhanConNgayEm("2026-11-05T13:00:00Z", NAM_11)).toBe("Hôm nay");
    expect(nhanConNgayEm("2026-11-06T13:00:00Z", NAM_11)).toBe("Ngày mai");
    expect(nhanConNgayEm("2026-11-07T13:00:00Z", NAM_11)).toBe("Còn 2 ngày");
  });
});

describe("Hôm nay — hạn nộp bài", () => {
  it("[HVH-04] hạn hôm nay/ngày mai/còn N ngày/quá hạn và cờ gấp", () => {
    expect(nhanHanBai(null, NAM_11)).toEqual({ nhan: "", gap: false });
    expect(nhanHanBai("2026-11-05T16:59:00Z", NAM_11)).toEqual({ nhan: "Hạn hôm nay", gap: true });
    expect(nhanHanBai("2026-11-06T16:59:00Z", NAM_11)).toEqual({ nhan: "Hạn ngày mai", gap: true });
    expect(nhanHanBai("2026-11-09T16:59:00Z", NAM_11)).toEqual({ nhan: "Còn 4 ngày", gap: false });
    expect(nhanHanBai("2026-11-03T16:59:00Z", NAM_11)).toEqual({ nhan: "Quá hạn 2 ngày", gap: true });
  });
});

describe("Hôm nay — câu chào", () => {
  const tiep = { homNay: false, ngayISO: "2026-11-07T13:00:00Z", so: 8 };
  it("[HVH-05] có buổi + còn bài chưa nộp ⇒ nhắc làm bài; hết bài ⇒ không nhắc", () => {
    expect(cauChao({ tiep, soBaiChuaNop: 1 })).toBe("Thứ Bảy này em học buổi 8. Làm xong bài về nhà là mình sẵn sàng rồi!");
    expect(cauChao({ tiep, soBaiChuaNop: 0 })).toBe("Thứ Bảy này em học buổi 8. Mình cùng học tiếp nhé!");
  });
  it("[HVH-06] hôm nay có buổi, thiếu số buổi, không còn buổi nào", () => {
    expect(cauChao({ tiep: { ...tiep, homNay: true }, soBaiChuaNop: 0 })).toContain("Hôm nay em học buổi 8.");
    expect(cauChao({ tiep: { ...tiep, so: null }, soBaiChuaNop: 0 })).toBe("Thứ Bảy này em học. Mình cùng học tiếp nhé!");
    expect(cauChao({ tiep: null, soBaiChuaNop: 3 })).toBe("Em chưa có buổi học sắp tới. Xem lại hành trình của mình nhé!");
  });
});

describe("Hôm nay — tiến độ học phần", () => {
  it("[HVH-07] đã học 7/48 ⇒ học phần 1, 7 ô sáng", () => {
    const v = viTriHocPhan(7, 48);
    expect(v.hocPhan).toBe(1);
    expect(v.trong).toBe(7);
    expect(v.o).toHaveLength(12);
    expect(v.o.filter(Boolean)).toHaveLength(7);
    expect(v.soHocPhan).toBe(4);
  });
  it("[HVH-08] đúng ranh giới: 12 buổi đã xong ⇒ sang học phần 2 với 0 ô; 30/48 ⇒ học phần 3, 6 ô", () => {
    expect(viTriHocPhan(12, 48)).toMatchObject({ hocPhan: 2, trong: 0 });
    expect(viTriHocPhan(30, 48)).toMatchObject({ hocPhan: 3, trong: 6 });
    expect(viTriHocPhan(48, 48)).toMatchObject({ hocPhan: 4, trong: 12 });
  });
  it("[HVH-09] khoá ngắn (9 buổi) chỉ vẽ 9 ô, không bịa 12", () => {
    const v = viTriHocPhan(4, 9);
    expect(v.o).toHaveLength(9);
    expect(v.soHocPhan).toBe(1);
    expect(viTriHocPhan(0, 0).o).toHaveLength(0);
  });
  it("[HVH-10] phần trăm cả khoá kẹp 0–100", () => {
    expect(phanTram(7, 48)).toBe(15);
    expect(phanTram(0, 0)).toBe(0);
    expect(phanTram(60, 48)).toBe(100);
  });
  it("[HVH-11] còn mấy buổi nữa tới demo: chỉ khi giáo trình CÓ buổi demo phía trước", () => {
    const buoi = [
      { order: 10, title: "A" },
      { order: 11, title: "Demo cuối học phần" },
      { order: 12, title: "Báo cáo" },
    ];
    expect(conBuoiToiDemo(buoi, 7)).toBe(3);
    expect(conBuoiToiDemo(buoi, 10)).toBe(0);
    // demo đã qua / không có demo ⇒ null (không bịa câu)
    expect(conBuoiToiDemo(buoi, 11)).toBeNull();
    expect(conBuoiToiDemo([{ order: 1, title: "A" }], 0)).toBeNull();
  });
});

describe("Hôm nay — rút gọn lời dặn", () => {
  it("[HVH-12] ngắn thì giữ nguyên, dài thì cắt ở khoảng trắng kèm dấu …", () => {
    expect(rutGonLoi("  Em   làm tốt.  ", 50)).toBe("Em làm tốt.");
    const r = rutGonLoi("Em lắp mô hình nhanh và chắc tay rất giỏi nhé các em", 30);
    expect(r.endsWith("…")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(31);
    expect(r).not.toContain("  ");
  });
});

describe("[HNT-LD] lời thầy cô dặn: nhận xét trống ⇒ câu mặc định (không để khung rỗng)", () => {
  it("trống / khoảng trắng / null / undefined ⇒ câu mặc định của chủ dự án", () => {
    expect(LOI_DAN_MAC_DINH).toBe("Nhớ làm bài tập về nhà đấy nhé!");
    for (const v of ["", "   ", "\n\t ", null, undefined]) expect(noiDungLoiDan(v, 280), String(v)).toBe(LOI_DAN_MAC_DINH);
  });
  it("có nhận xét ⇒ giữ nhận xét (đã rút gọn), KHÔNG chèn câu mặc định (đối chứng dương)", () => {
    expect(noiDungLoiDan("  Em   làm tốt.  ", 280)).toBe("Em làm tốt.");
    const dai = noiDungLoiDan("Em lắp mô hình nhanh và chắc tay rất giỏi nhé các em", 30);
    expect(dai.endsWith("…")).toBe(true);
    expect(dai).not.toContain("Nhớ làm bài tập");
  });
});
