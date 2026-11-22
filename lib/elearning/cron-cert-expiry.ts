import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { notifyElearning as notifyStaff } from "@/lib/elearning/notify-gate";
import { elearningHomeUrl } from "@/lib/auth/hosts";
import {
  canGiaoLai,
  mocCanNhac,
  noiDungNhacHetHan,
  soNgayConLai,
} from "@/lib/elearning/cert-expiry";

/**
 * EL-16 việc (5) — VÒNG ĐỜI HẾT HIỆU LỰC của chứng nhận.
 *
 * ⚠️ Chạy trong khe cron ĐÃ CÓ (`elearning-reminders`). Ngân sách module là đúng 2
 * khe và đã dùng hết — không xin khe thứ ba (QĐ-CDA-14 điểm 2).
 *
 * Ba việc, theo thứ tự:
 *   1. nhắc T-30 / T-7 trước hạn;
 *   2. chốt cột `status` sang `EXPIRED` cho bản đã quá hạn;
 *   3. giao lại khoá cho vòng tái chứng nhận (`cycle` + 1).
 *
 * ⚠️ Việc (2) là cập nhật BỘ NHỚ ĐỆM, không phải nguồn sự thật. Trang xác minh công
 * khai và mọi chỗ hiển thị đi qua `trangThaiHienThi()` — suy từ `validUntil`. Cron
 * này lỗi, treo, hay chưa đăng ký thì không tấm chứng nhận nào nói dối; chỉ là truy
 * vấn lọc theo cột `status` sẽ đếm thiếu. Đó là khác biệt cố ý: một trang công khai
 * không được phụ thuộc vào việc cron đêm nay có chạy hay không.
 */

const LO = 200;
const NGAY_MS = 24 * 60 * 60 * 1000;

export type KetQuaHetHan = {
  daNhac: number;
  chotHetHan: number;
  giaoLai: number;
  /** Không giao lại được vì khoá không còn bản xuất bản nào — nói ra, đừng nuốt. */
  khongGiaoLaiDuoc: number;
  loi: string[];
};

/**
 * `opts.nhacBat` BẮT BUỘC: chỉ việc (1) — nhắc T-30/T-7 — phụ thuộc cờ `ELEARNING_REMINDER_ENABLED`. Chốt
 * hết hạn (2) và giao lại vòng (3) là vòng đời của chứng từ, không phải "nhắc": cờ nhắc tắt không được làm
 * đứng chúng.
 */
