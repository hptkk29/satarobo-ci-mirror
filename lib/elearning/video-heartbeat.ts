import "server-only";

import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import {
  assertPolicyAccepted,
  PolicyNotAcceptedError,
} from "@/lib/elearning/policy-acceptance";
import { cuonKhoaSauKhiXongBai } from "@/lib/elearning/rollup";
import { checkContentAccess } from "@/lib/elearning/content-gate";
import { kiemVeMedia } from "@/lib/elearning/media-ticket";
import { effectiveAllowLate, isProgressWriteLocked } from "@/lib/elearning/due-lock";
import {
  gopNhipXem,
  soDoanCua,
  DOAN_GIAY,
  TRAN_DELTA_GIAY,
} from "@/lib/elearning/segment-bitmap";
import {
  chanTuaToi,
  vuotTranTocDo,
  quyetDinhKhoaPhat,
  nhipDenMuon,
  THONG_BAO_LOI,
  type MaLoiNhip,
  type NhipXemKetQua,
  type ThachThuc,
} from "@/lib/elearning/video-heartbeat-contract";
import {
  docSoCue,
  idCue,
  locCauHoiChoNguoiHoc,
  quyetDinhCue,
  type CauHoiCue,
} from "@/lib/elearning/lesson-cue";
import {
  nenHoiTapTrung,
  tinhTrangThachThuc,
  traLoiHopLe,
  idThachThuc,
  CAU_HOI_TAP_TRUNG,
  HAN_TRA_LOI_GIAY,
} from "@/lib/elearning/attention-check";

/**
 * EL-12b — GHI NHỊP XEM VIDEO.
 *
 * Anh em song sinh của `ghiNhipDoc` (EL-04) và đi ĐÚNG chuỗi cổng của nó:
 *
 *   quyền vào khu → quyền học → VÉ PHÁT → SỞ HỮU → thu hồi → chính sách
 *   → bài thuộc khoá + cổng nội dung → khoá sau hạn → tốc độ → khoá phát
 *   → nhịp trễ → chặn tua → câu hỏi đang treo → GHI
 *
 * Thứ tự là hợp đồng, không phải gu — lý do đầy đủ nằm ở đầu `reading-progress.ts`.
 * Ba cổng riêng của video chèn vào đúng chỗ chúng có đủ dữ liệu để phán:
 *  · TỐC ĐỘ đứng trước khoá phát vì nó chỉ cần con số trong thân yêu cầu.
 *  · CHẶN TUA phải đứng SAU khi nạp tiến độ — nó so với `maxPositionSec` đã ghi.
 *  · CÂU HỎI ĐANG TREO đứng ngay trước lúc ghi: hỏi rồi mà chưa trả lời thì khoảng
 *    vừa xem KHÔNG được tính, còn mọi cổng trước đó vẫn phải kiểm.
 *
 * ⚠️ VÉ PHÁT KHÔNG thay `can()`. Repo này có luật cứng "mọi kiểm tra quyền đi qua
 * duy nhất `can()`", nên quyền vẫn hỏi `can()` mỗi nhịp y như bài đọc. Vé giữ một
 * việc KHÁC mà `can()` không làm được: nó chứng minh nhịp này đến từ một người ĐÃ
 * MỞ trình phát. Không có nó thì bất kỳ ai có phiên đăng nhập hợp lệ đều gửi thẳng
 * nhịp mà chẳng tải một byte video nào — đúng cái gian lận "khai giờ xem mà không
 * xem" mà cả bộ tám cơ chế sinh ra để chặn.
 */

export type GhiNhipXemInput = {
  actor: Actor;
  /** Vé media đã ký lúc mở trình phát. */
  ve: string;
  enrollmentId: string;
  lessonId: string;
  tuSec: number;
  denSec: number;
  seq: number;
  tocDo: number;
  tabHien: boolean;
  viTriSec: number;
  /** Trả lời thách thức — xem `nhipXemSchema` trong hợp đồng. */
  traLoiThachThuc?: { id: string; dapAn?: string | null } | null;
  now: Date;
  /**
   * Kết quả giành khoá phát, do Route Handler lấy — tầng này không chạm Redis.
   * Vắng mặt = chưa giành khoá ⇒ bỏ qua cơ chế chống xem song song.
   */
  khoaPhat?: { backend: string; khoaThuocNguoiKhac: boolean };
};

