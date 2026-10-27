"use server";

// Thao tác Rank lương / chứng nhận Trial / chính sách hỗ trợ Trial (docs/cham-cong/parttime/23-LUOI-PHAN-CONG-GV.md §5–§6) — dùng chung cho
// màn Rank giáo viên, khối "Rank lương" trong hồ sơ GV và danh mục "Đơn giá Parttime" (cùng một dialog `rank-dialog.tsx`). Mỗi action:
//   auth → quyền ĐÚNG LOẠI (đổi Rank · chứng nhận · chính sách) → zod → dịch vụ `lib/parttime/rank-trial-db.ts` trong MỘT giao dịch →
//   revalidate. Chốt 25/10/2026: chỉ Giám đốc · QTTC · Đào tạo đổi Rank và đổi là áp ngay — bỏ đề xuất / chờ người khác duyệt.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { capChungNhan, datChinhSachTrial, doiRank, thuHoiChungNhan } from "@/lib/parttime/rank-trial-db";
import { coSoCuaGiaoVien } from "@/lib/parttime/rank-don-gia-db";
import { trongGiaoDich } from "@/lib/parttime/thao-tac";

type Res = { ok: true; message: string } | { ok: false; error: string };
const BASE = "/teachers/rank";
/** Mọi nơi hiển thị Rank / chứng nhận / chính sách: màn Rank, hồ sơ GV (mọi id — đề xuất chỉ mang id đề xuất), danh mục đơn giá, lưới. */
function lamMoi() {
  revalidatePath(BASE);
  revalidatePath("/teachers/[id]", "page");
  revalidatePath("/teachers");
  revalidatePath("/cham-cong/don-gia-parttime");
  revalidatePath("/cham-cong/phan-cong-gv");
}
const NGAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải dạng YYYY-MM-DD");

async function nguoi(): Promise<{ id: string; name: string } | null> {
  const s = await auth();
  return s?.user ? { id: s.user.id, name: s.user.name ?? s.user.email ?? "Người dùng" } : null;
}
// Hai người đổi Rank CÙNG ngày cùng lúc ⇒ khoá duy nhất (userId, effectiveFrom) chặn lượt sau bằng P2002 — nói đúng nguyên nhân, đừng "thử lại".
const loiCua = (e: unknown) =>
  (e instanceof Error && e.message === "RANK_TRUNG_NGAY") || (typeof e === "object" && e != null && (e as { code?: unknown }).code === "P2002")
    ? "Giáo viên đã có một Rank khác hiệu lực đúng ngày này (có thể vừa được người khác đổi) — tải lại trang."
    : "Có lỗi khi lưu — thử lại.";

/** Đổi Rank — chốt 25/10/2026: CHỈ Giám đốc · Quản trị tối cao · Đào tạo (`parttime_rank:approve`), áp ngay từ ngày hiệu lực. */
export async function doiRankAction(input: unknown): Promise<Res> {
  const a = await nguoi();
  if (!a) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!(await checkPermission("parttime_rank:approve"))) return { ok: false, error: "Chỉ Giám đốc · Quản trị tối cao · Đào tạo được đổi Rank." };
  const p = z.object({ userId: z.string().min(1), rank: z.coerce.number().int(), effectiveFrom: NGAY, lyDo: z.string().max(2000) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  // Cơ sở của GV đọc ở máy chủ (không tin client) — dùng để kiểm kỳ công đã khoá ở mọi nơi người đó dạy.
  const coSoIds = await coSoCuaGiaoVien(p.data.userId, new Date());
  if (coSoIds === null) return { ok: false, error: "Không tìm thấy giáo viên này." };
  try {
    const r = await trongGiaoDich((tx) => doiRank(tx, { ...p.data, coSoIds, actor: a, now: new Date() }));
    if (!r.ok) return { ok: false, error: r.loi };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
  lamMoi();
  return { ok: true, message: `Đã đổi sang Rank ${p.data.rank} — có hiệu lực từ ngày đã chọn.` };
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
  lamMoi();
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
  lamMoi();
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
  lamMoi();
  return { ok: true, message: "Đã lưu chính sách hỗ trợ Trial — áp từ ngày hiệu lực, không hồi tố." };
}
