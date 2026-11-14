import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/lib/actions/factory";

/**
 * DANH SÁCH NHÂN SỰ ĐỂ CHỌN (thay ô nhập `userId` thô) — dùng cho "Người chịu trách nhiệm nội dung" của chương trình và
 * "Người Nhân sự đồng phê duyệt" ở mức gắn đánh giá.
 *
 * ⚠️ TỆP NÀY PHẢI CLIENT-SAFE: chỉ `import type`. Component client `chon-nhan-su.tsx` import `TRAN_NHAN_SU_CHON` từ đây; một
 * `import` lúc chạy bất kỳ (ActionError, resolveActor, can…) kéo cả chuỗi `next/headers`/Prisma vào bundle client và `next build`
 * đỏ — `tsc` và test đơn vị không thấy (đo 26/10/2026). Phần xác minh Ở SERVER nằm ở `nhan-su-chon-xac-minh.ts`; lưới `[XMN-W7]`
 * (`lib/elearning/chon-nguoi-wiring.test.ts`) ghim cả hai chiều.
 *
 * Quyền + cơ sở KHÔNG nằm ở đây mà ở `db`: người gọi truyền `scopedDb(actor)`, nên người cấp cơ sở chỉ thấy nhân sự trong tầm
 * nhìn cơ sở của mình (`Employee` ∈ SCOPED_MODELS). Trang gọi hàm này vẫn gác quyền của chính nó (`program:manage`) TRƯỚC khi nạp,
 * để người không có quyền không bị truy vấn danh sách nhân sự.
 *
 * Chỉ người ĐANG LÀM VIỆC và CÓ TÀI KHOẢN ĐĂNG NHẬP ĐƯỢC: id trả về là `User.id` — thứ action nhận. Người chưa có tài khoản,
 * tài khoản bị khoá, hay đã xoá mềm không chọn được (họ không đăng nhập được nên không thể là người chịu trách nhiệm/duyệt).
 *
 * Trần 500 — cùng trần với các màn giao/soạn khác; vượt trần thì `daCat = true` để màn nói ra thay vì lặng lẽ thiếu người.
 *
 * 🔴 HAI PHÍA — MỘT VỊ TỪ. Ô chọn (`napNhanSuChon`) và cổng ở server (`xacMinhNguoiDuocChon`) cùng dùng
 * `dieuKienNhanSuChon`. Đừng viết điều kiện thứ hai ở chỗ nào khác: phía nào lỏng hơn phía kia là hoặc một lời hứa suông
 * (ô liệt kê người mà server từ chối), hoặc một lỗ (server nhận người mà ô không bao giờ đưa ra). Đo 26/10/2026 trên TEST:
 * server nhận nguyên văn `userId` giả, người ngoài cơ sở, người đã nghỉ — vì chỉ có ô chọn lọc, server tin giao diện.
 */
export const TRAN_NHAN_SU_CHON = 500;

export type NhanSuChon = { userId: string; nhan: string };

/** Trạng thái tài khoản đăng nhập hợp lệ — ĐÚNG ba vế mà `lib/auth.ts` (authorize) dùng để cho vào. */
const TAI_KHOAN_HOP_LE = { isActive: true, deletedAt: null, accountStatus: "ACTIVE" } as const;

/**
 * Điều kiện của MỘT người có thể được chọn. Truyền `userId` khi cần khớp đúng một tài khoản (cổng server);
 * bỏ trống khi liệt kê (ô chọn).
 */
export function dieuKienNhanSuChon(userId?: string): Prisma.EmployeeWhereInput {
  return {
    isActive: true,
    status: "ACTIVE",
    userAccount: { is: userId === undefined ? TAI_KHOAN_HOP_LE : { ...TAI_KHOAN_HOP_LE, id: userId } },
  };
}

export function nhanNhanSu(n: {
  fullName: string;
  employeeCode: string;
  jobTitle: string;
  departmentRef?: { name: string } | null;
}): string {
  const phu = [n.jobTitle?.trim(), n.departmentRef?.name?.trim()].filter(Boolean).join(" · ");
  return phu ? `${n.fullName} (${n.employeeCode}) — ${phu}` : `${n.fullName} (${n.employeeCode})`;
}

export async function napNhanSuChon(db: ScopedDb): Promise<{ ds: NhanSuChon[]; daCat: boolean }> {
  const dong = await db.employee.findMany({
    where: dieuKienNhanSuChon(),
    select: {
      fullName: true,
      employeeCode: true,
      jobTitle: true,
      departmentRef: { select: { name: true } },
      userAccount: { select: { id: true } },
    },
    orderBy: { fullName: "asc" },
    take: TRAN_NHAN_SU_CHON + 1,
  });
  const daCat = dong.length > TRAN_NHAN_SU_CHON;
  const ds: NhanSuChon[] = [];
  for (const n of dong.slice(0, TRAN_NHAN_SU_CHON)) {
    if (!n.userAccount) continue; // lưới an toàn: `is` đã lọc, nhưng kiểu vẫn là nullable
    ds.push({ userId: n.userAccount.id, nhan: nhanNhanSu(n) });
  }
  return { ds, daCat };
}
