"use server";

// app/(admin)/admin/nguon-hoa-hong/nguon/_actions-gan-hang-loat.ts — Server Action «GÁN NGUỒN HÀNG LOẠT» cho HÀNG CHỜ NGUỒN (mọi vấn đề). File RIÊNG (không nằm trong `_actions.ts`).
//
// MỎNG: xác thực → quyền (`sources:manage`, gác Ở ĐẦU HÀM — đúng khoá mà trang dùng để vẽ nút) → cờ → gọi dịch vụ MỘT LÔ. Luật chọn lead · bỏ qua lead đã có tiền · ghi từng lead ở `lib/nguon/gan-nguon-hang-loat.ts`
// và `doiNguonLead` (quyền + cơ sở THEO TỪNG LEAD — nên không cần cổng «toàn hệ thống» như chụp lại chủ nguồn: lead cơ sở khác bị `doiNguonLead` từ chối, không bị sửa lén).
//
// Phạm vi lead (`pham`): các lead người dùng TICK (`ids`) hoặc cả bộ lọc đang xem (`loc`). Danh sách id KHÔNG phải quyền — `ganNguonMotLo` chỉ lấy GIAO của nó với hàng chờ nguồn trong tầm nhìn của chính người gọi. `chiXem` = xem trước (không ghi).
//
// ⚠️ KHÔNG `revalidatePath` ở đây (cùng lý do `chupLaiChuNguonAction`): action được gọi LẶP theo lô từ hộp thoại; làm mới trang giữa chừng gỡ hộp thoại. Nút tự `router.refresh()` khi đóng.
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import { ganNguonMotLo } from "@/lib/nguon/gan-nguon-hang-loat";
import { TOI_DA_ID_GAN, type KetQuaGanHangLoatAction } from "@/lib/nguon/gan-nguon-hang-loat-nhan";
import { LY_DO_HANG_CHO } from "@/lib/nguon/nhan-hien-thi";

// `ids` chỉ THU HẸP (máy chủ giao với hàng chờ của chính người bấm — xem `PhamViGan`); trần số id chặn cả độ dài yêu cầu.
const phamSchema = z.discriminatedUnion("kieu", [
  z.object({ kieu: z.literal("ids"), ids: z.array(z.string().trim().min(1).max(64)).min(1).max(TOI_DA_ID_GAN) }),
  z.object({ kieu: z.literal("loc"), lyDo: z.enum(LY_DO_HANG_CHO).nullable() }),
]);

const ganSchema = z.object({
  groupId: z.string().trim().min(1).max(64),
  lyDo: z.string().max(500).nullish(),
  coSoId: z.string().trim().min(1).max(64).nullable(),
  pham: phamSchema,
  conTro: z.string().trim().min(1).max(64).nullable(),
  chiXem: z.boolean(),
});

export async function ganNguonHangLoatAction(input: unknown): Promise<KetQuaGanHangLoatAction> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("sources:manage"))) {
    return { ok: false, error: "Không có quyền gán nguồn (sources:manage).", field: "quyen" };
  }
  const parsed = ganSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (!(await laQuanLyNguonBat())) return { ok: false, error: "Quản lý nguồn chưa được bật." };

  const actor = await resolveActor(session.user.id);
  const kq = await ganNguonMotLo({
    actor,
    actorName: session.user.name ?? session.user.email ?? "Nhân viên",
    kiemQuyen: (action, target) => checkPermission(action, target),
    groupId: parsed.data.groupId,
    lyDo: parsed.data.lyDo ?? null,
    coSoId: parsed.data.coSoId,
    pham: parsed.data.pham,
    conTro: parsed.data.conTro,
    chiXem: parsed.data.chiXem,
    bayGio: new Date(),
  });
  if (!kq.ok) return { ok: false, error: kq.loi, field: kq.truong };
  const { ok: _ok, ...lo } = kq;
  void _ok;
  return { ok: true, ...lo };
}