export async function chayVongDoiChungNhan(
  now: Date,
  opts: { nhacBat: boolean },
): Promise<KetQuaHetHan> {
  const ket: KetQuaHetHan = {
    daNhac: 0,
    chotHetHan: 0,
    giaoLai: 0,
    khongGiaoLaiDuoc: 0,
    loi: [],
  };

  if (opts.nhacBat) {
    // ── 1. Nhắc T-30 / T-7 ─────────────────────────────────────────────────────
    try {
      const sapHet = await db.trnCertificate.findMany({
        where: {
          status: "VALID",
          validUntil: { not: null, gte: now, lte: new Date(now.getTime() + 30 * NGAY_MS) },
        },
        select: {
          id: true,
          userId: true,
          courseId: true,
          validUntil: true,
          enrollmentId: true,
        },
        orderBy: { validUntil: "asc" },
        take: LO,
      });

      const tenKhoaCua = new Map(
        (
          await db.trnCourse.findMany({
            where: { id: { in: [...new Set(sapHet.map((c) => c.courseId))] } },
            select: { id: true, title: true },
          })
        ).map((k) => [k.id, k.title]),
      );

      for (const c of sapHet) {
        const soNgay = soNgayConLai(c.validUntil!, now);
        // ⚠️ KHÔNG lưu "đã nhắc mốc nào" ở cột riêng: `notifyStaff` chống trùng bằng
        // `dedupeKey`, và khoá dưới đây gắn với (chứng nhận × mốc) nên gửi lại nhịp
        // sau không đẻ thông báo thứ hai. Thêm một cột nữa là thêm một thứ có thể
        // lệch với sự thật.
        const moc = mocCanNhac(soNgay, []);
        if (moc == null) continue;

        const noiDung = noiDungNhacHetHan({
          moc,
          tenKhoa: tenKhoaCua.get(c.courseId) ?? "khoá đào tạo",
          validUntil: c.validUntil!,
        });
        const soNguoi = await notifyStaff({
          userIds: [c.userId],
          dedupeKey: `elearning_cert_expiry:${c.id}:${moc}`,
          title: noiDung.title,
          body: noiDung.body,
          href: `${elearningHomeUrl().replace(/\/$/, "")}/elearning/hoc/${c.enrollmentId}`,
          entityId: c.id,
        });
        if (soNguoi > 0) ket.daNhac += 1;
      }
    } catch (e) {
      ket.loi.push(`nhac-het-han: ${String(e)}`);
    }
  }

  // ── 2. Chốt cột status cho bản đã quá hạn ──────────────────────────────────
  try {
    // Đọc TRƯỚC khi cập nhật: sau `updateMany` thì không còn cách nào biết những
    // dòng nào vừa đổi, mà cỗ máy tự động hoá (EL-18) cần đúng danh sách ấy.
    const vuaHet = await db.trnCertificate.findMany({
      where: { status: "VALID", validUntil: { not: null, lt: now } },
      select: { id: true, userId: true, courseId: true },
      take: LO,
    });

    // ⚠️ PHÁT sự kiện TRƯỚC, chốt `EXPIRED` SAU. Đảo lại (chốt rồi phát, hai bước rời nhau) thì chết giữa
    // chừng để dòng đã sang EXPIRED mà sự kiện chưa phát, và lần chạy sau — chỉ chọn `status = VALID` —
    // không bao giờ chọn lại: sự kiện hết hạn mất vĩnh viễn, luật `CHUNG_NHAN_HET_HAN` của EL-18 chết lặng
    // lẽ. Phát trước: khoá chống trùng làm lần phát lại vô hại, và lỗi giữa chừng để dòng còn VALID.
    // (Lý do phải phát: nếu không thì kích hoạt `CHUNG_NHAN_HET_HAN` của cỗ máy luật
    // là một luật CHẾT): người vận hành khai được luật, bật được nó, và nó không bao
    // giờ chạy — không lỗi nào, chỉ là im lặng.
    for (const c of vuaHet) {
      await publishEvent(
        "elearning.certificate.expired",
        { certificateId: c.id, userId: c.userId, courseId: c.courseId },
        { dedupeKey: `el.cert.exp:${c.id}` },
      );
    }

    const r = await db.trnCertificate.updateMany({
      where: { id: { in: vuaHet.map((c) => c.id) } },
      data: { status: "EXPIRED" },
    });
    ket.chotHetHan = r.count;
  } catch (e) {
    ket.loi.push(`chot-het-han: ${String(e)}`);
  }

  // ── 3. Giao lại khoá cho vòng tái chứng nhận ───────────────────────────────
  try {
    const daHet = await db.trnCertificate.findMany({
      // ⚠️ `recertAssignedAt: null` là thứ làm cửa sổ quét DRAIN ĐƯỢC.
      //
      // Không có nó thì `status = EXPIRED` đúng vĩnh viễn: sau khi tích đủ `LO` bản
      // đã xử lý xong, chúng chiếm trọn mỗi lượt quét và bản vừa hết hạn KHÔNG BAO
      // GIỜ tới lượt. Cron vẫn chạy, vẫn báo 0 lỗi, chỉ là không ai được giao lại
      // khoá nữa. Đúng lỗi đã xảy ra một lần ở EL-15d (cửa sổ bù SLA không bao giờ
      // rút) — không dựng lại nó ở đây.
      where: {
        status: "EXPIRED",
        recertAssignedAt: null,
        validUntil: { not: null, lt: now },
      },
      select: {
        id: true,
        userId: true,
        courseId: true,
        validUntil: true,
        revokedAt: true,
        centerId: true,
        orgUnitId: true,
        enrollment: {
          select: { cycle: true, snapJobTitle: true, snapDepartmentId: true },
        },
      },
      orderBy: { validUntil: "asc" },
      take: LO,
    });

    for (const c of daHet) {
      const vongSau = (c.enrollment.cycle ?? 1) + 1;
      const daCo = await db.trnEnrollment.count({
        where: { userId: c.userId, courseId: c.courseId, cycle: { gte: vongSau } },
      });

      if (
        !canGiaoLai({
          validUntil: c.validUntil,
          now,
          daCoLuotVongSau: daCo > 0,
          chungNhanBiThuHoi: c.revokedAt != null,
        })
      ) {
        // ĐÁNH DẤU ĐÃ XÉT, không chỉ `continue`. Bản này đã có câu trả lời cuối
        // ("đã có lượt vòng sau" / "đã thu hồi"), nên nó phải rời khỏi cửa sổ quét —
        // để lại là dựng đúng cái kẹt mà cột này sinh ra để tránh.
        await db.trnCertificate.update({
          where: { id: c.id },
          data: { recertAssignedAt: now },
        });
        continue;
      }

      // Hạn mới: 30 ngày kể từ hôm hết hiệu lực. Cùng con số với mốc nhắc đầu tiên,
      // nên người đã được nhắc T-30 có đúng khoảng thời gian ấy để làm.
      const hanMoi = new Date(now.getTime() + 30 * NGAY_MS);

      // ⚠️ `centerId`/`orgUnitId` NOT NULL trên `TrnEnrollment` — phải truyền tường
      // minh. Quên là lượt mới vô hình với chính người cấp cơ sở của họ.
      if (!c.centerId || !c.orgUnitId) {
        ket.khongGiaoLaiDuoc += 1;
        console.warn("[elearning] không giao lại được: chứng nhận thiếu cột đơn vị", {
          certId: c.id,
        });
        // Cũng đánh dấu: bản này KHÔNG tự khỏi, và để nó nằm lại trong cửa sổ quét
        // thì mỗi nhịp cron lại ghi một dòng cảnh báo giống hệt, đến khi log thành
        // vô dụng. Con số `khongGiaoLaiDuoc` là chỗ báo, không phải log lặp.
        await db.trnCertificate.update({
          where: { id: c.id },
          data: { recertAssignedAt: now },
        });
        continue;
      }

      try {
        await db.trnEnrollment.create({
          data: {
            userId: c.userId,
            courseId: c.courseId,
            // ⚠️ `cycle` tăng, và lượt là bản ghi MỚI — không mở lại lượt cũ.
            // `TrnLessonProgress` khoá theo `@@unique([enrollmentId, lessonId])`, nên
            // lượt mới bắt đầu với bitmap tiến độ RỖNG: người học phải xem lại thật,
            // không được hệ thống tính hoàn thành ngay. Đây chính là lý do khoá đó
            // không đặt theo `[userId, lessonId]` (HỢP ĐỒNG V2 §Z2).
            cycle: vongSau,
            source: "REQUIREMENT",
            status: "NOT_STARTED",
            dueAtOriginal: hanMoi,
            dueAt: hanMoi,
            snapJobTitle: c.enrollment.snapJobTitle,
            snapDepartmentId: c.enrollment.snapDepartmentId,
            centerId: c.centerId,
            orgUnitId: c.orgUnitId,
          },
        });
        await db.trnCertificate.update({
          where: { id: c.id },
          data: { recertAssignedAt: now },
        });
        ket.giaoLai += 1;
      } catch (e) {
        ket.loi.push(`giao-lai(${c.id}): ${String(e)}`);
      }
    }
  } catch (e) {
    ket.loi.push(`giao-lai: ${String(e)}`);
  }

  return ket;
}
