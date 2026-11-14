"use server";
// Server Action của tab «Chia theo phường» (màn «Quản lý chia lead»).
//
// ⚠️ QUYỀN KIỂM Ở ĐÂY, không phải ở UI: ẩn tab chỉ là chuyện thẩm mỹ, Server Action là một endpoint riêng.
//
// HAI chế độ, chọn theo QUYỀN THẬT của người gọi (không theo tham số client):
//   · TOÀN HỆ THỐNG — giữ `leads:assign-config` ở MỌI cơ sở (`tamNhinCuaKhoa(...) === "ALL"`: Quản trị tối cao / Hội sở): sửa cả bảng + bật/tắt chia theo phường.
//   · CƠ SỞ CỦA MÌNH — Quản lý cơ sở (06/11/2026: «QLCS nào thì cấu hình được cho cơ sở đó»): giữ `lead_pool:manage` tại từng cơ sở; chỉ đặt/bỏ phường
//     cho CƠ SỞ MÌNH, KHÔNG giật phường của cơ sở khác, KHÔNG đụng công tắc. Không đẻ quyền mới (không phải chạy seed) — dùng đúng quyền mà màn này đã gác.
// `leads:assign-config` seed GLOBAL nên một Quản lý cơ sở được cấp nó vẫn qua `checkPermission`; vì vậy chế độ TOÀN HỆ THỐNG đo thêm tầm nhìn, và người
// chỉ có tầm một cơ sở rơi xuống chế độ CƠ SỞ (không bao giờ sửa được bảng của cơ sở khác) — đúng lỗ đã gặp ở `_actions.ts` (`coQuyenTaiCoSo`).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { tamNhinCuaKhoa } from "@/lib/auth/quyen-tai-co-so";
import { TOI_DA_DONG_MOT_LAN } from "@/lib/lead/chia-theo-phuong";
import { coSoCauHinhPhuongCuaToi, luuCauHinhPhuong, luuPhuongCuaCoSo, type KetQuaLuuPhuong } from "@/lib/lead/chia-theo-phuong-ghi";

const dauVao = z.object({
  bat: z.boolean(),
  thanhPho: z.string().trim().min(1).max(100),
  dong: z
    .array(z.object({ phuong: z.string().trim().min(1).max(120), coSoId: z.string().trim().min(1).max(64).nullable() }))
    .max(TOI_DA_DONG_MOT_LAN),
});

export async function luuChiaTheoPhuongAction(raw: unknown): Promise<KetQuaLuuPhuong> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const actor = await resolveActor(session.user.id);
  const toanHe = (await checkPermission("leads:assign-config")) && tamNhinCuaKhoa(actor, "leads:assign-config") === "ALL";
  if (!toanHe && !(await checkPermission("lead_pool:manage"))) return { ok: false, error: "Không có quyền" };

  const p = dauVao.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const nguoiLuu = { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản trị" };

  let kq: KetQuaLuuPhuong;
  if (toanHe) {
    kq = await luuCauHinhPhuong({ ...p.data, actor: nguoiLuu });
  } else {
    const cuaToi = await coSoCauHinhPhuongCuaToi(actor);
    if (cuaToi.length === 0) return { ok: false, error: "Bạn chưa quản lý cơ sở nào đang nhận lead." };
    // `p.data.bat` cố ý KHÔNG được chuyển đi: công tắc là việc của Quản trị.
    kq = await luuPhuongCuaCoSo({ thanhPho: p.data.thanhPho, dong: p.data.dong, coSoCuaToi: cuaToi.map((c) => c.id), actor: nguoiLuu });
  }
  if (kq.ok) revalidatePath("/admin/quan-ly-chia-lead");
  return kq;
}
