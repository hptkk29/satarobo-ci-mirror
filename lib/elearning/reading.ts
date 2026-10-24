/**
 * EL-04 — ĐO TIẾN ĐỘ BÀI ĐỌC. Bốn hàm THUẦN, không import Prisma, không đọc giờ
 * hệ thống. Mọi thứ cần biết đều truyền vào.
 *
 * Thuần là điều kiện, không phải sở thích: ba trong bốn hàm dưới đây quyết định
 * "bài này đã đọc xong chưa", tức quyết định một dòng chứng từ. Một hàm quyết
 * định chứng từ mà lại phụ thuộc giờ máy hay kết nối DB thì không viết nổi test
 * biên, và biên là chỗ nó sai.
 */

/** Số giây tối thiểu phải ở lại trang thì mới tính là đã đọc. */
export const MIN_READ_FLOOR = 30;
/** Trần, để một bài dài bất thường không đòi người ta ngồi cả tiếng. */
export const MIN_READ_CEIL = 600;
/** Ngưỡng cuộn — phải thấy gần hết bài, không chỉ mở ra rồi bỏ đó. */
export const SCROLL_DONE_PCT = 90;

/**
 * Bỏ cú pháp Markdown trước khi đếm từ.
 *
 * Nếu đếm trên văn bản thô thì một bài toàn `![](https://...)` sẽ ăn ngưỡng cao
 * vì URL dài được tính là "từ", trong khi người đọc chẳng có chữ nào để đọc.
 */
function boCuPhapMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // khối mã
    .replace(/`[^`]*`/g, " ") // mã trong dòng
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // ảnh
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // link — giữ phần chữ
    .replace(/<[^>]+>/g, " ") // thẻ HTML
    .replace(/^[>#\-*+\s]+/gm, " ") // dấu đầu dòng, tiêu đề, trích dẫn
    .replace(/[*_~]/g, " ");
}

/**
 * Sàn thời gian đọc của MỘT BÀI, suy từ số từ.
 *
 * 200 từ/phút là tốc độ đọc thường; nhân 0,5 vì chỉ đòi người ta ở lại NỬA thời
 * gian đọc hết — mục tiêu là chặn bấm-cho-xong, không phải bắt đọc kỹ.
 *
 * ⚠️ Sàn 30 giây BIND CHO MỌI BÀI ≤ 200 TỪ (200 × 0,15 = 30), không riêng "bài
 * dưới 60 từ" như ví dụ trong đặc tả. Viết `if (soTu < 60) return 30` là hiểu ví
 * dụ thành luật, và bài 100 từ sẽ ra 15 giây — thấp hơn cả sàn.
 *
 * Giá trị này tính LÚC SOẠN/NHẬP BÀI và lưu cứng vào `TrnLesson.minReadSeconds`.
 * Trang đọc chỉ ĐỌC LẠI, tuyệt đối không tính lại: tính lại nghĩa là sửa một chữ
 * trong bài cũng đổi ngưỡng của người đang đọc dở.
 */
export function computeMinReadSeconds(text: string): number {
  const soTu = boCuPhapMarkdown(text).trim().split(/\s+/).filter(Boolean).length;
  const tho = Math.ceil(soTu * 0.15);
  return Math.min(Math.max(tho, MIN_READ_FLOOR), MIN_READ_CEIL);
}

/**
 * Chặn client bơm số giây đọc.
 *
 * Nhịp gửi là 15 giây, nhưng KHÔNG GÌ chặn một client sửa đổi gửi 1 nhịp/giây với
 * `readSeconds = 99999`. Nên số client gửi lên chỉ được nhận tới mức "giá trị DB
 * đang có + biên", và biên phải rộng hơn một nhịp để nhịp trễ mạng không bị cắt oan.
 *
 * Đơn điệu không giảm: giá trị mới không bao giờ nhỏ hơn giá trị DB.
 */
export function capReadSeconds(input: {
  /** Số client báo lên. */
  client: number;
  /** Số đang lưu trong DB. */
  db: number;
  /** Biên cho phép vượt, mặc định 20 giây (nhịp 15s + dư cho trễ mạng). */
  bien?: number;
}): number {
  const bien = input.bien ?? 20;
  const tran = input.db + bien;
  const nhan = Math.min(Math.max(input.client, 0), tran);
  return Math.max(nhan, input.db);
}

/**
 * Bài đọc đã xong chưa.
 *
 * VÀ chứ không HOẶC, và biên là `>=` cho cả hai: ở lại đủ lâu NHƯNG cuộn tới 89%
 * thì chưa xong, và cuộn hết bài NHƯNG mới 29 giây cũng chưa xong. Hai điều kiện
 * bắt hai kiểu bấm-cho-xong khác nhau.
 */
export function isLessonDone(input: {
  readSeconds: number;
  scrollMaxPct: number;
  minReadSeconds: number;
}): boolean {
  return (
    input.readSeconds >= input.minReadSeconds &&
    input.scrollMaxPct >= SCROLL_DONE_PCT
  );
}

export type ReadSnapshot = { readSeconds: number; scrollMaxPct: number };

/**
 * Gộp ảnh chụp tiến độ mới vào giá trị đang có — ĐƠN ĐIỆU KHÔNG GIẢM.
 *
 * 🔴 Đây là chỗ mở hai tab thật sự hỏng, và đặc tả KHÔNG viết ra.
 * Tab A đọc tới `readSeconds = 100`. Tab B mở sau, khởi tạo từ 0, gửi nhịp đầu
 * với `readSeconds = 15`. Nếu ghi đè thẳng thì tiến độ TỤT từ 100 xuống 15, và
 * người dùng thấy thanh tiến độ chạy lùi mà không hiểu vì sao.
 *
 * `scrollMaxPct` cũng vậy: tên cột đã nói "max", nên lấy max chứ không lấy mới.
 */
export function mergeSnapshot(db: ReadSnapshot, incoming: ReadSnapshot): ReadSnapshot {
  return {
    readSeconds: Math.max(db.readSeconds, incoming.readSeconds),
    scrollMaxPct: Math.min(
      100,
      Math.max(db.scrollMaxPct, Math.max(incoming.scrollMaxPct, 0)),
    ),
  };
}

/**
 * Hạ `# Tiêu đề` xuống `## Tiêu đề` trước khi render nội dung bài học.
 *
 * ⚠️ Vì sao cần: `components/blog/markdown-renderer.tsx` khai `h1: () => null` —
 * mọi thẻ `<h1>` render thành RỖNG. Với bài blog đó là cố ý (tiêu đề bài do trang
 * render riêng, tránh hai h1 trên một trang). Với NỘI DUNG BÀI HỌC thì đó là MẤT
 * NỘI DUNG CÂM: người soạn gõ `# Phần 1`, xem trước thấy trống, và không có thông
 * báo nào giải thích.
 *
 * Hạ cấp thay vì sửa renderer chung: trang học đã có `<h1>` là tên bài, nên tiêu
 * đề trong nội dung vốn phải là cấp 2 — vừa giữ nội dung, vừa đúng thứ bậc tiêu
 * đề cho trình đọc màn hình.
 *
 * Chỉ đụng `#` ở ĐẦU DÒNG và KHÔNG đụng trong khối mã: một dòng `# comment` trong
 * ví dụ shell không phải tiêu đề.
 */
export function demoteH1(md: string): string {
  // Quét theo DÒNG thay vì thay thế bằng ký tự canh: mọi placeholder đều có thể
  // trùng nội dung thật của người soạn, và ký tự điều khiển trong regex thì ESLint
  // chặn — đúng, nó là mùi chứ không phải giải pháp.
  let trongKhoiMa = false;
  return md
    .split(/\r?\n/)
    .map((dong) => {
      if (/^\s*```/.test(dong)) {
        trongKhoiMa = !trongKhoiMa;
        return dong;
      }
      if (trongKhoiMa) return dong;
      return dong.replace(/^#(?!#)\s/, "## ");
    })
    .join("\n");
}
