import "server-only";

import { db } from "@/lib/db";
import {
  xetCo,
  hanKhieuNai,
  type SoLieuXet,
  type ChungCu,
} from "@/lib/elearning/watch-flag-rules";

/**
 * EL-13 — QUÉT VÀ MỞ CỜ NGHI NGỜ (việc 7a của cron đêm).
 *
 * Không có tệp này thì `watch-flag-rules.ts` là luật viết ra mà không đường nào
 * thi hành — cùng lỗi đã gặp với `trnLessonCreateSchema` (đủ luật, chỉ được gọi
 * trong test) và `kyVeMedia` (kiểm vé nhưng chưa ai phát vé).
 *
 * ⚠️ QUÉT MỖI ĐÊM, KHÔNG XÉT TRONG NHỊP. Xét trong nhịp nghĩa là mỗi 15 giây mỗi
 * người đang xem lại chạy trọn bộ luật, và một phiên còn ĐANG chạy thì mọi tỉ lệ
 * đều dở dang — người tạm dừng đi họp 20 phút sẽ trông y như người khai khống.
 * Đợi phiên đóng lại rồi mới xét là điều kiện để các con số có nghĩa.
 */

/** Chỉ xét phiên đã im lặng ít nhất ngần này phút — coi như đã đóng. */
const IM_LANG_PHUT = 30;
/** Không xét lại phiên cũ hơn ngần này ngày. */
const NHIN_LAI_NGAY = 2;
/** Trần số phiên xét trong một lượt cron. */
const LO = 300;

export type KetQuaMoCo = {
  daXet: number;
  daMo: number;
  /**
   * Số cờ KHÔNG mở được vì không xác định được người xử có tên.
   *
   * ⚠️ Con số này phải nhìn thấy được, không được nuốt. Cờ không có người xử là
   * thứ đặc tả CẤM tạo (QĐ-CDA-04 mục 4); nhưng im lặng bỏ qua nghĩa là bộ giám
   * sát trông như đang chạy trong khi nó không mở nổi một cờ nào.
   */
  thieuNguoiXu: number;
};

/**
 * Người xử CÓ TÊN cho một cơ sở.
 *
 * Lấy người mang vai Đào tạo tại đơn vị của người bị xét. Không tìm được thì
 * KHÔNG mở cờ — chứ không gán tạm cho ai đó rồi sửa sau: bản ghi đầu tiên của một
 * hồ sơ quan hệ lao động không phải chỗ để điền tạm.
 */
async function nguoiXuCua(orgUnitId: string | null): Promise<string | null> {
  if (!orgUnitId) return null;
  const vai = await db.userOrgRole.findFirst({
    where: {
      orgUnitId,
      status: "ACTIVE",
      role: { code: "TRAINING" },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
    },
    select: { userId: true },
    orderBy: { effectiveFrom: "asc" },
  });
  return vai?.userId ?? null;
}

export async function quetMoCo(now: Date): Promise<KetQuaMoCo> {
  const tuNgay = new Date(now.getTime() - NHIN_LAI_NGAY * 24 * 60 * 60 * 1000);
  const denPhut = new Date(now.getTime() - IM_LANG_PHUT * 60 * 1000);

  const phien = await db.trnVideoSession.findMany({
    where: { lastBeatAt: { gte: tuNgay, lt: denPhut } },
    select: {
      id: true,
      userId: true,
      lessonId: true,
      enrollmentId: true,
      startedAt: true,
      lastBeatAt: true,
      totalWatchSec: true,
    },
    take: LO,
    orderBy: { lastBeatAt: "desc" },
  });

  const ket: KetQuaMoCo = { daXet: 0, daMo: 0, thieuNguoiXu: 0 };

  for (const p of phien) {
    // Đã có cờ cho phiên này rồi thì bỏ qua — cron chạy mỗi đêm và cửa sổ nhìn
    // lại là 2 ngày, nên KHÔNG có bước này là mỗi phiên đáng ngờ sinh một cờ mới
    // mỗi đêm, và người bị gắn nhận hai cờ cho cùng một lần xem.
    const daCo = await db.trnWatchFlag.findFirst({
      where: { videoSessionId: p.id },
      select: { id: true },
    });
    if (daCo) continue;

    const tienDo = p.enrollmentId
      ? await db.trnLessonProgress.findUnique({
          where: {
            enrollmentId_lessonId: {
              enrollmentId: p.enrollmentId,
              lessonId: p.lessonId,
            },
          },
          select: {
            coveredSec: true,
            contentSec: true,
            blockedSeekCount: true,
            seekCount: true,
            seq: true,
            enrollment: {
              select: {
                centerId: true,
                orgUnitId: true,
                assignment: { select: { maxPlaybackRate: true } },
              },
            },
          },
        })
      : null;
    if (!tienDo) continue;

    const soLieu: SoLieuXet = {
      coveredSec: tienDo.coveredSec,
      contentSec: tienDo.contentSec,
      totalWatchSec: p.totalWatchSec,
      wallSec: Math.max(0, (p.lastBeatAt.getTime() - p.startedAt.getTime()) / 1000),
      blockedSeekCount: tienDo.blockedSeekCount,
      seekCount: tienDo.seekCount,
      soNhip: tienDo.seq,
      tranTocDo: tienDo.enrollment.assignment?.maxPlaybackRate ?? 1.5,
    };

    ket.daXet += 1;
    const cacCo = xetCo(soLieu);
    if (cacCo.length === 0) continue;

    const handler = await nguoiXuCua(tienDo.enrollment.orgUnitId);
    if (!handler) {
      ket.thieuNguoiXu += cacCo.length;
      continue;
    }

    await moCo({
      cacCo,
      userId: p.userId,
      lessonId: p.lessonId,
      enrollmentId: p.enrollmentId,
      videoSessionId: p.id,
      handlerUserId: handler,
      centerId: tienDo.enrollment.centerId,
      orgUnitId: tienDo.enrollment.orgUnitId,
      now,
    });
    ket.daMo += cacCo.length;
  }

  return ket;
}

async function moCo(i: {
  cacCo: ChungCu[];
  userId: string;
  lessonId: string;
  enrollmentId: string | null;
  videoSessionId: string;
  handlerUserId: string;
  centerId: string | null;
  orgUnitId: string | null;
  now: Date;
}): Promise<void> {
  await db.trnWatchFlag.createMany({
    data: i.cacCo.map((c) => ({
      userId: i.userId,
      lessonId: i.lessonId,
      enrollmentId: i.enrollmentId,
      subjectKind: "VIDEO_SESSION" as const,
      videoSessionId: i.videoSessionId,
      ruleCode: c.ruleCode,
      evidenceJson: c.evidenceJson,
      openedAt: i.now,
      // Hạn tính TỪ mốc mở cờ truyền vào, không từ `now()` của DB: hai nguồn thời
      // gian cho cùng một bản ghi là hai con số lệch nhau vài giây, và cron chốt
      // hết hạn sẽ chạy trên con số không khớp với con số người dùng nhìn thấy.
      appealDeadline: hanKhieuNai(i.now),
      handlerUserId: i.handlerUserId,
      centerId: i.centerId,
      orgUnitId: i.orgUnitId,
    })),
  });
}
