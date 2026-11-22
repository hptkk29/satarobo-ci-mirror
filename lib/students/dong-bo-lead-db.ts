// lib/students/dong-bo-lead-db.ts — phần chạm DB của đồng bộ hai chiều HV ↔ lead (26/09/2026).
// Luật + bảng ô chung: `dong-bo-lead.ts` (thuần). Đọc file đó trước.
//
// Mọi hàm nhận `tx` của transaction BÊN GỌI: lượt ghi gốc và các bản sao đổi theo phải cùng
// commit hoặc cùng hoàn tác — hồ sơ HV đổi mà phiếu lead không đổi là đúng kiểu lệch mà chủ
// dự án cấm. File KHÔNG import `@/lib/db`.
//
// ⚠️ `tx` phải là client KHÔNG scope (`db.$transaction`). Qua `scopedDb` thì đọc Lead/Student
// bị lọc theo cơ sở của người sửa ⇒ phiếu lead hoặc anh chị em nằm ở cơ sở khác bị bỏ qua IM
// LẶNG. Đây là đồng bộ bản sao của CÙNG một gia đình, không phải một lượt đọc theo quyền —
// quyền đã được kiểm trên bản ghi gốc ở bên gọi.
//
// Mỗi bản ghi bị kéo theo có MỘT dòng nhật ký nói rõ vì sao nó đổi ("ai đổi SĐT phụ huynh
// của tôi?" phải trả lời được).

import "server-only";
import type { Prisma } from "@prisma/client";
import { logLeadAudit, logStudentAudit } from "@/lib/audit/log";
import {
  CHON_CON_HOC_VIEN,
  CHON_CON_LEAD,
  CHON_PH_HOC_VIEN,
  CHON_PH_LEAD,
  chiOKhacDich,
  coO,
  conHvSangLead,
  conLeadSangHv,
  oDaDoi,
  phHvSangLead,
  phLeadSangHv,
  type ConHocVien,
  type ConLead,
  type PhHocVien,
  type PhLead,
} from "./dong-bo-lead";

type Tx = Prisma.TransactionClient;

export type NguoiDongBo = { id: string | null; name: string };

export type KetQuaDongBo = { leadIds: string[]; studentIds: string[] };

const LY_DO_TU_HV = "Đồng bộ theo hồ sơ học viên (sửa ở màn Học viên)";
const LY_DO_TU_ANH_EM = "Đồng bộ thông tin phụ huynh theo hồ sơ anh/chị/em cùng phiếu lead";
const LY_DO_TU_LEAD = "Đồng bộ theo phiếu lead nguồn (sửa ở màn Lead)";

function tachGiaTri<T extends object>(o: T): Record<string, unknown> {
  return { ...o } as Record<string, unknown>;
}

/**
 * Ghi `patch` (ô PH, dạng HV) vào mọi HV đang nối `leadId` — trừ `boQuaId` — nhưng chỉ ô mà
 * từng HV đang khác. Trả id HV đã đổi.
 */
async function doiPhCacHocVien(
  tx: Tx,
  leadId: string,
  boQuaId: string | null,
  patch: Partial<PhHocVien>,
  actor: NguoiDongBo,
  lyDo: string,
): Promise<string[]> {
  if (!coO(patch)) return [];
  const ds = await tx.student.findMany({
    where: { leadId, deletedAt: null, ...(boQuaId ? { id: { not: boQuaId } } : {}) },
    select: { id: true, ...CHON_PH_HOC_VIEN },
  });
  const daDoi: string[] = [];
  for (const s of ds) {
    const { id, ...ph } = s;
    const p = chiOKhacDich(ph as PhHocVien, patch);
    if (!coO(p)) continue;
    await tx.student.update({ where: { id }, data: p });
    await logStudentAudit({
      studentId: id,
      action: "UPDATE",
      actorId: actor.id,
      actorName: actor.name,
      oldValues: Object.fromEntries(Object.keys(p).map((k) => [k, tachGiaTri(ph)[k]])),
      newValues: tachGiaTri(p),
      changedFields: Object.keys(p),
      reason: lyDo,
      tx,
    });
    daDoi.push(id);
  }
  return daDoi;
}

