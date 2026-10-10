"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { Session } from "next-auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { kiemNhom } from "@/lib/hoc-bu/xep-case";
import { caseCungNhom, type DongCase } from "@/lib/hoc-bu/case-doc";
import {
  LoiHocBu,
  gvTrongCa,
  taoCaseVaXep,
  xepVaoCaseCoSan,
  goKhoiCase,
  diemDanhBu,
  huyCase,
  beDeNhanXet,
  taoPhiBu,
  mienPhiBu,
  type GvTrongCa,
} from "@/lib/hoc-bu/case-db";
import { vnYmd } from "@/lib/time/vn";
import { guiBaiKiemTraBu } from "@/lib/hoc-bu/tai-lieu-bu";
import { saveSessionEvalChoHocBu } from "@/app/(admin)/admin/sessions/[id]/_feedback-core";
import type { PhieuNhanXetGui } from "@/app/(teacher)/teacher/lop/_components/student-eval-dialog";

// Học bù đời mới (docs/hoc-bu/DAC-TA.md). Luồng cũ "xếp bé vào buổi của lớp khác" đã GỠ
// (chốt 10). Quyền hỏi ở ĐẦU mỗi action (layout gate chưa đủ — Server Action là endpoint riêng);
// luật nghiệp vụ + phép ghi ở `lib/hoc-bu/case-db.ts`.

type KetQua = { ok: true } | { ok: false; error: string };

type Ngu = { ok: true; actor: Actor; session: Session } | { ok: false; error: string };

async function cong(quyen: "makeup:manage" | "makeup:waive" | "makeup:attend"): Promise<Ngu> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(quyen))) {
    return {
      ok: false,
      error:
        quyen === "makeup:waive"
          ? "Chỉ Quản lý cơ sở / Admin được làm việc này"
          : quyen === "makeup:attend"
            ? "Chỉ quản lý / giáo viên được điểm danh và nhận xét buổi bù"
            : "Bạn không có quyền xếp học bù",
    };
  }
  return { ok: true, actor: await resolveActor(session.user.id), session };
}

function dichLoi(e: unknown): { ok: false; error: string } {
  if (e instanceof LoiHocBu) return { ok: false, error: e.message };
  console.error("[hoc-bu]", e);
  return { ok: false, error: "Có lỗi khi lưu — thử lại sau ít phút" };
}

function xong(caseId?: string): void {
  revalidatePath("/hoc-bu");
  if (caseId) revalidatePath(`/hoc-bu/case/${caseId}`);
}

async function ghiAudit(
  n: Extract<Ngu, { ok: true }>,
  p: { entityType: string; entityId: string; action: string; newValues?: Record<string, unknown>; reason?: string },
): Promise<void> {
  const { actorId, actorName } = getAuditActor(n.session);
  await writeAudit({ actor: { id: actorId, name: actorName }, module: "lms", ...p });
}

// ─── Huỷ không bù ─────────────────────────────────────────────────────────────

const lyDo = z
  .string()
  .trim()
  .min(LY_DO_TOI_THIEU, `Ghi lý do ít nhất ${LY_DO_TOI_THIEU} ký tự`)
  .max(500);
const huySchema = z.object({ id: z.string().min(1), lyDo });

/**
 * HUỶ = buổi đó nghỉ luôn, không bù nữa (chốt 9: QLCS + Admin — "Giám đốc" là vai Admin, chốt 30/09; bắt buộc lý do).
 * Dòng đã huỷ KHÔNG tự hồi sinh khi sửa điểm danh — `createMakeupNeed` tha `waivedAt`.
 */
