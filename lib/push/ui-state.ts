// Màn "Bật thông báo" hiện cái gì — Web Push Đợt 3.
//
// THUẦN: không DOM, không React, không mạng. Tách ra khỏi component để test được ở cổng
// required (`lib/**/*.test.ts`), vì repo KHÔNG có tiền lệ test component bằng
// @testing-library/react — dựng khuôn mới cho một cái nút là chi phí không ai xin.

/** Ba giá trị của `Notification.permission`. */
export type QuyenThongBao = "default" | "granted" | "denied";

export interface BoiCanhThietBi {
  /** `"PushManager" in window && "serviceWorker" in navigator`. */
  hoTroPush: boolean;
  quyen: QuyenThongBao;
  /** Thiết bị iOS/iPadOS (đo bằng platform, không sniff user-agent bừa). */
  laIOS: boolean;
  /** `matchMedia("(display-mode: standalone)").matches || navigator.standalone`. */
  dangStandalone: boolean;
  /** Máy này đã có đăng ký đang sống trong DB chưa. */
  daDangKy: boolean;
}

export type TrangThaiManHinh =
  /** iOS chưa "Thêm vào màn hình chính" — hiện HƯỚNG DẪN, KHÔNG hiện nút. */
  | "IOS_CHUA_CAI"
  /** Người dùng đã chặn ở cấp trình duyệt — không hỏi lại được. */
  | "BI_CHAN"
  /** Trình duyệt không có Web Push (và không phải ca iOS ở trên). */
  | "KHONG_HO_TRO"
  /** Đã bật và máy này đã đăng ký. */
  | "DA_BAT"
  /** Hiện nút "Bật thông báo". */
  | "CO_THE_BAT";

/**
 * Quyết định hiển thị.
 *
 * ⚠️ THỨ TỰ HỎI LÀ MẤU CHỐT, không phải chuyện gọn gàng. Trên iOS Safari CHƯA cài vào màn hình
 * chính, `window.PushManager` KHÔNG TỒN TẠI — nên nếu hỏi `hoTroPush` trước, mọi iPhone chưa cài
 * sẽ nhận thông điệp "trình duyệt không hỗ trợ". Đó là câu SAI và là câu tệ nhất có thể nói:
 * nó bảo người dùng bỏ cuộc, trong khi họ chỉ còn cách đúng một thao tác. Toàn bộ phạm vi của
 * module này đứng trên việc ép được nhân viên iPhone cài web app — nói sai ở đây là tự phá nó.
 *
 * `BI_CHAN` hỏi trước `KHONG_HO_TRO` vì `Notification.permission` vẫn đọc được ngay cả khi
 * `PushManager` vắng mặt, và "bạn đã chặn" là thông tin dùng được, còn "không hỗ trợ" thì không.
 */
export function trangThaiManHinh(bc: BoiCanhThietBi): TrangThaiManHinh {
  if (bc.laIOS && !bc.dangStandalone) return "IOS_CHUA_CAI";
  if (bc.quyen === "denied") return "BI_CHAN";
  if (!bc.hoTroPush) return "KHONG_HO_TRO";
  if (bc.quyen === "granted" && bc.daDangKy) return "DA_BAT";
  return "CO_THE_BAT";
}

