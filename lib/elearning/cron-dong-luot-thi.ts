import { scopedDb } from "@/lib/db-scope";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { AN_HAN_GIAY } from "@/lib/elearning/exam-grading";
import { CUA_SO_BAO_NGUOI_HOC_MS, canDongLuot, hanChotLuot } from "@/lib/elearning/exam-close-pure";
import { notifyElearning } from "@/lib/elearning/notify-gate";
import { dongLuotThi, LuotDaDongError } from "@/lib/elearning/exam-close";
import { ghiXongBaiThi } from "@/lib/elearning/exam-taking";

/**
 * F-05 — ĐÓNG LƯỢT THI BỎ DỞ QUÁ HẠN (việc 6 của khe cron `elearning-reminders`).
 *
 * Chỉ chạy khi cờ `ELEARNING_EXAM_AUTO_CLOSE_ENABLED` bật (mặc định TẮT — thời gian chờ và hành vi chấm CHƯA được owner chốt).
 *
 * Luật (chốt tạm theo đặc tả hiện có — mọi mục mở nằm ở `docs/elearning/uat/defects-va-quyet-dinh-*.md`):
 *  · Đóng khi quá `startedAt + durationMin + ân hạn 60s + biên chờ` (biên mặc định 15 phút, ≥ 5): lúc đó việc lưu câu đã bị
 *    từ chối từ lâu nên tập câu trả lời đã đóng băng — chấm lúc này chấm đúng thứ người học đã lưu.
 *  · CHẤM phần đã lưu (giống người học bấm Nộp). `submittedAt` = HẠN CHÓT làm bài (không phải giờ cron) — đếm cooldown tất định,
 *    không phạt người học vì độ trễ của hệ thống.
 *  · Một lượt chỉ được đóng MỘT lần: `dongLuotThi` claim có điều kiện `status = IN_PROGRESS`; thua claim (người học vừa nộp, hoặc
 *    lượt cron khác) ⇒ `daBoQua`, không phải lỗi. Chỉ bên THẮNG claim được chạy bước "ghi xong bài học" ⇒ không chứng nhận trùng.
 *  · Đạt ⇒ ghi xong bài như đường người học (`ghiXongBaiThi`, có guard REVOKED); câu tự luận ⇒ `PENDING_GRADE` vào hàng đợi chấm.
 *  · Mỗi lượt đóng để lại một dòng AuditLog (`closedBy: AUTO_EXPIRY`), cùng giao dịch với việc đóng.
 *  · ĐỐI SOÁT (`doiSoatLuotDaDat`): "ghi xong bài" chạy SAU commit nên có thể hỏng riêng (lượt đã GRADED + đạt mà bài chưa DONE,
 *    không ai chọn lại nó). Mỗi lần chạy vá các lượt đạt trong 48 giờ mà bài chưa DONE — cả lượt do người học nộp / người chấm
 *    chốt. `ghiXongBai` idempotent; chỉ chạm bài CHƯA DONE nên không đổi `lastActivityAt` của bài đã xong.
 *
 * Chạy lại an toàn: lượt đã đóng không còn `IN_PROGRESS` nên không bao giờ được chọn lần nữa.
 */

const TOI_DA_MOI_LAN = 50;
const TRANG = 200;
/** Trần số hàng quét mỗi lần — đủ để không bị lượt chưa tới hạn (đề dài) chặn đầu hàng đợi, nhưng có chặn. */
const TRAN_QUET = 2000;
const TRAN_MS = 90_000;
const CUA_SO_DOI_SOAT_MS = 48 * 3_600_000;

export type KetQuaDongLuotHetHan = {
  /** Số lượt đã QUÁ HẠN tìm thấy trong vùng quét. */
  daXet: number;
  daDong: number;
  /** Thua claim: lượt đã được người học / lượt cron khác đóng trước. Bình thường, không phải lỗi. */
  daBoQua: number;
  /** Số lượt đã quá hạn nhưng lần này chưa tới lượt (giới hạn mỗi lần / hết giờ). Nói ra thay vì im lặng. */
  conSot: number;
  /** Số lượt đạt đã đóng mà bài chưa DONE, được vá ở bước đối soát. */
  daVa: number;
  /** Số thông báo trong ứng dụng đã gửi cho người học (chỉ lượt vừa hết hạn trong 24 giờ; qua cổng người nhận). */
  daBaoNguoiHoc: number;
  /** Lượt quá hạn nhưng cũ hơn `ELEARNING_EXAM_AUTO_CLOSE_MAX_AGE_DAYS` ⇒ GIỮ NGUYÊN, không đóng. */
  boQuaQuaCu: number;
  loi: string[];
};

type UngVien = {
  id: string;
  examId: string;
  userId: string;
  enrollmentId: string | null;
  attemptNo: number;
  startedAt: Date;
  centerId: string | null;
  orgUnitId: string | null;
  exam: { title: string; durationMin: number; passScore: number };
};

