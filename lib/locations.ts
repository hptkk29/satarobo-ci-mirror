export type LocationStatus = "operational" | "upcoming";

/**
 * SĐT CÔNG TY — MỘT SỐ DUY NHẤT cho toàn site [chủ dự án chốt 24/09/2026].
 *
 * Trước hôm nay mỗi cơ sở mang một số riêng (CS1 `0818.823.720` · CS2 `0702.193.933`), và
 * khoảng ba mươi màn **lặp qua danh sách cơ sở** để in ra HAI nút gọi + HAI nút Zalo.
 *
 * ⚠️ Vì sao bốn trường `hotline*`/`zalo` bị **GỠ KHỎI** `SataRoboLocation` chứ không phải
 * gán cùng một giá trị: giữ trường lại là giữ nguyên từng vòng lặp ấy, và một số duy nhất
 * in ra hai lần cạnh nhau là lỗi NHÌN THẤY ĐƯỢC mà không cổng nào bắt. Gỡ trường ⇒ `tsc`
 * liệt kê đủ chỗ phải sửa (luật 7: bỏ mặc định nguy hiểm để trình biên dịch đếm hộ).
 *
 * Cơ sở **vẫn là hai** — địa chỉ, phường, giờ mở cửa, bản đồ vẫn theo từng cơ sở. Chỉ số
 * điện thoại và Zalo là chung.
 */
export const SATA_ROBO_PHONE = {
  /** Dạng người đọc — dùng ở MỌI chỗ hiển thị. */
  hien: "0837.312.860",
  /** Số thuần cho `tel:` và `zalo.me`. */
  tho: "0837312860",
  /** Chuẩn E.164 cho JSON-LD. */
  e164: "+84837312860",
  /** Link Zalo của công ty. */
  zalo: "https://zalo.me/0837312860",
} as const;

export interface SataRoboLocation {
  id: string;
  /** Mã cơ sở ngắn dùng cho nhãn ("Cơ sở 1"/"CS1"). KHÔNG còn gắn với SĐT riêng. */
  code: "CS1" | "CS2";
  name: string;
  address: string;
  district: string;
  workingHours: string;
  status: LocationStatus;
  isHQ: boolean;
  openingDate?: string;
  note?: string;
}

// 2 cơ sở — CHUNG một số điện thoại (xem `SATA_ROBO_PHONE`). Khác nhau ở địa chỉ,
// phường và ghi chú; đừng thêm lại trường SĐT riêng cho từng cơ sở.
export const SATA_ROBO_LOCATIONS: SataRoboLocation[] = [
  {
    id: "tru-so-nguyen-huu-tho",
    code: "CS1",
    name: "Cơ sở 1 - Nguyễn Hữu Thọ",
    address: "211 Nguyễn Hữu Thọ, Đà Nẵng",
    // Hồ sơ BCT ghi "Phường Hòa Cường"; `lib/finance/hoa-don/phap-nhan.ts:81` (đo từ hoá đơn
    // thật) cũng ghi Hòa Cường. Trước 21/09/2026 ô này ghi "Hải Châu" — sai phường, và cái
    // sai đó đi thẳng vào JSON-LD `addressLocality` (lib/seo/jsonld.ts:56).
    // ⚠️ KHÔNG sửa CS2 theo: bản BCT chỉ cho địa chỉ CS1, và 114 Hoàng Diệu đúng là Hải Châu.
    district: "Hòa Cường",
    workingHours: "T2 - T7: 8:00 - 20:00",
    status: "operational",
    isHQ: true,
    // Đã gỡ tiền tố "Trụ sở chính - " (hướng dẫn BCT cấm nhãn này sau địa chỉ).
    // ⚠️ GIỮ cờ `isHQ` ở trên — 4 chỗ khác dùng nó để sắp xếp/chọn mặc định, gỡ cờ là vỡ.
    // Thứ phải gỡ là NHÃN, không phải CỜ.
    note: "Phòng Lab lớn, đầy đủ trang thiết bị",
  },
  {
    id: "co-so-hoang-dieu",
    code: "CS2",
    name: "Cơ sở 2 - Hoàng Diệu",
    address: "114 Hoàng Diệu, Đà Nẵng",
    district: "Hải Châu",
    workingHours: "T2 - T7: 8:00 - 20:00",
    status: "operational",
    isHQ: false,
  },
];

