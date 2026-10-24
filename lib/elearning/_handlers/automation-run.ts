import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { notifyStaff } from "@/lib/notifications/notify";
import { elearningHomeUrl } from "@/lib/auth/hosts";
import {
  khoaChongTrungLuat,
  xetLuat,
  type DieuKien,
  type DoiTuong,
} from "@/lib/elearning/automation";

/**
 * EL-18 — THI HÀNH luật tự động hoá, chạy trên DomainEvent.
 *
 * ⚠️ IDEMPOTENT bằng RÀNG BUỘC DB (`TrnAutomationLog.dedupeKey @unique`), không bằng
 * "tra rồi mới ghi". `dispatch-events` chạy lại sự kiện khi handler ném lỗi giữa
 * chừng, và hai lượt song song cùng vượt qua được một `findFirst` — người ta bị giao
 * cùng một khoá hai lần, và đó là thứ họ nhìn thấy chứ không phải một dòng log.
 *
 * ⚠️ Mọi lần thi hành ghi MỘT DÒNG NHẬT KÝ, kể cả khi BỎ QUA. Một cỗ máy tự động chỉ
 * ghi lại lúc nó làm gì đó là một cỗ máy không giải thích được vì sao nó KHÔNG làm —
 * và "vì sao tôi không được giao khoá đó" là câu hỏi sẽ được hỏi.
 */

const str = (v: unknown): string => (v == null ? "" : String(v));

type Ngu = Record<string, unknown>;

/** Ánh xạ sự kiện → kích hoạt của cỗ máy. */
const KICH_HOAT_THEO_SU_KIEN: Record<string, string> = {
  "elearning.enrollment.completed": "KHOA_HOAN_THANH",
  "elearning.certificate.expired": "CHUNG_NHAN_HET_HAN",
  "elearning.requirement.applied": "YEU_CAU_MOI_AP_DUNG",
  // Sự kiện này do QUÉT ĐÊM phát (`cron-nhan-su-moi.ts`), không do module Nhân sự —
  // module ấy không phát DomainEvent nào. Xem chú thích ở tệp cron.
  "elearning.employee.new": "NHAN_SU_MOI",
};

export async function onChayLuatTuDong(ev: DomainEventLite): Promise<void> {
  const trigger = KICH_HOAT_THEO_SU_KIEN[ev.type];
  if (!trigger) return;

  const p = ev.payload as Ngu;
  const doiTuong = await dungDoiTuong(trigger, p);
  if (!doiTuong) return;

  const luats = await db.trnAutomationRule.findMany({
    where: { trigger: trigger as "KHOA_HOAN_THANH", enabled: true, deletedAt: null },
    select: {
      id: true,
      title: true,
      action: true,
      conditionJson: true,
      actionJson: true,
      dueDays: true,
      centerId: true,
      orgUnitId: true,
    },
    take: 100,
  });
  if (luats.length === 0) return;

  const now = new Date();
  // Mốc nghiệp vụ của khoá chống trùng: id của thứ vừa xảy ra, KHÔNG phải thời gian.
  const moc = str(p.enrollmentId ?? p.certificateId ?? p.requirementId ?? ev.id);

  // ⚠️ Nhật ký thuộc cơ sở của NGƯỜI BỊ TÁC ĐỘNG, không của luật. Luật có thể dùng chung toàn công ty
  // (`centerId = null`) hoặc của cơ sở khác; `TrnAutomationLog` là bảng "dòng nhật ký nói về MỘT con
  // người" — đóng dấu cơ sở của luật là vô hình với mọi người cấp cơ sở (null) hoặc lộ hồ sơ đào tạo của
  // người cơ sở này cho người cơ sở kia. Người học thiếu cơ sở ⇒ vẫn ghi (null) và thiHanh nói rõ.
  for (const l of luats) {
    const kq = xetLuat(
      { trigger, conditionJson: (l.conditionJson ?? {}) as DieuKien },
      doiTuong,
      now,
    );
    const dedupeKey = khoaChongTrungLuat({
      ruleId: l.id,
      userId: doiTuong.userId,
      moc,
    });

    if (!kq.khop) {
      await ghiNhatKy({
        ruleId: l.id,
        subjectUserId: doiTuong.userId,
        dedupeKey,
        outcome: "SKIPPED",
        detail: `Không khớp: ${kq.lyDo}`,
        centerId: doiTuong.centerId,
        orgUnitId: doiTuong.orgUnitId,
      });
      continue;
    }

    try {
      const daLam = await thiHanh(l, doiTuong, now, moc);
      await ghiNhatKy({
        ruleId: l.id,
        subjectUserId: doiTuong.userId,
        dedupeKey,
        outcome: daLam.ok ? "APPLIED" : "SKIPPED",
        detail: `${kq.lyDo}. ${daLam.detail}`,
        centerId: doiTuong.centerId,
        orgUnitId: doiTuong.orgUnitId,
      });
    } catch (err) {
      await ghiNhatKy({
        ruleId: l.id,
        subjectUserId: doiTuong.userId,
        dedupeKey,
        outcome: "FAILED",
        detail: `Khớp nhưng thi hành lỗi: ${String(err)}`,
        centerId: doiTuong.centerId,
        orgUnitId: doiTuong.orgUnitId,
      });
    }
  }
}