export async function dongLuotThiHetHan(
  now: Date,
  /**
   * `trang`: chỉ để TEST (kích thước trang quét). Mặc định 200.
   * `tuoiToiDaNgay`: lượt có hạn chót cũ hơn mốc này không bị đóng (câu hỏi owner #7); bỏ trống = không giới hạn.
   */
  opts: { marginPhut: number; trang?: number; tuoiToiDaNgay?: number },
): Promise<KetQuaDongLuotHetHan> {
  const ket: KetQuaDongLuotHetHan = { daXet: 0, daDong: 0, daBoQua: 0, conSot: 0, daVa: 0, daBaoNguoiHoc: 0, boQuaQuaCu: 0, loi: [] };
  const batDau = Date.now();
  const conGio = () => Date.now() - batDau < TRAN_MS;
  const sdb = scopedDb(SYSTEM_ACTOR);

  // Điều kiện cần (rẻ, dùng được chỉ mục): đã bắt đầu quá ân hạn + biên. Hạn chót thật còn phụ thuộc `durationMin` của đề nên
  // lọc nốt bằng `canDongLuot` ở bộ nhớ. ⚠️ Quét theo TRANG (không `take` một lần): lượt của đề dài còn trong thời gian làm bài
  // nằm đầu hàng đợi theo `startedAt` và sẽ che mất lượt đã quá hạn của đề ngắn nếu chỉ lấy 200 hàng đầu.
  const gioiHan = new Date(now.getTime() - (AN_HAN_GIAY + opts.marginPhut * 60) * 1000);
  const kichTrang = opts.trang ?? TRANG;
  const het: UngVien[] = [];
  let conTro: string | undefined;
  let daQuet = 0;
  while (het.length < TOI_DA_MOI_LAN * 2 && daQuet < TRAN_QUET && conGio()) {
    const trang: UngVien[] = await sdb.trnExamAttempt.findMany({
      where: { status: "IN_PROGRESS", startedAt: { lt: gioiHan }, exam: { deletedAt: null } },
      select: {
        id: true,
        examId: true,
        userId: true,
        enrollmentId: true,
        attemptNo: true,
        startedAt: true,
        centerId: true,
        orgUnitId: true,
        exam: { select: { title: true, durationMin: true, passScore: true } },
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      take: kichTrang,
      ...(conTro ? { cursor: { id: conTro }, skip: 1 } : {}),
    });
    daQuet += trang.length;
    for (const r of trang) {
      if (
        canDongLuot({
          startedAt: r.startedAt,
          durationMin: r.exam.durationMin,
          now,
          marginPhut: opts.marginPhut,
        })
      ) {
        const hanChot = hanChotLuot({ startedAt: r.startedAt, durationMin: r.exam.durationMin });
        if (opts.tuoiToiDaNgay !== undefined && now.getTime() - hanChot.getTime() > opts.tuoiToiDaNgay * 86_400_000) {
          ket.boQuaQuaCu += 1;
          continue;
        }
        het.push(r);
      }
    }
    if (trang.length < kichTrang) break;
    conTro = trang[trang.length - 1]!.id;
  }
  ket.daXet = het.length;
  const lan = het.slice(0, TOI_DA_MOI_LAN);
  ket.conSot = het.length - lan.length;

  for (const r of lan) {
    if (!conGio()) {
      ket.conSot += 1;
      continue;
    }
    const hanChot = hanChotLuot({ startedAt: r.startedAt, durationMin: r.exam.durationMin });
    try {
      const kq = await dongLuotThi(sdb, {
        luot: {
          id: r.id,
          examId: r.examId,
          attemptNo: r.attemptNo,
          passScore: r.exam.passScore,
          centerId: r.centerId,
          orgUnitId: r.orgUnitId,
        },
        via: "AUTO_EXPIRY",
        submittedAt: hanChot,
        audit: {
          reason: "Hết giờ — hệ thống tự đóng lượt thi bỏ dở",
          extra: {
            userId: r.userId,
            hanChotLuc: hanChot.toISOString(),
            bienChoPhut: opts.marginPhut,
          },
        },
      });
      ket.daDong += 1;

      // Thông báo TRONG ỨNG DỤNG cho người học — chỉ bên THẮNG claim tới được đây (nên không báo đôi), và chỉ khi lượt vừa mới hết hạn:
      // lượt tồn đọng cũ hơn 24 giờ đóng im lặng. Đi qua cổng người nhận (`notify-gate`); `dedupeKey` theo lượt ⇒ chạy lại không đẻ thêm.
      // Lỗi gửi KHÔNG làm mất kết quả đã đóng.
      if (now.getTime() - hanChot.getTime() <= CUA_SO_BAO_NGUOI_HOC_MS) {
        try {
          const so = await notifyElearning({
            userIds: [r.userId],
            dedupeKey: `el.thi-tu-dong:${r.id}`,
            title: `Lượt thi "${r.exam.title}" đã được hệ thống đóng vì hết giờ`,
            body: kq.choChamTay
              ? "Phần bạn đã làm được lưu lại; câu tự luận đang chờ người chấm."
              : kq.passed
                ? "Phần bạn đã làm được chấm: đạt."
                : "Phần bạn đã làm được chấm. Xem kết quả và số lượt thi còn lại trong khoá học.",
            href: r.enrollmentId ? `/elearning/hoc/${r.enrollmentId}` : "/elearning",
            entityId: r.enrollmentId ?? r.id,
          });
          if (so > 0) ket.daBaoNguoiHoc += 1;
        } catch (e) {
          ket.loi.push(`thongBao:${r.id}: ${(e as Error).message}`);
        }
      }

      // Ghi xong bài học SAU commit — đúng thứ tự đường người học (`cauHinhNopBai`). Lỗi ở đây KHÔNG làm mất kết quả đã đóng:
      // báo vào `loi`, và bước đối soát bên dưới vá lại ở lần chạy sau.
      if (kq.passed === true && r.enrollmentId) {
        try {
          const gd = await sdb.trnEnrollment.findFirst({
            where: { id: r.enrollmentId },
            select: { courseId: true },
          });
          if (gd) {
            await ghiXongBaiThi(sdb, {
              enrollmentId: r.enrollmentId,
              userId: r.userId,
              examId: r.examId,
              courseId: gd.courseId,
              now: hanChot,
            });
          }
        } catch (e) {
          ket.loi.push(`ghiXongBai:${r.id}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      if (e instanceof LuotDaDongError) ket.daBoQua += 1;
      else ket.loi.push(`dong:${r.id}: ${(e as Error).message}`);
    }
  }

  try {
    ket.daVa = await doiSoatLuotDaDat(sdb, now, conGio);
  } catch (e) {
    ket.loi.push(`doiSoat: ${(e as Error).message}`);
  }
  return ket;
}

/**
 * Vá lượt ĐẠT trong 48 giờ qua mà bài kiểm tra tương ứng chưa DONE. Trả số lượt đã vá.
 *
 * ⚠️ Chỉ gọi `ghiXongBaiThi` cho bài CHƯA DONE: nó là upsert nên gọi cho bài đã DONE sẽ đổi `lastActivityAt` mỗi 15 phút.
 * Lượt ghi danh đã THU HỒI được `ghiXongBai` tự bỏ qua (guard REVOKED).
 */
async function doiSoatLuotDaDat(
  sdb: ReturnType<typeof scopedDb>,
  now: Date,
  conGio: () => boolean,
): Promise<number> {
  const luot = await sdb.trnExamAttempt.findMany({
    where: {
      status: "GRADED",
      passed: true,
      enrollmentId: { not: null },
      gradedAt: { gte: new Date(now.getTime() - CUA_SO_DOI_SOAT_MS) },
    },
    select: { id: true, userId: true, examId: true, enrollmentId: true, gradedAt: true },
    orderBy: { gradedAt: "desc" },
    take: 200,
  });
  if (luot.length === 0) return 0;

  const enIds = [...new Set(luot.map((l) => l.enrollmentId!))];
  const examIds = [...new Set(luot.map((l) => l.examId))];
  const [ghiDanh, baiThi] = await Promise.all([
    sdb.trnEnrollment.findMany({
      where: { id: { in: enIds }, status: { not: "REVOKED" } },
      select: { id: true, courseId: true },
    }),
    sdb.trnLesson.findMany({
      where: { examId: { in: examIds }, deletedAt: null },
      select: { id: true, examId: true, module: { select: { courseId: true } } },
    }),
  ]);
  const khoaCua = new Map(ghiDanh.map((g) => [g.id, g.courseId]));
  const baiCua = (examId: string, courseId: string) =>
    baiThi.find((b) => b.examId === examId && b.module.courseId === courseId)?.id ?? null;

  const cap = luot
    .map((l) => {
      const courseId = khoaCua.get(l.enrollmentId!);
      const lessonId = courseId ? baiCua(l.examId, courseId) : null;
      return courseId && lessonId ? { ...l, courseId, lessonId } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (cap.length === 0) return 0;

  const xong = await sdb.trnLessonProgress.findMany({
    where: {
      status: "DONE",
      enrollmentId: { in: cap.map((c) => c.enrollmentId!) },
      lessonId: { in: cap.map((c) => c.lessonId) },
    },
    select: { enrollmentId: true, lessonId: true },
  });
  const daXong = new Set(xong.map((x) => `${x.enrollmentId}:${x.lessonId}`));

  let va = 0;
  for (const c of cap) {
    if (!conGio()) break;
    if (daXong.has(`${c.enrollmentId}:${c.lessonId}`)) continue;
    await ghiXongBaiThi(sdb, {
      enrollmentId: c.enrollmentId!,
      userId: c.userId,
      examId: c.examId,
      courseId: c.courseId,
      now: c.gradedAt ?? now,
    });
    va += 1;
  }
  return va;
}
