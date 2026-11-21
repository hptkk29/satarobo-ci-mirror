// Ca [POS1-TD-*] — BẢNG ÁNH XẠ thông điệp cho sale (`thongDiepPos`). THUẦN.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §4.6. Câu chữ là LỜI HỨA với người đứng quầy (luật 12): câu
// sai nghĩa là sale mời khách quẹt thẻ lần hai cho một khoản ĐÃ thu — nên các ca dưới so NGUYÊN
// VĂN, không chỉ "có chứa". Giờ in theo giờ Việt Nam (+07:00), tiền theo `vi-VN`.
//
// Ba câu mang LỆNH CẤM là ba câu đắt nhất — mỗi câu có ca riêng:
//   · LECH_TIEN     "Đừng quẹt bù phần chênh"           (T14)
//   · CHUA_THAY     "ĐỪNG cho quẹt lại" khi dữ liệu chưa có giao dịch nào sau lúc tạo phiếu (T14)
//   · CHUA_XAC_DINH "ĐỪNG cho khách quẹt lại"           (pha tiền ném — §4.2)
import { describe, it, expect } from "vitest";
import { nhomLoiThe, thongDiepHienThi, thongDiepPos, thongDiepTrangThai } from "./thong-diep-pos";

/** 10:31:35Z = 17:31:35 giờ VN. */
const LUC = new Date("2026-10-06T10:31:35Z");
const TAO = new Date("2026-10-06T09:00:00Z"); // 16:00 VN

