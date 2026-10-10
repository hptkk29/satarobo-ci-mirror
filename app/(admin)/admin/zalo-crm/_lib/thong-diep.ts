// S1 · dịch `postMessage` từ khung ZaloCRM thành một đường dẫn điều hướng — THUẦN.
//
// Chiều chat → lead (kế hoạch §9.13, việc F5): trong `ChatView.vue` của fork có nút
// "Tạo lead Sata" / "Mở lead"; khi chạy trong iframe nó gửi
//   postMessage({ type: "sata:create-lead", phone, name, … }, SATA_ORIGIN)
//   postMessage({ type: "sata:open-lead",  leadId }, SATA_ORIGIN)
//
// 🔴 VÌ SAO TÁCH KHỎI COMPONENT: `window.addEventListener("message")` nhận tin từ MỌI
// nguồn — tab khác, tiện ích mở rộng, iframe quảng cáo lọt vào trang. Kiểm `event.origin`
// là hàng rào DUY NHẤT, và nó phải test được. Fork thì chưa tồn tại (repo khác), nên cách
// duy nhất có test thật hôm nay là gọi hàm này bằng object giả.
//
// Module thuần: không `db`, không `process.env`, không DOM API — nạp được cả ở client.

export type ThongDiepZaloCrm =
  | { loai: "tao-lead"; duongDan: string }
  | { loai: "mo-lead"; duongDan: string }
  /**
   * Khung xin một VÉ MỚI: phiên đang mở bên kia thuộc tổ chức KHÁC với vé vừa gửi.
   *
   * 🔴 VÌ SAO CẦN — sự cố prod 24/09/2026. Vé SSO nằm trong `src` của iframe. Trình
   * duyệt tải lại khung bằng `src` CŨ (bfcache, khôi phục tab, F5 trong khung) ⇒ vé bị
   * phát lại. Bên kia trước đây cứ thế đi tiếp bằng phiên đang có, KHÔNG kiểm tổ chức —
   * nên ai từng mở cơ sở A rồi đổi sang B sẽ KẸT Ở A: hộp thư trống, tìm SĐT không ra,
   * nick của chính mình không thấy. Không một dòng lỗi nào.
   *
   * Bên kia nay phát hiện được lệch, nhưng nó KHÔNG tự ký được vé — chỉ Sata ký. Nên nó
   * dọn phiên cũ rồi gửi tin này; Sata dựng lại trang ⇒ vé mới ⇒ `src` mới ⇒ khung dựng
   * lại và vào đúng tổ chức. Không cần ai đăng xuất tay.
   */
  | { loai: "xin-ve-moi" };

/** SĐT chấp nhận được từ fork: 8–15 chữ số, cho phép một dấu `+` đầu. */
const KHUON_SDT = /^\+?\d{8,15}$/;
/** `Lead.id` là cuid — chữ và số, không dấu chấm/gạch, không khoảng trắng. */
const KHUON_LEAD_ID = /^[a-z0-9]{10,40}$/i;
/** Tên hiển thị Zalo có thể rất dài; cắt để không dựng URL nghìn ký tự. */
const DAI_TOI_DA_TEN = 120;

/**
 * Đưa `ZALOCRM_APP_URL` về đúng dạng origin để so bằng `===` với `event.origin`.
 *
 * Phải chuẩn hoá vì env do người khai: `https://zalo.satarobo.vn/` (có dấu `/` cuối) so
 * `===` với `event.origin` (không bao giờ có dấu `/` cuối) là KHÔNG KHỚP ⇒ mọi tin bị
 * bỏ, nút "Tạo lead" chết câm mà không có lỗi nào.
 *
 * Trả `null` khi không phải URL — nơi gọi phải hiểu là "không tin tin nào", chứ không
 * được rơi về chuỗi rỗng (chuỗi rỗng so với `event.origin` rỗng sẽ khớp).
 */
export function chuanHoaNguonGoc(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function chuoiSach(v: unknown, dai: number): string {
  return typeof v === "string" ? v.trim().slice(0, dai) : "";
}

/**
 * Dịch một sự kiện `message` thành đường dẫn cần điều hướng tới, hoặc `null` nếu KHÔNG
 * được làm gì cả.
 *
 * `null` ở mọi ca nghi ngờ (fail-closed): sai origin, thiếu origin mong đợi, `data` không
 * phải object, loại tin lạ, thiếu/hỏng trường bắt buộc. Không ném — trình nghe sự kiện
 * chạy trên mọi tin của trang, ném ở đây là làm bẩn console bằng tin của công cụ dev.
 */
export function xuLyThongDiep(
  event: { origin?: unknown; data?: unknown },
  nguonGocTinCay: string | null,
): ThongDiepZaloCrm | null {
  // Chưa cấu hình ⇒ không tin ai. (Nếu để "" thì `event.origin === ""` cũng khớp.)
  if (!nguonGocTinCay) return null;
  if (typeof event.origin !== "string" || event.origin !== nguonGocTinCay) return null;

  const data = event.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const tin = data as Record<string, unknown>;
  if (typeof tin.type !== "string") return null;

  if (tin.type === "sata:create-lead") {
    // SĐT là trường BẮT BUỘC: biểu mẫu nhập khách mở ra mà không có gì điền sẵn thì
    // chuyến điều hướng này chẳng giúp được gì, còn Sale thì mất ngữ cảnh hội thoại.
    const phone = chuoiSach(tin.phone, 20).replace(/[\s.()-]/g, "");
    if (!KHUON_SDT.test(phone)) return null;

    // Trang nhập khách đã nhận `?phone=&name=` (đợt 1 — `lib/lead/intake/prefill.ts`).
    // Nó tự kiểm SĐT một lần nữa và bỏ trống ô nếu không hợp lệ, nên đây chỉ là lớp lọc
    // để không dựng URL rác.
    const q = new URLSearchParams({ phone });
    const name = chuoiSach(tin.name, DAI_TOI_DA_TEN);
    if (name) q.set("name", name);
    // ⚠️ `zcrmContactId`/`zcrmConversationId` của kế hoạch CỐ Ý chưa truyền: biểu mẫu
    // chưa có ô nào nhận chúng (thêm ô mới phải sửa validator + map + form — việc của lô
    // khác), nên gửi kèm bây giờ chỉ là tham số bị bỏ qua trong im lặng.
    return { loai: "tao-lead", duongDan: `/nhap-khach-hang?${q.toString()}` };
  }

  // Không mang dữ liệu nào: nó chỉ nói "vé vừa rồi không dùng được, ký cho tôi cái
  // mới". Mọi quyết định vẫn ở phía Sata — tin này KHÔNG chọn cơ sở, KHÔNG đổi tham số.
  if (tin.type === "sata:xin-ve-moi") return { loai: "xin-ve-moi" };

  if (tin.type === "sata:open-lead") {
    const leadId = chuoiSach(tin.leadId, 64);
    // Khuôn cứng thay vì `encodeURIComponent`: id đi vào ĐƯỜNG DẪN, và một chuỗi kiểu
    // `../../users` hay `x?y=1` mà lọt qua là đổi hẳn trang đích.
    if (!KHUON_LEAD_ID.test(leadId)) return null;
    return { loai: "mo-lead", duongDan: `/leads/${leadId}` };
  }

  return null;
}
