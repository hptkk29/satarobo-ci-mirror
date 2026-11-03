// lib/export/quyen-xuat.ts — cổng xuất dữ liệu, phần CHẠM HẠ TẦNG (session + cấu hình).
//
// Phép quyết định thuần ở `lib/export/quyen-xuat-thuan.ts`; danh mục màn ở
// `lib/export/danh-muc-xuat.ts`. Đọc hai file đó trước.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI CỔNG, CỘNG DỒN — KHÔNG PHẢI THAY THẾ
//
//   ① vai của người dùng phải nằm trong danh sách được xuất màn đó   ← MỚI
//   ② người dùng vẫn phải có `quyenGoc` để đọc dữ liệu đó            ← CŨ, giữ nguyên
//
// Bỏ ② là biến một ô tích trên màn cấu hình thành đường vòng qua cách ly cơ sở: tích
// `CENTER_MANAGER` cho "Hồ sơ nhân sự" mà không còn `employees:view-all` thì quản lý cơ sở
// xuất được hồ sơ mà chính họ không mở được trên màn. Vì vậy `duocXuat()` gọi CẢ HAI, và
// route chỉ cần một dòng — không có chỗ nào để quên một cổng.
//
// ⚠️ `quyenGoc` là thứ mang `centerId` sang `checkPermission`, nên cách ly cơ sở vẫn do nó
// giữ. Danh sách vai KHÔNG biết gì về cơ sở và cố ý không biết: nó trả lời "loại việc này
// có được tải về không", còn "của cơ sở nào" là việc của `quyenGoc` + `scopedDb`.
import { checkPermission } from "@/lib/auth/check-permission";
import { getSetting } from "@/lib/settings/service";
import { timManXuat } from "./danh-muc-xuat";
import { KHOA_VAI_XUAT, vaiDuocXuat, vaiKhopDanhSach, type BangVaiXuat } from "./quyen-xuat-thuan";

export {
  KHOA_VAI_XUAT,
  MOI_MA_XUAT,
  vaiCuaPhien,
  vaiDuocXuat,
  vaiKhopDanhSach,
  type BangVaiXuat,
} from "./quyen-xuat-thuan";

/**
 * Cổng ĐẦY ĐỦ cho một route/màn xuất. Trả `false` là từ chối, không ném.
 *
 * Mã lạ ⇒ `false`. Fail-closed có chủ đích: một đường xuất quên khai trong danh mục thì
 * KHÔNG ai xuất được, thay vì mọi người xuất được. Người thêm đường xuất mới sẽ thấy ngay
 * lúc thử, chứ không phải người vận hành phát hiện ra sáu tháng sau.
 */
export async function duocXuat(
  ma: string,
  nguoi: { roles: readonly string[]; laSuperAdmin: boolean },
  target?: { centerId?: string | null; classId?: string | null },
): Promise<boolean> {
  const man = timManXuat(ma);
  if (!man) return false;

  const bang = await docBangVaiXuat();
  if (!vaiKhopDanhSach(nguoi.roles, vaiDuocXuat(man, bang), nguoi.laSuperAdmin)) return false;

  // Cổng ② — quyền đọc dữ liệu, mang theo cơ sở.
  if (man.quyenGoc && !(await checkPermission(man.quyenGoc, target))) return false;
  return true;
}

/** Đọc cấu hình. Lỗi đọc ⇒ `null` ⇒ rơi về `vaiMacDinh`, không phải mở toang. */
export async function docBangVaiXuat(): Promise<BangVaiXuat | null> {
  try {
    const v = await getSetting(KHOA_VAI_XUAT);
    return v && typeof v === "object" ? (v as BangVaiXuat) : null;
  } catch {
    return null;
  }
}

/**
 * Cổng cho NÚT xuất dựng ở trình duyệt (CSV/xlsx sinh tại client, không qua route).
 *
 * Ba nút như vậy trong repo: sổ vết thao tác, báo cáo học thử theo Sale, tài khoản phụ
 * huynh. Chúng không có route để gác, nên cổng phải đặt ở TRANG (Server Component) rồi
 * truyền xuống — trang quyết định có vẽ nút hay không.
 *
 * ⚠️ Đây là cổng DUY NHẤT của ba nút đó, vì dữ liệu đã nằm trong trang rồi. Nghĩa là nó
 * quyết định "có được TẢI VỀ không", chứ không phải "có được XEM không" — người xem được
 * trang vẫn xem được số trên màn. Đúng ranh giới mà cả cơ chế này dựng ra để vẽ.
 */
export async function duocXuatCuaPhienHienTai(
  ma: string,
  target?: { centerId?: string | null; classId?: string | null },
): Promise<boolean> {
  const { auth } = await import("@/lib/auth");
  const { vaiCuaPhien } = await import("./quyen-xuat-thuan");
  const session = await auth();
  if (!session?.user) return false;
  return duocXuat(ma, vaiCuaPhien(session.user), target);
}
