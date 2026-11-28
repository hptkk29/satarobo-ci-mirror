/**
 * P8 — HƯỚNG DẪN SỬ DỤNG (nhân viên · quản trị). Nội dung DỰNG THEO `08-huong-dan-su-dung` của bộ thiết kế nhưng ĐÃ CHỈNH cho khớp hành vi THẬT của ứng dụng — một trang hướng dẫn nói
 * một nút/luồng không có là tệ hơn không có trang. Các chỗ thiết kế nói mà ứng dụng CHƯA có (nên bỏ khỏi lời hướng dẫn): ổ khoá "xong bài trước mới mở bài sau" (Q7), "Câu tiếp" +
 * ô số câu (runner từng câu), quay video / rút bài đã nộp, ảnh/âm thanh trong câu hỏi, mẫu chứng nhận, tab học viên online (P9), "Xem như người học". Ghi ở DECISIONS D-25.
 *
 * Dữ liệu thuần (không nằm trong JSX) để test được và để MỘT nguồn cho trang danh sách, trang chi tiết và liên kết Trước/Tiếp.
 */

export type BuocHuongDan = { tieuDe: string; moTa: string };
export type BaiHuongDan = {
  slug: string;
  tieuDe: string;
  moTa: string;
  /** Ước lượng thời gian đọc/làm theo, tính bằng phút (số hiển thị "khoảng N phút"). */
  phut: number;
  buoc: readonly BuocHuongDan[];
};

export type KhuHuongDan = "nhan-vien" | "quan-tri";

export const HUONG_DAN_NHAN_VIEN: readonly BaiHuongDan[] = [
  {
    slug: "hoc-khoa",
    tieuDe: "Học một khoá được giao",
    moTa: "Từ trang Tổng quan đến khi xong một bài",
    phut: 4,
    buoc: [
      { tieuDe: "Mở khoá đang học", moTa: "Ở Tổng quan, bấm Học tiếp để vào đúng bài bạn đang dừng." },
      { tieuDe: "Xem các khoá được giao", moTa: "Khoá của tôi chia 3 tab. Cần làm xếp theo hạn gần nhất, Quá hạn là khoá đã trễ, Đã xong là khoá bạn hoàn thành." },
      { tieuDe: "Theo đề cương", moTa: "Đề cương liệt kê chương và bài. Bài có dấu tích là đã xong; bấm tên bài để mở." },
      { tieuDe: "Xem video và đọc bài", moTa: "Xem hết video và trả lời câu hỏi giữa bài (nếu có). Bài đọc tính là xong khi bạn ở lại đủ thời gian đọc và cuộn tới cuối." },
    ],
  },
  {
    slug: "kiem-tra",
    tieuDe: "Làm bài kiểm tra",
    moTa: "Bắt đầu, nộp bài và xem lại kết quả",
    phut: 4,
    buoc: [
      { tieuDe: "Đọc luật rồi bắt đầu", moTa: "Xem số câu, thời gian và điểm đạt trước khi bấm Bắt đầu làm bài." },
      { tieuDe: "Trả lời các câu", moTa: "Chọn hoặc gõ đáp án cho từng câu. Hệ thống tự lưu dần trong lúc bạn làm." },
      { tieuDe: "Kiểm tra rồi nộp", moTa: "Bấm Nộp bài: hộp xác nhận cho biết còn câu nào bỏ trống. Làm nốt hoặc xác nhận nộp." },
      { tieuDe: "Xem lại kết quả", moTa: "Xem điểm và, nếu đề cho phép, đáp án kèm giải thích. Chưa đạt thì lượt sau mở sau khoảng giãn cách do đề quy định." },
    ],
  },
  {
    slug: "bai-tap",
    tieuDe: "Nộp bài tập",
    moTa: "Nộp bài và sửa khi bị trả về",
    phut: 3,
    buoc: [
      { tieuDe: "Đọc yêu cầu và khung chấm", moTa: "Khung chấm cho biết người chấm dựa vào tiêu chí nào — biết trước là một phần của việc học." },
      { tieuDe: "Ghi chú rồi nộp", moTa: "Nhập nội dung hoặc đính tệp bài làm, ghi chú cho người chấm nếu cần, rồi bấm Nộp bài." },
      { tieuDe: "Chờ chấm, sửa theo nhận xét", moTa: "Bài bị trả về có nhận xét từng tiêu chí. Sửa xong bấm Nộp lại." },
    ],
  },
  {
    slug: "chung-nhan",
    tieuDe: "Xem và tải chứng nhận",
    moTa: "Mở chứng nhận, tải PDF, gửi đường dẫn xác minh",
    phut: 3,
    buoc: [
      { tieuDe: "Chọn chứng nhận", moTa: "Danh sách có ngày cấp và ngày hết hạn. Bấm Xem để mở." },
      { tieuDe: "Tải bản in", moTa: "Tải PDF để in hoặc lưu vào máy." },
      { tieuDe: "Gửi đường dẫn xác minh", moTa: "Người nhận mở đường dẫn xác minh để kiểm tra chứng nhận là thật." },
    ],
  },
];

