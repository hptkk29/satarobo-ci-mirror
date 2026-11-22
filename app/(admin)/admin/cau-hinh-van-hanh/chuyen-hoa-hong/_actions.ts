"use server";
// Server Action của trang «Chuyển sang hoa hồng mới» (hướng D+H, đợt UAT cutover). MỎNG có chủ đích: auth → quyền → xác thực đầu vào → điều phối (`lib/hoa-hong/cutover-hanh-dong`).
// Mọi luật (cổng mốc, precheck, so bóng, compare-and-set, audit) nằm ở `lib/hoa-hong/cutover*.ts` — action KHÔNG viết lại.
//
// Khuôn mỗi action (luật cứng Nền Hệ thống #1 — kiểm quyền NGAY ĐẦU hàm, trước khi chạm bất cứ thứ gì):
//   1. auth()  2. assertPermission(<khoá>)  3. zod  4. (xác nhận) resolveActor  5. gọi điều phối.
// HAI khoá, mỗi khoá đúng MỘT nơi vẽ nút (luật 12):
//   · XEM TRƯỚC  → `settings:view` (khoá của cả trang; PAGE_GATES) — nút «Xem trước» chỉ vẽ cho người giữ khoá này.
//   · XÁC NHẬN   → `settings:edit` — nút «Đặt mốc» chỉ vẽ cho người giữ khoá này. Cùng một câu hỏi với `datMocCutover` (`isSuperAdmin`): ma trận v1 khai cả hai chỉ SUPER_ADMIN và
//                  không RoleDef nào của seed giữ `settings:edit`, nên nút / action / hàm ghi không thể lệch nhau (đo bằng `[CUT-W1]`).
// Client KHÔNG BAO GIỜ ghi mốc: nó chỉ gửi những gì nó ĐÃ XEM; server tính lại bằng chứng rồi so (compare-and-set).
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { assertPermission } from "@/lib/auth/check-permission";
import { xacNhanCutover, xemTruocCutover, type KetQua, type XemTruoc } from "@/lib/hoa-hong/cutover-hanh-dong";
import type { KetQuaDatMoc } from "@/lib/hoa-hong/cutover";

const CHUA_DANG_NHAP = "Chưa đăng nhập.";
const DAU_VAO_SAI = "Yêu cầu không hợp lệ — tải lại trang rồi thử lại.";

const thangSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const ngaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cuaSoSchema = z.object({ tuNgay: ngaySchema, denNgay: ngaySchema });

type Loi = { ok: false; ma: string; loi: string };
const tuChoi = (ma: string, loi: string): Loi => ({ ok: false, ma, loi });

export async function xemTruocCutoverAction(vao: { moi: string | null; tuNgay: string; denNgay: string }): Promise<KetQua<{ xem: XemTruoc }>> {
  const session = await auth();
  if (!session?.user) return tuChoi("CHUA_DANG_NHAP", CHUA_DANG_NHAP);
  try {
    await assertPermission("settings:view");
  } catch {
    return tuChoi("KHONG_QUYEN", "Bạn không có quyền xem trang chuyển hoa hồng (settings:view).");
  }
  const p = z.object({ moi: thangSchema.nullable() }).merge(cuaSoSchema).safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  return xemTruocCutover({ moi: p.data.moi, now: new Date(), cuaSo: { tuNgay: p.data.tuNgay, denNgay: p.data.denNgay } });
}

/**
 * Xác nhận đặt / dời / gỡ mốc. `cuDaXem` + `dauVanDaXem` + cửa sổ = CHÍNH cái người dùng đã xem ở bước trước; server nạp lại bằng chứng và so trong khoá độc quyền
 * (lệch ⇒ `MOC_DA_DOI` / `SO_LIEU_DA_DOI`, không ghi gì).
 */
export async function xacNhanCutoverAction(vao: {
  moi: string | null;
  lyDo: string;
  tuNgay: string;
  denNgay: string;
  cuDaXem: string | null;
  dauVanDaXem: string;
}): Promise<KetQua<{ ketQua: KetQuaDatMoc }>> {
  const session = await auth();
  if (!session?.user) return tuChoi("CHUA_DANG_NHAP", CHUA_DANG_NHAP);
  try {
    await assertPermission("settings:edit");
  } catch {
    return tuChoi("KHONG_QUYEN", "Bạn không có quyền đặt mốc chuyển hoa hồng (settings:edit).");
  }
  const p = z
    .object({ moi: thangSchema.nullable(), lyDo: z.string().max(1000), cuDaXem: thangSchema.nullable(), dauVanDaXem: z.string().min(1).max(128) })
    .merge(cuaSoSchema)
    .safeParse(vao);
  if (!p.success) return tuChoi("DAU_VAO_SAI", DAU_VAO_SAI);
  const actor = await resolveActor(session.user.id);
  const r = await xacNhanCutover(
    { actor, ten: session.user.name ?? session.user.email ?? session.user.id },
    { moi: p.data.moi, lyDo: p.data.lyDo, now: new Date(), cuaSo: { tuNgay: p.data.tuNgay, denNgay: p.data.denNgay }, cuDaXem: p.data.cuDaXem, dauVanDaXem: p.data.dauVanDaXem },
  );
  if (r.ok) {
    revalidatePath("/cau-hinh-van-hanh/chuyen-hoa-hong");
    // Cờ «có mốc hay chưa» đổi ⇒ tab Kỳ / Sổ của module Nguồn & hoa hồng đổi theo.
    revalidatePath("/nguon-hoa-hong", "layout");
  }
  return r;
}
