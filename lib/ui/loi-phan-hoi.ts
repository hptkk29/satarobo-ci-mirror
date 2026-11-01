/**
 * ĐỌC LÝ DO HỎNG từ phản hồi của một route nhập. Hàm THUẦN, không chạm mạng.
 *
 * ── VÌ SAO CÓ TỆP NÀY ────────────────────────────────────────────────────────────────────
 * Ảnh chụp prod 16/09/2026, màn nhập lead: hộp thoại in đúng một câu
 *
 *     "Nhập thất bại: Nhập thất bại"
 *
 * Server KHÔNG hề im lặng — nó trả về lý do đầy đủ. Vấn đề là các route nhập trả lỗi theo
 * HAI hình dạng khác nhau, còn màn hình chỉ đọc một:
 *
 *   · cổng đầu vào (401/403/400) →  { error: "Forbidden" }
 *   · hỏng lúc GHI (500)          →  { success: 0, errors: [{ row, error: "Lỗi ghi: …" }] }
 *
 * `body.error` ở hình dạng thứ hai là `undefined`, nên `err.error || "Import thất bại"` rơi
 * về chuỗi mặc định và NUỐT MẤT chẩn đoán — đúng ở chỗ cuối cùng trước mắt người dùng. Một
 * lỗi có sẵn câu trả lời bị biến thành một lỗi không tra được.
 *
 * ⚠️ Đo ngày 16/09: **8 màn nhập** cùng viết `err.error || "Import thất bại"` (lead · cơ sở ·
 * lớp · ngày nghỉ · kho · nhân sự · câu hỏi · phòng · học viên). Nên luật nằm ở MỘT hàm
 * thuần có test, thay vì chép câu điều kiện ra tám chỗ rồi sửa được bảy.
 *
 * Luật: KHÔNG BAO GIỜ trả về một câu vô nghĩa. Không đọc được gì thì ít nhất phải nói ra mã
 * HTTP — "máy chủ trả lỗi 500 và không nói lý do" vẫn tra được, còn "Import thất bại" thì
 * không.
 */

/** Hình dạng phản hồi lỗi của các route nhập. Mọi trường đều có thể vắng. */
export interface ThanLoiNhap {
  error?: unknown;
  errors?: unknown;
}

function chuoiSach(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Gộp mảng `errors` thành một câu đọc được.
 *
 * Có `row > 0` thì nói rõ dòng nào — người dùng đang cầm file Excel trong tay, và "dòng 47"
 * là thứ họ mở ra sửa được ngay. `row = 0` là lỗi của cả lượt, không gắn dòng nào.
 *
 * Cắt ở `tran` dòng: một file 300 dòng hỏng hết sẽ sinh một câu dài vô tận mà người ta chỉ
 * đọc mấy dòng đầu. Cắt thì PHẢI nói là đã cắt — im lặng bỏ bớt ở một thông báo lỗi là để
 * người đọc tưởng mình đã thấy hết.
 */
export function gopDongLoi(errors: unknown, tran = 5): string {
  if (!Array.isArray(errors)) return "";
  const cau: string[] = [];
  for (const e of errors) {
    if (typeof e !== "object" || e === null) continue;
    const { row, error } = e as { row?: unknown; error?: unknown };
    const chu = chuoiSach(error);
    if (!chu) continue;
    cau.push(typeof row === "number" && row > 0 ? `dòng ${row}: ${chu}` : chu);
  }
  if (cau.length === 0) return "";
  if (cau.length <= tran) return cau.join(" · ");
  return `${cau.slice(0, tran).join(" · ")} … (và ${cau.length - tran} lỗi nữa)`;
}

/**
 * Lý do hỏng, đọc được, không bao giờ rỗng.
 *
 * `body` là thân JSON đã phân tích, hoặc `null` khi phản hồi không phải JSON (route ném ra
 * trang lỗi HTML — cũng là một ca thật, và cũng phải nói được điều gì đó).
 */
export function docLoiPhanHoi(status: number, body: ThanLoiNhap | null): string {
  const tren = chuoiSach(body?.error);
  if (tren) return tren;
  const duoi = gopDongLoi(body?.errors);
  if (duoi) return duoi;
  return `Máy chủ trả lỗi ${status} và không nói lý do`;
}
