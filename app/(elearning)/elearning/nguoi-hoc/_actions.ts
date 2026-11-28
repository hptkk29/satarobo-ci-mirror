"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { actionFail, type ActionResult } from "@/lib/actions/factory";
import { isElearningEnabled } from "@/lib/flags";
import { coSoCuaPhamVi, loaiQuyenBaoCao } from "@/lib/elearning/report-scope";
import { nhacHocNguoi, TRAN_NHAC_HOC, type KetQuaNhacHoc } from "@/lib/elearning/nhac-hoc";

/**
 * P7 — "Nhắc học" (một người hoặc nhiều người đã chọn). Cố ý mỏng: luật + ghi nằm ở `lib/elearning/nhac-hoc.ts`.
 *
 * Gác: phiên → cờ e-learning → quyền xem tiến độ (`view-all` hoặc `view-team`, cùng cổng với trang Người học) → phạm vi cơ sở
 * (tường minh, không chỉ `scopedDb` — xem `report-scope.ts`). Danh sách id từ client KHÔNG phải nguồn tin cậy.
 * ⚠️ Tệp `"use server"` chỉ export HÀM async.
 */
const dauVao = z.object({ userIds: z.array(z.string().min(1)).min(1).max(TRAN_NHAC_HOC) }).strict();

export async function nhacHocAction(input: unknown): Promise<ActionResult<KetQuaNhacHoc>> {
  const session = await auth();
  if (!session?.user?.id) return actionFail("AUTH", "Chưa đăng nhập");
  if (!isElearningEnabled()) return actionFail("NOT_FOUND", "Không tìm thấy");
  const actor = await resolveActor(session.user.id);
  const loai = loaiQuyenBaoCao(actor);
  if (!loai) return actionFail("PERMISSION_DENIED", "Bạn không có quyền nhắc học");
  const p = dauVao.safeParse(input);
  if (!p.success) return actionFail("VALIDATION", p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
  const data = await nhacHocNguoi({
    sdb: scopedDb(actor),
    coSo: coSoCuaPhamVi(loai, actor),
    userIds: p.data.userIds,
    nguoiGui: { id: session.user.id, name: session.user.name ?? session.user.email ?? session.user.id },
  });
  revalidatePath("/elearning/nguoi-hoc");
  return { ok: true, data };
}
