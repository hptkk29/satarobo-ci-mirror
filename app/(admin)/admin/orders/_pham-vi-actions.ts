"use server";

// XEM TRƯỚC giá theo phạm vi học cho form tạo đơn — action CHỈ ĐỌC (không ghi bảng nào, không audit, không sự kiện).
//
// Vì sao tách khỏi `_actions.ts` (tệp nóng): BANG-DIEU-PHOI §3 muốn `createOrderManualAction` chỉ giữ ĐÚNG MỘT lời gọi cổng
// SCOPE. Xem trước là một đường khác — nó gọi `xemTruocMoHinhPhamVi` (cùng cổng cờ, cùng planner, chỉ không đối chiếu đơn giá
// khách gõ), không phải cổng thứ hai.
//
// Gác như `createOrderManualAction`: đăng nhập + `orders:create`, đọc qua `scopedDb`, cơ sở phải nằm trong tầm nhìn.
// KHÁC ở một điểm cố ý: không `redirect` — đây là lời gọi nền từ form, nên thiếu quyền trả `{ ok: false }` chứ không đá trang.
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docDauVaoXemTruoc } from "@/lib/orders/pham-vi/dau-vao-xem-truoc";
import { xemTruocMoHinhPhamVi } from "@/lib/orders/pham-vi/ap-dung";
import { ketQuaXemTruoc, type KetQuaXemTruocPhamVi } from "@/lib/orders/pham-vi/xem-truoc";

export async function xemTruocGiaPhamViAction(input: unknown): Promise<KetQuaXemTruocPhamVi> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("orders:create"))) return { ok: false, error: "Không có quyền tạo đơn" };

  // Lời từ chối nói THẬT dòng nào/vì sao khi schema có câu riêng (vd số buổi ngoài 1–500) — xem `dau-vao-xem-truoc.ts`.
  const parsed = docDauVaoXemTruoc(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { centerId, items } = parsed.data;

  const actor = await resolveActor(session.user.id);
  if (centerId && !passesScope("Order", { centerId }, actor)) {
    return { ok: false, error: "Không có quyền tạo đơn cho cơ sở này" };
  }

  // Cùng câu tra với `createOrderManualAction` (id, price, totalSessions) — qua `scopedDb`, mã khoá lấy từ metadata đã chuẩn hoá.
  const courseIds = [...new Set(items.map((it) => docHinhThucLop(it.metadata).courseId).filter((v): v is string => v !== null))];
  const sdb = scopedDb(actor);
  const khoa =
    courseIds.length > 0
      ? await sdb.course.findMany({
          where: { id: { in: courseIds } },
          select: { id: true, price: true, totalSessions: true },
        })
      : [];
  const orgUnitId = centerId ? await orgUnitIdForCenter(centerId) : null;

  const kq = await xemTruocMoHinhPhamVi({ centerId, orgUnitId, items, khoa, taoDon: new Date() });
  return ketQuaXemTruoc(kq);
}
