// lib/bao-luu/anh-chup.ts — ẢNH CHỤP QUYỀN LỢI tại START (BR-14). THUẦN, không DB. PHIÊN 6.
//
// Lưu CẶP CHƯA CHIA (tử số `snapTuitionNet`, số buổi mua `snapSoBuoiMua`) — chốt 07/10: chia sớm là mất phần lẻ, và `snapUnitPrice` chỉ là giá
// trị SUY RA để hiển thị (làm tròn XUỐNG 1.000đ). Mọi phép TIỀN về sau (yêu cầu hoàn của loại CENTER) tính lại từ CẶP, không từ `snapUnitPrice`.
//
// ⚠️ THIẾU GIÁ ⇒ `snapUnitPrice = null`, KHÔNG BAO GIỜ 0. 0 nghĩa là "miễn phí", và `lib/finance/refund.ts` đọc đơn giá 0 thành hoàn 100%
// học phí đã đóng. Một ảnh chụp không dựng được giá phải NÓI là không dựng được.
//
// ⚠️ THIẾU SỐ BUỔI MUA ⇒ suy "mua đủ khoá" (`Course.totalSessions`) và đặt cờ `snapSoBuoiSuyRa = true` để Kế toán/QLTT thấy con số này là
// SUY RA. Ba đường tạo đơn ngoài form (convert-lead, backfill, ghi giao dịch cũ) KHÔNG bao giờ ghi `soBuoi`, nên suy là mặc định thực tế
// — không phải trường hợp hiếm.

export type DauVaoAnhChup = {
  /** Học phí THỰC ĐÓNG của ghi danh (đã trừ giảm giá / học bổng). `null` = chưa chốt. */
  hocPhiThuc: number | null;
  /** `OrderItem.metadata.soBuoi` — số buổi khách MUA. `null`/0 = không khai. */
  soBuoiMua: number | null;
  /** `Course.totalSessions` — dùng khi không khai số buổi mua. */
  tongBuoiKhoa: number | null;
  /**
   * Số buổi học viên ĐÃ DÙNG: có mặt / đi muộn / đã học bù. Vắng (có phép lẫn không phép) và buổi bù CHƯA học KHÔNG tính là đã dùng
   * (BR-14: "cộng cả vắng có phép/không phép và buổi bù chưa học" vào số còn lại).
   */
  soBuoiDaDung: number;
};

export type AnhChupQuyenLoi = {
  snapTuitionNet: number | null;
  snapSoBuoiMua: number | null;
  snapSoBuoiSuyRa: boolean;
  snapSessionsRemaining: number | null;
  snapUnitPrice: number | null;
};

/** Làm tròn XUỐNG bội của 1.000đ. */
export const lamTronXuong1000 = (n: number): number => Math.floor(n / 1000) * 1000;

export function tinhAnhChup(v: DauVaoAnhChup): AnhChupQuyenLoi {
  const khaiSoBuoi = v.soBuoiMua !== null && Number.isInteger(v.soBuoiMua) && v.soBuoiMua > 0;
  const soBuoiMua = khaiSoBuoi ? v.soBuoiMua : v.tongBuoiKhoa !== null && v.tongBuoiKhoa > 0 ? v.tongBuoiKhoa : null;
  const suyRa = !khaiSoBuoi && soBuoiMua !== null;

  const conLai = soBuoiMua === null ? null : Math.max(0, soBuoiMua - Math.max(0, v.soBuoiDaDung));
  const donGia =
    v.hocPhiThuc !== null && v.hocPhiThuc > 0 && soBuoiMua !== null
      ? lamTronXuong1000(v.hocPhiThuc / soBuoiMua)
      : null;

  return {
    snapTuitionNet: v.hocPhiThuc !== null && v.hocPhiThuc >= 0 ? v.hocPhiThuc : null,
    snapSoBuoiMua: soBuoiMua,
    snapSoBuoiSuyRa: suyRa,
    snapSessionsRemaining: conLai,
    // Chia xuống dưới 1.000đ ra 0 (học phí quá nhỏ) cũng là "không dựng được giá" chứ không phải miễn phí.
    snapUnitPrice: donGia !== null && donGia > 0 ? donGia : null,
  };
}

/**
 * Số tiền Trung tâm phải hoàn khi hồ sơ loại CENTER chọn "sinh yêu cầu hoàn" (BR-23): `snapSessionsRemaining × đơn giá THỰC`, tính từ CẶP CHƯA CHIA —
 * (học phí thực × buổi còn lại) / buổi mua, làm tròn ĐẾN ĐỒNG chỉ ở kết quả CUỐI. Làm tròn đơn giá trước rồi nhân (cách `snapUnitPrice` làm) mất tới
 * `buổi còn lại × 999` đồng — với 28 buổi là 27.972đ — nên KHÔNG dùng `snapUnitPrice × còn lại` cho tiền.
 * Thiếu một trong ba số ⇒ `null` (không đoán, không 0).
 * TODO(bao-luu K13): quy tắc làm tròn tiền hoàn — mặc định đến đồng, chờ Kế toán chốt.
 */
export function tienHoanTuCap(a: Pick<AnhChupQuyenLoi, "snapTuitionNet" | "snapSoBuoiMua" | "snapSessionsRemaining">): number | null {
  if (a.snapTuitionNet === null || a.snapSoBuoiMua === null || a.snapSessionsRemaining === null || a.snapSoBuoiMua <= 0) return null;
  return Math.round((a.snapTuitionNet * a.snapSessionsRemaining) / a.snapSoBuoiMua);
}
