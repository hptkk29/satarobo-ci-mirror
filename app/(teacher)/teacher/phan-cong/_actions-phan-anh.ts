"use server";

// Giáo viên PHẢN ÁNH ô công của CHÍNH MÌNH (GĐ6, chốt 4, 5). `userId` luôn từ PHIÊN — không nhận từ client. Cơ sở client gửi chỉ là
// địa chỉ ô; dịch vụ kiểm người này CÓ VIỆC ở đúng cơ sở × ngày đó trước khi ghi (`lyDoKhongGuiDuoc`). `homNay` do máy chủ tính.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { vnYmd } from "@/lib/time/vn";
import { guiPhanAnh, LoiPhanAnh, rutPhanAnh } from "@/lib/phan-cong/phan-anh-db";

type Res = { ok: true; message: string } | { ok: false; error: string };
const TRANG = "/teacher/phan-cong/cong-o";

export async function guiPhanAnhAction(input: unknown): Promise<Res> {
  const p = z
    .object({
      centerId: z.string().min(1),
      ngay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      ca: z.string().min(1).max(10),
      lyDo: z.string().trim().max(500),
      moc: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()).min(1).max(8),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  try {
    await guiPhanAnh({ ...p.data, userId: session.user.id, homNay: vnYmd(new Date()) });
  } catch (e) {
    if (e instanceof LoiPhanAnh) return { ok: false, error: e.message };
    return { ok: false, error: "Không gửi được phản ánh — thử lại." };
  }
  revalidatePath(TRANG);
  return { ok: true, message: "Đã gửi phản ánh — quản lý cơ sở sẽ xem." };
}

export async function rutPhanAnhAction(input: unknown): Promise<Res> {
  const p = z.object({ id: z.string().min(1) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  try {
    await rutPhanAnh({ id: p.data.id, userId: session.user.id });
  } catch (e) {
    if (e instanceof LoiPhanAnh) return { ok: false, error: e.message };
    return { ok: false, error: "Không rút được — thử lại." };
  }
  revalidatePath(TRANG);
  return { ok: true, message: "Đã rút phản ánh." };
}