export const HUONG_DAN_QUAN_TRI: readonly BaiHuongDan[] = [
  {
    slug: "soan-khoa",
    tieuDe: "Soạn và gửi duyệt khoá nội bộ",
    moTa: "Từ chương trình đào tạo đến khoá đã duyệt",
    phut: 4,
    buoc: [
      { tieuDe: "Tạo khoá", moTa: "Khoá nội bộ luôn tạo từ một chương trình đào tạo đã lập." },
      { tieuDe: "Thêm bài vào chương", moTa: "Gõ tên bài, chọn loại rồi bấm Thêm bài. Mũi tên lên xuống (hoặc kéo thả) để đổi thứ tự." },
      { tieuDe: "Gửi duyệt", moTa: "Ghi chú thay đổi là bắt buộc để người duyệt biết bạn đã sửa gì. Còn lỗi dàn bài thì chưa gửi được." },
      { tieuDe: "Người duyệt chốt", moTa: "Người duyệt xem phần so với bản đang phát hành, rồi Duyệt hoặc Trả lại nháp kèm lý do. Duyệt xong khoá chưa tự xuất bản." },
    ],
  },
  {
    slug: "giao-khoa",
    tieuDe: "Giao khoá cho nhân viên",
    moTa: "4 bước: khoá, người học, hạn, xác nhận",
    phut: 4,
    buoc: [
      { tieuDe: "Chọn khoá, đặt tên lượt", moTa: "Chọn khoá đang phát hành cần giao và đặt tên lượt để dễ tìm lại." },
      { tieuDe: "Chọn người học", moTa: "Lọc theo vai trò, phòng ban, cơ sở rồi bấm Xem trước để thấy đủ tên những người khớp, bỏ chọn người không cần giao." },
      { tieuDe: "Đặt hạn", moTa: "Chọn hạn theo ngày cụ thể hoặc số ngày sau khi giao. Cho phép nộp trễ ở khoá bắt buộc thì phải ghi lý do." },
      { tieuDe: "Kiểm tra và giao", moTa: "Xem phần Tóm tắt rồi bấm nút Giao khoá. Người học nhận thông báo trong ứng dụng." },
    ],
  },
  {
    slug: "cham-bai",
    tieuDe: "Chấm bài tập",
    moTa: "Chấm theo khung tiêu chí, trả về hoặc chốt điểm",
    phut: 3,
    buoc: [
      { tieuDe: "Chọn bài chờ chấm", moTa: "Bài nộp sớm nhất nằm trên; hạn chấm hiện ngay trên từng dòng." },
      { tieuDe: "Chấm từng tiêu chí", moTa: "Chọn mức điểm cho từng tiêu chí trong khung chấm." },
      { tieuDe: "Nhận xét rồi chốt", moTa: "Đạt thì chốt điểm. Chưa đạt thì Trả về để sửa — người học thấy nhận xét của bạn." },
    ],
  },
  {
    slug: "cau-hoi",
    tieuDe: "Thêm câu hỏi vào kho",
    moTa: "Chọn dạng câu, soạn đề, lưu vào kho",
    phut: 3,
    buoc: [
      { tieuDe: "Thêm câu hỏi", moTa: "Vào Kho câu hỏi, bấm thêm câu và nhập nhánh kho để câu mới nằm đúng chỗ." },
      { tieuDe: "Chọn dạng câu", moTa: "Đang mở: một đáp án, nhiều đáp án, đúng/sai, trả lời ngắn, tự luận và nhập số. Các dạng khác chờ quyết định cách chấm." },
      { tieuDe: "Soạn đề rồi lưu", moTa: "Gõ đề, đánh dấu đáp án đúng (hoặc nhập đáp án số và sai số) rồi lưu câu hỏi." },
    ],
  },
  {
    slug: "chung-nhan",
    tieuDe: "Cấp và tra cứu chứng nhận",
    moTa: "Cấp tay khi cần, xem chứng nhận đã cấp",
    phut: 3,
    buoc: [
      { tieuDe: "Chứng nhận tự cấp khi đạt khoá", moTa: "Hệ thống tự cấp khi người học hoàn thành khoá. Chỉ cấp tay cho trường hợp đặc biệt." },
      { tieuDe: "Ghi lý do rồi xác nhận", moTa: "Lý do cấp tay ít nhất 10 ký tự và được lưu vào nhật ký kiểm toán." },
      { tieuDe: "Tra cứu chứng nhận đã cấp", moTa: "Mục Chứng nhận liệt kê số hiệu, ngày cấp và hạn; mỗi chứng nhận có trang xác minh công khai." },
    ],
  },
];

export const DANH_SACH_HUONG_DAN: Record<KhuHuongDan, readonly BaiHuongDan[]> = {
  "nhan-vien": HUONG_DAN_NHAN_VIEN,
  "quan-tri": HUONG_DAN_QUAN_TRI,
};

/** Đường dẫn của danh sách hướng dẫn theo khu. */
export const DUONG_HUONG_DAN: Record<KhuHuongDan, string> = {
  "nhan-vien": "/elearning/huong-dan",
  "quan-tri": "/elearning/huong-dan-quan-tri",
};

export type KetQuaTimHuongDan = { bai: BaiHuongDan; truoc: BaiHuongDan | null; tiep: BaiHuongDan | null };

/** Tìm một bài theo `slug` trong ĐÚNG khu (slug khu kia ⇒ `null`: không lộ nội dung quản trị qua đường dẫn nhân viên) kèm bài trước/sau trong khu đó. */
export function timHuongDan(khu: KhuHuongDan, slug: string): KetQuaTimHuongDan | null {
  const ds = DANH_SACH_HUONG_DAN[khu];
  const i = ds.findIndex((b) => b.slug === slug);
  if (i < 0) return null;
  return { bai: ds[i]!, truoc: ds[i - 1] ?? null, tiep: ds[i + 1] ?? null };
}