// Thông tin công ty (KHÔNG còn hotline/zalo đơn lẻ — luôn dùng theo từng cơ sở
// qua SATA_ROBO_LOCATIONS để hiển thị đủ 2 số).
export const SATA_ROBO_CONTACT = {
  companyName: "Công ty Cổ phần Công nghệ Giáo dục Sata Robo",
  /** Dạng VIẾT HOA cho khối pháp nhân — hồ sơ BCT in tên công ty ở dạng này. */
  legalNameUpper: "CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC SATA ROBO",
  shortName: "Sata Robo",
  // ─── Mã số doanh nghiệp ───────────────────────────────────────────────────
  // Hồ sơ BCT đòi in ĐẦY ĐỦ: "Mã số doanh nghiệp: 0402301783 do Sở Tài chính Thành phố
  // Đà Nẵng cấp ngày 02/10/2025". Trước 21/09/2026 toàn repo chỉ in con số trần và gọi
  // sai tên pháp lý là "MST"/"Mã số thuế"; cụm "do … cấp ngày …" có 0 dòng.
  //
  // ⚠️ `taxCode` GIỮ NGUYÊN — các đường kế toán/hoá đơn đang đọc nó. `businessCode` là
  //    cùng một con số nhưng dùng ở ngữ cảnh pháp lý công khai; đừng gộp hai cái làm một.
  businessCode: "0402301783",
  businessCodeIssuer: "Sở Tài chính Thành phố Đà Nẵng",
  businessCodeIssuedAt: "02/10/2025",
  /**
   * Địa chỉ công ty ĐẦY ĐỦ theo hồ sơ BCT.
   *
   * ⚠️ TUYỆT ĐỐI KHÔNG gắn nhãn "Trụ sở chính" sau địa chỉ này. Hướng dẫn BCT cấm
   * (*"Địa chỉ kinh doanh nếu khác địa chỉ trụ sở chính trong Đăng ký kinh doanh thì không
   * chú thích 'Trụ sở chính'"*), và nhãn đó còn SAI SỰ THẬT: trụ sở đăng ký của pháp nhân
   * MST 0402301783 là **258 Lê Thanh Nghị** — đo từ hoá đơn thật, xem
   * `lib/finance/hoa-don/phap-nhan.ts:81`. 211 Nguyễn Hữu Thọ là địa chỉ KINH DOANH.
   */
  address: "211 Nguyễn Hữu Thọ, Phường Hòa Cường, Thành phố Đà Nẵng, Việt Nam",
  taxCode: "0402301783",
  emails: {
    primary: "thongtin@satarobo.vn",
    general: "thongtin@satarobo.vn",
    recruitment: "tuyendung@satarobo.vn",
    ceo: "hodacphuchtc@gmail.com",
  },
  facebook: "https://www.facebook.com/satarobo",
  tiktok: "https://www.tiktok.com/@satarobo",
  youtube: "https://www.youtube.com/@satarobo",
} as const;

/**
 * Giờ mở cửa cơ sở ở dạng schema.org (`openingHours`), PHẢI khớp `workingHours` ở trên.
 *
 * Hai dạng cùng tồn tại vì hai người đọc khác nhau: `workingHours` là chữ cho phụ huynh
 * ("T2 - T7: 8:00 - 20:00"), còn chuỗi này là cho máy tìm kiếm. Trước 21/09/2026 bản cho
 * máy bị gõ tay thẳng trong `lib/seo/jsonld.ts` là `'Mo-Su 08:00-21:00'` — lệch CẢ hai
 * đầu (Chủ nhật, và 21h) so với chữ in ngay trên cùng trang /lien-he.
 *
 * ⚠️ Đây KHÔNG phải giờ tiếp nhận khiếu nại. Chính sách bảo mật công bố giờ tiếp nhận
 * khiếu nại là "08h00 – 17h30, thứ Hai đến thứ Sáu" — hai khái niệm khác nhau, đừng gộp.
 *
 * Ca `[GIO-01]` trong `lib/locations.test.ts` canh hai dạng không trôi khỏi nhau.
 */
export const OPENING_HOURS_SCHEMA = "Mo-Sa 08:00-20:00";

export function operationalLocations(): SataRoboLocation[] {
  return SATA_ROBO_LOCATIONS.filter((l) => l.status === "operational");
}

export function upcomingLocations(): SataRoboLocation[] {
  return SATA_ROBO_LOCATIONS.filter((l) => l.status === "upcoming");
}

/** Danh sách cơ sở dùng cho nút liên hệ / hotline (đang hoạt động). */
export const SATA_ROBO_CONTACT_CENTERS = operationalLocations();

// ⚠️ ĐÃ GỠ `hotlinesInline()` và `hotlinesCompany()` [24/09/2026]. Cả hai ghép chuỗi từ
// SĐT của từng cơ sở; nay chỉ còn một số nên hàm nào cũng chỉ trả về đúng
// `SATA_ROBO_PHONE.hien`, và giữ lại một hàm tên "hotlines" (số nhiều, có tiền tố "CS1:")
// là để tên nói sai về thứ nó trả về. Chỗ nào cần in số thì đọc thẳng hằng.
