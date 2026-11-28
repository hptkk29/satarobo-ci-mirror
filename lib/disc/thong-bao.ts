/**
 * Thông báo sau khi LƯU DISC — thuần, một nguồn (P0.4 của Master Prompt).
 *
 * Hai luật cứng:
 *  1. Câu chính là MỘT câu TRUNG TÍNH cho mọi SĐT — không nói SĐT đã có tài khoản hay chưa
 *     (màn này không đăng nhập, không OTP ⇒ phân nhánh là oracle dò SĐT).
 *  2. Email: KHÔNG có email ⇒ không có dòng nào về email; chỉ nói "đã gửi" khi trạng thái là SENT
 *     (có bằng chứng), QUEUED chỉ được nói "sẽ gửi", chưa xác minh thì đòi xác minh.
 */

export type TrangThaiEmail = "NONE" | "VERIFICATION_REQUIRED" | "QUEUED" | "SENT" | "FAILED";

/**
 * 0905123456 / 84905123456 ⇒ "0905 *** 456" (7/10 chữ số lộ).
 * ⚠️ CHỈ dùng khi SĐT đã được XÁC MINH (người xem đã qua OTP). Trước khi xác minh dùng
 * `chePhoneChuaXacMinh` (F-18). Không đủ 9 chữ số thì che gần hết.
 */
export function chePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const quocGia = d.startsWith("84") ? "0" + d.slice(2) : d;
  if (quocGia.length < 9) return "***";
  return `${quocGia.slice(0, 4)} *** ${quocGia.slice(-3)}`;
}

/**
 * Che SĐT khi CHƯA xác minh (F-18): chỉ 3 chữ số cuối ⇒ "*** *** 456". Lộ 3/10 chữ số — đủ để người
 * vừa gõ số nhận ra mình, không đủ để thu hẹp số của người khác. Đầu vào hỏng ⇒ "***".
 */
export function chePhoneChuaXacMinh(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const quocGia = d.startsWith("84") ? "0" + d.slice(2) : d;
  if (quocGia.length < 9) return "***";
  return `*** *** ${quocGia.slice(-3)}`;
}

/** an.nguyen@gmail.com ⇒ "a***@gmail.com". */
export function cheEmail(raw: string): string {
  const [u, h] = raw.trim().split("@");
  if (!u || !h) return "***";
  return `${u[0]}***@${h}`;
}

export const THONG_BAO_LUU_CHINH =
  "Kết quả DISC của bạn đã được lưu an toàn với số điện thoại vừa cung cấp. " +
  "Để xem lại kết quả và lịch sử các lần kiểm tra, vui lòng truy cập https://satarobo.vn/kich-hoat " +
  "để xác minh số điện thoại và kích hoạt tài khoản, hoặc đăng nhập bằng tài khoản đã có.";

export type ThongBaoSauLuu = { chinh: string; email: string | null };

/**
 * Kết quả THẬT của việc xếp thư xác minh email (xem `guiLinkXacMinh`, email.ts):
 *  - `DA_XEP_HANG`: thư đã nằm trong hàng đợi (hoặc đã được xếp trước đó và còn hạn) ⇒ được nói "sẽ gửi liên kết";
 *  - `CHUA_GUI_DUOC`: vượt hạn mức · hàng đợi lỗi · thiếu gốc URL ứng dụng ⇒ nói thẳng là CHƯA gửi.
 * Không truyền (undefined) ⇒ giữ câu cũ cho trạng thái VERIFICATION_REQUIRED; đường lưu thật LUÔN truyền.
 * Không nhánh nào trong đây được khẳng định "đã gửi báo cáo": báo cáo chỉ đi sau khi email được xác minh.
 */
export type KetQuaLinkXacMinh = "DA_XEP_HANG" | "CHUA_GUI_DUOC";

export function thongBaoSauLuu(input: { email?: string | null; trangThaiEmail: TrangThaiEmail; linkXacMinh?: KetQuaLinkXacMinh }): ThongBaoSauLuu {
  const { email, trangThaiEmail: tt } = input;
  if (tt === "NONE" || !email) return { chinh: THONG_BAO_LUU_CHINH, email: null };
  const che = cheEmail(email);
  if (tt === "VERIFICATION_REQUIRED" && input.linkXacMinh === "CHUA_GUI_DUOC") {
    return { chinh: THONG_BAO_LUU_CHINH, email: `Chúng tôi chưa gửi được liên kết xác minh tới ${che}. Bạn vẫn tải được kết quả tại đây; chưa xác minh email thì chúng tôi chưa gửi báo cáo qua email.` };
  }
  const dong: Record<Exclude<TrangThaiEmail, "NONE">, string> = {
    SENT: `Chúng tôi cũng đã gửi thông tin kết quả của lần kiểm tra này đến ${che}. Bạn vui lòng kiểm tra hộp thư (bao gồm Thư rác/Spam).`,
    QUEUED: `Chúng tôi sẽ gửi thông tin kết quả đến ${che}. Bạn vui lòng kiểm tra hộp thư sau ít phút.`,
    VERIFICATION_REQUIRED: `Vui lòng xác minh địa chỉ email ${che} để nhận báo cáo; chúng tôi sẽ gửi liên kết xác minh tới hộp thư này. Chưa xác minh thì chúng tôi chưa gửi báo cáo.`,
    FAILED: `Chúng tôi chưa gửi được email tới ${che}. Bạn vẫn có thể tải kết quả tại đây.`,
  };
  return { chinh: THONG_BAO_LUU_CHINH, email: dong[tt] };
}
