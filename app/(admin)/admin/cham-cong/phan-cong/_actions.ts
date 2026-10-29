"use server";

// Thao tác của QLCS trên màn "Phân công buổi" (SR.QD.238 · P2). Mỗi action:
//   auth → hỏi `hr_attendance:assign` Ở ĐÚNG CƠ SỞ CỦA BUỔI (tra từ DB, không tin client) → công tắc ĐÚNG LOẠI tại cơ sở đó
//   (STAFFING cho phân công · WORKUNIT_SHADOW cho xác nhận thực hiện; bật mà RBAC v1 ⇒ RBAC_V2_REQUIRED_FOR_PARTTIME) → dịch vụ
//   `lib/parttime/phan-cong-db.ts` trong MỘT giao dịch → thông báo SAU commit → revalidate.
// Không có action "xác nhận thay": nhận/từ chối là việc của chính người được phân (site giáo viên).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  dungPhanCongMacDinh,
  huyPhanCong,
  nhacXacNhan,
  phanCongVaoBuoi,
  thayGiaoVienChinh,
  type ThongBaoPhanCong,
} from "@/lib/parttime/phan-cong-db";
import { congThaoTacParttime } from "@/lib/parttime/cong-tac";
import type { LoaiCongTac } from "@/lib/parttime/cong-tac-thuan";
import { guiThongBaoPhanCong } from "@/lib/parttime/thong-bao";
import { xacNhanThucHien } from "@/lib/parttime/workunit-db";
import { coSoCuaNguon, coSoCuaPhanCong, laBuoiDaQuaCua, trongGiaoDich } from "@/lib/parttime/thao-tac";
import { suaBuoiDaQua } from "@/lib/parttime/sua-buoi-da-qua-db";
import { loadModuleScope } from "@/lib/cham-cong/module-scope";
import { laGiaoVienCuaCoSo } from "@/lib/teachers/giao-vien-co-so";
import { vnYmd } from "@/lib/time/vn";
import { ghiGvNguonGoc, ghiGvNguonGocNeuDungChinh } from "@/lib/phan-cong/giao-go-db";

type Res = { ok: true; message?: string } | { ok: false; error: string };

const ASSIGN = "hr_attendance:assign";
const BASE = "/cham-cong/phan-cong";
const CHUA_BAT: Record<LoaiCongTac, string> = {
  STAFFING: "Phân công theo buổi chưa bật ở cơ sở này. Quản trị bật ở Cấu hình vận hành → Chấm công (“Parttime: bật phân công buổi…”).",
  ATTENDANCE_CONTEXT: "Chấm công theo ngữ cảnh chưa bật ở cơ sở này.",
  WORKUNIT_SHADOW: "Đối soát Parttime chưa bật ở cơ sở này. Quản trị bật ở Cấu hình vận hành → Chấm công (“Parttime: bật đối soát…”).",
  COMPENSATION: "Công tắc tiền Parttime chưa bật ở cơ sở này.",
};

const nguon = z.object({
  sourceType: z.enum(["CLASS_SESSION", "MAKEUP_CASE", "TRIAL_SESSION"]),
  sourceId: z.string().min(1),
});
const lyDo = z.string().trim().min(5, "Ghi lý do (tối thiểu 5 ký tự)").max(500);

/** Cổng chung: đăng nhập + quyền phân ca ở cơ sở `centerId` + công tắc `loai` TẠI cơ sở đó. `loai` BẮT BUỘC (luật 7). */
async function cong(centerId: string | null, loai: LoaiCongTac): Promise<{ ok: true; actor: { id: string; name: string } } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Phiên đăng nhập đã hết — đăng nhập lại." };
  if (!centerId) return { ok: false, error: "Không tìm thấy buổi / lớp." };
  if (!(await checkPermission(ASSIGN, { centerId }))) return { ok: false, error: "Bạn không có quyền phân công ở cơ sở này." };
  const ct = await congThaoTacParttime(loai, { centerId }, CHUA_BAT[loai]);
  if (!ct.ok) return { ok: false, error: ct.error };
  return { ok: true, actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Quản lý" } };
}

async function xong(thongBao: ThongBaoPhanCong[], actorId: string, message?: string): Promise<Res> {
  await guiThongBaoPhanCong(thongBao, actorId);
  revalidatePath(BASE);
  return { ok: true, message };
}

/**
 * Người được phân phải là GIÁO VIÊN của cơ sở của buổi hoặc của một cơ sở khác người thao tác phân công được (điều chuyển — chủ dự
 * án 20/10/2026). CÙNG hàm với danh sách trên màn (`docGiaoVienCuaCoSo`) ⇒ màn bày ai thì nhận người đó, không hơn. Trước 20/10/2026
 * action nhận MỌI `userId` client gửi lên.
 */
