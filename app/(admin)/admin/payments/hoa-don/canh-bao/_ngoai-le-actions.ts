"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { laHubQuetBat } from "@/lib/finance/hoa-don/feature";
import { xuLyNgoaiLe } from "@/lib/finance/hoa-don/ngoai-le-db";

// Xử lý ngoại lệ hoá đơn (lát S12, Invoice Hub). Quyền DÙNG LẠI `payments:confirm` (TD-07) — không đẻ quyền mới. Action là LỚP NGOÀI: kiểm sớm để báo rõ; dịch vụ
// (`ngoai-le-db.ts`) kiểm LẠI phạm vi cơ sở trên dòng đọc lại từ DB, vì phạm vi theo từng ngoại lệ, không phải theo người gọi. Cờ scanner TẮT ⇒ từ chối, không hỏi phiên.
// ⚠️ Không có action nào "sửa nội dung" ngoại lệ, và không action nào chạm hoá đơn / sổ tiền: chỉ ba bước của máy trạng thái (nhận · đã xử lý · bỏ qua).

type KetQua = { ok: true; data: { id: string; trangThai: string } } | { ok: false; error: string; ma?: string };

const schema = z.object({
  id: z.string().min(1).max(64),
  hanhDong: z.enum(["NHAN_XU_LY", "DA_XU_LY", "BO_QUA"]),
  lyDo: z.string().max(500),
});

export async function xuLyNgoaiLeAction(input: unknown): Promise<KetQua> {
  if (!(await laHubQuetBat())) return { ok: false, error: "Khu ngoại lệ hoá đơn chưa được bật" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:confirm"))) {
    return { ok: false, error: "Không có quyền — cần quyền xác nhận khoản thu (payments:confirm)" };
  }
  try {
    const actor = await resolveActor(session.user.id);
    const kq = await xuLyNgoaiLe({
      actor,
      ten: session.user.name ?? session.user.email ?? session.user.id,
      id: p.data.id,
      hanhDong: p.data.hanhDong,
      lyDo: p.data.lyDo,
    });
    if (!kq.ok) return { ok: false, error: kq.error, ma: kq.ma };
    revalidatePath("/payments/hoa-don/canh-bao");
    return { ok: true, data: { id: kq.id, trangThai: kq.trangThai } };
  } catch {
    // Không đưa nội dung lỗi (có thể mang địa chỉ máy chủ / câu SQL) ra trình duyệt.
    return { ok: false, error: "Không xử lý được lúc này — thử lại sau ít phút; nếu vẫn lỗi, báo bộ phận kỹ thuật." };
  }
}
