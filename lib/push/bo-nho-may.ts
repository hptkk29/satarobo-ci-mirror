// lib/push/bo-nho-may.ts — hai mẩu trạng thái của Web Push nằm TRONG TRÌNH DUYỆT. Đợt 6.
//
// ⚠️ FILE NÀY CHẠY Ở TRÌNH DUYỆT. Không `server-only`, không `Buffer`, không import gì từ `lib/db`.
//
// ── VÌ SAO PHẢI CÓ, VÀ VÌ SAO KHÔNG ĐỂ TRONG DB ───────────────────────────────────────────
// Đợt 6 thêm đường TỰ ĐĂNG KÝ LẠI sau đăng nhập. Đường đó cần biết hai thứ mà DB không trả lời
// được, vì cả hai đều thuộc về MỘT TRÌNH DUYỆT chứ không thuộc về một người:
//
//  1. "Người dùng có CHỦ ĐỘNG tắt thông báo trên máy này không?" — nếu không có mẩu này thì nút
//     "Gỡ" trên màn thiết bị trở thành VÔ NGHĨA: nó chỉ thu hồi DÒNG trong DB, không huỷ đăng ký
//     ở trình duyệt, nên lượt tải trang kế tiếp sẽ tự đăng ký lại và thiết bị hiện lại trong
//     danh sách. DB không phân biệt được "vừa đăng xuất" với "cố ý tắt" — cả hai đều ra một dòng
//     `REVOKED` với cùng lý do.
//  2. "Trong phiên tab này đã đồng bộ endpoint đó chưa?" — chốt idempotence. Không có nó thì MỖI
//     lượt tải trang cứng gọi một Server Action (kèm `revalidatePath` hai đường + `resolveActor`),
//     tức trả phí ghi cho một việc không đổi gì. Repo đã có một sự cố vượt trần egress vì đúng
//     loại "ghi vô điều kiện ở đường nóng" (xem `lib/notifications/notify.ts`).
//
// ── ⚠️ MỌI KHOÁ MANG THEO `nguoiDung` — LĂNG KÍNH ĐỢT 6 TÌM RA, ĐỪNG GỠ ──────────────────
// Bản đầu của tệp này khoá theo ORIGIN (storage vốn theo origin). Lăng kính đo được HAI chuỗi
// hỏng thật trên máy DÙNG CHUNG, và cả hai đều IM LẶNG:
//
//  · mốc `da-dong-bo` theo endpoint đơn: A bị phiên chết (bump `tokenVersion` — 9 nơi làm việc
//    đó) ⇒ layout đá A sang `/dang-xuat` ⇒ tài khoản CÒN SỐNG nên không thu hồi gì, và vì là
//    redirect phía server nên không nửa client nào chạy ⇒ đăng ký E còn sống. B đăng nhập TRONG
//    CÙNG TAB (sessionStorage không bị xoá) ⇒ mốc khớp E ⇒ đường tự động trả "đã đồng bộ" và
//    KHÔNG gọi máy chủ ⇒ KHÔNG chuyển chủ ⇒ mọi lead của A nổ trên màn hình khoá máy B đang cầm,
//    kèm tên phụ huynh. Chính cổng này chặn đúng lời gọi tạo nên "lưới thứ hai" của Đợt 5.
//  · cờ `da-tat-tay` theo origin: A bấm "Tắt trên máy này" cuối buổi ⇒ sáng sau B đăng nhập trên
//    đúng máy đó và KHÔNG BAO GIỜ được đăng ký lại, trong khi màn hình vẫn hứa "thông báo sẽ tới
//    máy này". Một người tắt là bịt miệng mọi người còn lại dùng chung trình duyệt đó.
//
// `nguoiDung` là `session.user.id` của phiên server, truyền xuống qua prop. KHÔNG phải thông tin
// mới trong HTML: `components/admin/topbar.tsx` và `app/(teacher)/teacher/layout.tsx` đã truyền
// đúng giá trị đó cho client từ trước (đã đo).
//
// MỌI lời gọi đều bọc `try/catch`: `localStorage`/`sessionStorage` NÉM trong cửa sổ riêng tư và
// khi người dùng chặn site data. Mất mẩu trạng thái chỉ làm đường tự-đăng-ký-lại thận trọng hơn
// (không chạy) hoặc tốn thêm một lượt ghi — không bao giờ được làm vỡ trang.

