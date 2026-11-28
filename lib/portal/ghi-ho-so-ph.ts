// lib/portal/ghi-ho-so-ph.ts — LƯỢT GHI hồ sơ do CHÍNH PHỤ HUYNH sửa ở cổng, đẩy sang mọi bản sao (14/11/2026).
//
// Chủ dự án 14/11: nhập thông tin ở một nơi thì các nơi khác tự có, đỡ phải nhập lại; địa chỉ nào
// người dùng vừa chọn thì địa chỉ đó thắng ở mọi nơi. Trước đó cổng chỉ ghi `User` + `Student`, nên
// phiếu lead (admin/Sale đọc) và anh chị em cùng phiếu không đổi theo.
//
// ── Vì sao "ghi đè theo lần sửa mới nhất" ĐƯỢC ở đây mà KHÔNG được ở form công khai ──────────────
//   Người sửa ở cổng đã ĐĂNG NHẬP (qua OTP/mật khẩu), nên lần sửa là của chủ tài khoản. Phiếu công
//   khai (DISC / Tủ sách / Sức khoẻ) thì ai gõ SĐT cũng được — chưa chứng minh là chủ số — nên chúng
//   chỉ ĐIỀN CHỖ TRỐNG của phiếu có sẵn (xem `lib/cong-thong-tin/tao-lead.ts`). Đừng gộp hai luật.
//
// ── Các nơi một lượt sửa chảy tới ────────────────────────────────────────────────────────────────
//   User.name / User.address → mọi Student của hộ (parentName, address, parent2*) qua `ghiHoSoTrongTx`
//   → phiếu lead nguồn + anh chị em cùng phiếu (đường `dongBoTuHocVien` sẵn có) → và phiếu lead cùng
//   SĐT nhưng CHƯA nối với học viên nào (tài khoản mới, chưa ghi danh) bằng `dongBoLeadTheoSdt`.
//
// Giao kèo: file KHÔNG tự kiểm quyền — bên gọi (server action portal) đã `requireParent()`; `userId` là
// của chính phiên. Mọi phép ghi nằm trong MỘT `db.$transaction` KHÔNG scope (đồng bộ bản sao của cùng
// một gia đình, không phải lượt đọc theo quyền — xem đầu `dong-bo-lead-db.ts`).

import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logLeadAudit } from "@/lib/audit/log";
import { phoneVariants } from "@/lib/phone";
import { ghiHoSoTrongTx, SNAPSHOT_HO_SO } from "@/lib/students/ghi-ho-so";
import {
  CHON_PH_LEAD,
  chiOKhacDich,
  coO,
  phHvSangLead,
  type PhHocVien,
  type PhLead,
} from "@/lib/students/dong-bo-lead";
import { dongBoTuLead, type NguoiDongBo } from "@/lib/students/dong-bo-lead-db";

type Tx = Prisma.TransactionClient;

const LY_DO = "Phụ huynh tự sửa hồ sơ ở cổng — đồng bộ sang phiếu lead";

/** Phần phụ huynh được sửa ở `/portal/ho-so`. Ô vắng mặt = không đụng; `null` = xoá trắng. */
export type SuaHoSoPh = {
  name?: string;
  /** Dòng địa chỉ (số nhà, đường). Phường/xã + tỉnh chọn ở danh mục — chưa sửa được ở màn này. */
  address?: string | null;
  parent2Name?: string | null;
  parent2Phone?: string | null;
};

/**
 * Phiếu lead cùng SĐT với tài khoản nhưng chưa nối học viên nào: ghi các ô PH đã đổi vào đó (nếu bên
 * kia khác) rồi dội sang học viên đang nối. Lead đã được `dongBoTuHocVien` chạm tới thì bỏ qua.
 */
