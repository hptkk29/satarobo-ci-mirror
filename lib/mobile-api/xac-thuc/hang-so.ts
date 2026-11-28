/**
 * Hằng số của xác thực di động — MỘT tệp, app không biết con số nào (app chỉ làm mới khi máy chủ báo hết hạn), nên đổi ở đây
 * không cần phát hành lại app. Nguồn: docs/mobile/11_BACKEND_MOBILE_API_DESIGN.md mục 3.1 / 3.8.
 *
 * ⚠️ TRẠNG THÁI PHÊ DUYỆT: các con số dưới đây là ĐỀ XUẤT của tài liệu thiết kế (khuyến nghị "giữ ba con số", người chốt là chủ dự án;
 * ngưỡng làm mới / đăng xuất chờ phiếu R-9). Chỉ chạy ở local/test sau cờ `MOBILE_API_ENABLED`. Đổi con số = đổi MỘT dòng ở đây + ca kiểm thử.
 */
const PHUT = 60_000;
const GIO = 60 * PHUT;
const NGAY = 24 * GIO;

export const MOBILE_AUTH = {
  /** Access token sống 15 phút. */
  accessTtlMs: 15 * PHUT,
  /** Hết hạn sau 30 ngày KHÔNG dùng (tính từ lần phát cặp token gần nhất). */
  khongDungTtlMs: 30 * NGAY,
  /** Trần tuyệt đối 180 ngày kể từ lúc đăng nhập. */
  tuyetDoiTtlMs: 180 * NGAY,
  /** Tối đa 5 phiên sống mỗi tài khoản; đăng nhập máy thứ 6 thu hồi phiên lâu không dùng nhất. */
  toiDaPhienSong: 5,
  /** Đăng nhập: cùng ngưỡng với web (`lib/auth.ts`): 10/phút theo IP, 5/phút theo định danh. */
  dangNhap: { cuaSoMs: PHUT, nguongIp: 10, nguongDinhDanh: 5 },
  /** Làm mới token: 30/giờ theo phiên, 60/giờ theo IP (đề xuất, chờ phiếu R-9). */
  lamMoi: { cuaSoMs: GIO, nguongPhien: 30, nguongIp: 60 },
  /** Đăng xuất: 60/giờ theo IP, chỉ đếm token KHÔNG tra ra phiên sống (bản rà P-07). */
  dangXuat: { cuaSoMs: GIO, nguongIp: 60 },
} as const;

export const TIEN_TO_ACCESS = "sma_";
export const TIEN_TO_REFRESH = "smr_";

export type LyDoThuHoi =
  | "dang-xuat"
  | "dang-nhap-lai"
  | "vuot-so-thiet-bi"
  | "dung-lai-token"
  | "tai-khoan"
  | "het-han"
  | "nguoi-dung-thu-hoi"
  | "quan-tri";
