// GHI "khoá quan tâm" của MỘT đứa con — và đồng bộ bản sao của nó trên lead.
//
// Tách khỏi `app/(admin)/admin/leads/actions.ts` ngày 26/09/2026: màn lớp trial nay cũng
// ghi đúng cột này (ô chọn khoá ở khối "Chưa xếp case" — xem `lib/trial/khoa-truoc-case.ts`).
// Hai nơi ghi cùng một cột mà mỗi nơi tự đồng bộ `Lead.courseId` theo cách riêng là đúng
// lỗi mà `lib/lead/khoa-quan-tam.ts` sinh ra để chặn — nên cả hai đi qua MỘT hàm ở đây.
//
// Tệp không import `@/lib/db`: mọi hàm nhận `tx` của transaction bên gọi.

import type { Prisma } from "@prisma/client";
import { conTheoLeadDoi, dongBoKhoaTuCon, leadTheoConDoi } from "@/lib/lead/khoa-quan-tam";
import { logLeadAudit } from "@/lib/audit/log";
import { ghiTuongTacLead } from "@/lib/lead/tuong-tac/ghi";

/**
 * Đồng bộ "Khoá quan tâm" của LEAD theo các con — NHƯNG KHÔNG ĐÈ giá trị người dùng đặt tay.
 *
 * `Lead.courseId` là BẢN SAO có chủ đích của `LeadChild.interestedCourseId` (chốt
 * 24/08/2026), để mọi màn đang đọc `lead.course` đổi theo mà không phải sửa từng nơi.
 * Luật "khi nào con được ghi đè" nằm ở `lib/lead/khoa-quan-tam.ts` (hàm thuần, có test).
 *
 * ⚠️ Gọi CÓ ĐIỀU KIỆN: chỉ khi con THỰC SỰ chọn khoá, hoặc khi đang gỡ đúng cái khoá do
 * chính con đó đặt. Biểu mẫu TẠO lead có ô "Khoá quan tâm" cấp lead rồi mới tới khối con;
 * đồng bộ vô tư lúc con không chọn khoá là XOÁ TRẮNG thứ người dùng vừa chọn.
 *
 * `khoaConTruocKhiSua` = khoá của đứa con vừa sửa, GIÁ TRỊ TRƯỚC LƯỢT SỬA. Thiếu nó thì
 * luồng thường gãy — xem chú thích của `DauVaoDongBoKhoa`.
 */
export async function syncLeadCourseFromChildren(
  tx: Prisma.TransactionClient,
  leadId: string,
  khoaConTruocKhiSua?: string | null,
): Promise<void> {
  const [kids, lead] = await Promise.all([
    tx.leadChild.findMany({
      where: { leadId },
      select: { interestedCourseId: true },
      orderBy: { updatedAt: "desc" },
    }),
    tx.lead.findUnique({ where: { id: leadId }, select: { courseId: true } }),
  ]);
  const quyet = dongBoKhoaTuCon({
    khoaLead: lead?.courseId,
    khoaCacCon: kids.map((k) => k.interestedCourseId),
    khoaConTruocKhiSua,
  });
  if (!quyet.doiKhoa) return;
  await tx.lead.update({ where: { id: leadId }, data: { courseId: quyet.khoaMoi } });
}

/**
 * Đặt khoá quan tâm cho một đứa con (chỉ ĐẶT, không gỡ trắng — `courseId` bắt buộc).
 * Ghi con → lead nhận đúng khoá đó (`khoaConDaDoi`) → nhật ký audit → dòng lịch sử trên
 * hồ sơ lead, cùng một `tx`.
 *
 * Trả `doi: false` khi con đã mang đúng khoá đó: bấm chọn lại cùng giá trị không đẻ dòng
 * lịch sử "đã sửa" giả.
 */
