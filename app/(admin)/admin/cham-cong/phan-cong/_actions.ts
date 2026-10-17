"use server";

// Thao tác của QLCS trên màn "Phân công buổi" (SR.QD.238 · P2). Mỗi action:
//   auth → hỏi `hr_attendance:assign` Ở ĐÚNG CƠ SỞ CỦA BUỔI (tra từ DB, không tin client) → công tắc bật → dịch vụ
//   `lib/parttime/phan-cong-db.ts` trong MỘT giao dịch → thông báo SAU commit → revalidate.
// Không có action "xác nhận thay": nhận/từ chối là việc của chính người được phân (site giáo viên).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  datYeuCauTroGiang,
  dungPhanCongMacDinh,
  huyPhanCong,
  nhacXacNhan,
  phanCongBat,
  phanCongVaoBuoi,
  thayGiaoVienChinh,
  type ThongBaoPhanCong,
} from "@/lib/parttime/phan-cong-db";
import { guiThongBaoPhanCong } from "@/lib/parttime/thong-bao";
import { xacNhanThucHien } from "@/lib/parttime/workunit-db";
import { coSoCuaLop, coSoCuaNguon, coSoCuaPhanCong, trongGiaoDich } from "@/lib/parttime/thao-tac";

type Res = { ok: true; message?: string } | { ok: false; error: string };

const ASSIGN = "hr_attendance:assign";
const BASE = "/cham-cong/phan-cong";
const CHUA_BAT = "Phân công theo buổi chưa bật. Quản trị bật ở Cấu hình vận hành → Chấm công (“Bật phân công theo buổi…”).";

const nguon = z.object({
  sourceType: z.enum(["CLASS_SESSION", "MAKEUP_CASE", "TRIAL_SESSION"]),
  sourceId: z.string().min(1),
});
const lyDo = z.string().trim().min(5, "Ghi lý do (tối thiểu 5 ký tự)").max(500);

/** Cổng chung: đăng nhập + quyền phân ca ở cơ sở `centerId` + công tắc. */
async function cong(centerId: string | null): Promise<{ ok: true; actor: { id: string; name: string } } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!centerId) return { ok: false, error: "Không tìm thấy buổi / lớp." };
  if (!(await checkPermission(ASSIGN, { centerId }))) return { ok: false, error: "Bạn không có quyền phân công ở cơ sở này." };
  if (!(await phanCongBat())) return { ok: false, error: CHUA_BAT };
  return { ok: true, actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản lý" } };
}

async function xong(thongBao: ThongBaoPhanCong[], actorId: string, message?: string): Promise<Res> {
  await guiThongBaoPhanCong(thongBao, actorId);
  revalidatePath(BASE);
  return { ok: true, message };
}

const loiCua = (e: unknown) => (e instanceof Error ? e.message : "Không thực hiện được — thử lại.");

