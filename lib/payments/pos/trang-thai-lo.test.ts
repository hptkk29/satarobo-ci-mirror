// [POS-LO-*] — trạng thái HIỂN THỊ của một lượt import file POS (nợ 4, 30/09/2026). THUẦN.
//
// "Dừng giữa chừng" của lượt DANG_NHAP bị bỏ dở được SUY khi ĐỌC (quá 30 phút không cập nhật),
// không có cron nào ghi. Đồng hồ luôn truyền vào (`now` bắt buộc — luật 19, không đọc giờ thật).
import { describe, expect, it } from "vitest";
import { PHUT_COI_LA_DUNG, trangThaiHienThiLo } from "./trang-thai-lo";

const NOW = new Date("2026-09-30T10:00:00.000Z");
const phutTruoc = (p: number) => new Date(NOW.getTime() - p * 60_000);

describe("[POS-LO] trangThaiHienThiLo", () => {
  it("[POS-LO-01] XONG ⇒ 'Xong', không kèm số lô", () => {
    const t = trangThaiHienThiLo({ trangThai: "XONG", soLoTong: 3, soLoXong: 3, capNhatLuc: phutTruoc(500) }, NOW);
    expect(t).toEqual({ loai: "XONG", nhan: "Xong", chiTiet: null });
  });

  it("[POS-LO-02] DANG_NHAP mới cập nhật ⇒ 'Đang nhập' + x/y lô", () => {
    const t = trangThaiHienThiLo({ trangThai: "DANG_NHAP", soLoTong: 5, soLoXong: 2, capNhatLuc: phutTruoc(1) }, NOW);
    expect(t).toEqual({ loai: "DANG_NHAP", nhan: "Đang nhập", chiTiet: "2/5 lô" });
  });

  it("[POS-LO-03] DANG_NHAP quá 30 phút không cập nhật ⇒ SUY 'Dừng giữa chừng' (không cần ai ghi)", () => {
    const t = trangThaiHienThiLo(
      { trangThai: "DANG_NHAP", soLoTong: 5, soLoXong: 2, capNhatLuc: phutTruoc(PHUT_COI_LA_DUNG + 1) },
      NOW,
    );
    expect(t).toEqual({ loai: "DUNG", nhan: "Dừng giữa chừng", chiTiet: "2/5 lô" });
  });

  it("[POS-LO-03b] đúng mốc 30 phút vẫn là 'Đang nhập' (ngưỡng là QUÁ 30 phút)", () => {
    expect(PHUT_COI_LA_DUNG).toBe(30);
    const t = trangThaiHienThiLo(
      { trangThai: "DANG_NHAP", soLoTong: 2, soLoXong: 1, capNhatLuc: phutTruoc(PHUT_COI_LA_DUNG) },
      NOW,
    );
    expect(t.loai).toBe("DANG_NHAP");
  });

  it("[POS-LO-04] DUNG_GIUA_CHUNG (client báo) ⇒ 'Dừng giữa chừng' NGAY, kể cả vừa cập nhật", () => {
    const t = trangThaiHienThiLo({ trangThai: "DUNG_GIUA_CHUNG", soLoTong: 4, soLoXong: 0, capNhatLuc: NOW }, NOW);
    expect(t).toEqual({ loai: "DUNG", nhan: "Dừng giữa chừng", chiTiet: "0/4 lô" });
  });

  it("[POS-LO-06] đã ghi ĐỦ lô mà lời báo XONG không tới server ⇒ 'Xong', KHÔNG 'Dừng giữa chừng 5/5 lô' (rà vòng 4, luật 12)", () => {
    // Mã TRƯỚC bản vá chỉ xét `trangThai` + im lặng ⇒ DANG_NHAP 5/5 im quá 30 phút in "Dừng giữa
    // chừng · 5/5 lô" vĩnh viễn — nói dối và mời import lại vô ích. Server coi "đủ lô" là XONG
    // (`ketThucNhapPosAction`: `soLoXong >= soLoTong`), màn đọc cùng điều kiện đó.
    const xong = { loai: "XONG", nhan: "Xong", chiTiet: null };
    expect(trangThaiHienThiLo({ trangThai: "DANG_NHAP", soLoTong: 5, soLoXong: 5, capNhatLuc: phutTruoc(90) }, NOW)).toEqual(xong);
    expect(trangThaiHienThiLo({ trangThai: "DUNG_GIUA_CHUNG", soLoTong: 5, soLoXong: 5, capNhatLuc: NOW }, NOW)).toEqual(xong);
    // Đối chứng: thiếu MỘT lô vẫn là dừng giữa chừng.
    expect(trangThaiHienThiLo({ trangThai: "DANG_NHAP", soLoTong: 5, soLoXong: 4, capNhatLuc: phutTruoc(90) }, NOW).loai).toBe("DUNG");
  });

  it("[POS-LO-05] không biết số lô (soLoTong = 0) ⇒ không in 'x/0 lô'", () => {
    const t = trangThaiHienThiLo({ trangThai: "DANG_NHAP", soLoTong: 0, soLoXong: 0, capNhatLuc: phutTruoc(90) }, NOW);
    expect(t).toEqual({ loai: "DUNG", nhan: "Dừng giữa chừng", chiTiet: null });
  });
});