export async function datKhoaQuanTamCon(
  tx: Prisma.TransactionClient,
  p: {
    leadChildId: string;
    courseId: string;
    actorId: string | null;
    actorName: string;
    /** Nơi bấm — ghi vào audit để đọc lại được "đổi từ màn nào". */
    noiDoi: string;
  },
): Promise<{ doi: boolean }> {
  const child = await tx.leadChild.findUnique({
    where: { id: p.leadChildId },
    select: { id: true, leadId: true, fullName: true, interestedCourseId: true },
  });
  if (!child) throw new Error("Không tìm thấy hồ sơ con của lead");
  // Chốt giá trị CŨ trước phép ghi — nó là đầu vào `khoaConTruocKhiSua` của luật đồng bộ.
  const khoaCu = child.interestedCourseId;
  if (khoaCu === p.courseId) return { doi: false };

  await tx.leadChild.update({
    where: { id: child.id },
    data: { interestedCourseId: p.courseId },
  });
  await khoaConDaDoi(tx, { leadId: child.leadId, khoaConCu: khoaCu, khoaConMoi: p.courseId });
  await logLeadAudit({
    leadId: child.leadId,
    action: "UPDATE",
    actorId: p.actorId,
    actorName: p.actorName,
    oldValues: { leadChildId: child.id, interestedCourseId: khoaCu },
    newValues: { leadChildId: child.id, interestedCourseId: p.courseId, noiDoi: p.noiDoi },
    changedFields: ["children"],
    tx,
  });
  await ghiTuongTacLead(tx, {
    leadId: child.leadId,
    actorId: p.actorId,
    actorName: p.actorName,
    moc: new Date(),
    sk: { viec: "con.sua", tenCon: child.fullName, truong: ["khoá quan tâm"] },
  });
  return { doi: true };
}

/**
 * Khoá của MỘT bé vừa được ghi (đường SỬA) ⇒ đồng bộ lead. Luật ở `leadTheoConDoi`:
 * bé được chọn khoá mới ⇒ lead nhận đúng khoá đó (chủ dự án 26/09: "1 cái đổi thì đổi
 * hết"). Bé bị gỡ trắng khoá ⇒ tính lại bằng luật cũ `dongBoKhoaTuCon` (không bịa khoá).
 * Khoá không đổi ⇒ không làm gì — đó là chỗ chặn "sửa tên bé mà đè mất khoá của lead".
 *
 * Gọi SAU phép ghi con, cùng `tx`.
 */
export async function khoaConDaDoi(
  tx: Prisma.TransactionClient,
  p: { leadId: string; khoaConCu: string | null; khoaConMoi: string | null },
): Promise<void> {
  const q = leadTheoConDoi({ khoaConCu: p.khoaConCu, khoaConMoi: p.khoaConMoi });
  if (q.ghi) {
    await tx.lead.update({ where: { id: p.leadId }, data: { courseId: q.khoa } });
    return;
  }
  const goTrang = !p.khoaConMoi?.trim() && !!p.khoaConCu?.trim();
  if (goTrang) await syncLeadCourseFromChildren(tx, p.leadId, p.khoaConCu);
}

/**
 * Khoá quan tâm của LEAD vừa được ghi ⇒ dội xuống các bé theo `conTheoLeadDoi` (bé chưa
 * có khoá + bé đang mang đúng khoá cũ của lead). Nhờ vậy khoá trial ở lớp trial và cột
 * Khoá học trên site giáo viên đổi theo ngay. Trả về số bé đã đổi.
 *
 * Gọi SAU phép ghi lead, cùng `tx`.
 */
export async function khoaLeadDaDoi(
  tx: Prisma.TransactionClient,
  p: { leadId: string; khoaLeadCu: string | null; khoaLeadMoi: string | null },
): Promise<number> {
  if ((p.khoaLeadMoi ?? null) === (p.khoaLeadCu ?? null)) return 0;
  const con = await tx.leadChild.findMany({
    where: { leadId: p.leadId },
    select: { id: true, interestedCourseId: true },
  });
  const ids = conTheoLeadDoi({
    khoaLeadCu: p.khoaLeadCu,
    khoaLeadMoi: p.khoaLeadMoi,
    con: con.map((c) => ({ id: c.id, khoa: c.interestedCourseId })),
  });
  if (ids.length === 0 || !p.khoaLeadMoi) return 0;
  await tx.leadChild.updateMany({
    where: { id: { in: ids } },
    data: { interestedCourseId: p.khoaLeadMoi },
  });
  return ids.length;
}
