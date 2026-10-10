/**
 * EL-15c — CHUẨN NỘP TỆP cho BÀI TẬP của người học.
 *
 * ⚠️ Bảng chuẩn THỨ BA, cố ý tách khỏi `media-rules.ts` (video BÀI HỌC) và
 * `lib/storage/upload-config.ts` (trần chung năm module). Nới trần trong
 * `media-rules.ts` cho vừa video dạy thử là nới cho TOÀN BỘ người học xem bài —
 * trần 200MB/720p ở đó tính theo dữ liệu di động của người XEM, không phải theo
 * nhu cầu của người NỘP.
 *
 * ⚠️ NỘI DUNG Ở ĐÂY MANG DỮ LIỆU CÁ NHÂN CỦA BÊN THỨ BA. §13.3 bắt giáo viên nộp
 * "video dạy thử" và tư vấn viên nộp "ghi âm hội thoại" — tức TRẺ EM và PHỤ HUYNH,
 * những người không phải người dùng của hệ thống này và không tự bảo vệ được.
 *
 * Bốn quy tắc của kế hoạch, và chỗ chúng được thi hành:
 *  1. mặc định KHÔNG chứa mặt/tên học sinh — câu chữ ở màn nộp, không ép được bằng mã;
 *  2. nếu buộc phải có thì đi qua đường media hiện hữu (tag + `StudentConsent`) —
 *     ⚠️ CHƯA thi hành, xem `NO_CHUA_LAM` ở cuối tệp;
 *  3. ghi âm ẩn danh trước khi nộp — câu chữ ở màn nộp;
 *  4. khai vào thông báo xử lý dữ liệu — thuộc `lib/elearning/policy.ts`.
 */

/** Trần dung lượng MỘT tệp đính kèm của bài nộp. */
export const NOP_MAX_BYTES = 300 * 1024 * 1024;

/**
 * Số tệp tối đa cho một lượt nộp.
 *
 * ⚠️ Có trần vì không có trần nghĩa là một lượt nộp có thể kéo theo hàng trăm tệp,
 * và người chấm phải mở từng cái trong hạn 3 ngày làm việc.
 */
export const NOP_MAX_TEP = 5;

/**
 * Loại tệp NHẬN — danh sách ĐÓNG.
 *
 * ⚠️ Đóng chứ không mở: mỗi định dạng thêm vào là một bề mặt phân tích nữa ở phía
 * máy chủ, và tệp ở đây do NGƯỜI HỌC tải lên chứ không phải người soạn nội dung —
 * tức bề mặt rộng hơn nhiều so với thư viện media.
 *
 * `application/pdf` cho nhật ký hội thoại đã ẩn danh; `video/mp4` cho video dạy
 * thử; `audio/mpeg` + `audio/mp4` cho ghi âm.
 */
export const NOP_MIME_NHAN = [
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
  "application/pdf",
] as const;

export type MimeNhan = (typeof NOP_MIME_NHAN)[number];

export function mimeDuocNhan(mime: string): mime is MimeNhan {
  return (NOP_MIME_NHAN as readonly string[]).includes(mime);
}

/**
 * VÂN TAY đầu tệp (magic bytes) cho từng loại.
 *
 * ⚠️ Kiểm ở MÁY CHỦ, không tin `Content-Type` trình duyệt gửi lên: header đó do
 * phía tải lên tự khai và đổi được bằng một dòng. Không sniff thì một tệp `.exe`
 * đặt tên `.mp4` sẽ nằm trong kho và được phát ra cho người chấm tải về.
 *
 * MP4/M4A: hộp `ftyp` ở byte 4-7. MP3: `ID3` hoặc khung sync `FF Fx`. PDF: `%PDF-`.
 */
export function vanTayKhop(mime: string, dauTep: Uint8Array): boolean {
  const b = dauTep;
  const chuoi = (i: number, s: string) =>
    s.split("").every((c, k) => b[i + k] === c.charCodeAt(0));

  if (mime === "video/mp4" || mime === "audio/mp4") return chuoi(4, "ftyp");
  if (mime === "application/pdf") return chuoi(0, "%PDF-");
  if (mime === "audio/mpeg") {
    if (chuoi(0, "ID3")) return true;
    // Khung sync MPEG: 11 bit 1 liên tiếp.
    return b[0] === 0xff && (b[1] ?? 0) >= 0xe0;
  }
  return false;
}

/**
 * TIỀN TỐ KHOÁ trên kho tệp cho một lượt nộp.
 *
 * ⚠️ KHÔNG dùng lại `elearning/master/<lessonId>/` của video bài học. Vé phát của
 * EL-10 cấp theo BÀI (`khoaThuocBai`), nên đặt bài nộp dưới tiền tố đó là để MỌI
 * người học cùng bài đọc được bài nộp của nhau chỉ bằng cách đổi đường dẫn.
 *
 * Khoá gắn `submissionId` — thứ chỉ chính chủ và người chấm biết.
 */
export function tienToKhoaBaiNop(submissionId: string): string {
  return `elearning/bai-nop/${submissionId}/`;
}

/**
 * Khoá này có thuộc ĐÚNG lượt nộp đó không.
 *
 * ⚠️ Chặn đi lùi thư mục TRƯỚC khi so tiền tố: `elearning/bai-nop/A/../B/x.mp4`
 * bắt đầu bằng tiền tố của A nhưng trỏ vào B.
 */
export function khoaThuocLuotNop(khoa: string, submissionId: string): boolean {
  if (khoa.includes("..")) return false;
  return khoa.startsWith(tienToKhoaBaiNop(submissionId));
}

/**
 * NỢ CÓ TÊN — chưa làm, và biết là chưa làm.
 *
 * Quy tắc 2 của §13.3 ("nếu buộc phải có mặt/tên học sinh thì đi qua tag +
 * `StudentConsent` + tự ẩn khi thu hồi") CHƯA được thi hành ở đây. Hiện chỉ có câu
 * chữ ở màn nộp yêu cầu người nộp tự bảo đảm.
 *
 * Vì sao chưa: `StudentConsent` gắn với `Student` của hệ vận hành lớp học, còn lượt
 * nộp gắn với `User` nhân sự — nối hai thứ đó cần một quyết định về việc "video này
 * có những học sinh nào" mà không ai đang ở vị trí chốt. Ghi ra để không ai tưởng
 * nó đã có.
 *
 * ⚠️ HỆ QUẢ VẬN HÀNH: chưa nên xuất bản khoá bắt nộp video có mặt học sinh cho tới
 * khi nợ này đóng. Khoá dùng nhân viên đóng vai hoặc góc không nhận diện thì chạy
 * được ngay.
 */
export const NO_CHUA_LAM =
  "Chưa nối StudentConsent cho tệp bài nộp có mặt/tên học sinh (§13.3 quy tắc 2)";
