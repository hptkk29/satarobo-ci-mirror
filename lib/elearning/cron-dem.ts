import { db } from "@/lib/db";
import { chotCoHetHan } from "@/lib/elearning/watch-flag-close";
import { quetMoCo } from "@/lib/elearning/watch-flag-scan";
import { publishEvent } from "@/lib/events/publish";
import {
  chonQuaHan,
  mocDonTang2,
  mocDonTaiDo,
  chonTaiDoDeHuy,
  type DongQuaHan,
} from "@/lib/elearning/dem-quyet-dinh";
import { donTaiDo } from "@/lib/elearning/cleanup-multipart";
import { runDynamicAudienceSync } from "@/lib/elearning/dynamic-audience-run";
import { thuLaiHangDoiNhanSu } from "@/lib/elearning/retry-queue";

/**
 * EL-06 — CRON ĐÊM `elearning-dem`, chạy 00:47 giờ Việt Nam (`47 17 * * *` UTC).
 *
 * SÁU việc tuần tự, mỗi việc idempotent. Thứ tự KHÔNG đổi được:
 *
 *   1. quét quá hạn → `OVERDUE` + phát sự kiện
 *   2. tập ĐỘNG §10.4 — người mới khớp luật thì thêm, rời tập thì thu hồi
 *   3. chứng nhận T-30/T-7 + tự giao lại khi hết hiệu lực  ⛔ CHƯA LÀM ĐƯỢC
 *   4. dọn dữ liệu tầng 2 (QĐ-CDA-14)
 *   6. dọn lượt tải nhiều phần bỏ dở trên R2 (EL-10)
 *   5. thử lại hàng đợi "chờ dữ liệu Nhân sự"
 *   7. cờ nghi ngờ (EL-13): quét mở cờ, rồi chốt cờ hết cửa sổ khiếu nại
 *
 * Việc (6) mang số 6 nhưng chạy TRƯỚC việc (5): nó thuộc nhóm DỌN, và số thứ tự
 * giữ nguyên theo đặc tả để đối chiếu được. Đổi số cho "gọn" là làm mọi trích
 * dẫn tài liệu trỏ sai chỗ.
 *
 * ⚠️ Việc (4) phải chạy SAU (1) và (3), không chạy trước: cả hai việc kia ĐỌC
 * trạng thái của kỳ đang chốt, còn (4) thì xoá dữ liệu — dọn trước là rút thảm
 * dưới chân hai việc chưa chạy.
 *
 * ⚠️ ĐÚNG HAI khe cron cho cả module (QĐ-CDA-14 điểm 2). Việc dọn GỘP vào đây,
 * không xin khe thứ ba. Cron tập ĐỘNG riêng của EL-05 cũng đã gộp vào việc (2)
 * và trả lại khe của nó — `vercel.json` sau PR này có đúng 25 cron.
 */
import { tinhBuSla, hanSauKhiBu } from "@/lib/elearning/sla-bu";

export type KetQuaDem = {
  /**
   * EL-15c việc (0) — BÙ HẠN cho người nộp khi NGƯỜI CHẤM trễ SLA.
   *
   * `conSot` = số lượt còn phải bù nhưng hết giờ chưa làm tới. Nói ra thay vì im
   * lặng: một cron báo "xong" trong khi còn việc chưa chạy là thứ khó phát hiện
   * nhất, và ở đây cái chưa chạy là hạn của một con người.
   */
  buSla: { daXet: number; daBu: number; conSot: number };
  quaHan: number;
  tapDong: { themMoi: number; thuHoi: number; choDuLieuNhanSu: number };
  chungNhan: { chuaLamDuoc: string } | { nhac: number };
  don: { videoSession: number; bitmap: number; examAttempt: number | null };
  thuLai: { taoMoi: number; vanKet: number; nguoiVanKet: string[] };
  /** EL-10 việc (6) — lượt tải nhiều phần bỏ dở, đã huỷ trên R2. */
  taiDo: { daHuy: number; conGiu: number } | { chuaLamDuoc: string };
  /** EL-13 việc (7) — cờ nghi ngờ: quét mở, rồi chốt cờ hết cửa sổ khiếu nại. */
  moCo: { daXet: number; daMo: number; thieuNguoiXu: number };
  chotCo: { daChot: number; boQua: number };
  loi: { viec: string; message: string }[];
};

