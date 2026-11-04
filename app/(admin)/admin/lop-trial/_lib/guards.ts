// app/(admin)/admin/lop-trial/_lib/guards.ts — GĐ2.
//
// ⚠️ LÝ DO FILE NÀY TỒN TẠI: `scopedDb` CHỈ auto-scope 7 method ĐỌC. Mọi
// `update`/`updateMany`/`delete` phải tự kiểm phạm vi trước, nếu không là IDOR ghi
// liên cơ sở và nó hỏng CÂM (không lỗi, chỉ ghi nhầm dữ liệu cơ sở khác).
//
// Ngoài ra `TrialClassSession` KHÔNG thuộc `SCOPED_MODELS` — nó thừa hưởng phạm vi
// qua quan hệ lên lớp, nên phải load kèm lớp rồi `passesScope` trên lớp.
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import type { Session } from "next-auth";

export async function requireSession(): Promise<Session | null> {
  const session = await auth();
  if (!session?.user) return null;
  return session;
}

/**
 * Actor có được thao tác trên cơ sở `centerId` không.
 * GHI đối xứng với ĐỌC: role Hội sở không có quyền trial thì cũng không tạo được
 * lớp ở cơ sở khác.
 */
export function actorCanUseCenter(actor: Actor, centerId: string): boolean {
  return passesScope("TrialClassV2", { centerId }, actor);
}

export type ScopedClass = {
  id: string;
  centerId: string;
  teacherId: string | null;
  status: string;
  name: string;
  /**
   * NGÀY + KHUNG GIỜ lớp mở (22/09/2026). `null` với lớp tạo TRƯỚC ngày đó — chốt 28/08
   * để ba cột này trống có chủ đích, nên `null` ở đây là "lớp cũ", không phải dữ liệu
   * hỏng, và cổng khung giờ cố ý KHÔNG chặn lớp cũ.
   */
  startDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  /** 23/09 — lớp theo khung hay lớp cũ (lib/trial/nghia-null.ts). KHÔNG đoán từ giờ. */
  theoKhung: boolean;
};

/** Lấy lớp trải nghiệm trong tầm nhìn của actor. null = ngoài phạm vi hoặc không có. */
export async function loadScopedTrialClass(
  actor: Actor,
  trialClassId: string,
): Promise<ScopedClass | null> {
  const sdb = scopedDb(actor);
  const row = await sdb.trialClassV2.findUnique({
    where: { id: trialClassId },
    // 22/09/2026 — thêm NGÀY + KHUNG GIỜ của lớp: cổng "case phải nằm trong khung lớp"
    // đọc từ đây. Thiếu ba cột này thì cổng không có gì để so và im lặng cho qua.
    select: {
      id: true,
      centerId: true,
      teacherId: true,
      status: true,
      name: true,
      startDate: true,
      startTime: true,
      endTime: true,
      theoKhung: true,
    },
  });
  if (!row || !passesScope("TrialClassV2", row, actor)) return null;
  return row;
}

export type ScopedSession = {
  id: string;
  trialClassId: string;
  centerId: string;
  /**
   * ⚠️ 28/08 — giáo viên ở CẤP LỚP đã thôi dùng (đặt ở từng buổi). Trường này giữ lại
   * cho dữ liệu cũ; đường mới phải đọc `teacherId` của chính BUỔI ngay dưới.
   */
  classTeacherId: string | null;
  // 28/08 — thêm chính các cột của BUỔI: sửa/huỷ buổi cần biết giá trị TRƯỚC khi đổi
  // để so ra "có dời lịch không" và để báo đúng người vừa bị thay.
  seq: number;
  date: Date;
  startTime: string;
  endTime: string;
  roomId: string | null;
  teacherId: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  /** 23/09 — ai TAO case nay. `null` = buoi truoc 23/09/2026 (cot khong backfill). */
  createdById: string | null;
};

/**
 * Lấy một buổi của lớp trải nghiệm, kèm phạm vi suy từ lớp cha.
 * Dùng cho điểm danh và hoàn tất buổi.
 */
export async function loadScopedTrialSession(
  actor: Actor,
  trialSessionId: string,
): Promise<ScopedSession | null> {
  const sdb = scopedDb(actor);
  const ses = await sdb.trialClassSession.findUnique({
    where: { id: trialSessionId },
    select: {
      id: true,
      trialClassId: true,
      seq: true,
      date: true,
      startTime: true,
      endTime: true,
      roomId: true,
      teacherId: true,
      status: true,
      // 23/09 — dau vao cua `quyenSuaCase`. Thieu cot nay thi cong sua/xoa case khong
      // co gi de tua vao va se cho qua tat ca.
      createdById: true,
      trialClass: { select: { centerId: true, teacherId: true } },
    },
  });
  if (!ses || !ses.trialClass) return null;
  if (!passesScope("TrialClassV2", ses.trialClass, actor)) return null;
  return {
    id: ses.id,
    trialClassId: ses.trialClassId,
    centerId: ses.trialClass.centerId,
    classTeacherId: ses.trialClass.teacherId,
    seq: ses.seq,
    date: ses.date,
    startTime: ses.startTime,
    endTime: ses.endTime,
    roomId: ses.roomId,
    teacherId: ses.teacherId,
    status: ses.status,
    createdById: ses.createdById,
  };
}

export type ScopedBooking = {
  id: string;
  leadId: string;
  status: string;
  scheduledAt: Date | null;
  centerId: string | null;
  teacherId: string | null;
  /** Phòng ĐANG gán — cần để lượt lưu không bị rào phạm vi đá văng dữ liệu cũ. */
  roomId: string | null;
  hasFeedback: boolean;
};

/** Lấy buổi hẹn học thử V1 trong tầm nhìn của actor. */
export async function loadScopedBooking(
  actor: Actor,
  trialId: string,
): Promise<ScopedBooking | null> {
  const sdb = scopedDb(actor);
  const row = await sdb.trialClass.findUnique({
    where: { id: trialId },
    select: {
      id: true,
      leadId: true,
      status: true,
      scheduledAt: true,
      centerId: true,
      teacherId: true,
      roomId: true,
      feedback: { select: { id: true } },
    },
  });
  if (!row || !passesScope("TrialClass", row, actor)) return null;
  return {
    id: row.id,
    leadId: row.leadId,
    status: row.status,
    scheduledAt: row.scheduledAt,
    centerId: row.centerId,
    teacherId: row.teacherId,
    roomId: row.roomId,
    hasFeedback: Boolean(row.feedback),
  };
}

/** Tiện dụng: lấy session + actor một lượt. */
export async function requireActor(): Promise<{ session: Session; actor: Actor } | null> {
  const session = await requireSession();
  if (!session?.user?.id) return null;
  const actor = await resolveActor(session.user.id);
  return { session, actor };
}