describe("[POS1-TD] thông điệp phiếu thu thẻ", () => {
  it("[POS1-TD-01] DA_THU lần đầu ⇒ số tiền + giờ quẹt (giờ VN) + 'chờ kế toán xác nhận'", () => {
    expect(thongDiepPos({ loai: "DA_THU", soTien: 6_732_000, luc: LUC, daGhiTruoc: false, giaoDichKhac: 0 })).toEqual({
      cau: "Đã thu 6.732.000đ lúc 17:31 — đã ghi nhận, chờ kế toán xác nhận.",
      mucDo: "thanh_cong",
    });
  });

  it("[POS1-TD-02] DA_THU đã ghi từ trước (TRUNG / import đã khớp) ⇒ 'Đã ghi nhận lúc …'", () => {
    expect(thongDiepPos({ loai: "DA_THU", soTien: 6_732_000, luc: LUC, daGhiTruoc: true, giaoDichKhac: 0 })).toEqual({
      cau: "Đã ghi nhận lúc 17:31 — chờ kế toán xác nhận.",
      mucDo: "thanh_cong",
    });
  });

  it("[POS1-TD-03] DA_THU mà có thêm giao dịch thành công cùng mã ⇒ cảnh báo thu đôi, mức cảnh báo", () => {
    const r = thongDiepPos({ loai: "DA_THU", soTien: 6_732_000, luc: LUC, daGhiTruoc: false, giaoDichKhac: 1 });
    expect(r.cau).toBe(
      "Đã thu 6.732.000đ lúc 17:31 — đã ghi nhận, chờ kế toán xác nhận. " +
        "Có thêm 1 giao dịch thẻ thành công mang mã này — kế toán sẽ kiểm/hoàn.",
    );
    expect(r.mucDo).toBe("canh_bao");
  });

  it("[POS1-TD-04] LECH_TIEN ⇒ 'Máy đã thu X, phiếu cần Y' + LỆNH 'Đừng quẹt bù phần chênh'", () => {
    expect(thongDiepPos({ loai: "LECH_TIEN", soTienMay: 6_000_000, soTienPhieu: 6_732_000 })).toEqual({
      cau: "Máy đã thu 6.000.000đ, phiếu cần 6.732.000đ — đã chuyển kế toán xử lý. Đừng quẹt bù phần chênh.",
      mucDo: "canh_bao",
    });
    // Không biết số phiếu (dữ liệu cũ) ⇒ vẫn có lệnh cấm, không bịa số.
    const r = thongDiepPos({ loai: "LECH_TIEN", soTienMay: 6_000_000, soTienPhieu: null });
    expect(r.cau).toContain("Đừng quẹt bù phần chênh");
    expect(r.cau).not.toContain("phiếu cần");
  });

  it("[POS1-TD-05] CAN_XU_LY ⇒ số máy thu + lý do + 'đã chuyển kế toán'", () => {
    expect(thongDiepPos({ loai: "CAN_XU_LY", soTienMay: 6_732_000, lyDo: "Ghi chú có 2 mã phiếu: K7M2N, QHKMN" })).toEqual({
      cau: "Máy đã thu 6.732.000đ nhưng không tự ghi nhận được: Ghi chú có 2 mã phiếu: K7M2N, QHKMN — đã chuyển kế toán xử lý.",
      mucDo: "canh_bao",
    });
    expect(thongDiepPos({ loai: "CAN_XU_LY", soTienMay: null, lyDo: "X" }).cau).toBe(
      "Giao dịch thẻ không tự ghi nhận được: X — đã chuyển kế toán xử lý.",
    );
  });

  it("[POS1-TD-06] THAT_BAI theo nhóm lý do — phiếu vẫn mở, câu nói rõ việc tiếp theo", () => {
    expect(thongDiepPos({ loai: "THAT_BAI", maLoi: "USER_CANCELLED", nhom: "KHACH_HUY" })).toEqual({
      cau: "Khách huỷ trên máy — cho quẹt lại.",
      mucDo: "loi",
    });
    expect(thongDiepPos({ loai: "THAT_BAI", maLoi: "51", nhom: "THE_TU_CHOI" }).cau).toBe(
      "Thẻ bị từ chối (mã 51) — đổi thẻ khác.",
    );
    expect(thongDiepPos({ loai: "THAT_BAI", maLoi: null, nhom: "DA_HUY_TREN_MAY" }).cau).toBe(
      "Giao dịch đã bị huỷ toàn bộ trên máy — có thể cho quẹt lại.",
    );
    // File ghi "Thất bại" (mã THAT_BAI) — thất bại RÕ ⇒ mời quẹt lại.
    expect(thongDiepPos({ loai: "THAT_BAI", maLoi: "THAT_BAI", nhom: "THAT_BAI_RO" }).cau).toBe(
      "Giao dịch thất bại (mã THAT_BAI) — cho quẹt lại.",
    );
    // Mã LẠ — đặc tả: "Giao dịch thất bại (mã …)", KHÔNG mời quẹt lại (Q-I: lạ ⇒ fail-closed).
    expect(thongDiepPos({ loai: "THAT_BAI", maLoi: "XYZ_99", nhom: "KHAC" }).cau).toBe("Giao dịch thất bại (mã XYZ_99).");
    expect(thongDiepPos({ loai: "THAT_BAI", maLoi: null, nhom: "KHAC" }).cau).toBe("Giao dịch thất bại.");
    expect(thongDiepPos({ loai: "THAT_BAI", maLoi: "XYZ_99", nhom: "KHAC" }).cau).not.toMatch(/quẹt lại/);
  });

  it("[POS1-TD-07] nhomLoiThe: mã thẻ để sẵn (T19) — không bịa, mã lạ ⇒ KHAC", () => {
    expect(nhomLoiThe("USER_CANCELLED")).toBe("KHACH_HUY");
    expect(nhomLoiThe("cancelled")).toBe("KHACH_HUY");
    for (const ma of ["05", "51", "54", "57", "61", "DECLINED"]) expect(nhomLoiThe(ma), ma).toBe("THE_TU_CHOI");
    expect(nhomLoiThe("THAT_BAI")).toBe("THAT_BAI_RO");
    expect(nhomLoiThe("DANG_XU_LY")).toBe("KHAC");
    expect(nhomLoiThe(null)).toBe("KHAC");
    expect(nhomLoiThe(undefined)).toBe("KHAC");
  });

  it("[POS1-TD-08] CHUA_THAY — dữ liệu ĐÃ có giao dịch sau lúc tạo phiếu ⇒ giờ dữ liệu, KHÔNG lệnh cấm", () => {
    const r = thongDiepPos({
      loai: "CHUA_THAY",
      code5: "K7M2N",
      duLieuLuc: new Date("2026-10-06T09:05:00Z"), // 16:05
      gdMoiNhatLuc: new Date("2026-10-06T09:02:00Z"), // 16:02 > lúc tạo 16:00
      taoLuc: TAO,
      baoAdminTuLuc: new Date(TAO.getTime() + 10 * 60_000),
    });
    expect(r.cau).toBe(
      "Chưa thấy giao dịch mang mã K7M2N. Kiểm tra biên lai đã báo thành công và mã trong ghi chú. " +
        "Dữ liệu Techcombank cập nhật lần cuối 16:05 (giao dịch mới nhất 16:02).",
    );
    expect(r.mucDo).toBe("thong_tin");
  });

  it("[POS1-TD-08b] CHUA_THAY — dữ liệu CHƯA có giao dịch nào sau lúc tạo phiếu ⇒ 'ĐỪNG cho quẹt lại' (T14)", () => {
    const r = thongDiepPos({
      loai: "CHUA_THAY",
      code5: "K7M2N",
      duLieuLuc: new Date("2026-10-06T08:58:00Z"),
      gdMoiNhatLuc: new Date("2026-10-06T08:50:00Z"), // 15:50 < lúc tạo 16:00
      taoLuc: TAO,
      baoAdminTuLuc: new Date(TAO.getTime() + 10 * 60_000),
    });
    expect(r.cau).toContain("giao dịch mới nhất 15:50");
    expect(r.cau).toContain(
      "Dữ liệu chưa có giao dịch nào sau lúc tạo phiếu — KHÔNG có nghĩa khách chưa trả. " +
        "Biên lai máy đã báo THÀNH CÔNG thì ĐỪNG cho quẹt lại.",
    );
    // Chưa từng nhập file nào ⇒ nói thẳng, và vẫn có lệnh cấm.
    const r2 = thongDiepPos({
      loai: "CHUA_THAY",
      code5: "K7M2N",
      duLieuLuc: null,
      gdMoiNhatLuc: null,
      taoLuc: TAO,
      baoAdminTuLuc: new Date(TAO.getTime() + 10 * 60_000),
    });
    expect(r2.cau).toContain("Chưa có dữ liệu Techcombank nào được nhập.");
    expect(r2.cau).toContain("ĐỪNG cho quẹt lại");
  });

  it("[POS1-TD-08c] CHUA_THAY — dữ liệu cập nhật NGÀY KHÁC ngày tạo phiếu ⇒ in kèm ngày", () => {
    const r = thongDiepPos({
      loai: "CHUA_THAY",
      code5: "K7M2N",
      duLieuLuc: new Date("2026-10-05T09:05:00Z"),
      gdMoiNhatLuc: new Date("2026-10-05T09:02:00Z"),
      taoLuc: TAO,
      baoAdminTuLuc: new Date(TAO.getTime() + 10 * 60_000),
    });
    expect(r.cau).toContain("cập nhật lần cuối 16:05 ngày 05/10");
  });

  it("[POS1-TD-09] HUY_SAU_THU ⇒ D7: kế toán xử lý, hệ thống không tự đảo", () => {
    expect(thongDiepPos({ loai: "HUY_SAU_THU", soTien: 6_732_000 })).toEqual({
      cau: "Giao dịch thẻ đã bị huỷ/hoàn sau khi ghi nhận — kế toán đang xử lý (hệ thống không tự đảo).",
      mucDo: "canh_bao",
    });
  });

  it("[POS1-TD-10] LOI_KET_NOI ⇒ mã lỗi + 'đã báo admin'; CHUA_CAP_API có giải nghĩa", () => {
    expect(thongDiepPos({ loai: "LOI_KET_NOI", maLoi: "TCB_FILE_DB" })).toEqual({
      cau: "Lỗi kết nối hệ thống thanh toán (mã TCB_FILE_DB) — đã báo admin.",
      mucDo: "loi",
    });
    expect(thongDiepPos({ loai: "LOI_KET_NOI", maLoi: "CHUA_CAP_API" }).cau).toBe(
      "Lỗi kết nối hệ thống thanh toán (mã CHUA_CAP_API — chưa được cấp API) — đã báo admin.",
    );
  });

  it("[POS1-TD-11] CHUA_XAC_DINH ⇒ LỆNH 'ĐỪNG cho khách quẹt lại' + 'đã báo admin'", () => {
    expect(thongDiepPos({ loai: "CHUA_XAC_DINH" })).toEqual({
      cau: "Chưa xác định được kết quả — ĐỪNG cho khách quẹt lại. Bấm Kiểm tra lại sau ít phút; đã báo admin.",
      mucDo: "loi",
    });
  });

  it("[POS1-TD-12] câu theo TRẠNG THÁI (phiếu đóng nhận kết quả yếu) — DA_THU không bao giờ mời quẹt lại", () => {
    expect(thongDiepTrangThai("DA_THU").cau).not.toMatch(/quẹt lại/);
    expect(thongDiepTrangThai("DA_THU").mucDo).toBe("thanh_cong");
    expect(thongDiepTrangThai("LECH_TIEN").cau).toContain("Đừng quẹt bù");
    expect(thongDiepTrangThai("CAN_XU_LY").cau).toContain("kế toán");
    expect(thongDiepTrangThai("HET_HAN").cau).toContain("hết hạn");
    expect(thongDiepTrangThai("HUY").cau).toContain("huỷ");
    expect(thongDiepTrangThai("CHO_QUET").cau).toContain("Chờ khách quẹt");
  });

  it("[POS1-VA-TD-01] DANG_CHO_NGAN_HANG (dòng 'Đang xử lý') ⇒ LỆNH 'ĐỪNG cho quẹt lại', không gọi là thất bại", () => {
    const r = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: "K7M2N", maTrangThai: "DANG_XU_LY" });
    expect(r.cau).toBe(
      "Có giao dịch mang mã K7M2N nhưng ngân hàng chưa xác nhận (trạng thái DANG_XU_LY) — ĐỪNG cho quẹt lại. " +
        "Bấm Kiểm tra lại sau khi kế toán nhập dữ liệu mới.",
    );
    expect(r.cau).not.toMatch(/thất bại/);
    expect(r.mucDo).toBe("thong_tin");
  });

  it("[POS1-VA-TD-02] câu theo HIỂN THỊ (trạng thái suy ra khác trạng thái lưu) — không lời hứa cũ", () => {
    expect(thongDiepHienThi("KE_TOAN_DA_GO")).toEqual({
      cau: "Kế toán đã gỡ khoản thẻ này khỏi đơn — hỏi kế toán trước khi thu lại.",
      mucDo: "canh_bao",
    });
    expect(thongDiepHienThi("KE_TOAN_DA_GHI")).toEqual({
      cau: "Kế toán đã ghi nhận khoản thẻ này vào đơn (gắn tay).",
      mucDo: "thanh_cong",
    });
    expect(thongDiepHienThi("PHIEU_DA_DONG")).toEqual({
      cau: "Phiếu gộp của mã này đã đóng — không thu thẻ theo mã này nữa. Khách đã quẹt thì bấm Kiểm tra thanh toán.",
      mucDo: "thong_tin",
    });
    expect(thongDiepHienThi("HET_HAN")).toEqual(thongDiepTrangThai("HET_HAN"));
    for (const h of ["KE_TOAN_DA_GO", "KE_TOAN_DA_GHI", "PHIEU_DA_DONG", "HET_HAN"] as const) {
      expect(thongDiepHienThi(h).cau, h).not.toMatch(/cho quẹt lại|đã ghi nhận, chờ/);
    }
  });
});
