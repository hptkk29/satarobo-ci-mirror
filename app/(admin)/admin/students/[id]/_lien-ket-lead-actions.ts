"use server";

// Liên kết Học viên ↔ Lead nguồn — nút "Gắn lead" / "Gỡ liên kết" / ô tìm phiếu trên hồ
// sơ học viên (25/09/2026, chủ dự án chốt D1).
//
// ⚠️ 'use server' ⇒ file này CHỈ export hàm async (export hằng/kiểu là vỡ Server Action
// lúc chạy mà `pnpm build` vẫn xanh).
//
// Ba cổng, theo thứ tự, TẤT CẢ đứng TRƯỚC phép ghi đầu tiên:
//   1. quyền `students:edit` (hỏi trực tiếp trong từng action — lint no-inline-authz);
//   2. học viên thuộc tầm nhìn cơ sở (`scopedDb` + `passesScope`) — `scopedDb` KHÔNG che
//      đường GHI, nên phải tự hỏi;
//   3. phiếu lead ĐÍCH mở được (cách ly cơ sở + `canSeeLead`), và phiếu CŨ (nếu đang nối
//      phiếu khác) cũng phải được phép đụng — `duocDoiLienKetCu`.
// Trong `$transaction` từ chối = `throw` (luật "return không rollback" — CLAUDE.md).
//
// ⛔ KHÔNG ghi `Enrollment.leadChildId` ở đây: cột đó là tín hiệu "đã chốt" của báo cáo
// chuyển đổi (lib/lead/tuong-tac/ghi.ts:130-134). Liên kết sống ở `Student.leadId`.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  canViewLeadPii,
  checkPermission,
  checkPermissionDetail,
} from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { canSeeLead, leadSharingEnabled } from "@/lib/lead/sharing";
import { getAuditActor, logStudentAudit } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { dienTuLead } from "@/lib/students/dien-tu-lead";
import { locPhanDienTheoQuyen } from "@/lib/students/lead-nguon-view";
import { duocDoiLienKetCu, timLeadDeGan } from "@/lib/students/lead-nguon";
import { LOI_DA_AN_DANH } from "@/lib/students/da-an-danh";
import { hocVienDaAnDanh } from "@/lib/students/da-an-danh-db";
import type { LeadGoiY } from "@/lib/students/lead-nguon-types";

type KetQua = { ok: true } | { ok: false; error: string };

const idSchema = z.string().trim().min(1).max(64);

/** Lỗi nghiệp vụ ném ra TRONG transaction để rollback, rồi dịch thành câu cho người dùng. */
class LoiLienKet extends Error {}

const LOI_KHONG_QUYEN = "Bạn không có quyền sửa hồ sơ học viên";
const LOI_KHONG_THAY_HV = "Không tìm thấy học viên";
const LOI_KHONG_THAY_LEAD = "Không tìm thấy phiếu lead, hoặc bạn không được mở phiếu này";
const LOI_DA_DOI =
  "Liên kết lead của học viên vừa được đổi ở nơi khác — tải lại trang rồi thử lại.";

/** Các ô của Student mà luật điền-từ-lead xét tới + cột liên kết (đọc lại trong tx). */
const CHON_HV_DE_DIEN = {
  leadId: true,
  leadChildId: true,
  dateOfBirth: true,
  gender: true,
  school: true,
  currentGrade: true,
  parentEmail: true,
  parentGender: true,
  parentDob: true,
  parentFacebookUrl: true,
  city: true,
  ward: true,
  address: true,
  district: true,
} satisfies Prisma.StudentSelect;

/** Học viên trong tầm nhìn của người thao tác, hoặc `null`. */
async function hocVienTrongTamNhin(userId: string, studentId: string) {
  const actor = await resolveActor(userId);
  const hv = await scopedDb(actor).student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: { id: true, name: true, centerId: true, leadId: true, leadChildId: true },
  });
  if (!hv || !passesScope("Student", hv, actor)) return { actor, hv: null };
  return { actor, hv };
}