export async function huyBuoiCanBuAction(input: { id: string; lyDo: string }): Promise<KetQua> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:waive"))) {
    return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được huỷ buổi cần bù" };
  }
  const p = huySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  // Chống IDOR ghi: đọc qua scopedDb — ngoài cơ sở của người bấm thì như không tồn tại.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const need = await sdb.makeupNeed.findUnique({
    where: { id: p.data.id },
    select: { id: true, status: true, waivedAt: true, orgUnitId: true, studentId: true, missedSessionId: true },
  });
  if (!need) return { ok: false, error: "Không tìm thấy buổi cần bù" };

  const now = new Date();
  // Ghi CÓ ĐIỀU KIỆN: hai người bấm cùng lúc thì chỉ một lượt ăn.
  const doi = await sdb.makeupNeed.updateMany({
    where: { id: need.id, status: "PENDING", waivedAt: null },
    data: {
      status: "CANCELLED",
      waivedAt: now,
      waivedById: session.user.id,
      waivedReason: p.data.lyDo,
    },
  });
  if (doi.count === 0) return { ok: false, error: "Buổi này đã được xử lý rồi — tải lại trang" };

  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "lms",
    entityType: "MakeupNeed",
    entityId: need.id,
    action: "UPDATE",
    oldValues: { status: need.status },
    newValues: { status: "CANCELLED", waivedAt: now.toISOString() },
    reason: p.data.lyDo,
    orgUnitId: need.orgUnitId,
  });

  revalidatePath("/hoc-bu");
  return { ok: true };
}

/**
 * KHÔI PHỤC buổi đã huỷ (phụ huynh đổi ý muốn bù) — cùng quyền với huỷ. Lý do huỷ cũ giữ lại
 * trong AuditLog; dòng quay về danh sách cần bù với lượt tính lại như thường.
 */
export async function khoiPhucBuoiCanBuAction(id: string): Promise<KetQua> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:waive"))) {
    return { ok: false, error: "Chỉ Quản lý cơ sở / Admin được khôi phục buổi đã huỷ" };
  }
  const sdb = scopedDb(await resolveActor(session.user.id));
  const need = await sdb.makeupNeed.findUnique({
    where: { id },
    select: { id: true, waivedReason: true, orgUnitId: true },
  });
  if (!need) return { ok: false, error: "Không tìm thấy buổi đã huỷ" };
  const doi = await sdb.makeupNeed.updateMany({
    where: { id: need.id, status: "CANCELLED", waivedAt: { not: null } },
    data: { status: "PENDING", waivedAt: null, waivedById: null, waivedReason: null },
  });
  if (doi.count === 0) return { ok: false, error: "Buổi này đã được xử lý rồi — tải lại trang" };
  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "lms",
    entityType: "MakeupNeed",
    entityId: need.id,
    action: "UPDATE",
    oldValues: { status: "CANCELLED", waivedReason: need.waivedReason },
    newValues: { status: "PENDING" },
    reason: "Khôi phục buổi đã huỷ",
    orgUnitId: need.orgUnitId,
  });
  revalidatePath("/hoc-bu");
  return { ok: true };
}

// ─── Chọn case cho một nhóm bé ────────────────────────────────────────────────

const idsSchema = z.array(z.string().min(1)).min(1, "Chưa chọn học viên nào").max(50);

export type LuaChonCase =
  | {
      ok: true;
      coSo: string;
      khoa: string;
      buoi: string;
      be: { id: string; hocVien: string; cachXep: "Lượt bù" | "Đã thu phí" | "Miễn phí" }[];
      caseCoSan: DongCase[];
      phong: { id: string; name: string }[];
      homNay: string;
    }
  | { ok: false; error: string };

