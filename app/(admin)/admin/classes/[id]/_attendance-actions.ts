"use server";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { buildSessionAttendanceRows, type AttendanceRosterRow } from "@/lib/attendance/roster";

type RosterResult =
  | { ok: true; session: { id: string; date: string; topic: string | null; className: string }; rows: AttendanceRosterRow[] }
  | { ok: false; error: string };

/**
 * Nạp roster điểm danh 1 buổi cho tab "Buổi & Điểm danh" của trang chi tiết lớp.
 * Scope server-side (chống IDOR đọc roster lớp ngoài tầm nhìn): ClassSession ∈
 * SCOPED_MODELS nên scopedDb tự lọc theo cơ sở; thêm owner-check cho view-own (GV
 * chỉ buổi của lớp mình dạy/trợ giảng) — đồng bộ canManageSessionClass.
 */
export async function loadClassSessionRoster(sessionId: string): Promise<RosterResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const id = sessionId?.trim();
  if (!id) return { ok: false, error: "Thiếu buổi học" };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const sess = await sdb.classSession.findFirst({
    where: { id },
    select: {
      id: true,
      class: { select: { teacherId: true, assistantId: true, centerId: true } },
    },
  });
  if (!sess) return { ok: false, error: "Buổi học không tồn tại" };

  // Owner-scope: GV (chỉ view-own) phải là GV/TA của lớp; QL/SUPER_ADMIN bỏ qua.
  if (!(await checkPermission("classes:view-all", { centerId: sess.class.centerId }))) {
    const isOwner =
      sess.class.teacherId === session.user.id || sess.class.assistantId === session.user.id;
    if (!isOwner) return { ok: false, error: "Buổi học không tồn tại" };
  }

  const { session: meta, rows } = await buildSessionAttendanceRows(actor, id);
  if (!meta) return { ok: false, error: "Buổi học không tồn tại" };
  return {
    ok: true,
    session: { id: meta.id, date: meta.date.toISOString(), topic: meta.topic, className: meta.className },
    rows,
  };
}