async function kiemNguoiDuocPhan(userId: string, centerIdBuoi: string, actorId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const quanLy = (await loadModuleScope(actorId)).blocksWith(ASSIGN).map((b) => b.id);
  if (await laGiaoVienCuaCoSo(userId, [centerIdBuoi, ...quanLy])) return { ok: true };
  return { ok: false, error: "Người này không phải giáo viên của cơ sở bạn quản lý — chọn người trong danh sách." };
}

const loiCua = (e: unknown) => (e instanceof Error ? e.message : "Không thực hiện được — thử lại.");

/** Ba thao tác phân công thường KHÔNG chạm buổi đã qua — sửa buổi đã qua đi `suaBuoiDaQuaAction` (lý do + nhật ký). */
const DA_QUA = "Buổi đã qua — dùng “Sửa buổi đã qua” (bắt buộc lý do, có nhật ký gửi giáo viên liên quan).";

/** Phân một người vào vai còn trống của buổi (MAIN hoặc TA). */
export async function phanCongAction(input: unknown): Promise<Res> {
  const p = nguon.extend({ userId: z.string().min(1), role: z.enum(["MAIN_TEACHER", "TEACHING_ASSISTANT"]) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const n = { sourceType: p.data.sourceType, sourceId: p.data.sourceId };
  const centerId = await coSoCuaNguon(n);
  const g = await cong(centerId, "STAFFING");
  if (!g.ok) return g;
  if (await laBuoiDaQuaCua(n)) return { ok: false, error: DA_QUA };
  const kn = await kiemNguoiDuocPhan(p.data.userId, centerId!, g.actor.id);
  if (!kn.ok) return kn;
  try {
    // Học bù / Trial: đứng chính ghi CẢ cột GV gốc cùng giao dịch (chốt lượt 2 điểm 2 — `ghiGvNguonGoc`).
    const r = await trongGiaoDich(async (tx) => {
      await ghiGvNguonGocNeuDungChinh(tx, n, p.data.role, p.data.userId);
      return phanCongVaoBuoi(tx, { nguon: n, userId: p.data.userId, role: p.data.role, assignmentType: "MANUAL", nguonGiao: "TAY", actor: g.actor });
    });
    if (!r.ok) return { ok: false, error: r.loi };
    return xong(r.thongBao, g.actor.id, r.moi ? "Đã phân công — giáo viên được báo, không cần bấm nhận." : "Người này đã được phân vai này rồi.");
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

/** Đổi giáo viên đứng chính: phân công cũ ⇒ bị thay, người mới được gán thẳng. */
export async function doiGvChinhAction(input: unknown): Promise<Res> {
  const p = nguon.extend({ userId: z.string().min(1), lyDo }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const n = { sourceType: p.data.sourceType, sourceId: p.data.sourceId };
  const centerId = await coSoCuaNguon(n);
  const g = await cong(centerId, "STAFFING");
  if (!g.ok) return g;
  if (await laBuoiDaQuaCua(n)) return { ok: false, error: DA_QUA };
  const kn = await kiemNguoiDuocPhan(p.data.userId, centerId!, g.actor.id);
  if (!kn.ok) return kn;
  try {
    const r = await trongGiaoDich(async (tx) => {
      await ghiGvNguonGoc(tx, n, p.data.userId);
      return thayGiaoVienChinh(tx, { nguon: n, gvMoiId: p.data.userId, actor: g.actor, sourceWorkRequestId: null, lyDo: p.data.lyDo, nguonKhongDon: "TAY" });
    });
    if (!r.ok) return { ok: false, error: r.loi };
    return xong(r.thongBao, g.actor.id, "Đã đổi giáo viên — người mới được báo.");
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

/** Huỷ một phân công còn sống (bắt buộc lý do). */
export async function huyPhanCongAction(input: unknown): Promise<Res> {
  const p = z.object({ assignmentId: z.string().min(1), lyDo }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const g = await cong(await coSoCuaPhanCong(p.data.assignmentId), "STAFFING");
  if (!g.ok) return g;
  if (await laBuoiDaQuaCua({ assignmentId: p.data.assignmentId })) return { ok: false, error: DA_QUA };
  try {
    const r = await trongGiaoDich(async (tx) => {
      // Huỷ đứng chính học bù / Trial ⇒ cột GV gốc theo (học bù: chặn — case phải có GV; Trial: về trống nếu đúng người này).
      const a = await tx.sessionStaffAssignment.findUnique({ where: { id: p.data.assignmentId }, select: { sourceType: true, sourceId: true, role: true, userId: true } });
      if (a) await ghiGvNguonGocNeuDungChinh(tx, { sourceType: a.sourceType, sourceId: a.sourceId }, a.role, null, a.userId);
      return huyPhanCong(tx, { id: p.data.assignmentId, actor: g.actor, lyDo: p.data.lyDo });
    });
    if (!r.ok) return { ok: false, error: r.loi };
    return xong(r.thongBao, g.actor.id, "Đã huỷ phân công.");
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

/**
 * QLCS SỬA BUỔI ĐÃ QUA (chủ dự án 20/10/2026): GV đứng chính · trợ giảng · người thực dạy (buổi lớp đã chốt). Ô không gửi = không
 * đổi; gửi `null` = gỡ. Lý do bắt buộc, mỗi thay đổi một dòng nhật ký, chuông cho người cũ + người mới. Luật: `lib/parttime/sua-buoi-da-qua.ts`.
 */
export async function suaBuoiDaQuaAction(input: unknown): Promise<Res> {
  const nguoi = z.string().min(1).nullable().optional();
  const p = nguon.extend({ lyDo: z.string().trim().min(10, "Ghi lý do (tối thiểu 10 ký tự)").max(500), main: nguoi, ta: nguoi, thucDay: nguoi }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const n = { sourceType: p.data.sourceType, sourceId: p.data.sourceId };
  const centerId = await coSoCuaNguon(n);
  const g = await cong(centerId, "STAFFING");
  if (!g.ok) return g;
  for (const u of [p.data.main, p.data.ta, p.data.thucDay]) {
    if (!u) continue;
    const kn = await kiemNguoiDuocPhan(u, centerId!, g.actor.id);
    if (!kn.ok) return kn;
  }
  try {
    const r = await trongGiaoDich((tx) =>
      suaBuoiDaQua(tx, { nguon: n, actor: g.actor, lyDo: p.data.lyDo, homNay: vnYmd(new Date()), main: p.data.main, ta: p.data.ta, thucDay: p.data.thucDay }),
    );
    if (!r.ok) return { ok: false, error: r.loi };
    return xong(r.thongBao, g.actor.id, `Đã sửa ${r.soThayDoi} mục — giáo viên liên quan đã được báo kèm lý do.`);
  } catch (e) {
    return { ok: false, error: loiCua(e) };
  }
}

// `datYeuCauTaAction` (QLCS đặt lớp bắt buộc / không bắt buộc trợ giảng) ĐÃ GỠ 20/10/2026 — trợ giảng không còn bắt buộc
// (`yeuCauTroGiangThuan`, lib/parttime/phan-cong.ts). Để lại action là để lại một endpoint ghi một giá trị không còn tác dụng.

/** Dựng phân công từ giáo viên / trợ giảng mặc định của lớp cho các buổi đã chọn (idempotent). */
export async function dungMacDinhAction(input: unknown): Promise<Res> {
  const p = z.object({ buoi: z.array(nguon).min(1).max(200) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const thongBao: ThongBaoPhanCong[] = [];
  let soTao = 0;
  let soDaQua = 0;
  let actorId = "";
  const homNay = vnYmd(new Date());
  for (const n of p.data.buoi) {
    const g = await cong(await coSoCuaNguon(n), "STAFFING");
    if (!g.ok) return soTao > 0 ? { ok: false, error: `Đã dựng ${soTao} phân công, rồi dừng: ${g.error}` } : g;
    actorId = g.actor.id;
    try {
      const r = await trongGiaoDich((tx) => dungPhanCongMacDinh(tx, { nguon: n, actor: g.actor, homNay }));
      soTao += r.soTao;
      if (r.daQua) soDaQua++;
      thongBao.push(...r.thongBao);
    } catch (e) {
      return { ok: false, error: `Đã dựng ${soTao} phân công, rồi dừng: ${loiCua(e)}` };
    }
  }
  const boQua = soDaQua > 0 ? ` Bỏ qua ${soDaQua} buổi đã qua — không mời nhận lớp hồi tố.` : "";
  return xong(thongBao, actorId, (soTao > 0 ? `Đã dựng ${soTao} phân công từ giáo viên/trợ giảng của lớp.` : "Không có vai nào cần dựng.") + boQua);
}

/** Gửi lại nhắc xác nhận cho MỘT phân công đang chờ nhận (không đổi trạng thái, không nhận thay). */
export async function nhacLaiAction(input: unknown): Promise<Res> {
  const p = z.object({ assignmentId: z.string().min(1) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const g = await cong(await coSoCuaPhanCong(p.data.assignmentId), "STAFFING");
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
  const g = await cong(await coSoCuaPhanCong(p.data.assignmentId), "WORKUNIT_SHADOW");
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
    const g = await cong(await coSoCuaPhanCong(m.assignmentId), "WORKUNIT_SHADOW");
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