export async function layLuaChonCaseAction(needIds: string[]): Promise<LuaChonCase> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  const p = idsSchema.safeParse(needIds);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const sdb = scopedDb(n.actor);
  const dong = await docDongTheoId(sdb, p.data);
  if (dong.length !== new Set(p.data).size) return { ok: false, error: "Có học viên đã được xếp/huỷ — tải lại trang" };
  const nhom = kiemNhom(dong.map((d) => ({ ...d, hocVien: d.hocVien })));
  if (!nhom.ok) return { ok: false, error: nhom.lyDo };
  const chan = dong.find((d) => !d.xep.ok);
  if (chan && !chan.xep.ok) return { ok: false, error: `${chan.hocVien}: ${chan.xep.lyDo}` };

  const homNay = vnYmd(new Date());
  const [caseCoSan, phong, coSo] = await Promise.all([
    caseCungNhom(sdb, nhom.nhom, new Date(`${homNay}T00:00:00Z`)),
    sdb.room.findMany({
      where: { centerId: nhom.nhom.centerId!, status: "ACTIVE" },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    sdb.center.findUnique({ where: { id: nhom.nhom.centerId! }, select: { code: true, name: true } }),
  ]);
  const dau = dong[0]!;
  return {
    ok: true,
    coSo: coSo?.code || coSo?.name || "—",
    khoa: dau.khoa,
    buoi: dau.buoiVang ?? "—",
    be: dong.map((d) => ({
      id: d.id,
      hocVien: d.hocVien,
      cachXep: d.phi.loai === "LUOT" ? "Lượt bù" : d.phi.loai === "DA_THU" ? "Đã thu phí" : "Miễn phí",
    })),
    caseCoSan,
    phong,
    homNay,
  };
}

const khungSchema = z.object({
  needIds: idsSchema,
  ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Chọn ngày dạy bù"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ bắt đầu không hợp lệ"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ kết thúc không hợp lệ"),
});

export async function layGvChoCaseAction(
  input: z.input<typeof khungSchema>,
): Promise<{ ok: true; ds: GvTrongCa[]; lyDoRong: string | null } | { ok: false; error: string }> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  const p = khungSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  // Cơ sở suy từ CHÍNH các dòng cần bù (không nhận centerId từ trình duyệt).
  const [dau] = await docDongTheoId(scopedDb(n.actor), [p.data.needIds[0]!]);
  if (!dau?.centerId) return { ok: false, error: "Không xác định được cơ sở của học viên" };
  try {
    return { ok: true, ...(await gvTrongCa(n.actor, { centerId: dau.centerId, ...p.data })) };
  } catch (e) {
    return dichLoi(e);
  }
}

const taoCaseSchema = khungSchema.extend({
  roomId: z.string().min(1).nullable(),
  teacherId: z.string().min(1, "Chọn giáo viên"),
  note: z.string().trim().max(500).nullable(),
});