/** Trần thời gian mềm cho cả lượt chạy — cron không được kéo dài vô hạn. */
const TRAN_MS = 4 * 60 * 1000;
const LO = 500;

export async function runElearningDem(now = new Date()): Promise<KetQuaDem> {
  const batDau = Date.now();
  const conGio = () => Date.now() - batDau < TRAN_MS;
  const ket: KetQuaDem = {
    buSla: { daXet: 0, daBu: 0, conSot: 0 },
    quaHan: 0,
    tapDong: { themMoi: 0, thuHoi: 0, choDuLieuNhanSu: 0 },
    chungNhan: {
      // ⛔ Việc (3) chưa làm được: bảng `TrnCertificate` thuộc EL-16 và CHƯA tồn
      // tại. Nói ra ở đây thay vì bỏ trống lặng lẽ — một cron báo "xong" trong
      // khi có việc chưa chạy là thứ khó phát hiện nhất.
      chuaLamDuoc: "TrnCertificate chưa tồn tại (EL-16)",
    },
    don: { videoSession: 0, bitmap: 0, examAttempt: null },
    thuLai: { taoMoi: 0, vanKet: 0, nguoiVanKet: [] },
    moCo: { daXet: 0, daMo: 0, thieuNguoiXu: 0 },
    chotCo: { daChot: 0, boQua: 0 },
    taiDo: { daHuy: 0, conGiu: 0 },
    loi: [],
  };

  // ── Việc 0: BÙ HẠN vì người chấm trễ ─────────────────────────────────────
  //
  // ⚠️ CHẠY TRƯỚC việc (1), và thứ tự này là ràng buộc THẬT, không phải sở thích.
  //
  // Việc (1) quét `dueAt < now` để đánh `OVERDUE`. Nếu bù chạy SAU thì chính đêm
  // đó lượt vừa được bù VẪN bị đánh quá hạn và phát sự kiện cho người học — rồi
  // lần lật thứ hai sẽ IM LẶNG vì `dedupeKey: el.over:{id}`, tức họ nhận đúng một
  // thông báo "bạn đã quá hạn" cho một cái hạn mà hệ thống vừa tự nới ra, và không
  // bao giờ nhận thông báo đính chính.
  try {
    // ⚠️ CHỈ nhóm ĐANG CHỜ CHẤM. Bản đầu quét cả `GRADED`/`NEEDS_REVISION`, và đó
    // là một cửa sổ KHÔNG BAO GIỜ VƠI: một lượt đã chấm xong vẫn thoả
    // `dueGradeAt < now` mãi mãi. Với `take: 500` sắp theo hạn CŨ TRƯỚC, 500 dòng
    // đã tất toán từ đời nào sẽ chiếm trọn cửa sổ, và những lượt vừa trễ hôm nay
    // KHÔNG BAO GIỜ được xét — phép bù chết lặng lẽ sau vài tháng dữ liệu.
    //
    // Nhóm đã chấm nay chốt NGAY LÚC CHẤM (`task-grading.ts`), nơi `gradedAt` vừa
    // được đặt và tổng nợ là con số cuối cùng. Cron chỉ còn lo nhóm đang chờ — nhóm
    // này tự vơi, vì chấm xong là nó rời hàng đợi.
    const canXet = await db.trnSubmission.findMany({
      where: {
        dueGradeAt: { lt: now },
        status: "SUBMITTED",
        enrollmentId: { not: null },
      },
      select: {
        id: true,
        enrollmentId: true,
        dueGradeAt: true,
        gradedAt: true,
        slaBuNgayLam: true,
      },
      orderBy: { dueGradeAt: "asc" },
      take: LO,
    });
    // ⚠️ Đếm SAU vòng lặp, không gán trước. Bản đầu gán `daXet = canXet.length`
    // TRƯỚC rồi tính `conSot = canXet.length - daXet` — phép trừ tự triệt tiêu và
    // `conSot` LUÔN bằng 0, tức cron báo "làm hết" đúng lúc còn việc chưa chạy.
    // Chính chú thích của `KetQuaDem` cấm cái im lặng đó.
    for (const l of canXet) {
      if (!conGio()) break;
      ket.buSla.daXet += 1;
      const { themNgayLam, tongDangLe } = tinhBuSla({
        dueGradeAt: l.dueGradeAt,
        gradedAt: l.gradedAt,
        now,
        so: { daBuNgayLam: l.slaBuNgayLam },
      });
      if (themNgayLam <= 0) continue;

      const gd = await db.trnEnrollment.findUnique({
        where: { id: l.enrollmentId! },
        select: { id: true, dueAt: true, slaGraceDays: true, status: true },
      });
      // Lượt đã thu hồi thì không bù: nới hạn cho một người đã bị rút khỏi khoá là
      // vô nghĩa, và `dueAt` của họ không còn ai đọc.
      if (!gd || gd.status === "REVOKED") continue;

      await db.$transaction(async (t) => {
        await t.trnEnrollment.update({
          where: { id: gd.id },
          data: {
            dueAt: hanSauKhiBu(gd.dueAt, themNgayLam),
            slaGraceDays: gd.slaGraceDays + themNgayLam,
            // ⚠️ Quá hạn rồi được bù thì kéo về ĐANG HỌC — y hệt đường gia hạn tay
            // (`assignment-lifecycle.ts`). Để nguyên `OVERDUE` là giữ một cái nhãn
            // sai trên hồ sơ của người không làm gì sai.
            ...(gd.status === "OVERDUE" ? { status: "IN_PROGRESS" } : {}),
          },
        });
        // Cập nhật SỔ trong CÙNG giao dịch. Tách ra thì một lần lỗi giữa chừng sẽ
        // bù mà không ghi sổ, và đêm sau bù thêm lần nữa cho cùng khoảng chờ.
        await t.trnSubmission.update({
          where: { id: l.id },
          data: { slaBuNgayLam: tongDangLe },
        });
      });
      ket.buSla.daBu += 1;
    }
    ket.buSla.conSot = canXet.length - ket.buSla.daXet;
  } catch (e) {
    ket.loi.push({ viec: "buSla", message: (e as Error).message });
  }

  // ── Việc 1: quá hạn ───────────────────────────────────────────────────────
  try {
    let con = true;
    while (con && conGio()) {
      const rows = (await db.trnEnrollment.findMany({
        where: {
          status: { in: ["NOT_STARTED", "IN_PROGRESS"] },
          dueAt: { lt: now },
          pausedAt: null,
        },
        select: { id: true, status: true, dueAt: true, pausedAt: true, userId: true },
        take: LO,
      })) as (DongQuaHan & { userId: string })[];
      con = rows.length === LO;
      if (!rows.length) break;

      const ids = chonQuaHan(rows, now);
      if (!ids.length) break;

      await db.trnEnrollment.updateMany({
        where: { id: { in: ids } },
        data: { status: "OVERDUE" },
      });
      ket.quaHan += ids.length;

      // Sự kiện phát NGOÀI vòng cập nhật, một dòng cho mỗi người: handler báo
      // người học + quản lý trực tiếp + Đào tạo. `dedupeKey` chặn báo lại đêm
      // sau nếu vì lý do gì đó dòng bị quét lại.
      for (const r of rows.filter((x) => ids.includes(x.id))) {
        await publishEvent(
          "elearning.enrollment.overdue",
          { enrollmentId: r.id, userId: r.userId },
          { dedupeKey: `el.over:${r.id}` },
        );
      }
    }
  } catch (e) {
    ket.loi.push({ viec: "qua-han", message: String(e) });
  }

  // ── Việc 2: tập ĐỘNG ──────────────────────────────────────────────────────
  try {
    const r = await runDynamicAudienceSync(now);
    ket.tapDong = {
      themMoi: r.soThemMoi,
      thuHoi: r.soThuHoi,
      choDuLieuNhanSu: r.soChoDuLieuNhanSu,
    };
    for (const l of r.loi) ket.loi.push({ viec: `tap-dong:${l.assignmentId}`, message: l.message });
  } catch (e) {
    ket.loi.push({ viec: "tap-dong", message: String(e) });
  }

  // ── Việc 3: chứng nhận — xem ghi chú ở `ket.chungNhan` ────────────────────

  // ── Việc 4: dọn dữ liệu tầng 2 (SAU việc 1 và 3) ──────────────────────────
  try {
    const moc = mocDonTang2(now);

    // (a) Nhịp xem hết hạn lưu — xoá CỨNG. `TrnVideoSession` cố ý nằm ngoài
    // `SOFT_DELETE_MODELS` đúng để câu này xoá được thật.
    const xoaVideo = await db.trnVideoSession.deleteMany({
      where: { purgeAfter: { lt: moc.videoSessionTruoc } },
    });
    ket.don.videoSession = xoaVideo.count;

    // (b) Bản đồ đoạn xem của bài ĐÃ XONG và im ắng quá 90 ngày.
    // ⚠️ KHÔNG chạm cột `status` của bất kỳ bảng nào (QĐ-CDA-14): dọn là xoá dữ
    // liệu thô, không phải đổi kết luận nghiệp vụ.
    const xoaBitmap = await db.trnLessonProgress.updateMany({
      where: {
        status: "DONE",
        lastActivityAt: { lt: moc.bitmapLastActivityTruoc },
        segmentBitmap: { not: null },
      },
      data: { segmentBitmap: null, bitmapPurgedAt: now },
    });
    ket.don.bitmap = xoaBitmap.count;

    // (c) EL-14 — dấu vân kỹ thuật của lượt thi (`ipHash`, `ipPrefix`,
    // `deviceClass`, `browserFamily`). Đây là dữ liệu TẦNG 2; bản ghi lượt thi và
    // điểm là tầng 1 và ở lại.
    //
    // ⚠️ Đi bằng `purgeAfter` — cột NOT NULL ghi cứng lúc INSERT — chứ không tính
    // lại hạn ở đây. Tính lại là dựng nguồn sự thật thứ hai, và ngày ai đó đổi
    // con số 90 thì hai chỗ lệch nhau mà không gì báo.
    const xoaVanThi = await db.trnExamAttempt.updateMany({
      where: {
        purgeAfter: { lt: now },
        // Chỉ chạm dòng CÒN dấu vân: không có vế này thì mỗi đêm cron ghi lại
        // toàn bộ lượt thi cũ, và `updatedAt` của chúng nhảy mỗi ngày.
        OR: [{ ipHash: { not: null } }, { deviceClass: { not: null } }],
      },
      data: {
        ipHash: null,
        ipPrefix: null,
        deviceClass: null,
        browserFamily: null,
      },
    });
    ket.don.examAttempt = xoaVanThi.count;
  } catch (e) {
    ket.loi.push({ viec: "don-tang-2", message: String(e) });
  }

  // ── Việc 6: dọn lượt tải nhiều phần bỏ dở ─────────────────────────────────
  // Chạy CÙNG nhóm việc dọn (sau việc 1 và 3, trước việc 5) và KHÔNG xin khe
  // cron thứ ba — ngân sách của module là đúng hai khe.
  try {
    ket.taiDo = await donTaiDo(chonTaiDoDeHuy, mocDonTaiDo(now));
  } catch (e) {
    ket.loi.push({ viec: "don-tai-do", message: String(e) });
  }

  // ── Việc 7: cờ nghi ngờ ───────────────────────────────────────────────────
  // Gộp vào KHE NÀY, không xin khe cron thứ ba — ngân sách module là đúng hai khe.
  //
  // ⚠️ QUÉT trước, CHỐT sau, và hai bước bắt lỗi RIÊNG. Gộp chung một `try` thì
  // một lỗi lúc quét sẽ nuốt luôn bước chốt, và cửa sổ khiếu nại 14 ngày âm thầm
  // không có hiệu lực — không ai thấy, vì cron vẫn báo chạy xong.
  try {
    ket.moCo = await quetMoCo(now);
  } catch (e) {
    ket.loi.push({ viec: "mo-co", message: String(e) });
  }
  try {
    ket.chotCo = await chotCoHetHan(now);
  } catch (e) {
    ket.loi.push({ viec: "chot-co", message: String(e) });
  }

  // ── Việc 5: thử lại hàng đợi "chờ dữ liệu Nhân sự" ────────────────────────
  try {
    const r = await thuLaiHangDoiNhanSu(now);
    ket.thuLai = r;
  } catch (e) {
    ket.loi.push({ viec: "thu-lai-hang-doi", message: String(e) });
  }

  return ket;
}