/** Phân một người vào vai còn trống của buổi (MAIN hoặc TA). */
export async function phanCongAction(input: unknown): Promise<Res> {
  const p = nguon.extend({ userId: z.string().min(1), role: z.enum(["MAIN_TEACHER", "TEACHING_ASSISTANT"]) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const n = { sourceType: p.data.sourceType, sourceId: p.data.sourceId };
  const g = await cong(await coSoCuaNguon(n));
  if (!g.ok) return g;
  try {
    const r = await trongGiaoDich((tx) => phanCongVaoBuoi(tx, { nguon: n, userId: p.data.userId, role: p.data.role, assignmentType: "MANUAL", actor: g.actor }));
    if (!r.ok) return { ok: false, error: r.loi };
    return xong(r.thongBao, g.actor.id, r.moi ? "Đã phân công — chờ người được phân xác nhận." : "Người này đã được phân vai này rồi.");
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

/** Đổi giáo viên đứng chính: phân công cũ ⇒ bị thay, người mới chờ xác nhận. */
export async function doiGvChinhAction(input: unknown): Promise<Res> {
  const p = nguon.extend({ userId: z.string().min(1), lyDo }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const n = { sourceType: p.data.sourceType, sourceId: p.data.sourceId };
  const g = await cong(await coSoCuaNguon(n));
  if (!g.ok) return g;
  try {
    const r = await trongGiaoDich((tx) => thayGiaoVienChinh(tx, { nguon: n, gvMoiId: p.data.userId, actor: g.actor, sourceWorkRequestId: null, lyDo: p.data.lyDo }));
    if (!r.ok) return { ok: false, error: r.loi };
    return xong(r.thongBao, g.actor.id, "Đã đổi giáo viên — chờ người mới xác nhận.");
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

/** Huỷ một phân công còn sống (bắt buộc lý do). */
export async function huyPhanCongAction(input: unknown): Promise<Res> {
  const p = z.object({ assignmentId: z.string().min(1), lyDo }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const g = await cong(await coSoCuaPhanCong(p.data.assignmentId));
  if (!g.ok) return g;
  try {
    const r = await trongGiaoDich((tx) => huyPhanCong(tx, { id: p.data.assignmentId, actor: g.actor, lyDo: p.data.lyDo }));
    if (!r.ok) return { ok: false, error: r.loi };
    return xong(r.thongBao, g.actor.id, "Đã huỷ phân công.");
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

/** QLCS quyết lớp có BẮT BUỘC trợ giảng không (ghi đè PL02, bắt buộc lý do). */
export async function datYeuCauTaAction(input: unknown): Promise<Res> {
  const p = z.object({ classId: z.string().min(1), taRequired: z.boolean(), lyDo }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const g = await cong(await coSoCuaLop(p.data.classId));
  if (!g.ok) return g;
  try {
    const r = await trongGiaoDich((tx) => datYeuCauTroGiang(tx, { classId: p.data.classId, taRequired: p.data.taRequired, lyDo: p.data.lyDo, actor: g.actor }));
    if (!r.ok) return { ok: false, error: r.loi };
    return xong([], g.actor.id, p.data.taRequired ? "Lớp này nay BẮT BUỘC trợ giảng." : "Lớp này nay KHÔNG bắt buộc trợ giảng.");
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

/** Dựng phân công từ giáo viên / trợ giảng mặc định của lớp cho các buổi đã chọn (idempotent). */
export async function dungMacDinhAction(input: unknown): Promise<Res> {
  const p = z.object({ buoi: z.array(nguon).min(1).max(200) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const thongBao: ThongBaoPhanCong[] = [];
  let soTao = 0;
  let actorId = "";
  for (const n of p.data.buoi) {
    const g = await cong(await coSoCuaNguon(n));
    if (!g.ok) return soTao > 0 ? { ok: false, error: `Đã dựng ${soTao} phân công, rồi dừng: ${g.error}` } : g;
    actorId = g.actor.id;
    try {
      const r = await trongGiaoDich((tx) => dungPhanCongMacDinh(tx, { nguon: n, actor: g.actor }));
      soTao += r.soTao;
      thongBao.push(...r.thongBao);
    } catch (e) {
      return { ok: false, error: `Đã dựng ${soTao} phân công, rồi dừng: ${loiCua(e)}` };
    }
  }
  return xong(thongBao, actorId, soTao > 0 ? `Đã dựng ${soTao} phân công từ giáo viên/trợ giảng của lớp.` : "Không có vai nào cần dựng.");
}

/** Gửi lại nhắc xác nhận cho MỘT phân công đang chờ nhận (không đổi trạng thái, không nhận thay). */
export async function nhacLaiAction(input: unknown): Promise<Res> {
  const p = z.object({ assignmentId: z.string().min(1) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const g = await cong(await coSoCuaPhanCong(p.data.assignmentId));
  if (!g.ok) return g;
  try {
    const r = await trongGiaoDich((tx) => nhacXacNhan(tx, { id: p.data.assignmentId, actor: g.actor }));
    if (!r.ok) return { ok: false, error: r.loi };
    return xong(r.thongBao, g.actor.id, "Đã gửi lại nhắc xác nhận.");
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

// ─── P5a · QLCS xác nhận "đã thực hiện" (sinh WorkUnit) ─────────────────────────────────────
// Cổng: cùng `cong()` (quyền phân công Ở CƠ SỞ CỦA BUỔI + công tắc). Payload mang phiên bản + dấu vân QLCS ĐÃ XEM; máy chủ
// tính lại bằng chứng P4 và từ chối khi lệch. Không tin cờ "sạch" của client: xếp loại chạy lại ở máy chủ (`xetUngVien`).

const muc = z.object({ assignmentId: z.string().min(1), phienBanDaXem: z.number().int().min(1), dauVanDaXem: z.string().min(1) });

/** Xác nhận / từ chối / cần bổ sung cho MỘT phân công. */
export async function xacNhanThucHienAction(input: unknown): Promise<Res> {
  const p = muc
    .extend({ quyetDinh: z.enum(["CONFIRMED", "REJECTED", "NEEDS_INFO"]), lyDo: z.string().trim().max(500).optional() })
    .safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const g = await cong(await coSoCuaPhanCong(p.data.assignmentId));
  if (!g.ok) return g;
  try {
    const r = await xacNhanThucHien({ ...p.data, lyDo: p.data.lyDo ?? null, hangLoat: false, actor: g.actor, now: new Date() });
    if (!r.ok) return { ok: false, error: r.loi };
    revalidatePath(BASE);
    return { ok: true, message: p.data.quyetDinh === "CONFIRMED" ? (r.daCo ? "Đã xác nhận từ trước." : "Đã xác nhận thực hiện.") : "Đã ghi quyết định." };
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

/** Xác nhận HÀNG LOẠT — chỉ dòng SẠCH (máy chủ xếp lại); dòng có ngoại lệ bị trả về để xem từng dòng. Kết quả từng mục.
 *  Quyền hỏi TỪNG MỤC ở cơ sở CỦA BUỔI tra từ DB (không nhận cơ sở từ client). */
export async function xacNhanHangLoatAction(input: unknown): Promise<Res & { ketQua?: { assignmentId: string; ok: boolean; loi?: string }[] }> {
  const p = z.object({ muc: z.array(muc).min(1).max(300) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const now = new Date();
  const ketQua: { assignmentId: string; ok: boolean; loi?: string }[] = [];
  for (const m of p.data.muc) {
    const g = await cong(await coSoCuaPhanCong(m.assignmentId));
    if (!g.ok) {
      ketQua.push({ assignmentId: m.assignmentId, ok: false, loi: g.error });
      continue;
    }
    try {
      const r = await xacNhanThucHien({ ...m, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: true, actor: g.actor, now });
      ketQua.push(r.ok ? { assignmentId: m.assignmentId, ok: true } : { assignmentId: m.assignmentId, ok: false, loi: r.loi });
    } catch (e) {
      ketQua.push({ assignmentId: m.assignmentId, ok: false, loi: loiCua(e) });
    }
  }
  revalidatePath(BASE);
  const dat = ketQua.filter((k) => k.ok).length;
  return { ok: true, message: `Đã xác nhận ${dat}/${ketQua.length} dòng.`, ketQua };
}