/** Ghi `patch` (ô CON, dạng HV) vào mọi HV đang nối `leadChildId` — trừ `boQuaId`. */
async function doiConCacHocVien(
  tx: Tx,
  leadChildId: string,
  boQuaId: string | null,
  patch: Partial<ConHocVien>,
  actor: NguoiDongBo,
  lyDo: string,
): Promise<string[]> {
  if (!coO(patch)) return [];
  const ds = await tx.student.findMany({
    where: { leadChildId, deletedAt: null, ...(boQuaId ? { id: { not: boQuaId } } : {}) },
    select: { id: true, ...CHON_CON_HOC_VIEN },
  });
  const daDoi: string[] = [];
  for (const s of ds) {
    const { id, ...con } = s;
    const p = chiOKhacDich(con as ConHocVien, patch);
    if (!coO(p)) continue;
    await tx.student.update({ where: { id }, data: p });
    await logStudentAudit({
      studentId: id,
      action: "UPDATE",
      actorId: actor.id,
      actorName: actor.name,
      oldValues: Object.fromEntries(Object.keys(p).map((k) => [k, tachGiaTri(con)[k]])),
      newValues: tachGiaTri(p),
      changedFields: Object.keys(p),
      reason: lyDo,
      tx,
    });
    daDoi.push(id);
  }
  return daDoi;
}

/**
 * HỒ SƠ HỌC VIÊN vừa đổi ⇒ dội sang phiếu lead nguồn, đứa con trong phiếu, và anh chị em
 * cùng phiếu. Gọi SAU lượt `student.update`, trong cùng `tx`.
 *
 * `truoc` / `sau` là giá trị các ô chung của HV trước và sau lượt ghi (đủ ô — đọc bằng
 * `CHON_PH_HOC_VIEN` + `CHON_CON_HOC_VIEN`). `leadId` / `leadChildId` là liên kết SAU lượt ghi.
 */