export type GhiNhipXemKetQua =
  | { ok: true; data: NhipXemKetQua }
  | { ok: false; code: MaLoiNhip | "NOT_FOUND" | "PERMISSION_DENIED"; message: string };

const loi = (code: MaLoiNhip): GhiNhipXemKetQua => ({
  ok: false,
  code,
  message: THONG_BAO_LOI[code],
});

/** Nhịp cùng người + cùng bài mà nhịp cuối còn trong ngần này thì là CÙNG phiên xem. */
const CUA_SO_PHIEN_PHUT = 5;
/** Tầng 2 giữ 90 ngày rồi cron dọn — `purgeAfter` ghi cứng lúc INSERT. */
const GIU_NGAY = 90;
/** Phủ tới mức này thì coi như xem xong bài. */
const NGUONG_XONG_PCT = 95;

export async function ghiNhipXem(input: GhiNhipXemInput): Promise<GhiNhipXemKetQua> {
  const { actor, now } = input;

  // ── 1. Quyền ──────────────────────────────────────────────────────────────
  if (!can(actor, "elearning:portal:access") || !can(actor, "elearning:lesson:learn")) {
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      message: "Bạn không có quyền học trong khu đào tạo nội bộ",
    };
  }

  // ── 2. Vé phát — chặn nhịp bịa TRƯỚC khi tốn một câu truy vấn nào ─────────
  const ve = kiemVeMedia(input.ve, now.getTime());
  if (!ve.ok || ve.ve?.userId !== actor.userId || ve.ve?.lessonId !== input.lessonId) {
    // Ba trường hợp một lỗi: vé hỏng, vé của người khác, vé của bài khác. Tách
    // thông báo ra là nói cho người dò biết vé họ nhặt được thuộc về cái gì.
    return loi("TICKET_INVALID");
  }

  // ── 3. Sở hữu — chống IDOR ────────────────────────────────────────────────
  const enrollment = await db.trnEnrollment.findFirst({
    where: { id: input.enrollmentId, userId: actor.userId },
    select: {
      id: true,
      courseId: true,
      status: true,
      dueAt: true,
      assignmentId: true,
      assignment: {
        select: { allowLate: true, blockSeek: true, maxPlaybackRate: true },
      },
    },
  });
  if (!enrollment) {
    return { ok: false, code: "NOT_FOUND", message: "Không tìm thấy lượt học của bạn" };
  }
  if (enrollment.status === "REVOKED") return loi("REVOKED");

  // ── 4. Chính sách theo dõi — TRƯỚC khi ghi ────────────────────────────────
  try {
    await assertPolicyAccepted(actor.userId);
  } catch (e) {
    if (e instanceof PolicyNotAcceptedError) return loi("POLICY_NOT_ACCEPTED");
    throw e;
  }

  // ── 5. Bài phải thuộc khoá của lượt này + cổng nội dung ───────────────────
  const lesson = await db.trnLesson.findFirst({
    where: {
      id: input.lessonId,
      deletedAt: null,
      module: { courseId: enrollment.courseId },
    },
    select: {
      id: true,
      kind: true,
      durationSec: true,
      // ⚠️ Nạp cue NGAY TRONG câu truy vấn bài, không thêm một lượt đọc riêng cho
      // mỗi nhịp của mỗi người đang xem. Bài không có cue thì mảng rỗng và mọi
      // nhánh dưới đây thoát ngay.
      cues: {
        select: { id: true, atSec: true, blocking: true, inlineJson: true },
        orderBy: { atSec: "asc" },
      },
    },
  });
  if (!lesson) return { ok: false, code: "NOT_FOUND", message: "Không tìm thấy bài học" };

  const course = await db.trnCourse.findUnique({
    where: { id: enrollment.courseId },
    select: {
      id: true,
      visibility: true,
      selfEnrollEnabled: true,
      securityLevel: true,
      versions: { where: { status: "PUBLISHED" }, select: { id: true }, take: 1 },
    },
  });
  if (!course) return { ok: false, code: "NOT_FOUND", message: "Không tìm thấy khoá học" };
  const tuChoi = checkContentAccess({
    actor,
    course: {
      id: course.id,
      visibility: course.visibility,
      selfEnrollEnabled: course.selfEnrollEnabled,
      securityLevel: course.securityLevel,
      hasPublishedVersion: course.versions.length > 0,
    },
    hasEnrollment: true,
  });
  if (tuChoi) return { ok: false, code: "NOT_FOUND", message: tuChoi.message };

  // ── 6. Khoá sau hạn ───────────────────────────────────────────────────────
  const allowLate = effectiveAllowLate({
    assignmentId: enrollment.assignmentId,
    assignmentAllowLate: enrollment.assignment?.allowLate,
  });
  if (isProgressWriteLocked({ dueAt: enrollment.dueAt, allowLate, now })) {
    return loi("DUE_PASSED");
  }

  // ── 7. Trần tốc độ phát ───────────────────────────────────────────────────
  // ⚠️ Kiểm ở ĐÂY, không chỉ ở trình phát: `video.playbackRate = 4` gõ trong bảng
  // điều khiển là qua mặt mọi thứ client làm.
  if (vuotTranTocDo(input.tocDo, enrollment.assignment?.maxPlaybackRate ?? undefined)) {
    return loi("RATE_TOO_HIGH");
  }

  // ── 8. Chống xem song song ────────────────────────────────────────────────
  if (input.khoaPhat) {
    const kp = quyetDinhKhoaPhat(input.khoaPhat);
    if (!kp.cho) return loi(kp.ma);
  }

  // ── 9. Nạp tiến độ ────────────────────────────────────────────────────────
  const khoaDong = {
    enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id },
  };
  const cu = await db.trnLessonProgress.findUnique({
    where: khoaDong,
    select: {
      segmentBitmap: true,
      segmentSec: true,
      coveredSec: true,
      contentSec: true,
      maxPositionSec: true,
      seq: true,
      verifiedAt: true,
      attnAskedCount: true,
      attnPendingAt: true,
      cueLogJson: true,
    },
  });

  const doanGiay = cu?.segmentSec ?? DOAN_GIAY;
  const contentSec = lesson.durationSec ?? cu?.contentSec ?? 0;
  if (contentSec <= 0) {
    // Không có thời lượng thì KHÔNG có mẫu số để tính phủ. Ghi bừa là đẻ ra một
    // tỉ lệ phần trăm không dựa trên gì, rồi báo cáo tuân thủ đứng lên nó.
    return { ok: false, code: "NOT_FOUND", message: "Bài học chưa có thời lượng video" };
  }
  const soDoan = soDoanCua(contentSec, doanGiay);

  // Nhịp tới trễ / đảo thứ tự: bỏ, KHÔNG báo lỗi — với người học không có gì sai,
  // và một lỗi ở đây sẽ hiện lên giữa lúc họ đang xem.
  if (cu && nhipDenMuon(input.seq, cu.seq)) {
    return {
      ok: true,
      data: {
        coveredSec: cu.coveredSec,
        coveragePercent: Math.round((cu.coveredSec / contentSec) * 100),
        status: "BO_QUA",
        meta: { seq: cu.seq },
      },
    };
  }

  // ── 10. Chặn tua tới ──────────────────────────────────────────────────────
  const maxDaXem = cu?.maxPositionSec ?? 0;
  const soCue = docSoCue(cu?.cueLogJson ?? null);
  if (
    chanTuaToi({
      // ⚠️ `tuSec`, KHÔNG phải `viTriSec` — lý do đầy đủ ở `chanTuaToi`. Truyền
      // nhầm con trỏ vào đây là chặn mọi nhịp của mọi người.
      batDauSec: input.tuSec,
      maxDaXemSec: maxDaXem,
      chanTua: enrollment.assignment?.blockSeek ?? true,
      // ⚠️ Nới dung sai đúng MỘT nhịp khi đang có câu hỏi treo.
      //
      // Video bị dừng GIỮA một nhịp, nên con trỏ của trình phát nằm trước mốc đã
      // ghi tới một khoảng nhịp. Nhịp MANG CÂU TRẢ LỜI bắt đầu từ đó, và nếu đo
      // bằng dung sai 2 giây thì chính câu trả lời bị cổng này nuốt — người học
      // kẹt cứng với thông báo "khoá này không cho tua tới", không liên quan gì
      // tới việc họ vừa làm.
      //
      // Nới ở đây KHÔNG mở đường gian lận: phần được ghi nhận vẫn bị trần delta
      // cắt, và khoảng khai rộng hơn chỉ làm họ mất công xem lại.
      dungSaiSec: soCue.treo ? TRAN_DELTA_GIAY : undefined,
    })
  ) {
    // Đếm lượt bị chặn NGAY CẢ KHI từ chối nhịp: đây chính là số liệu của báo cáo
    // giám sát (EL-13). Từ chối mà không đếm là vứt đúng thứ cần đo.
    //
    // Dùng `updateMany` chứ không `update`: dòng tiến độ có thể chưa tồn tại (người
    // vừa mở bài đã tua ngay), và `update` trên dòng không có sẽ NÉM lỗi — biến một
    // cú tua bị chặn thành lỗi 500.
    await db.trnLessonProgress.updateMany({
      where: { enrollmentId: enrollment.id, lessonId: lesson.id },
      data: { blockedSeekCount: { increment: 1 }, seekCount: { increment: 1 } },
    });
    return loi("SEEK_BLOCKED");
  }

  // ── 11a. CÂU HỎI CHÈN GIỮA VIDEO ──────────────────────────────────────────
  //
  // ⚠️ Xét TRƯỚC điểm kiểm tra tập trung, và dùng SỔ RIÊNG (`cueLogJson`), không
  // đụng `attnPendingAt`/`attnAskedCount`. Ba lý do, cả ba đều hỏng im lặng:
  //
  //  1. `attnAskedCount` CHÍNH LÀ đầu vào của `nenHoiTapTrung`. Cue tăng nó thì
  //     video có 5 cue sẽ gần như không bao giờ hỏi tập trung nữa — vô hiệu hoá
  //     một cơ chế giám sát mà không ai thấy. Và ô báo cáo "tập trung 5/5" thành
  //     con số bịa.
  //  2. `TrnLessonProgress` chỉ có MỘT ô treo, và id câu hỏi chính là mốc
  //     `attnPendingAt`. Hai loại cùng đến hạn trong một nhịp sẽ ghi đè nhau, và
  //     người học kẹt với một thông báo không liên quan tới việc họ vừa làm.
  //  3. Ưu tiên CUE khi cả hai cùng đến: cue neo vào một giây cụ thể, bỏ là bỏ
  //     luôn. Tập trung nhường một nhịp và vẫn nổ ở nhịp sau.
  //
  // ⚠️ Quyết định là hàm THUẦN (`quyetDinhCue`); tầng này chỉ THI HÀNH. Bản đầu
  // trộn hai việc và thoát sớm ngay tại đây, nên đoạn xem tới mốc cue bay mất và
  // `maxPositionSec` đứng yên — làm nhịp mang câu trả lời bị chính cổng chặn-tua
  // nuốt, và MỌI cue chặn khoá cứng bài học.
  const qdCue = quyetDinhCue({
    cues: lesson.cues,
    so: soCue,
    tuSec: input.tuSec,
    denSec: input.denSec,
    traLoi: input.traLoiThachThuc ?? null,
    now,
  });

  if (qdCue.loai === "CHO") {
    // Đang treo: KHÔNG ghi nhận đoạn nào, nhưng vẫn gửi lại câu hỏi. Không gửi lại
    // thì tải lại trang là mất câu hỏi, video vẫn bị chặn, và người học không còn
    // gì để bấm.
    if (qdCue.so) {
      await db.trnLessonProgress.updateMany({
        where: { enrollmentId: enrollment.id, lessonId: lesson.id },
        data: { cueLogJson: qdCue.so as object, lastActivityAt: now },
      });
    }
    const cueDo = lesson.cues.find((x) => x.id === qdCue.cueId);
    return {
      ok: true,
      data: {
        // Tỉ lệ phủ THẬT, không phải 0 — trả 0 làm thanh tiến độ trên màn hình
        // tụt về 0% mỗi lần câu hỏi bung ra.
        coveredSec: cu?.coveredSec ?? 0,
        coveragePercent: Math.round(((cu?.coveredSec ?? 0) / contentSec) * 100),
        status: "CHO_TRA_LOI",
        meta: { seq: cu?.seq ?? 0 },
        thachThuc: thachThucCue(qdCue.cau, qdCue.cueId, cueDo?.atSec),
        ...(qdCue.saiRoi ? { saiRoi: true } : {}),
      },
    };
  }

  // `HOI` ⇒ ghi nhận tới ĐÚNG mốc cue rồi treo. Mọi nhánh còn lại ghi trọn khoảng.
  const catDen = qdCue.loai === "HOI" ? qdCue.catDen : input.denSec;
  const soCueMoi = qdCue.so;

  // ── 11b. Câu hỏi tập trung đang treo ──────────────────────────────────────
  const treo = tinhTrangThachThuc({ attnPendingAt: cu?.attnPendingAt ?? null, now });
  let daTraLoi = false;
  if (treo !== "KHONG_CO") {
    if (
      traLoiHopLe({
        // Điểm kiểm tra tập trung chỉ cần id — nó hỏi "còn ở đây không", không
        // hỏi kiến thức. Lấy `id` ra khỏi object thay vì bắt hàm kia biết về cue.
        traLoi: input.traLoiThachThuc?.id ?? null,
        attnPendingAt: cu!.attnPendingAt,
      })
    ) {
      daTraLoi = true;
    } else if (treo === "QUA_HAN") {
      // Quá hạn mà chưa trả lời: ngưng ghi nhận nhịp này và gỡ câu treo để người
      // học xem tiếp được. KHÔNG xoá bitmap đã có — bằng chứng đã học vẫn là bằng
      // chứng, và số lượt trượt suy ra được từ `attnAskedCount - attnPassedCount`.
      await db.trnLessonProgress.updateMany({
        where: { enrollmentId: enrollment.id, lessonId: lesson.id },
        data: { attnPendingAt: null, attnPendingPosSec: null },
      });
      await congTruotPhien({ userId: actor.userId, lessonId: lesson.id, now });
      return loi("PAUSED_ATTENTION");
    } else {
      // Đang chờ trong hạn: chưa phạt, nhưng cũng chưa tính khoảng vừa xem.
      return loi("PAUSED_ATTENTION");
    }
  }

  // ── 12. Gộp bitmap và ghi ─────────────────────────────────────────────────
  const gop = gopNhipXem({
    bitmapCu: cu?.segmentBitmap ? new Uint8Array(cu.segmentBitmap) : null,
    soDoan,
    tuSec: input.tuSec,
    // `catDen`, không phải `input.denSec`: khi cue bung ra, video dừng Ở MỐC —
    // đoạn sau mốc chưa được xem, và tính nó là cộng cho người học đoạn họ chưa đi qua.
    denSec: catDen,
    doanGiay,
  });

  const themWatch = gop.doanMoi * doanGiay;
  // ⚠️ Mốc đã xem cũng kẹp ở `catDen`. Không kẹp thì mốc nhảy tới cuối khoảng
  // trong khi bitmap chỉ tới mốc cue — hai con số lệch nhau, và cổng chặn-tua
  // đứng trên con số rộng hơn.
  const maxMoi = Math.max(maxDaXem, Math.round(Math.min(input.viTriSec, catDen)));
  const xong = gop.coveragePercent >= NGUONG_XONG_PCT;

  // Tới lúc hỏi chưa — tính trên con số VỪA GỘP, không phải con số cũ.
  const hoi = nenHoiTapTrung({
    coveredSec: gop.coveredSec,
    daHoi: cu?.attnAskedCount ?? 0,
  });

  await db.trnLessonProgress.upsert({
    where: khoaDong,
    update: {
      segmentBitmap: Buffer.from(gop.bitmap),
      segmentSec: doanGiay,
      coveredSec: gop.coveredSec,
      contentSec,
      totalWatchSec: { increment: themWatch },
      maxPositionSec: maxMoi,
      seq: input.seq,
      lastActivityAt: now,
      status: xong ? "DONE" : "IN_PROGRESS",
      ...(soCueMoi ? { cueLogJson: soCueMoi as object } : {}),
      ...(daTraLoi
        ? {
            attnPendingAt: null,
            attnPendingPosSec: null,
            attnPassedCount: { increment: 1 },
          }
        : {}),
      // Đặt câu mới SAU nhánh xoá câu cũ: cùng một nhịp có thể vừa trả lời xong câu
      // trước vừa chạm mốc hỏi câu tiếp.
      ...(hoi
        ? {
            attnPendingAt: now,
            attnPendingPosSec: Math.round(input.viTriSec),
            attnAskedCount: { increment: 1 },
          }
        : {}),
      // `verifiedAt`/`completedAt` chỉ ĐẶT MỘT LẦN: chúng là mốc "lần đầu đạt", xem
      // lại bài sau đó không được đẩy mốc về sau.
      ...(xong && cu?.verifiedAt == null ? { verifiedAt: now, completedAt: now } : {}),
    },
    create: {
      enrollmentId: enrollment.id,
      lessonId: lesson.id,
      userId: actor.userId,
      segmentBitmap: Buffer.from(gop.bitmap),
      segmentSec: doanGiay,
      coveredSec: gop.coveredSec,
      contentSec,
      totalWatchSec: themWatch,
      maxPositionSec: maxMoi,
      seq: input.seq,
      firstStartedAt: now,
      lastActivityAt: now,
      status: xong ? "DONE" : "IN_PROGRESS",
      ...(soCueMoi ? { cueLogJson: soCueMoi as object } : {}),
      ...(hoi
        ? {
            attnPendingAt: now,
            attnPendingPosSec: Math.round(input.viTriSec),
            attnAskedCount: 1,
          }
        : {}),
      ...(xong ? { verifiedAt: now, completedAt: now } : {}),
    },
  });

  await ghiPhienXem({
    userId: actor.userId,
    lessonId: lesson.id,
    enrollmentId: enrollment.id,
    themWatch,
    maxMoi,
    now,
    dat: daTraLoi ? 1 : 0,
  });

  // Chỉ cuộn khi bài này VỪA đạt — cuộn mỗi nhịp là ba câu đếm mỗi 15 giây cho mỗi
  // người đang xem.
  if (xong && cu?.verifiedAt == null) {
    await cuonKhoaSauKhiXongBai(enrollment.id, now);
  }

  return {
    ok: true,
    data: {
      coveredSec: gop.coveredSec,
      coveragePercent: gop.coveragePercent,
      // Cue thắng khi cả hai cùng đến: nó neo vào một giây cụ thể, bỏ là bỏ luôn.
      // Điểm kiểm tra tập trung nhường một nhịp và vẫn nổ ở nhịp sau, vì điều kiện
      // của nó là `floor(covered/chuKy) > daHoi` — con số đó không mất đi.
      status: qdCue.loai === "HOI" || hoi ? "CHO_TRA_LOI" : "GHI_NHAN",
      meta: { seq: input.seq },
      ...(qdCue.loai === "HOI"
        ? {
            thachThuc: thachThucCue(
              qdCue.cau,
              qdCue.cueId,
              qdCue.catDen,
            ),
          }
        : hoi
          ? {
              thachThuc: {
                loai: "ATTENTION" as const,
                id: idThachThuc(now),
                cauHoi: CAU_HOI_TAP_TRUNG,
                hanGiay: HAN_TRA_LOI_GIAY,
                // Không có lựa chọn: chỉ cần một nút xác nhận có mặt.
                luaChon: [],
                chan: true,
              },
            }
          : {}),
      ...(gop.biCatTran ? { biCatTran: true } : {}),
    },
  };
}

