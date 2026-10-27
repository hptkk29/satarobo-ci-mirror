"use server";

// Thao tác trên màn "Phân công giáo viên": "Đồng bộ lại tuần này" + quyết định trực khi có học bù (PR6, cuối tệp). "Đồng bộ lại tuần này" — gọi lại CHÍNH bộ đồng bộ Parttime cho các nguồn của
// tuần đang xem ở MỘT cơ sở (G1, docs/cham-cong/parttime/23-LUOI-PHAN-CONG-GV.md §3). Idempotent: nguồn đã đúng thì không ghi gì.
// Cổng: auth → `hr_attendance:assign` ở ĐÚNG cơ sở (client chỉ gửi id cơ sở; quyền tra lại ở server) → công tắc PHÂN CÔNG tại cơ sở.
// Chỉ [max(hôm nay, đầu tuần), cuối tuần]: buổi đã qua không dựng hồi tố (chốt 20/10/2026).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { congThaoTacParttime } from "@/lib/parttime/cong-tac";
import { nguonCanDoiSoat } from "@/lib/parttime/doi-soat-dong-bo";
import { dongBoNgay } from "@/lib/parttime/dong-bo";
import { vnYmd } from "@/lib/time/vn";
import { coSoCuaNguon, trongGiaoDich } from "@/lib/parttime/thao-tac";
import { chotTrucKhiCoBu } from "@/lib/parttime/truc-bu";

type Res = { ok: true; message: string } | { ok: false; error: string };

const vao = z.object({ centerId: z.string().min(1), tuan: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

const congNgay = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function dongBoLaiTuanAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  const p = vao.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const { centerId, tuan } = p.data;
  if (!(await checkPermission("hr_attendance:assign", { centerId }))) return { ok: false, error: "Bạn không có quyền phân công ở cơ sở này." };
  const ct = await congThaoTacParttime("STAFFING", { centerId }, "Phân công theo buổi chưa bật ở cơ sở này — chưa có gì để đồng bộ.");
  if (!ct.ok) return { ok: false, error: ct.error };

  const homNay = vnYmd(new Date());
  const den = congNgay(tuan, 6);
  const tu = tuan > homNay ? tuan : homNay;
  if (tu > den) return { ok: true, message: "Tuần này đã qua — buổi đã qua không đồng bộ lại tự động (đối soát lịch sử ở Phân công buổi)." };
  const nguon = await nguonCanDoiSoat({ tu, den, centerIds: [centerId] });
  const kq = await dongBoNgay(nguon, "DOI_SOAT_DINH_KY", { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản lý" });
  revalidatePath("/cham-cong/phan-cong-gv");
  if (kq.loi.length) return { ok: false, error: `Đã soát ${kq.soNguon} buổi; ${kq.loi.length} buổi lỗi khi đồng bộ — xem nhật ký hệ thống.` };
  return { ok: true, message: kq.soBuoc === 0 ? `Đã soát ${kq.soNguon} buổi — lưới đã khớp nguồn, không có gì thay đổi.` : `Đã soát ${kq.soNguon} buổi, cập nhật ${kq.soBuoc} phân công.` };
}

const quyetTruc = z.object({
  caseId: z.string().min(1),
  giu: z.boolean(),
  lyDo: z.string().trim().max(500).nullable(),
});

/**
 * PR6 (chủ dự án 24/10/2026): GV đang trực được book học bù — QLCS quyết "còn trực phần còn lại không" (ô lưới cảnh báo CAN_QUYET_TRUC).
 * Cổng: auth → `hr_attendance:assign` ở CƠ SỞ CỦA CASE (tra ở server từ caseId) → công tắc phân công tại cơ sở → `chotTrucKhiCoBu`
 * (đọc lại case + dòng trực, từ chối case chưa là lịch thật / ca đã kết thúc / bỏ trực thiếu lý do).
 */
export async function chotTrucBuAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  const p = quyetTruc.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const centerId = await coSoCuaNguon({ sourceType: "MAKEUP_CASE", sourceId: p.data.caseId });
  if (!centerId) return { ok: false, error: "Không tìm thấy case học bù." };
  if (!(await checkPermission("hr_attendance:assign", { centerId }))) return { ok: false, error: "Bạn không có quyền phân công ở cơ sở này." };
  const ct = await congThaoTacParttime("STAFFING", { centerId }, "Phân công theo buổi chưa bật ở cơ sở này.");
  if (!ct.ok) return { ok: false, error: ct.error };
  const actor = { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản lý" };
  try {
    const r = await trongGiaoDich((tx) => chotTrucKhiCoBu(tx, { caseId: p.data.caseId, giu: p.data.giu, lyDo: p.data.lyDo, actor, now: new Date() }));
    if (!r.ok) return { ok: false, error: r.loi };
    revalidatePath("/cham-cong/phan-cong-gv");
    revalidatePath("/cham-cong/phan-cong");
    return { ok: true, message: p.data.giu ? "Đã ghi: GV tiếp tục trực phần còn lại — ô thành TD." : "Đã kết thúc trực ca này — ô thành D, không còn tiền trực." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không thực hiện được — thử lại." };
  }
}