async function dungDoiTuong(
  trigger: string,
  p: Ngu,
): Promise<(DoiTuong & { centerId: string | null; orgUnitId: string | null }) | null> {
  if (trigger === "KHOA_HOAN_THANH") {
    const gd = await db.trnEnrollment.findUnique({
      where: { id: str(p.enrollmentId) },
      select: { userId: true, courseId: true, centerId: true, orgUnitId: true },
    });
    if (!gd) return null;
    const nv = await hoSo(gd.userId);
    return {
      userId: gd.userId,
      departmentId: nv.departmentId,
      joinedAt: nv.joinedAt,
      courseId: gd.courseId,
      centerId: gd.centerId,
      orgUnitId: gd.orgUnitId,
    };
  }

  if (trigger === "CHUNG_NHAN_HET_HAN") {
    const cn = await db.trnCertificate.findUnique({
      where: { id: str(p.certificateId) },
      select: { userId: true, courseId: true, centerId: true, orgUnitId: true },
    });
    if (!cn) return null;
    const nv = await hoSo(cn.userId);
    return {
      userId: cn.userId,
      departmentId: nv.departmentId,
      joinedAt: nv.joinedAt,
      courseId: cn.courseId,
      centerId: cn.centerId,
      orgUnitId: cn.orgUnitId,
    };
  }

  const userId = str(p.userId);
  if (!userId) return null;
  const nv = await hoSo(userId);
  return {
    userId,
    departmentId: nv.departmentId,
    joinedAt: nv.joinedAt,
    courseId: str(p.courseId) || null,
    centerId: nv.centerId,
    orgUnitId: nv.orgUnitId,
  };
}

async function hoSo(userId: string) {
  const nv = await db.employee.findFirst({
    where: { userAccount: { id: userId } },
    select: {
      departmentId: true,
      joinedAt: true,
      centerId: true,
      orgUnitId: true,
    },
  });
  return {
    departmentId: nv?.departmentId ?? null,
    joinedAt: nv?.joinedAt ?? null,
    centerId: nv?.centerId ?? null,
    orgUnitId: nv?.orgUnitId ?? null,
  };
}