/**
 * Ghi CÓ ĐIỀU KIỆN (khoá lạc quan) cho cột liên kết + các ô sắp điền: `where` mang đúng
 * giá trị vừa đọc trong tx. Hai người bấm "Gắn" cùng lúc: cả hai đọc `leadId = null`, lượt
 * sau đợi khoá dòng rồi CHỈ khớp `id` nếu ghi `update({ where: { id } })` ⇒ đè liên kết và
 * đè luôn các ô lượt trước vừa điền, phá luật "chỉ điền ô trống". Với `where` này lượt sau
 * khớp 0 dòng ⇒ ném `LOI_DA_DOI` ⇒ rollback (lượt rà đối kháng 25/09).
 */
function dieuKienGhi(
  studentId: string,
  cur: Record<string, unknown>,
  cot: readonly string[],
): Prisma.StudentWhereInput {
  const where: Record<string, unknown> = { id: studentId };
  for (const k of cot) where[k] = cur[k] ?? null;
  return where as Prisma.StudentWhereInput;
}

export async function ganLeadChoHocVien(input: {
  studentId: string;
  leadId: string;
  leadChildId?: string | null;
}): Promise<{ ok: true; soODaDien: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) return { ok: false, error: LOI_KHONG_QUYEN };

  const parsed = z
    .object({ studentId: idSchema, leadId: idSchema, leadChildId: idSchema.nullish() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const { studentId, leadId } = parsed.data;
  const userId = session.user.id;

  const { actor, hv } = await hocVienTrongTamNhin(userId, studentId);
  if (!hv) return { ok: false, error: LOI_KHONG_THAY_HV };
  // NĐ13: hồ sơ đã ẩn danh KHÔNG được nối lại — `dienTuLead` sẽ coi các ô vừa xoá là ô
  // trống và điền LẠI PII từ lead (lib/students/da-an-danh.ts).
  if (await hocVienDaAnDanh(hv)) return { ok: false, error: LOI_DA_AN_DANH };
  const sdb = scopedDb(actor);

  const [canViewAll, canViewPii] = await Promise.all([
    checkPermission("leads:view-all"),
    canViewLeadPii(),
  ]);

  // Phiếu ĐÍCH: đọc TOP-LEVEL qua cổng cách ly, rồi luật "lead độc quyền".
  const lead = await sdb.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: {
      id: true,
      assignedToId: true,
      createdById: true,
      isSharedWithTeam: true,
      email: true,
      facebookUrl: true,
      parentGender: true,
      parentDob: true,
      city: true,
      ward: true,
      addressLine: true,
    },
  });
  if (
    !lead ||
    !canSeeLead({
      canViewAll,
      isOwner: lead.assignedToId === userId,
      isCreator: !!lead.createdById && lead.createdById === userId,
      isShared: lead.isSharedWithTeam,
      sharingEnabled: leadSharingEnabled(),
    })
  ) {
    return { ok: false, error: LOI_KHONG_THAY_LEAD };
  }

  // Đứa trẻ: không truyền ⇒ cùng phiếu thì giữ đứa đang nối, khác phiếu thì bỏ trống
  // (KHÔNG tự chọn con duy nhất: học viên có thể là anh/em chưa được khai vào phiếu, điền
  // ngày sinh của đứa kia sang là dữ liệu sai trông như đúng).
  const leadChildId =
    parsed.data.leadChildId !== undefined
      ? parsed.data.leadChildId
      : hv.leadId === lead.id
        ? hv.leadChildId
        : null;
  const con = leadChildId
    ? await sdb.leadChild.findFirst({
        where: { id: leadChildId, leadId: lead.id },
        select: { id: true, dob: true, gender: true, schoolName: true, gradeLevel: true },
      })
    : null;
  if (leadChildId && !con) {
    return { ok: false, error: "Đứa trẻ đã chọn không thuộc phiếu lead này" };
  }

  // Đang nối phiếu KHÁC ⇒ phải được phép đụng phiếu cũ (xem `duocDoiLienKetCu`).
  const leadCu = hv.leadId && hv.leadId !== lead.id ? hv.leadId : null;
  if (leadCu && !(await duocDoiLienKetCu({ actor, userId, leadId: leadCu, canViewAll }))) {
    return {
      ok: false,
      error:
        "Học viên đang nối với một phiếu lead bạn không được mở — nhờ quản lý cơ sở đổi liên kết.",
    };
  }

  const { actorId, actorName } = getAuditActor(session);
  let soODaDien = 0;
  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      // Đọc lại TRONG tx: luật điền "chỉ ô trống" phải xét bản mới nhất, không phải bản
      // đọc trước đó vài trăm mili-giây (người khác có thể vừa lưu form).
      const cur = await tx.student.findUnique({ where: { id: studentId }, select: CHON_HV_DE_DIEN });
      if (!cur) throw new LoiLienKet(LOI_KHONG_THAY_HV);
      // Cổng cũ đã xét trên `hv.leadId` — lệch nghĩa là có người đổi liên kết giữa chừng.
      if (cur.leadId !== hv.leadId) throw new LoiLienKet(LOI_DA_DOI);

      const phan = locPhanDienTheoQuyen(
        dienTuLead(
          cur,
          {
            email: lead.email,
            facebookUrl: lead.facebookUrl,
            parentGender: lead.parentGender,
            parentDob: lead.parentDob,
            city: lead.city,
            ward: lead.ward,
            addressLine: lead.addressLine,
          },
          con
            ? { dob: con.dob, gender: con.gender, schoolName: con.schoolName, gradeLevel: con.gradeLevel }
            : null,
        ),
        canViewPii,
      );
      const oDien = Object.keys(phan) as (keyof typeof phan)[];
      soODaDien = oDien.length;

      const ghi = await tx.student.updateMany({
        where: dieuKienGhi(studentId, cur, ["leadId", "leadChildId", ...oDien]),
        data: { leadId: lead.id, leadChildId: con?.id ?? null, ...phan },
      });
      if (ghi.count !== 1) throw new LoiLienKet(LOI_DA_DOI);

      const cu: Record<string, unknown> = { leadId: cur.leadId, leadChildId: cur.leadChildId };
      const moi: Record<string, unknown> = { leadId: lead.id, leadChildId: con?.id ?? null };
      for (const k of oDien) {
        cu[k] = cur[k];
        moi[k] = phan[k];
      }
      const changedFields = ["leadId", "leadChildId", ...oDien];
      const lyDo = leadCu ? "Đổi lead nguồn của học viên" : "Gắn lead nguồn cho học viên";
      await logStudentAudit({
        studentId,
        action: "UPDATE",
        actorId,
        actorName,
        oldValues: cu,
        newValues: moi,
        changedFields,
        reason: soODaDien > 0 ? `${lyDo} (điền ${soODaDien} ô trống từ lead)` : lyDo,
        tx,
      });
      // Dòng sự kiện có NGHĨA (như STATUS_CHANGE của bảo lưu) để lọc được "ai nối ai".
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "students",
        entityType: "Student",
        entityId: studentId,
        action: "LEAD_LINK",
        oldValues: { leadId: cur.leadId, leadChildId: cur.leadChildId },
        newValues: { leadId: lead.id, leadChildId: con?.id ?? null, oDaDien: oDien },
        changedFields: ["leadId", "leadChildId"],
        reason: lyDo,
        orgUnitId: hv.centerId,
        tx,
      });
    });
  } catch (err) {
    if (err instanceof LoiLienKet) return { ok: false, error: err.message };
    return { ok: false, error: "Không lưu được liên kết lead — lỗi cơ sở dữ liệu" };
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}/edit`);
  revalidatePath(`/leads/${lead.id}`);
  if (leadCu) revalidatePath(`/leads/${leadCu}`);
  return { ok: true, soODaDien };
}

export async function goLienKetLead(input: { studentId: string }): Promise<KetQua> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) return { ok: false, error: LOI_KHONG_QUYEN };

  const parsed = z.object({ studentId: idSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const { studentId } = parsed.data;
  const userId = session.user.id;

  const { actor, hv } = await hocVienTrongTamNhin(userId, studentId);
  if (!hv) return { ok: false, error: LOI_KHONG_THAY_HV };
  const leadCu = hv.leadId;
  if (!leadCu) return { ok: false, error: "Học viên chưa nối lead nào" };

  const canViewAll = await checkPermission("leads:view-all");
  if (!(await duocDoiLienKetCu({ actor, userId, leadId: leadCu, canViewAll }))) {
    return {
      ok: false,
      error: "Bạn không được mở phiếu lead này nên không gỡ được liên kết — nhờ quản lý cơ sở.",
    };
  }

  const { actorId, actorName } = getAuditActor(session);
  try {
    await scopedDb(actor).$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      const cur = await tx.student.findUnique({
        where: { id: studentId },
        select: { leadId: true, leadChildId: true },
      });
      if (!cur) throw new LoiLienKet(LOI_KHONG_THAY_HV);
      if (cur.leadId !== leadCu) throw new LoiLienKet(LOI_DA_DOI);

      // Gỡ CHỈ gỡ liên kết. Các ô đã điền từ lead là dữ liệu hồ sơ, KHÔNG xoá theo.
      const ghi = await tx.student.updateMany({
        where: dieuKienGhi(studentId, cur, ["leadId", "leadChildId"]),
        data: { leadId: null, leadChildId: null },
      });
      if (ghi.count !== 1) throw new LoiLienKet(LOI_DA_DOI);
      const cu = { leadId: cur.leadId, leadChildId: cur.leadChildId };
      const moi = { leadId: null, leadChildId: null };
      await logStudentAudit({
        studentId,
        action: "UPDATE",
        actorId,
        actorName,
        oldValues: cu,
        newValues: moi,
        changedFields: ["leadId", "leadChildId"],
        reason: "Gỡ liên kết lead nguồn",
        tx,
      });
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "students",
        entityType: "Student",
        entityId: studentId,
        action: "LEAD_UNLINK",
        oldValues: cu,
        newValues: moi,
        changedFields: ["leadId", "leadChildId"],
        reason: "Gỡ liên kết lead nguồn",
        orgUnitId: hv.centerId,
        tx,
      });
    });
  } catch (err) {
    if (err instanceof LoiLienKet) return { ok: false, error: err.message };
    return { ok: false, error: "Không gỡ được liên kết lead — lỗi cơ sở dữ liệu" };
  }

  revalidatePath("/students");
  revalidatePath(`/students/${studentId}/edit`);
  revalidatePath(`/leads/${leadCu}`);
  return { ok: true };
}

export async function timLeadDeGanAction(input: {
  studentId: string;
  q: string;
}): Promise<{ ok: true; items: LeadGoiY[] } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("students:edit"))) return { ok: false, error: LOI_KHONG_QUYEN };

  const parsed = z.object({ studentId: idSchema, q: z.string().max(100) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };

  // Ô tìm nằm TRÊN hồ sơ một học viên — người không mở được hồ sơ đó thì không có lý do
  // gì dùng nó để dò phiếu.
  const { actor, hv } = await hocVienTrongTamNhin(session.user.id, parsed.data.studentId);
  if (!hv) return { ok: false, error: LOI_KHONG_THAY_HV };

  // SĐT phụ huynh của học viên này đang bị che cho người xem (US-03) ⇒ không cho dò theo
  // số, và che số ở kết quả — cùng luật với khối "Lead nguồn" (docLeadNguon).
  const { fieldMask } = await checkPermissionDetail("students:view-all");
  const items = await timLeadDeGan({
    actor,
    userId: session.user.id,
    q: parsed.data.q,
    sdtHocVienBiChe: fieldMask.includes("parentPhone"),
  });
  return { ok: true, items };
}