/**
 * Ghi phiên xem (tầng 2 — dữ liệu giám sát, giữ 90 ngày).
 *
 * ⚠️ Bảng không có khoá duy nhất nào ngoài `id`, nên "cùng phiên" phải SUY RA: nhịp
 * cùng người + cùng bài mà nhịp cuối còn trong cửa sổ 5 phút thì nối vào phiên đó,
 * ngoài cửa sổ thì mở phiên mới. Không có ranh giới này thì hoặc mỗi nhịp đẻ một
 * dòng (bảng phình theo số nhịp, và nó là bảng giám sát chứ không phải nhật ký
 * nhịp), hoặc mọi lần xem của cả năm dồn vào một dòng và câu hỏi "người này xem mấy
 * lần" mất luôn câu trả lời.
 */
async function ghiPhienXem(i: {
  userId: string;
  lessonId: string;
  enrollmentId: string;
  themWatch: number;
  maxMoi: number;
  now: Date;
  dat: number;
}): Promise<void> {
  const phien = await timPhien(i.userId, i.lessonId, i.now);

  if (phien) {
    await db.trnVideoSession.update({
      where: { id: phien.id },
      data: {
        lastBeatAt: i.now,
        totalWatchSec: { increment: i.themWatch },
        maxPositionSec: Math.max(phien.maxPositionSec, i.maxMoi),
        ...(i.dat ? { checkpointAnswered: { increment: i.dat } } : {}),
      },
    });
    return;
  }

  await db.trnVideoSession.create({
    data: {
      lessonId: i.lessonId,
      enrollmentId: i.enrollmentId,
      userId: i.userId,
      startedAt: i.now,
      lastBeatAt: i.now,
      totalWatchSec: i.themWatch,
      maxPositionSec: i.maxMoi,
      checkpointAnswered: i.dat,
      // NOT NULL, ghi cứng lúc INSERT — cron dọn tầng 2 đi bằng chính cột này.
      purgeAfter: new Date(i.now.getTime() + GIU_NGAY * 24 * 60 * 60 * 1000),
    },
  });
}

