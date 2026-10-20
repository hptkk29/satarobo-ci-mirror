// lib/payments/noi-dung-trong-anh.ts — ĐỌC NGƯỢC nội dung CK ra khỏi chính ảnh QR. THUẦN.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI — đo 24/09/2026, ba chuỗi cho MỘT phiếu thu
//
// Chủ dự án: *"mã QR khi in ra bị sai nội dung CK, đợi một chút F5 thì ra đúng chỗ Nội
// dung CK, nhưng khi KH quét QR thì vẫn là nội dung cũ mặc dù ở web là nội dung đúng."*
//
// Đo trên một phiếu (học viên "Nguyễn Phương Quỳnh Anh", SĐT 0905123456, khoá Sata 4,
// `matchKey = ORD260924000001D1`):
//
//   A. Trang đơn IN RA (`transferContentForOrder`)  →  `Anh_0905123456_Sata4`
//   B. NẰM TRONG ẢNH QR (`addInfoFor` → `noiDungCkCoKhoa`) → `ORD260924000001D1 Anh_090`
//   C. Khuôn đời mới của phiếu gộp (`dungMemo`)     →  `ANH 0905123456 K7M2N`
//
// A ≠ B, và **đó chính là lời than của chủ dự án**. Nguyên nhân cấu trúc: `QrSessionView`
// nhận ẢNH và CHỮ từ HAI NGUỒN KHÁC NHAU —
//
//   · ảnh  = `QrSession.qrContent`, ẢNH CHỤP lúc phát hành, nằm trong DB, KHÔNG đổi;
//   · chữ  = tham số `transferContent` do chỗ gọi truyền, TÍNH LẠI ở mỗi lượt render.
//
// Hai nguồn thì có ngày lệch, và khi lệch thì màn hình NÓI DỐI: nó in một chuỗi mà mã
// bên cạnh không hề mang. Phụ huynh quét mã, ngân hàng ghi chuỗi B, sale đối chiếu với
// chuỗi A trên màn và không thấy khớp.
//
// Lệch còn theo ĐƯỜNG ĐI nữa, nên cùng một phiếu đổi chữ tuỳ lúc:
//   · trang tải lần đầu → `loadActiveQrSessions` nhận chuỗi mức ĐƠN (A, không khoá);
//   · bấm "Xuất QR"/"Tạo lại" → action trả `addInfoFor(req)` (B, có khoá).
// Đó là vế "đợi một chút F5 thì ra đúng" — không phải dữ liệu chậm, mà là HAI CÔNG THỨC.
//
// ─────────────────────────────────────────────────────────────────────────────
// LỜI GIẢI: ĐỪNG DỰNG LẠI CHỮ — ĐỌC NÓ RA KHỎI ẢNH
//
// Chừng nào chữ còn được TÍNH LẠI thì nó còn có thể khác ảnh. Cách duy nhất khiến hai
// thứ không bao giờ lệch là lấy chữ TỪ CHÍNH cái ảnh đang hiển thị. `buildVietQrImageUrl`
// nhét nội dung CK vào tham số truy vấn `addInfo`, nên phép đọc ngược là chính xác —
// không phải suy đoán, không phải dựng lại.
//
// ⚠️ TRẢ `null` LÀ MỘT CÂU TRẢ LỜI HỢP LỆ, và cố ý. Chuỗi EMVCo của payOS (tag 62-08) đọc
// được về mặt kỹ thuật, nhưng một bộ phân tích TLV viết vội mà đọc SAI thì tệ hơn hẳn
// việc không đọc: nó sẽ in ra một chuỗi bịa và trông y như thật. Với payOS, đối khớp
// bám `providerOrderCode` chứ không bám nội dung, nên nhánh này không phải đường tiền —
// trả `null` để chỗ gọi lùi về chuỗi nó có, và chỉ CÁI ĐÓ mới là phỏng đoán có khai báo.

/** Tham số truy vấn mà `buildVietQrImageUrl` dùng để nhét nội dung CK vào ảnh. */
const THAM_SO_ADDINFO = "addInfo";

/**
 * Nội dung CK đang NẰM TRONG một ảnh QR.
 *
 * @param qrContent giá trị `QrSession.qrContent` — URL ảnh VietQR, hoặc chuỗi EMVCo của
 *                  cổng, hoặc `null`.
 * @returns chuỗi đã giải mã, hoặc `null` khi KHÔNG đọc được chắc chắn (không phải URL,
 *          URL không có `addInfo`, hoặc chuỗi EMVCo).
 *
 * Không ném với mọi đầu vào: chỗ gọi là đường render của trang đơn, một chuỗi rác trong
 * DB không được phép làm trắng cả trang.
 */
export function noiDungTrongAnhQr(qrContent: string | null | undefined): string | null {
  const s = (qrContent ?? "").trim();
  if (s === "") return null;
  if (!/^https?:\/\//i.test(s)) return null; // chuỗi EMVCo — xem khối chú thích trên.
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  // `URLSearchParams` tự giải `%XX` VÀ đổi `+` thành khoảng trắng — đúng cặp với
  // `URLSearchParams.toString()` mà `buildVietQrImageUrl` dùng để dựng. Tự viết
  // `decodeURIComponent` ở đây là mất dấu cách của khuôn `ORD… Anh_090`.
  const v = url.searchParams.get(THAM_SO_ADDINFO);
  return v === null || v === "" ? null : v;
}

/**
 * Ảnh QR đang cầm nội dung CŨ so với thứ hệ thống sẽ phát HÔM NAY hay không.
 *
 * ⚠️ Câu hỏi này BẮT BUỘC phải hỏi sau khi đã sửa chữ thành "đọc từ ảnh". Trước bản vá,
 * chữ được tính lại nên nó VÔ TÌNH là tín hiệu duy nhất cho thấy ảnh đã cũ (sale sửa tên
 * con / SĐT / khoá sau khi xuất QR thì chữ đổi, ảnh thì không). Sửa chữ mà không thêm
 * câu hỏi này là bịt luôn cái tín hiệu ấy — đổi một lỗi NÓI DỐI lấy một lỗi CÂM, tệ hơn.
 *
 * `null` (không đọc được nội dung trong ảnh) ⇒ trả `false`: không biết thì KHÔNG báo
 * động. Cảnh báo giả trên màn tiền bị người dùng học cách bỏ qua, rồi bỏ qua luôn lần
 * thật.
 */
export function anhQrDaCu(qrContent: string | null | undefined, noiDungHomNay: string): boolean {
  const trongAnh = noiDungTrongAnhQr(qrContent);
  if (trongAnh === null) return false;
  return trongAnh !== noiDungHomNay;
}
