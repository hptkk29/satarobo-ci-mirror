"use server";

// Người ĐƯỢC GIAO TRỰC tự nhận / từ chối (SR.QD.238 · P5b). `userId` lấy từ PHIÊN, không bao giờ từ client; dịch vụ còn kiểm
// "đúng người được giao" trong giao dịch. Không có quyền RBAC riêng: quyền là QUAN HỆ — chỉ chủ dòng trực quyết được.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { congThaoTacParttime } from "@/lib/parttime/cong-tac";
import { coSoCuaTruc, trongGiaoDich } from "@/lib/parttime/thao-tac";
import { quyetDinhTruc } from "@/lib/parttime/truc-van-hanh-db";

type Res = { ok: true; message: string } | { ok: false; error: string };

const schema = z.discriminatedUnion("quyetDinh", [
  z.object({ dutyId: z.string().min(1), phienBan: z.number().int().min(1), quyetDinh: z.literal("ACCEPTED") }),
  z.object({ dutyId: z.string().min(1), phienBan: z.number().int().min(1), quyetDinh: z.literal("DECLINED"), lyDo: z.string().trim().min(5, "Ghi lý do từ chối (tối thiểu 5 ký tự)").max(500) }),
]);

export async function quyetDinhTrucAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  // Nhận / từ chối trực là GHI ⇒ công tắc STAFFING tại cơ sở của dòng trực (tra từ DB) + RBAC v2.
  const ct = await congThaoTacParttime("STAFFING", { centerId: await coSoCuaTruc(p.data.dutyId) }, "Phân công theo buổi chưa bật ở cơ sở của ca trực này.");
  if (!ct.ok) return { ok: false, error: ct.error };
  const nguoiBam = { id: session.user.id, name: session.user.name ?? session.user.email ?? "Giáo viên" };
  try {
    const r = await trongGiaoDich((tx) =>
      quyetDinhTruc(tx, { dutyId: p.data.dutyId, nguoiBam, quyetDinh: p.data.quyetDinh, phienBanDaXem: p.data.phienBan, lyDo: p.data.quyetDinh === "DECLINED" ? p.data.lyDo : null, now: new Date() }),
    );
    if (!r.ok) return { ok: false, error: r.loi };
    revalidatePath("/teacher/phan-cong");
    return { ok: true, message: p.data.quyetDinh === "ACCEPTED" ? "Đã nhận trực." : "Đã từ chối trực — quản lý cơ sở sẽ xếp người khác." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không lưu được — thử lại." };
  }
}