/** Nhãn nút / tiêu đề khối, gom một chỗ để màn admin và màn giáo viên nói giống nhau. */
export const NHAN: Record<TrangThaiManHinh, { tieuDe: string; moTa: string }> = {
  IOS_CHUA_CAI: {
    tieuDe: "Thêm Sata Robo vào màn hình chính",
    moTa: "iPhone và iPad chỉ gửi được thông báo khi web app đã nằm ở màn hình chính. Làm một lần, sau đó mở Sata Robo từ biểu tượng vừa thêm rồi quay lại đây.",
  },
  BI_CHAN: {
    tieuDe: "Thông báo đang bị chặn",
    moTa: "Bạn đã chặn thông báo cho trang này nên trình duyệt sẽ không hỏi lại. Mở phần cài đặt quyền của trình duyệt cho địa chỉ này, đổi Thông báo sang Cho phép, rồi tải lại trang.",
  },
  KHONG_HO_TRO: {
    tieuDe: "Trình duyệt này không nhận được thông báo",
    moTa: "Thử bằng Chrome, Edge hoặc Safari bản mới. Thông báo trong ứng dụng (chuông ở góc trên) vẫn hoạt động bình thường.",
  },
  DA_BAT: {
    tieuDe: "Máy này đã đăng ký nhận thông báo",
    // KHÔNG hứa ở thì hiện tại. Engine gửi đã có từ Đợt 4 (`lib/push/engine.ts`), NHƯNG công
    // tắc `push.webPushEnabled` vẫn TẮT mặc định và còn cổng thứ hai là ba biến VAPID. Nói
    // "bạn sẽ nhận được" khi chưa ai bật là một câu SAI mà người dùng chỉ phát hiện bằng cách
    // chờ mãi không thấy gì. Câu dưới đúng ở CẢ HAI trạng thái nên không phải sửa lại lần nữa
    // vào ngày mở kênh — và không có test nào canh câu chữ này, nên đừng dựa vào CI để nhớ.
    moTa: "Đăng ký đã lưu. Thông báo lead mới sẽ tới máy này ngay khi hệ thống mở kênh gửi — kể cả lúc bạn đã đóng trình duyệt.",
  },
  CO_THE_BAT: {
    tieuDe: "Bật thông báo trên máy này",
    moTa: "Đăng ký máy này để nhận thông báo lead mới ngay trên điện thoại, kể cả khi đã đóng trình duyệt.",
  },
};

/** Các bước "Thêm vào màn hình chính" trên iOS Safari. Chữ đủ — không cần ảnh. */
export const BUOC_CAI_IOS: readonly string[] = [
  "Mở trang này bằng Safari (Chrome trên iPhone không thêm được vào màn hình chính).",
  'Chạm nút Chia sẻ ở thanh dưới — biểu tượng ô vuông có mũi tên hướng lên.',
  'Vuốt lên trong bảng vừa mở, chọn "Thêm vào MH chính".',
  'Chạm "Thêm" ở góc trên bên phải.',
  "Mở Sata Robo từ biểu tượng vừa xuất hiện trên màn hình chính, vào lại trang này rồi bấm Bật thông báo.",
];

/**
 * Thiết bị có phải iOS/iPadOS không — THUẦN, nhận sẵn hai giá trị của `navigator`.
 *
 * Vì sao không chỉ soi `iPhone|iPad|iPod`: từ iPadOS 13, iPad tự khai user-agent là `Macintosh`
 * để web hiện bản desktop. Chỉ soi ba chuỗi kia là mọi iPad rơi vào nhánh "không hỗ trợ" thay vì
 * nhánh hướng dẫn cài — đúng cái sai mà `trangThaiManHinh` dựng thứ tự để tránh.
 * Phân biệt iPad với Mac thật bằng `maxTouchPoints`: Mac trả 0, iPad trả 5.
 *
 * Đây là một trong số ít chỗ soi user-agent chính đáng: KHÔNG có API nào khác cho biết
 * "thiết bị này đòi cài vào màn hình chính mới nhận được push".
 */
export function laThietBiIOS(nav: { userAgent: string; maxTouchPoints: number }): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  return nav.maxTouchPoints > 1 && /Macintosh/.test(nav.userAgent);
}

/**
 * Origin → nhãn người đọc được.
 *
 * Service worker khoá theo ORIGIN, và từ Đợt 3 có worker ở CẢ hai host nhân viên — nên một
 * người kiêm nhiệm sẽ thấy HAI dòng cho cùng một cái điện thoại. Hiện URL thô thì hai dòng
 * trông như trùng lặp và người dùng bấm Gỡ nhầm, tắt push ở host kia mà không có dấu hiệu gì.
 */
export function nhanHost(origin: string): string {
  const h = origin.replace(/^https?:\/\//, "").split(":")[0]?.toLowerCase() ?? "";
  if (h.startsWith("admin.")) return "Trang quản trị";
  if (h.startsWith("giaovien.")) return "Trang giáo viên";
  if (h.startsWith("e-learning.")) return "Khu đào tạo nội bộ";
  if (h.startsWith("sale.")) return "Trang Sale";
  if (h.startsWith("hocvien.")) return "Cổng phụ huynh";
  return origin;
}
