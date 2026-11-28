import { taoGioiHan, type KetQuaKiemTruoc } from "./dong-co";
import { dinhDanhChuanHoa } from "./chuan-hoa";
import { KhoPostgres } from "./kho";

/**
 * CỔNG DUY NHẤT của giới hạn đăng nhập dùng chung (B4): web (`lib/auth.ts`) và mobile (`lib/mobile-api/xac-thuc/dich-vu.ts`) cùng gọi `kiemTruocDangNhap` — cùng kho Postgres,
 * cùng chuẩn hoá định danh, cùng chính sách; `kenh` CHỈ để nơi gọi ghi nhật ký, KHÔNG nằm trong khoá đếm (nên chia lượt giữa hai kênh không lách được).
 * Chỉ được gọi khi `isLoginLimiterV2Enabled()` (cờ `LOGIN_LIMITER_V2`, mặc định TẮT). Cờ TẮT ⇒ nơi gọi giữ nguyên đường cũ — rollback = tắt cờ, không cần deploy.
 */
export type KenhDangNhap = "web" | "mobile";
export type { KetQuaKiemTruoc };
export { LoiKhongDemDuoc } from "./dong-co";
const gioiHan = taoGioiHan(new KhoPostgres());

export async function kiemTruocDangNhap(_kenh: KenhDangNhap, ip: string, thoNhap: string, now: Date = new Date()): Promise<KetQuaKiemTruoc> {
  return gioiHan.kiemTruoc({ ip, dinhDanh: dinhDanhChuanHoa(thoNhap), now });
}
