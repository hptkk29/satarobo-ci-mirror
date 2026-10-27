"use server";

// Duyệt / không duyệt PHẢN ÁNH ô công Parttime (GĐ6, chốt 5). Cổng: đăng nhập → `hr_attendance:assign` TẠI cơ sở của phản ánh (tra từ DB,
// không nhận cơ sở từ client) → dịch vụ `lib/phan-cong/phan-anh-db.ts` (luật thuần chặn tự duyệt / kỳ chốt / kỳ cũ; duyệt = ghi THÊM lượt
// quét trong MỘT giao dịch). `now` do máy chủ đọc.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { coSoCuaPhanAnh } from "@/lib/phan-cong/cong-o-db";
import { duyetPhanAnh, LoiPhanAnh } from "@/lib/phan-cong/phan-anh-db";

type Res = { ok: true; message: string } | { ok: false; error: string };

export async function duyetPhanAnhAction(input: unknown): Promise<Res> {
  const p = z.object({ id: z.string().min(1), duyet: z.boolean(), ghiChu: z.string().trim().max(500).nullable() }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  const centerId = await coSoCuaPhanAnh(p.data.id);
  if (!centerId) return { ok: false, error: "Không tìm thấy phản ánh." };
  if (!(await checkPermission("hr_attendance:assign", { centerId }))) return { ok: false, error: "Bạn không có quyền duyệt phản ánh ở cơ sở này." };
  try {
    await duyetPhanAnh({
      id: p.data.id,
      actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản lý" },
      duyet: p.data.duyet,
      ghiChu: p.data.ghiChu,
      now: new Date(),
    });
  } catch (e) {
    if (e instanceof LoiPhanAnh) return { ok: false, error: e.message };
    return { ok: false, error: "Không xử lý được phản ánh — thử lại." };
  }
  revalidatePath("/cham-cong/phan-cong/thang");
  return { ok: true, message: p.data.duyet ? "Đã duyệt — đã ghi thêm lượt quét." : "Đã ghi không duyệt." };
}
