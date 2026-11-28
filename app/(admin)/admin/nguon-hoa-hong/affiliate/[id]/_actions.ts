"use server";

// app/(admin)/admin/nguon-hoa-hong/affiliate/[id]/_actions.ts — Server Action của TRANG CHI TIẾT ĐỐI TÁC (AFF-L3a): TÀI KHOẢN TRUY CẬP CỔNG (liên kết · gỡ · đổi người đại diện · tạm ngừng / mở lại cổng) và ô TÌM
// tài khoản.
//
// MỎNG: xác thực → quyền (`affiliates:manage`, gác Ở ĐẦU HÀM — đúng khoá mà giao diện dùng để vẽ nút: `scope.has("affiliates:manage")`) → zod → cờ (`affiliate.enabled` ∧ `nguon.enabled`) → gọi hàm ghi →
// làm mới trang. Luật ghi (khoá hàng, khoá lạc quan, cổng trước phép ghi, nhật ký cùng transaction, đồng bộ cột legacy) ở `lib/affiliate/tai-khoan-truy-cap-ghi.ts`; luật ĐƯỢC / KHÔNG ĐƯỢC ở `*-dau-vao.ts`.
//
// KHÔNG có action nào ở đây TẠO tài khoản User hay cấp vai: màn này chỉ nối User ĐÃ CÓ (quyết định kinh doanh về đường vào cổng cho đối tác ngoài hệ thống còn mở — xem notes L3a).
// Ghi danh campaign và duyệt thành viên KHÔNG có action ở đây: trang dùng thẳng `themMembershipAction` / `doiTrangThaiMembershipAction` của tab Campaign (khoá `affiliate_memberships:manage`) — không viết lại luật.
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { docCoModule } from "@/lib/nguon-hoa-hong/module-scope";
import { timUserDeLienKet, type UserUngVien } from "@/lib/affiliate/tai-khoan-truy-cap";
import {
  doiDaiDien,
  goLienKet,
  lienKetUser,
  moLaiCong,
  tamNgungCong,
  type KetQuaGo,
  type KetQuaLienKet,
} from "@/lib/affiliate/tai-khoan-truy-cap-ghi";
import { timUserSchema } from "@/lib/affiliate/tai-khoan-truy-cap-dau-vao";

// Đường dẫn của ROUTE trong app (có `/admin`), cùng quy ước với tab Affiliate.
const BASE = "/admin/nguon-hoa-hong/affiliate";
const CHUA_DANG_NHAP = { ok: false, loi: "Chưa đăng nhập", truong: "quyen" } as const;
const THIEU_QUYEN = { ok: false, loi: "Không có quyền quản lý đối tác Affiliate (affiliates:manage).", truong: "quyen" } as const;
const CO_TAT = { ok: false, loi: "Affiliate chưa được bật.", truong: "quyen" } as const;

const tenNguoi = (u: { name?: string | null; email?: string | null }) => u.name ?? u.email ?? "Nhân viên";

function lamMoi() {
  revalidatePath(BASE, "layout");
}

export async function lienKetUserAction(input: unknown): Promise<KetQuaLienKet> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  if (!(await docCoModule()).affiliate) return CO_TAT;
  const kq = await lienKetUser({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: input, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

export async function goLienKetAction(input: unknown): Promise<KetQuaGo> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  if (!(await docCoModule()).affiliate) return CO_TAT;
  const kq = await goLienKet({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: input, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

export async function tamNgungCongAction(input: unknown): Promise<KetQuaGo> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  if (!(await docCoModule()).affiliate) return CO_TAT;
  const kq = await tamNgungCong({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: input, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

export async function moLaiCongAction(input: unknown): Promise<KetQuaGo> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  if (!(await docCoModule()).affiliate) return CO_TAT;
  const kq = await moLaiCong({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: input, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

export async function doiDaiDienAction(input: unknown): Promise<KetQuaGo> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  if (!(await docCoModule()).affiliate) return CO_TAT;
  const kq = await doiDaiDien({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: input, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

// ── Ô tìm tài khoản để liên kết ──────────────────────────────────────────────────────────────────────────────

type KetQuaTimUser = { ok: true; ketQua: UserUngVien[] } | { ok: false; error: string };

/**
 * Tìm tài khoản PHỤ HUYNH liên kết được. Gác bằng ĐÚNG khoá của nút «Liên kết tài khoản» (`affiliates:manage`) — không mượn khoá của module khác. Hỏi cờ SAU quyền (người không có quyền không dò
 * được cờ). Tìm tối thiểu 3 ký tự, trần 8 kết quả, che SĐT/email (xem `timUserDeLienKet`): không phải danh bạ.
 */
export async function timUserAction(input: unknown): Promise<KetQuaTimUser> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("affiliates:manage"))) return { ok: false, error: THIEU_QUYEN.loi };
  const parsed = timUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  if (!(await docCoModule()).affiliate) return { ok: false, error: CO_TAT.loi };
  return { ok: true, ketQua: await timUserDeLienKet(parsed.data) };
}
