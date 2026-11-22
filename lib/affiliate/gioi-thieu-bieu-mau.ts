/**
 * lib/affiliate/gioi-thieu-bieu-mau.ts — GHI NHẬN NGƯỜI GIỚI THIỆU NGAY KHI KHÁCH GỬI BIỂU MẪU trên các trang của chính satarobo.vn mà KHÔNG mang `?aff=&clk=`
 * trong thân (DISC · Tủ sách · Sức khoẻ). Tín hiệu duy nhất là cookie `sr_aff` do `/r/<token>` đặt trên trình duyệt khách + header `Origin` của lượt gửi.
 *
 * ── Chốt của chủ dự án 20/11/2026 (đảo N4 của DISC) ─────────────────────────────────────────────────────────────
 * «Đối với tất cả các trang aff, cứ có thông tin được submit về thì ghi nhận luôn chứ không phải như DISC là phải xác thực OTP mới ghi nhận.»
 * ⇒ Tín hiệu affiliate đi vào QUY NGUỒN lúc TẠO lead (để luật `AFFILIATE_REFERRAL` thắng và referral ra `VALID`), không đợi chủ số xác thực.
 *
 * ── Rủi ro đã biết, chấp nhận có chủ đích ─────────────────────────────────────────────────────────────────────
 *  · Không có `clk` (cookie không mang mã lượt bấm — dùng lại `clk` cho biểu mẫu thứ hai sẽ bị coi là PHÁT LẠI ⇒ xem tay). Độ tin cậy vì thế là TRUNG BÌNH (chỉ Origin).
 *  · Cookie và `Origin` đều GIẢ ĐƯỢC bằng công cụ dòng lệnh: ai có token của một link công khai có thể gửi SĐT của người khác kèm token đó. Lớp chặn còn lại: khách ĐÃ CÓ hồ sơ
 *    ⇒ `REJECTED_DUPLICATE` (người ghi nhận đầu tiên giữ công), tự giới thiệu bị từ chối, giới hạn tần suất của từng route, và hoa hồng chỉ phát sinh khi khách THẬT đóng học phí.
 *
 * Mọi quyết định (link còn sống · đối tác · campaign · nguồn · tự giới thiệu · Origin) vẫn ở `chuanBiReferral` — tệp này chỉ đọc tín hiệu và gọi đúng thứ tự của `/api/leads`:
 * chuẩn bị TRƯỚC khi tạo lead → `tinHieu` vào quy nguồn → ghi referral SAU commit (`ghiSauKhiGui`). KHÔNG BAO GIỜ ném: lỗi ở đây không được làm mất khách.
 */
import { chuanBiReferral, ghiReferralChoLeadCu, ghiReferralSauKhiTaoLead, type KetQuaChuanBiReferral } from "./nhan-referral";
import { docCoTheoDoi } from "./theo-doi-cong-khai";
import { tachTokenTuCookie } from "./cookie-gioi-thieu";

export type GioiThieuDaChuanBi = Extract<KetQuaChuanBiReferral, { ok: true }>;

/** Mã lỗi AN TOÀN cho log — không bao giờ in thông điệp (lỗi Prisma hay mang SĐT). */
function maLoi(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; name?: unknown };
    if (typeof o.code === "string" && /^[A-Za-z0-9_]{1,24}$/.test(o.code)) return o.code;
    if (typeof o.name === "string" && /^[A-Za-z]{1,40}$/.test(o.name)) return o.name;
  }
  return "UNKNOWN";
}

/**
 * Đọc tín hiệu giới thiệu của MỘT lượt gửi biểu mẫu. `null` = không có / cờ Affiliate∧Nguồn tắt / token lạ / lỗi — khách vẫn được lưu như thường.
 * `idempotencyKey` PHẢI là khoá ổn định của lượt gửi (eventId của lead) để gửi lại không đẻ hai dòng referral.
 */
export async function chuanBiGioiThieuKhiGui(p: {
  cookieGioiThieu: string | null;
  origin: string | null;
  phone: string;
  idempotencyKey: string;
  now: Date;
  nhanLog: string;
}): Promise<GioiThieuDaChuanBi | null> {
  const token = tachTokenTuCookie(p.cookieGioiThieu);
  if (token === null) return null;
  try {
    if (!(await docCoTheoDoi())) return null;
    const cb = await chuanBiReferral({ token, clickId: null, khach: { phone: p.phone, email: null }, origin: p.origin, idempotencyKey: p.idempotencyKey, now: p.now });
    return cb.ok ? cb : null;
  } catch (e) {
    console.error(`[${p.nhanLog}] chuẩn bị giới thiệu:`, maLoi(e));
    return null;
  }
}

/**
 * Ghi dòng referral SAU KHI lead đã commit. Lead MỚI ⇒ trạng thái theo luật quy nguồn đã thắng (`VALID` khi `AFFILIATE_REFERRAL` thắng đúng đối tác này);
 * lead CŨ (trùng SĐT) ⇒ `REJECTED_DUPLICATE` — người ghi nhận đầu tiên giữ công. Idempotent theo `idempotencyKey`. Không ném.
 */
export async function ghiSauKhiGui(p: {
  gioiThieu: GioiThieuDaChuanBi | null;
  leadId: string;
  laLeadMoi: boolean;
  centerId: string | null;
  now: Date;
  nhanLog: string;
}): Promise<void> {
  if (!p.gioiThieu) return;
  try {
    if (p.laLeadMoi) await ghiReferralSauKhiTaoLead({ ghi: p.gioiThieu.ghi, leadId: p.leadId, centerId: p.centerId, now: p.now });
    else await ghiReferralChoLeadCu({ ghi: p.gioiThieu.ghi, leadId: p.leadId, now: p.now });
  } catch (e) {
    console.error(`[${p.nhanLog}] ghi giới thiệu:`, maLoi(e));
  }
}
