"use server";

// Màn "Rank & Đơn giá giáo viên" (lưới phân công GV · PR4, docs/cham-cong/parttime/23-LUOI-PHAN-CONG-GV.md §5–§6). Mỗi action:
//   auth → quyền ĐÚNG LOẠI (đề xuất theo cơ sở · duyệt · chứng nhận · chính sách) → zod → dịch vụ `lib/parttime/rank-trial-db.ts` trong
//   MỘT giao dịch → revalidate. SR.QD.238 §3: QLCS ĐỀ XUẤT, Ban lãnh đạo DUYỆT — người lập không tự duyệt (luật ở `kiemQuyetRank`).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { capChungNhan, datChinhSachTrial, deXuatRank, quyetRank, thuHoiChungNhan } from "@/lib/parttime/rank-trial-db";
import { trongGiaoDich } from "@/lib/parttime/thao-tac";
import { laGiaoVienCuaCoSo } from "@/lib/teachers/giao-vien-co-so";

type Res = { ok: true; message: string } | { ok: false; error: string };
const BASE = "/nhan-su/rank-gv";
const NGAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải dạng YYYY-MM-DD");

async function nguoi(): Promise<{ id: string; name: string } | null> {
  const s = await auth();
  return s?.user ? { id: s.user.id, name: s.user.name ?? s.user.email ?? "Người dùng" } : null;
}
const loiCua = (e: unknown) => (e instanceof Error && e.message === "RANK_TRUNG_NGAY" ? "Giáo viên đã có một Rank khác hiệu lực đúng ngày này." : "Có lỗi khi lưu — thử lại.");

export async function deXuatRankAction(input: unknown): Promise<Res> {
  const a = await nguoi();
  if (!a) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  const p = z
    .object({ userId: z.string().min(1), centerId: z.string().min(1), proposedRank: z.coerce.number().int(), effectiveFrom: NGAY, basis: z.string().max(2000) })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (!(await checkPermission("parttime_rank:propose", { centerId: p.data.centerId }))) return { ok: false, error: "Bạn không có quyền đề xuất Rank ở cơ sở này." };
  // Chỉ đề xuất cho giáo viên CỦA cơ sở mình — cùng hàm với danh sách trên màn (không tin client).
  if (!(await laGiaoVienCuaCoSo(p.data.userId, [p.data.centerId]))) return { ok: false, error: "Người này không phải giáo viên của cơ sở đã chọn." };
  try {
    const r = await trongGiaoDich((tx) => deXuatRank(tx, { ...p.data, actor: a, now: new Date() }));
    if (!r.ok) return { ok: false, error: r.loi };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
  revalidatePath(BASE);
  return { ok: true, message: "Đã gửi đề xuất Rank — chờ Ban lãnh đạo duyệt. Giá chưa đổi." };
}

export async function quyetRankAction(input: unknown): Promise<Res> {
  const a = await nguoi();
  if (!a) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!(await checkPermission("parttime_rank:approve"))) return { ok: false, error: "Chỉ Ban lãnh đạo duyệt / từ chối đề xuất Rank." };
  const p = z.object({ id: z.string().min(1), duyet: z.boolean(), ghiChu: z.string().max(1000).nullable() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  try {
    const r = await trongGiaoDich((tx) => quyetRank(tx, { ...p.data, actor: a, now: new Date() }));
    if (!r.ok) return { ok: false, error: r.loi };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
  revalidatePath(BASE);
  return { ok: true, message: p.data.duyet ? "Đã duyệt — Rank mới có hiệu lực từ ngày trong đề xuất." : "Đã từ chối đề xuất." };
}

export async function capChungNhanAction(input: unknown): Promise<Res> {
  const a = await nguoi();
  if (!a) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!(await checkPermission("trial_cert:manage"))) return { ok: false, error: "Chỉ Phòng Đào tạo Hội sở cấp chứng nhận Trial." };
  const p = z.object({ userId: z.string().min(1), code: z.string().max(100).nullable(), effectiveFrom: NGAY, note: z.string().max(1000).nullable() }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    const r = await trongGiaoDich((tx) => capChungNhan(tx, { ...p.data, actor: a, now: new Date() }));
    if (!r.ok) return { ok: false, error: r.loi };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
  revalidatePath(BASE);
  return { ok: true, message: "Đã cấp chứng nhận Trial." };
}

export async function thuHoiChungNhanAction(input: unknown): Promise<Res> {
  const a = await nguoi();
  if (!a) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!(await checkPermission("trial_cert:manage"))) return { ok: false, error: "Chỉ Phòng Đào tạo Hội sở thu hồi chứng nhận Trial." };
  const p = z.object({ id: z.string().min(1), tuNgay: NGAY, lyDo: z.string().max(1000) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    const r = await trongGiaoDich((tx) => thuHoiChungNhan(tx, { ...p.data, actor: a, now: new Date() }));
    if (!r.ok) return { ok: false, error: r.loi };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
  revalidatePath(BASE);
  return { ok: true, message: "Đã thu hồi — buổi Trial trước ngày thu hồi vẫn được tính." };
}

export async function datChinhSachTrialAction(input: unknown): Promise<Res> {
  const a = await nguoi();
  if (!a) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!(await checkPermission("parttime_policy:manage"))) return { ok: false, error: "Chỉ Hội sở (Nhân sự / Kế toán) đặt chính sách hỗ trợ Trial." };
  const p = z
    .object({ centerId: z.string().min(1).nullable(), enabled: z.boolean(), amountPerStudent: z.coerce.number().int(), effectiveFrom: NGAY, reason: z.string().max(2000) })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    const r = await trongGiaoDich((tx) => datChinhSachTrial(tx, { ...p.data, actor: a, now: new Date() }));
    if (!r.ok) return { ok: false, error: r.loi };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
  revalidatePath(BASE);
  revalidatePath("/cham-cong/phan-cong-gv");
  return { ok: true, message: "Đã lưu chính sách hỗ trợ Trial — áp từ ngày hiệu lực, không hồi tố." };
}