export async function taoCaseAction(
  input: z.input<typeof taoCaseSchema>,
): Promise<{ ok: true; caseId: string } | { ok: false; error: string }> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  const p = taoCaseSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (p.data.ymd < vnYmd(new Date())) return { ok: false, error: "Ngày dạy bù không được ở quá khứ" };
  try {
    const caseId = await taoCaseVaXep(n.actor, { ...p.data, note: p.data.note || null });
    await ghiAudit(n, {
      entityType: "MakeupCase",
      entityId: caseId,
      action: "CREATE",
      newValues: { ...p.data },
    });
    xong(caseId);
    return { ok: true, caseId };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function xepVaoCaseAction(input: { caseId: string; needIds: string[] }): Promise<KetQua> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  const p = z.object({ caseId: z.string().min(1), needIds: idsSchema }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    await xepVaoCaseCoSan(n.actor, p.data);
    await ghiAudit(n, { entityType: "MakeupCase", entityId: p.data.caseId, action: "UPDATE", newValues: { them: p.data.needIds } });
    xong(p.data.caseId);
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

// ─── Trong case ───────────────────────────────────────────────────────────────

export async function goKhoiCaseAction(input: { caseId: string; caseStudentId: string }): Promise<KetQua> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  try {
    await goKhoiCase(n.actor, input.caseStudentId);
    xong(input.caseId);
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function diemDanhBuAction(input: {
  caseId: string;
  caseStudentId: string;
  coMat: boolean;
  /** Ghi đè điểm danh QUÁ 3 ngày (T02, HB-03) — cần quyền `makeup:waive` + lý do; xem `diemDanhBu`. */
  ghiDe?: { lyDo: string };
}): Promise<KetQua> {
  const n = await cong("makeup:attend");
  if (!n.ok) return n;
  // Ghi đè là quyền RIÊNG (quản lý cơ sở trở lên), không phải quyền điểm danh thường.
  let ghiDe: { lyDo: string; ten: string } | undefined;
  if (input.ghiDe) {
    if (!(await checkPermission("makeup:waive"))) return { ok: false, error: "Bạn không có quyền ghi đè điểm danh quá hạn" };
    ghiDe = { lyDo: input.ghiDe.lyDo, ten: n.session.user.name ?? n.session.user.email ?? n.session.user.id };
  }
  try {
    await diemDanhBu(n.actor, { caseStudentId: input.caseStudentId, coMat: input.coMat === true, ghiDe });
    xong(input.caseId);
    revalidatePath("/attendance");
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

/** Nhận xét bé ở buổi bù — ghi vào buổi VẮNG gốc như nhập ở buổi chính (chốt 29/09). */
export async function nhanXetBuAction(p: PhieuNhanXetGui & { caseStudentId: string }): Promise<KetQua> {
  const n = await cong("makeup:attend");
  if (!n.ok) return n;
  try {
    const dich = await beDeNhanXet(n.actor, { caseStudentId: p.caseStudentId });
    const kq = await saveSessionEvalChoHocBu(
      { id: n.session.user.id, role: n.session.user.role, centerId: n.session.user.centerId },
      { sessionId: dich.missedSessionId, studentId: dich.studentId, projectName: p.projectName, notes: p.notes, rubric: p.rubric },
      { guiEmailPhuHuynh: true },
    );
    if (!kq.ok) return { ok: false, error: kq.error ?? "Không lưu được nhận xét" };
    xong(dich.caseId);
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

/** Quản lý gửi bài kiểm tra bù thay giáo viên (cùng quyền điểm danh/nhận xét bù). */
export async function guiBaiKiemTraBuAction(p: {
  caseId: string;
  examId: string;
}): Promise<{ ok: true; soBe: number } | { ok: false; error: string }> {
  const n = await cong("makeup:attend");
  if (!n.ok) return n;
  // Case phải nằm trong tầm nhìn cơ sở của người bấm.
  const c = await scopedDb(n.actor).makeupCase.findUnique({ where: { id: p.caseId }, select: { id: true } });
  if (!c) return { ok: false, error: "Không tìm thấy case dạy bù" };
  try {
    const r = await guiBaiKiemTraBu({ caseId: p.caseId, examId: p.examId, byUserId: n.actor.userId, chiGiaoVien: null, now: new Date() });
    xong(p.caseId);
    return { ok: true, soBe: r.soBe };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function huyCaseAction(caseId: string): Promise<KetQua> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  try {
    await huyCase(n.actor, caseId);
    await ghiAudit(n, { entityType: "MakeupCase", entityId: caseId, action: "UPDATE", newValues: { status: "CANCELLED" } });
    xong(caseId);
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}

// ─── Phí bù / miễn phí ngoại lệ ────────────────────────────────────────────────

export async function taoPhiBuAction(needId: string): Promise<{ ok: true; orderId: string } | { ok: false; error: string }> {
  const n = await cong("makeup:manage");
  if (!n.ok) return n;
  try {
    const r = await taoPhiBu(n.actor, needId);
    await ghiAudit(n, { entityType: "MakeupNeed", entityId: needId, action: "UPDATE", newValues: { feeOrderId: r.orderId } });
    xong();
    return { ok: true, orderId: r.orderId };
  } catch (e) {
    return dichLoi(e);
  }
}

export async function mienPhiBuAction(input: { needId: string; lyDo: string }): Promise<KetQua> {
  const n = await cong("makeup:waive");
  if (!n.ok) return n;
  const p = z.object({ needId: z.string().min(1), lyDo }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  try {
    await mienPhiBu(n.actor, p.data);
    await ghiAudit(n, {
      entityType: "MakeupNeed",
      entityId: p.data.needId,
      action: "UPDATE",
      newValues: { freeApproved: true },
      reason: p.data.lyDo,
    });
    xong();
    return { ok: true };
  } catch (e) {
    return dichLoi(e);
  }
}
