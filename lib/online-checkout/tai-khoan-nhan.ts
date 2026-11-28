import { docSnapshot } from "./cau-hinh-thanh-toan";

/**
 * V8.33 — TIỀN CHỈ TÍNH CHO ĐƠN ONLINE KHI VỀ ĐÚNG TÀI KHOẢN NHẬN ĐÃ CHỤP VÀO ĐƠN (tài khoản + pháp nhân SataRobo do Owner duyệt) — THUẦN, không DB.
 *
 * Vì sao: webhook (SePay/PayOS) được xác thực bằng khoá API nhưng route CHỈ khớp theo nội dung chuyển khoản (`SR{mã}`); số tài khoản nhận chỉ được GHI chứ không được so. Một cổng thanh toán nối nhiều tài khoản
 * (cơ sở Offline, pháp nhân khác) sẽ báo cả tiền về tài khoản KHÁC mà nội dung mang mã đơn Online ⇒ đơn được tính là đã thu và cấp quyền học dù tiền KHÔNG vào pháp nhân SataRobo Online.
 *
 * Luật: đơn KHÔNG có bản chụp thu tiền (đơn Offline / đơn Online tạo trước khi có cấu hình) ⇒ KHÔNG kiểm (giữ nguyên hành vi). Có bản chụp ⇒ webhook PHẢI mang số tài khoản (hoặc VA) trùng bản chụp
 * (so chữ số, bỏ khoảng trắng/dấu); thiếu số ⇒ GIỮ LẠI (fail-closed); lệch ⇒ GIỮ LẠI. «Giữ lại» = giao dịch nằm ở hàng chờ đối soát tay (UNMATCHED + lý do), KHÔNG mất tiền, KHÔNG cấp quyền.
 * Đối soát TAY của kế toán KHÔNG đi qua hàm này (người có thẩm quyền chủ động gắn).
 */
export type KetQuaTaiKhoanNhan = { ok: true } | { ok: false; ma: "THIEU_TAI_KHOAN" | "SAI_TAI_KHOAN"; lyDo: string };

const chuSo = (v: string | null | undefined): string => (v ?? "").replace(/[^0-9]/g, "");
const che = (s: string): string => (s.length <= 4 ? "****" : `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`);

export function kiemTaiKhoanNhanDonOnline(snapshotThuTien: unknown, taiKhoanWebhook: string | null | undefined, vaWebhook?: string | null): KetQuaTaiKhoanNhan {
  if (snapshotThuTien === null || snapshotThuTien === undefined) return { ok: true };
  const sn = docSnapshot(snapshotThuTien);
  if (!sn) return { ok: false, ma: "SAI_TAI_KHOAN", lyDo: "Bản chụp thu tiền của đơn Online không đọc được — giữ lại để đối soát tay." };
  const mong = chuSo(sn.soTaiKhoan);
  const co = [chuSo(taiKhoanWebhook), chuSo(vaWebhook)].filter((x) => x.length > 0);
  if (co.length === 0) return { ok: false, ma: "THIEU_TAI_KHOAN", lyDo: `Giao dịch không mang số tài khoản nhận; đơn Online yêu cầu tài khoản ${che(mong)} — giữ lại để đối soát tay.` };
  if (co.includes(mong)) return { ok: true };
  return { ok: false, ma: "SAI_TAI_KHOAN", lyDo: `Tiền về tài khoản ${che(co[0]!)} KHÁC tài khoản nhận Online đã chụp vào đơn (${che(mong)}) — giữ lại để đối soát tay, KHÔNG tự tính là đã thu.` };
}