async function timPhien(userId: string, lessonId: string, now: Date) {
  const nguong = new Date(now.getTime() - CUA_SO_PHIEN_PHUT * 60_000);
  return db.trnVideoSession.findFirst({
    where: { userId, lessonId, lastBeatAt: { gte: nguong } },
    orderBy: { lastBeatAt: "desc" },
    select: { id: true, maxPositionSec: true },
  });
}

/**
 * Trượt một câu kiểm tra tập trung.
 *
 * Đếm trên PHIÊN chứ không trên tiến độ: `TrnLessonProgress` cố ý không có cột
 * `attnMissedCount` — số trượt suy ra được từ `attnAskedCount - attnPassedCount`,
 * và thêm cột thứ ba cho cùng một sự thật là mở đường cho ba con số lệch nhau.
 */
async function congTruotPhien(i: {
  userId: string;
  lessonId: string;
  now: Date;
}): Promise<void> {
  const phien = await timPhien(i.userId, i.lessonId, i.now);
  if (!phien) return;
  await db.trnVideoSession.update({
    where: { id: phien.id },
    data: { checkpointMissed: { increment: 1 }, lastBeatAt: i.now },
  });
}

/**
 * Cổng CÂU HỎI CHÈN GIỮA VIDEO.
 *
 * Trả `null` = không có gì chặn, nhịp đi tiếp. Trả kết quả = dừng ở đây.
 *
 * ⚠️ Cue chặn KHÔNG CÓ HẠN TRẢ LỜI, cố ý. Chép nhánh `QUA_HAN` của điểm kiểm tra
 * tập trung sang đây là hỏng nặng nhất có thể: nhánh đó gỡ câu treo rồi CHO ĐI
 * TIẾP, nên "ngồi im 45 giây" trở thành đường bỏ qua MỌI câu hỏi — và triệu chứng
 * là mọi thứ vẫn trả 200, không lỗi, không cờ, không ai thấy gì.
 *
 * ⚠️ Trả lời SAI trả về 200 kèm CHÍNH câu hỏi đó, không phải mã lỗi. Hai lẽ: trình
 * phát không bao giờ được mất câu đang treo (mất là người học kẹt với video dừng
 * và không có gì để bấm), và sai-rồi-làm-lại là đường bình thường của việc học.
 */