export async function dongBoTuHocVien(input: {
  tx: Tx;
  studentId: string;
  leadId: string | null;
  leadChildId: string | null;
  truoc: PhHocVien & ConHocVien;
  sau: PhHocVien & ConHocVien;
  actor: NguoiDongBo;
}): Promise<KetQuaDongBo> {
  const { tx, studentId, actor } = input;
  const leadIds: string[] = [];
  const studentIds: string[] = [];

  const doiPh = oDaDoi(
    Object.fromEntries(Object.keys(CHON_PH_HOC_VIEN).map((k) => [k, input.truoc[k as keyof PhHocVien]])) as PhHocVien,
    Object.fromEntries(Object.keys(CHON_PH_HOC_VIEN).map((k) => [k, input.sau[k as keyof PhHocVien]])) as PhHocVien,
  );
  const doiCon = oDaDoi(
    Object.fromEntries(Object.keys(CHON_CON_HOC_VIEN).map((k) => [k, input.truoc[k as keyof ConHocVien]])) as ConHocVien,
    Object.fromEntries(Object.keys(CHON_CON_HOC_VIEN).map((k) => [k, input.sau[k as keyof ConHocVien]])) as ConHocVien,
  );

  // ── Phụ huynh → phiếu lead + anh chị em cùng phiếu ──────────────────────────────────
  if (input.leadId && coO(doiPh)) {
    const lead = await tx.lead.findFirst({
      where: { id: input.leadId, deletedAt: null },
      select: CHON_PH_LEAD,
    });
    if (lead) {
      const p = chiOKhacDich(lead as PhLead, phHvSangLead(doiPh));
      if (coO(p)) {
        await tx.lead.update({ where: { id: input.leadId }, data: p });
        await logLeadAudit({
          leadId: input.leadId,
          action: "UPDATE",
          actorId: actor.id,
          actorName: actor.name,
          oldValues: Object.fromEntries(Object.keys(p).map((k) => [k, tachGiaTri(lead)[k]])),
          newValues: tachGiaTri(p),
          changedFields: Object.keys(p),
          reason: LY_DO_TU_HV,
          tx,
        });
        leadIds.push(input.leadId);
      }
    }
    // Anh chị em đọc giá trị dạng HV thẳng từ hồ sơ vừa sửa — không đi vòng qua dạng lead
    // (vòng qua là SĐT "0905…" thành "84905…" rồi mới quay về).
    studentIds.push(
      ...(await doiPhCacHocVien(tx, input.leadId, studentId, doiPh, actor, LY_DO_TU_ANH_EM)),
    );
  }

  // ── Con → đứa con trong phiếu (+ HV khác cùng nối đứa con đó) ─────────────────────────
  if (input.leadChildId && coO(doiCon)) {
    const con = await tx.leadChild.findUnique({
      where: { id: input.leadChildId },
      select: { leadId: true, ...CHON_CON_LEAD },
    });
    if (con) {
      const { leadId: leadCuaCon, ...phanCon } = con;
      const p = chiOKhacDich(phanCon as ConLead, conHvSangLead(doiCon));
      if (coO(p)) {
        await tx.leadChild.update({ where: { id: input.leadChildId }, data: p });
        await logLeadAudit({
          leadId: leadCuaCon,
          action: "UPDATE",
          actorId: actor.id,
          actorName: actor.name,
          oldValues: {
            leadChildId: input.leadChildId,
            ...Object.fromEntries(Object.keys(p).map((k) => [k, tachGiaTri(phanCon)[k]])),
          },
          newValues: { leadChildId: input.leadChildId, ...tachGiaTri(p) },
          changedFields: ["children", ...Object.keys(p)],
          reason: LY_DO_TU_HV,
          tx,
        });
        if (!leadIds.includes(leadCuaCon)) leadIds.push(leadCuaCon);
      }
    }
    studentIds.push(
      ...(await doiConCacHocVien(tx, input.leadChildId, studentId, doiCon, actor, LY_DO_TU_HV)),
    );
  }

  return { leadIds, studentIds: [...new Set(studentIds)] };
}

/**
 * PHIẾU LEAD vừa đổi ô phụ huynh ⇒ dội sang mọi HV đang nối phiếu đó. Gọi SAU `lead.update`.
 *
 * `truoc` = giá trị các ô PH của lead TRƯỚC lượt sửa (đủ ô); `sau` = CHỈ các ô lượt sửa gửi
 * (ô vắng mặt = không đụng) — đúng hình dạng `updateData` của `updateLeadFields`.
 */
export async function dongBoTuLead(input: {
  tx: Tx;
  leadId: string;
  truoc: PhLead;
  sau: Partial<PhLead>;
  actor: NguoiDongBo;
}): Promise<KetQuaDongBo> {
  const doi = oDaDoi(input.truoc, input.sau);
  if (!coO(doi)) return { leadIds: [], studentIds: [] };
  const studentIds = await doiPhCacHocVien(
    input.tx,
    input.leadId,
    null,
    phLeadSangHv(doi),
    input.actor,
    LY_DO_TU_LEAD,
  );
  return { leadIds: [], studentIds };
}

/**
 * ĐỨA CON trong phiếu vừa đổi ⇒ dội sang mọi HV đang nối đứa con đó. Gọi SAU
 * `leadChild.update`. Tên con KHÔNG đi đường này — xem `syncLeadChildNameToStudents`.
 */
export async function dongBoTuCon(input: {
  tx: Tx;
  leadChildId: string;
  truoc: ConLead;
  sau: Partial<ConLead>;
  actor: NguoiDongBo;
}): Promise<KetQuaDongBo> {
  const doi = oDaDoi(input.truoc, input.sau);
  if (!coO(doi)) return { leadIds: [], studentIds: [] };
  const studentIds = await doiConCacHocVien(
    input.tx,
    input.leadChildId,
    null,
    conLeadSangHv(doi),
    input.actor,
    LY_DO_TU_LEAD,
  );
  return { leadIds: [], studentIds };
}
