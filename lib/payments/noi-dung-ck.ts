// lib/payments/noi-dung-ck.ts — nội dung chuyển khoản MANG KHOÁ ĐỐI KHỚP. THUẦN.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI — đo 14/09/2026, đường tự-xác-nhận đang chạy bằng phỏng đoán
//
// `resolvePaymentTargetDetailed` (lib/payments/payos-ingest.ts) có BỐN nhánh, theo
// thứ tự cứng:
//   (a) `matchKey` — tra `PaymentRequest.matchKey`, @unique, khớp CHÍNH XÁC ĐỢT
//   (b) `QrSession.providerOrderCode` — chỉ QR do payOS phát
//   (c) mã đơn `ORD\d{12}` trong nội dung
//   (d) SĐT phụ huynh + bằng chứng chuỗi tên/khoá
//
// Với mã QR VietQR đang phát hôm nay, BA nhánh đầu đều CHẾT:
//   · (a) vì nội dung CK không chứa `matchKey` — định dạng chốt 20/08 là
//         `TenCon_84SĐT_MaKhoa`, và chú thích ở `_qr-core.ts` tự ghi nhận hệ quả:
//         **"Đợt 1 và đợt 2 của CÙNG một đơn ra CÙNG một chuỗi."**
//   · (b) vì VietQR tĩnh có `providerOrderCode = null`
//   · (c) vì `extractOrderCode` trả null với định dạng mới
// ⇒ **Nhánh (d) là đường sống duy nhất**: ba tầng suy đoán, tới 5 truy vấn tuần tự
// theo từng biến thể SĐT, không biết tiền thuộc ĐỢT nào, và có lỗ "bà ngoại chuyển
// hộ" mà chính chú thích trong `pickOrderForPhone` đã tả.
//
// Chủ dự án 14/09: "khi KH thanh toán thì hệ thống tự xác nhận biến động theo nội
// dung CK để tự xác nhận đã thu, làm sao xác nhận thật nhanh… lâu quá thì KH sẽ
// ngồi đợi hơi lâu." Đường nhanh nhất KHÔNG phải tối ưu câu truy vấn của nhánh (d)
// — mà là làm nhánh (a) sống lại: MỘT truy vấn, khoá @unique, đúng đợt, không đoán.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI NGÂN SÁCH, HAI CÁCH CHIA — cố ý khác nhau
//
// Bản 25 ký tự (NHÚNG VÀO MÃ QR — máy quét, máy đọc):
//   `ORD260913000001D1 NguyenV`
//   Khoá đứng TRƯỚC và chiếm trọn; phần người đọc lấy chỗ thừa. Mất SĐT và mã khoá
//   là CHẤP NHẬN ĐƯỢC ở đây vì khoá thay thế đúng vai trò của chúng: chúng vốn chỉ
//   là nguyên liệu cho nhánh (d) đoán, mà nhánh (a) thì không cần đoán.
//   Ngân sách: 17 (khoá) + 1 (khoảng trắng) + 7 (`TRANSFER_NAME_MIN`) = 25 KHÍT.
//
// Bản 80 ký tự (SALE ĐỌC CHO PHỤ HUYNH GÕ TAY):
//   `ORD260913000001D1 NguyenVanAn_84987654321_Sata4`
//   Giữ NGUYÊN phần người đọc chốt 20/08, chỉ thêm khoá lên đầu. Gõ tay là đường
//   dễ sai nhất, nên nó giữ CẢ HAI khoá: sai khoá thì còn SĐT cho nhánh (d).
//
// ⚠️ DẤU NỐI LÀ KHOẢNG TRẮNG, KHÔNG PHẢI `_`. Đây không phải chuyện thẩm mỹ:
// `collectMatchKeyCandidates` tách token bằng `/[^A-Za-z0-9_-]+/` — biểu thức đó
// KHÔNG tách dấu `_`. Nối bằng `_` thì `ORD260913000001D1_NguyenV` ra MỘT token 25
// ký tự, không bằng `matchKey` nào, và nhánh (a) trượt y như cũ. Đã suýt viết sai.
// (Vẫn nới thêm bộ tách ở `payos-ingest.ts` để phụ huynh gõ tay dấu `_` cũng khớp —
// hai lớp, vì chuỗi đi qua tay người và qua ngân hàng đều bị chỉnh.)
//
// ⚠️ KHÔNG đổi `matchKey` — bất biến #3: khoá sinh MỘT LẦN lúc tạo phiếu và bền
// theo đời phiếu. File này chỉ đổi thứ ĐƯỢC IN RA.
// ─────────────────────────────────────────────────────────────────────────────

/** Ký tự nối khoá với phần người đọc. Xem chú thích trên — phải là khoảng trắng. */
export const DAU_NOI_KHOA = " ";

/**
 * Ghép khoá đối khớp vào trước nội dung CK dạng người đọc.
 *
 * @param matchKey   `PaymentRequest.matchKey` (vd `ORD260913000001D1`); `null` cho
 *                   đơn cũ chưa có phiếu ⇒ trả nguyên phần người đọc.
 * @param phanNguoiDoc chuỗi `TenCon_84SĐT_MaKhoa` đã được `transferContentForOrder`
 *                   cắt đúng ngân sách — hàm này KHÔNG dựng lại phép chia đó.
 * @param tran       trần ký tự (25 cho QR, 80 cho bản đọc).
 *
 * KHOÁ ĐƯỢC ƯU TIÊN TUYỆT ĐỐI: hết chỗ thì phần người đọc bị cắt, không bao giờ
 * ngược lại. Một chuỗi mất tên con vẫn rót tiền đúng phiếu; một chuỗi mất khoá thì
 * rơi về đoán.
 */
export function noiDungCkCoKhoa(
  matchKey: string | null | undefined,
  phanNguoiDoc: string,
  tran: number,
): string {
  const nguoiDoc = (phanNguoiDoc ?? "").trim();
  // Khoá đi qua ngân hàng thì mọi ký tự lạ đều có thể bị đổi — chỉ giữ chữ và số,
  // đúng dạng `paymentMatchKey` vốn đã sinh ra.
  const khoa = (matchKey ?? "").replace(/[^A-Za-z0-9]/g, "");

  if (!khoa) return nguoiDoc.slice(0, Math.max(0, tran));
  if (tran <= 0) return "";
  // Khoá dài hơn cả trần: giữ khoá (dù cụt) còn hơn giữ tên — nhưng khoá cụt thì
  // nhánh (a) trượt, nên đây là ca phải tránh bằng cách không đặt trần < 17.
  if (khoa.length >= tran) return khoa.slice(0, tran);

  const conLai = tran - khoa.length - DAU_NOI_KHOA.length;
  if (conLai <= 0 || !nguoiDoc) return khoa;
  return `${khoa}${DAU_NOI_KHOA}${nguoiDoc.slice(0, conLai)}`;
}

/**
 * Chuỗi này có mang khoá đối khớp không — dùng để phân loại nhanh khi đọc sao kê,
 * và để test khẳng định QR mới KHÁC QR cũ ở đúng điểm đó.
 */
export function coKhoaDoiKhop(noiDung: string, matchKey: string): boolean {
  const khoa = matchKey.replace(/[^A-Za-z0-9]/g, "");
  if (!khoa) return false;
  // So trên chuỗi đã bỏ ký tự lạ: ngân hàng chèn "CT tu ...", đổi dấu, viết hoa.
  return noiDung.replace(/[^A-Za-z0-9]/g, "").includes(khoa);
}