/**
 * Thân thách thức cho một cue — CHỈ nhãn và mã, KHÔNG BAO GIỜ đáp án.
 *
 * ⚠️ `chonNhieu` gửi tường minh, không để trình phát tự đoán. Bản đầu suy từ
 * `luaChon.length > 2`, nên một câu MỘT-đáp-án có 3 lựa chọn trở lên biến thành ô
 * tích nhiều: người học tích hai ý, client gửi `"0,2"`, và câu đúng bị chấm sai.
 *
 * ⚠️ Cue chặn KHÔNG có hạn trả lời (`hanGiay: null`), cố ý. Chép nhánh hết-hạn của
 * điểm kiểm tra tập trung sang đây là hỏng nặng nhất có thể: nhánh đó gỡ câu treo
 * rồi CHO ĐI TIẾP, nên "ngồi im 45 giây" thành đường bỏ qua MỌI câu hỏi — và mọi
 * thứ vẫn trả 200, không ai thấy gì.
 */
function thachThucCue(cau: CauHoiCue, cueId: string, atSec?: number): ThachThuc {
  const loc = locCauHoiChoNguoiHoc(cau);
  return {
    loai: "CUE",
    id: idCue(cueId),
    cauHoi: loc.cauHoi,
    hanGiay: null,
    luaChon: loc.luaChon,
    chan: true,
    chonNhieu: cau.type === "multiple",
    atSec,
  };
}
