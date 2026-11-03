/**
 * EL-16 — VÒNG ĐỜI HẾT HIỆU LỰC của chứng nhận: nhắc T-30/T-7, chốt EXPIRED, và
 * giao lại khoá cho vòng tái chứng nhận.
 *
 * Tệp này THUẦN (không chạm DB) để test được từng nhánh mà không phải dựng dữ liệu.
 * Phần đọc/ghi nằm ở `cron-cert-expiry.ts`.
 */

/** Hai mốc nhắc trước hạn, tính bằng NGÀY. Kế hoạch §13.4 chốt đúng hai mốc này. */
export const MOC_NHAC_HET_HAN = [30, 7] as const;
export type MocNhacHetHan = (typeof MOC_NHAC_HET_HAN)[number];

const NGAY_MS = 24 * 60 * 60 * 1000;

/**
 * Số ngày còn lại tới hạn — làm tròn LÊN.
 *
 * Làm tròn lên chứ không xuống: còn 6,4 ngày thì người ta còn 7 ngày theo lịch, và
 * nói "còn 6" là hối thúc sai. Quan trọng hơn, làm tròn xuống khiến mốc T-7 bị nhảy
 * qua ở những lần chạy rơi vào nửa sau của ngày.
 */
export function soNgayConLai(validUntil: Date, now: Date): number {
  return Math.ceil((validUntil.getTime() - now.getTime()) / NGAY_MS);
}

/**
 * Mốc nhắc cần gửi cho một chứng nhận, hoặc `null`.
 *
 * ⚠️ Trả về mốc NHỎ NHẤT còn khớp, và khớp theo `<=` chứ không `===`.
 *
 * `=== 30` chỉ đúng nếu cron chạy đúng ngày đó và không lỗi lần nào. Một lần chạy hụt
 * — máy chủ bận, deploy, hàng đợi tắc — là mốc T-30 bị nhảy qua VĨNH VIỄN, và không
 * gì báo: sổ nhắc chỉ có dòng "chưa gửi" nằm im. Dùng `<=` thì lần chạy kế tiếp vẫn
 * bắt được.
 *
 * Và vì `<=`, phải chọn mốc nhỏ nhất còn khớp: ở ngày thứ 5 thì cả 30 lẫn 7 đều
 * khớp, mà lời nhắc đúng là "còn 7 ngày", không phải "còn 30".
 */
export function mocCanNhac(
  soNgay: number,
  daNhac: readonly number[],
): MocNhacHetHan | null {
  if (soNgay < 0) return null; // đã hết hạn — việc của nhánh chốt EXPIRED
  for (const m of [...MOC_NHAC_HET_HAN].sort((a, b) => a - b)) {
    if (soNgay <= m && !daNhac.includes(m)) return m;
  }
  return null;
}

export function noiDungNhacHetHan(input: {
  moc: MocNhacHetHan;
  tenKhoa: string;
  validUntil: Date;
}): { title: string; body: string } {
  const ngay = input.validUntil.toLocaleDateString("vi-VN");
  return {
    title:
      input.moc === 30
        ? `Chứng nhận "${input.tenKhoa}" hết hiệu lực sau 30 ngày`
        : `Chứng nhận "${input.tenKhoa}" sắp hết hiệu lực (còn 7 ngày)`,
    // Nói THẲNG việc phải làm. Một lời nhắc chỉ báo ngày mà không nói phải làm gì
    // thì người nhận đọc xong vẫn không biết mình cần học lại.
    body:
      input.moc === 30
        ? `Chứng nhận của bạn hết hiệu lực ngày ${ngay}. Hệ thống sẽ tự giao lại khoá để bạn học lại — bạn không cần đăng ký.`
        : `Chứng nhận của bạn hết hiệu lực ngày ${ngay}. Sau ngày đó, hồ sơ tuân thủ của bạn tính là CHƯA đạt cho tới khi học lại xong.`,
  };
}

/**
 * Chứng nhận này có cần giao lại khoá cho vòng mới không.
 *
 * ⚠️ Chỉ giao lại khi có CHU KỲ. Chứng nhận vô thời hạn thì không có gì để tái —
 * giao lại là bắt người ta học lại một thứ không ai yêu cầu học lại.
 *
 * ⚠️ Và chỉ khi chưa có lượt ghi danh nào ở vòng sau. Không kiểm thì mỗi nhịp cron
 * sinh thêm một lượt: người học mở khu ra thấy mười hai lượt cùng một khoá.
 */
export function canGiaoLai(input: {
  validUntil: Date | null;
  now: Date;
  daCoLuotVongSau: boolean;
  chungNhanBiThuHoi: boolean;
}): boolean {
  if (input.chungNhanBiThuHoi) return false;
  if (input.validUntil == null) return false;
  if (input.daCoLuotVongSau) return false;
  return input.validUntil.getTime() <= input.now.getTime();
}
