// QoCNPrompt — văn bản prompt để nhờ công cụ tạo ảnh (ChatGPT, Gemini…) vẽ PHÔI giấy chứng nhận của MỘT khoá online. HÀM THUẦN, không đọc/ghi DB.
//
// Nguồn nội dung: bản thiết kế `QoCNPrompt.dc.html` (20/11/2026). Chỗ thiết kế gắn cứng một con người (tên + chức danh người ký) KHÔNG được chép vào mã:
// người ký là dữ liệu của tổ chức — đưa vào qua tham số; để trống thì BỎ dòng chữ ký (không bịa người).
// Màu thương hiệu lấy từ thiết kế (#5B2A86 tím, #FE8F2D cam). Việc lưu phôi/vị trí chữ/PDF online CHƯA có (chờ Q1–Q7 và schema — xem QO-CHUNG-NHAN-THONG-KE-V9.5.md).

export const MAU_TIM = "#5B2A86";
export const MAU_CAM = "#FE8F2D";

export type DauVaoPromptPhoi = {
  tenKhoa: string;
  /** Đối tượng nhận; mặc định "Học viên" (khoá online bán cho học viên). */
  doiTuong?: string;
  /** Tuỳ chọn: chữ ký + dòng "Tên – Chức danh" ở góc dưới phải. Thiếu một trong hai ⇒ bỏ dòng chữ ký. */
  nguoiKy?: string;
  chucDanh?: string;
};

const gon = (s: string) => s.replace(/\s+/g, " ").trim();

export function taoPromptPhoiChungNhan(i: DauVaoPromptPhoi): string {
  const ten = gon(i.tenKhoa);
  const doiTuong = gon(i.doiTuong ?? "Học viên") || "Học viên";
  const nguoiKy = gon(i.nguoiKy ?? "");
  const chucDanh = gon(i.chucDanh ?? "");
  const giuChuKy = nguoiKy && chucDanh ? `, chữ ký và dòng "${nguoiKy} – ${chucDanh}" ở góc dưới phải` : "";
  return [
    "Thiết kế PHÔI giấy chứng nhận khổ A4 nằm ngang, 3508 × 2480 px (300 dpi), xuất PNG.",
    "Đơn vị cấp: Sata Robo – trung tâm Robotics & AI cho trẻ lớp 1–8 tại Đà Nẵng.",
    `Khoá học: ${ten} · Đối tượng nhận: ${doiTuong}.`,
    `Phong cách: tươi sáng, thân thiện với trẻ em; màu chủ đạo tím ${MAU_TIM} và cam ${MAU_CAM} trên nền sáng; có thể dùng robot linh vật Sata Robo ở hai bên mép.`,
    `GIỮ trên phôi: logo Sata Robo ở trên, tiêu đề "GIẤY CHỨNG NHẬN HOÀN THÀNH KHOÁ HỌC"${giuChuKy}.`,
    "BẮT BUỘC CHỪA TRỐNG (nền trơn, không chữ, không hoạ tiết, không đường kẻ đè lên):",
    "1. Dải tên người nhận ở giữa trang: rộng khoảng 45% chiều ngang, cao khoảng 9%, nằm khoảng 50–58% chiều cao.",
    "2. Ô tên khoá học ngay dưới tên: rộng khoảng 45%, cao 5%. Có thể là dải màu nhạt hoặc khung bo tròn, nhưng bên trong để trống.",
    "3. Ô kết quả / thành tích ngay dưới ô khoá: rộng khoảng 42%, cao 4%, bên trong để trống.",
    "4. Góc dưới trái: khoảng trống 22% × 10% cho 2–3 dòng ngày cấp, hiệu lực, mã chứng nhận.",
    "KHÔNG được: viết tên người mẫu, tên khoá, ngày tháng hay mã số; đặt chữ hoặc hình vào các ô ở trên; để chữ sát mép (chừa lề an toàn 5% bốn phía).",
    "Chữ tiếng Việt (nếu có) phải đúng dấu.",
  ].join("\n");
}