export async function dongBoLeadTheoSdt(input: {
  tx: Tx;
  soDienThoai: string | null;
  doi: Partial<PhHocVien>;
  daXong: ReadonlySet<string>;
  actor: NguoiDongBo;
  lyDo: string;
}): Promise<string[]> {
  const { tx, soDienThoai, doi, actor } = input;
  if (!soDienThoai || !coO(doi)) return [];
  const bien = phoneVariants(soDienThoai);
  if (bien.length === 0) return [];
  const lead = await tx.lead.findFirst({
    where: { phone: { in: bien }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, ...CHON_PH_LEAD },
  });
  if (!lead || input.daXong.has(lead.id)) return [];
  const { id: leadId, ...truoc } = lead;
  const patch = chiOKhacDich(truoc as PhLead, phHvSangLead(doi));
  if (!coO(patch)) return [];
  await tx.lead.update({ where: { id: leadId }, data: patch });
  await logLeadAudit({
    leadId,
    action: "UPDATE",
    actorId: actor.id,
    actorName: actor.name,
    oldValues: Object.fromEntries(Object.keys(patch).map((k) => [k, (truoc as Record<string, unknown>)[k] ?? null])),
    newValues: { ...patch },
    changedFields: Object.keys(patch),
    reason: input.lyDo,
    tx,
  });
  await dongBoTuLead({ tx, leadId, truoc: truoc as PhLead, sau: patch, actor });
  return [leadId];
}

/**
 * Lõi trong transaction của BÊN GỌI (đổi SĐT đăng nhập cũng dùng): áp `data` lên mọi học viên của
 * phụ huynh qua `ghiHoSoTrongTx`, rồi lo phiếu lead cùng SĐT chưa nối. `tx` phải KHÔNG scope.
 */
export async function ghiPhTrongTx(input: {
  tx: Tx;
  userId: string;
  /** SĐT hiện tại của tài khoản — để tìm phiếu lead chưa nối học viên. */
  soDienThoai: string | null;
  data: Prisma.StudentUpdateManyMutationInput;
  doi: Partial<PhHocVien>;
  actor: NguoiDongBo;
  lyDo?: string;
}): Promise<{ leadIds: string[]; studentIds: string[] }> {
  const { tx, userId, actor } = input;
  const hocVien = await tx.student.findMany({
    where: { parentUserId: userId, deletedAt: null },
    select: { id: true, ...SNAPSHOT_HO_SO },
  });
  const leadIds = new Set<string>();
  const studentIds = new Set<string>();
  for (const { id, ...truoc } of hocVien) {
    const r = await ghiHoSoTrongTx({ tx, studentId: id, data: input.data, truoc, actor });
    r.leadIds.forEach((l) => leadIds.add(l));
    r.studentIds.forEach((s) => studentIds.add(s));
    studentIds.add(id);
  }
  const them = await dongBoLeadTheoSdt({
    tx,
    soDienThoai: input.soDienThoai,
    doi: input.doi,
    daXong: leadIds,
    actor,
    lyDo: input.lyDo ?? LY_DO,
  });
  them.forEach((l) => leadIds.add(l));
  return { leadIds: [...leadIds], studentIds: [...studentIds] };
}

/** Ghi hồ sơ phụ huynh sửa ở `/portal/ho-so`: User + mọi bản sao, một transaction. */
export async function ghiHoSoPhuHuynh(input: {
  userId: string;
  actor: NguoiDongBo;
  sua: SuaHoSoPh;
}): Promise<void> {
  const { userId, actor, sua } = input;
  await db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Tx;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { phone: true } });

    const duLieuUser: Prisma.UserUpdateInput = {};
    if (sua.name !== undefined) duLieuUser.name = sua.name;
    if (sua.address !== undefined) duLieuUser.address = sua.address;
    if (coO(duLieuUser)) await tx.user.update({ where: { id: userId }, data: duLieuUser });

    // `Student.parentPhone` LẤY TỪ `User.phone` (định danh đăng nhập) — KHÔNG từ ô nhập; xem ghi chú P6 cũ.
    const data: Prisma.StudentUpdateManyMutationInput = { parentPhone: user?.phone ?? null };
    const doi: Partial<PhHocVien> = {};
    if (sua.name !== undefined) {
      data.parentName = sua.name;
      doi.parentName = sua.name;
    }
    if (sua.address !== undefined) {
      data.address = sua.address;
      doi.address = sua.address;
    }
    if (sua.parent2Name !== undefined) data.parent2Name = sua.parent2Name;
    if (sua.parent2Phone !== undefined) data.parent2Phone = sua.parent2Phone;

    await ghiPhTrongTx({ tx, userId, soDienThoai: user?.phone ?? null, data, doi, actor });
  });
}