/** Khoá cho cờ "người dùng NÀY đã tự tắt thông báo trên máy này". */
const KHOA_TAT_TAY = "satarobo:push:da-tat-tay";
/** Khoá cho mốc "người dùng NÀY đã đồng bộ endpoint này trong phiên tab này". */
const KHOA_DA_DONG_BO = "satarobo:push:da-dong-bo";

/**
 * Ghép khoá theo người. `null` khi không biết người dùng là ai — nơi gọi phải xử lý ca đó theo
 * chiều SAI AN TOÀN của chính nó, đừng lặng lẽ dùng một khoá dùng chung (đó là lỗi vừa vá).
 */
function khoaTheoNguoi(goc: string, nguoiDung: string | null | undefined): string | null {
  if (!nguoiDung) return null;
  return `${goc}:${nguoiDung}`;
}

/**
 * Người dùng này có chủ động tắt thông báo trên máy này không.
 *
 * Trả `true` khi KHÔNG ĐỌC ĐƯỢC storage — hoặc khi không biết người dùng là ai — là CỐ Ý: fail
 * sang "đừng tự bật lại". Đoán sai theo chiều này chỉ làm người dùng phải bấm "Bật thông báo" một
 * lần; đoán sai theo chiều kia là tự bật lại một thứ họ vừa tắt, và đó là kiểu lỗi khiến người ta
 * tắt quyền ở cấp trình duyệt.
 */
export function daTatTayOMayNay(nguoiDung: string | null | undefined): boolean {
  try {
    const k = khoaTheoNguoi(KHOA_TAT_TAY, nguoiDung);
    if (!k) return true;
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(k) === "1";
  } catch {
    return true;
  }
}

/** Ghi nhận người dùng này vừa CHỦ ĐỘNG tắt thông báo trên máy này. */
export function datTatTay(nguoiDung: string | null | undefined): void {
  try {
    const k = khoaTheoNguoi(KHOA_TAT_TAY, nguoiDung);
    if (!k) return;
    localStorage?.setItem(k, "1");
  } catch {
    /* cửa sổ riêng tư / site data bị chặn — mất cờ thì lượt sau tự bật lại, chấp nhận */
  }
}

/** Người dùng này vừa CHỦ ĐỘNG bật lại — xoá cờ để đường tự đăng ký lại hoạt động trở lại. */
export function xoaTatTay(nguoiDung: string | null | undefined): void {
  try {
    const k = khoaTheoNguoi(KHOA_TAT_TAY, nguoiDung);
    if (!k) return;
    localStorage?.removeItem(k);
  } catch {
    /* không xoá được thì đường tự động im lặng — nút bấm tay vẫn chạy như cũ */
  }
}

/**
 * Endpoint (theo băm) đã được người dùng này đồng bộ lên máy chủ trong phiên tab này chưa.
 *
 * `sessionStorage` chứ không `localStorage`: phạm vi đúng là MỘT TAB. Người dùng mở tab mới hay
 * tải lại sau khi đóng tab thì nên đồng bộ lại một lần — đó là lúc trạng thái phía máy chủ có
 * thể đã đổi (bị thu hồi ở nơi khác). Dùng `localStorage` là khoá cứng vĩnh viễn, và một dòng
 * bị thu hồi sẽ không bao giờ được dựng lại.
 *
 * ⚠️ Nhưng sessionStorage SỐNG QUA ĐĂNG XUẤT trong cùng tab — nên khoá PHẢI mang `nguoiDung`,
 * xem khối chú thích đầu tệp.
 */
export function daDongBoTrongPhien(
  nguoiDung: string | null | undefined,
  bamEndpoint: string,
): boolean {
  try {
    const k = khoaTheoNguoi(KHOA_DA_DONG_BO, nguoiDung);
    if (!k || !bamEndpoint) return false;
    if (typeof sessionStorage === "undefined") return false;
    return sessionStorage.getItem(k) === bamEndpoint;
  } catch {
    // Không đọc được ⇒ coi như CHƯA đồng bộ. Fail sang "làm thêm một lượt ghi" (vô hại) chứ
    // không sang "bỏ qua" (mất đăng ký).
    return false;
  }
}

/** Ghi nhận người dùng này vừa đồng bộ xong endpoint này trong phiên tab. */
export function datDaDongBo(nguoiDung: string | null | undefined, bamEndpoint: string): void {
  try {
    const k = khoaTheoNguoi(KHOA_DA_DONG_BO, nguoiDung);
    if (!k || !bamEndpoint) return;
    sessionStorage?.setItem(k, bamEndpoint);
  } catch {
    /* mất mốc thì lượt tải sau ghi thêm một lần — chỉ tốn, không sai */
  }
}