async function thiHanh(
  l: {
    id: string;
    title: string;
    action: string;
    actionJson: unknown;
    dueDays: number;
    centerId: string | null;
    orgUnitId: string | null;
  },
  nguoi: DoiTuong & { centerId: string | null; orgUnitId: string | null },
  now: Date,
  moc: string,
): Promise<{ ok: boolean; detail: string }> {
  const a = (l.actionJson ?? {}) as Ngu;
  const han = new Date(now.getTime() + l.dueDays * 86_400_000);

  if (l.action === "GUI_NHAC") {
    const so = await notifyStaff({
      userIds: [nguoi.userId],
      // ⚠️ Khoá có MỐC sự kiện (như `khoaChongTrungLuat`). Bản đầu dùng `<luật>:<người>` trần: lần kích hoạt
      // thứ hai cho cùng (luật, người) bị `notifyStaff` nuốt, mà nhật ký vẫn ghi APPLIED "Đã gửi nhắc" —
      // cỗ máy khai đã làm một việc nó không làm. Chạy lại CÙNG sự kiện vẫn ra CÙNG khoá (idempotent).
      dedupeKey: `elearning_auto:${khoaChongTrungLuat({ ruleId: l.id, userId: nguoi.userId, moc })}`,
      title: str(a.tieuDe) || l.title,
      body: str(a.noiDung) || "",
      href: `${elearningHomeUrl().replace(/\/$/, "")}/elearning`,
      entityId: l.id,
    });
    return so > 0
      ? { ok: true, detail: "Đã gửi nhắc." }
      : { ok: false, detail: "Không gửi được cho ai — người này chưa có tài khoản?" };
  }

  const dsKhoa =
    l.action === "GIAO_KHOA"
      ? [str(a.courseId)].filter(Boolean)
      : await khoaCuaLoTrinh(str(a.pathId));

  if (dsKhoa.length === 0) {
    return { ok: false, detail: "Không có khoá nào để giao (lộ trình rỗng?)." };
  }

  // ⚠️ `centerId`/`orgUnitId` NOT NULL trên `TrnEnrollment` — lấy của NGƯỜI HỌC, không
  // của luật. Luật có thể là luật chung toàn công ty (`centerId = null`); gán null vào
  // lượt ghi danh là làm nó vô hình với chính người cấp cơ sở của người học.
  if (!nguoi.centerId || !nguoi.orgUnitId) {
    return { ok: false, detail: "Hồ sơ người học thiếu cơ sở/đơn vị — không giao được." };
  }

  let daGiao = 0;
  let boQua = 0;
  for (const courseId of dsKhoa) {
    const co = await db.trnEnrollment.findFirst({
      where: { userId: nguoi.userId, courseId, status: { not: "REVOKED" } },
      select: { id: true },
    });
    if (co) {
      boQua += 1;
      continue;
    }
    await db.trnEnrollment.create({
      data: {
        userId: nguoi.userId,
        courseId,
        source: "REQUIREMENT",
        status: "NOT_STARTED",
        dueAtOriginal: han,
        dueAt: han,
        snapJobTitle: "(tự động)",
        centerId: nguoi.centerId,
        orgUnitId: nguoi.orgUnitId,
      },
    });
    daGiao += 1;
  }

  return {
    ok: daGiao > 0,
    detail:
      daGiao > 0
        ? `Đã giao ${daGiao} khoá, hạn ${han.toLocaleDateString("vi-VN")}${boQua > 0 ? ` (bỏ qua ${boQua} khoá đã có)` : ""}.`
        : `Đã có sẵn cả ${boQua} khoá — không giao lại.`,
  };
}

async function khoaCuaLoTrinh(pathId: string): Promise<string[]> {
  if (!pathId) return [];
  const b = await db.trnLearningPathStep.findMany({
    where: { pathId },
    orderBy: { orderIndex: "asc" },
    select: { courseId: true },
  });
  return b.map((x) => x.courseId);
}

async function ghiNhatKy(d: {
  ruleId: string;
  subjectUserId: string;
  dedupeKey: string;
  outcome: "APPLIED" | "SKIPPED" | "FAILED";
  detail: string;
  centerId: string | null;
  orgUnitId: string | null;
}): Promise<void> {
  try {
    await db.trnAutomationLog.create({ data: d });
  } catch (err) {
    // P2002 trên `dedupeKey` = lượt chạy lại của hàng đợi. Đây là đường bình thường,
    // không phải lỗi — và nó chính là cơ chế chống trùng.
    if ((err as { code?: string }).code !== "P2002") throw err;
  }
}

export function registerElearningAutomationHandlers(): void {
  // ⚠️ Viết THẲNG từng loại — KHÔNG lặp trên `Object.keys(KICH_HOAT_THEO_SU_KIEN)`. Lưới
  // `lib/events/khop-phat-nghe.test.ts` quét chuỗi LITERAL `on("loại", …)` để chắc mọi sự kiện được phát đều có
  // nơi nghe; một vòng lặp động làm nó mù và báo bốn sự kiện "không ai nghe" (đã đỏ ở lượt gộp 24/10/2026).
  // Test `automation-run.test.ts` khoá cả hai phía: đúng bốn loại, và đủ literal.
  on("elearning.enrollment.completed", onChayLuatTuDong);
  on("elearning.certificate.expired", onChayLuatTuDong);
  on("elearning.requirement.applied", onChayLuatTuDong);
  on("elearning.employee.new", onChayLuatTuDong);
}
