import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { huyDongHocVuotKhiDoiBuoiBatDau, taoDongHocBu } from "@/lib/hoc-bu/dong-service";
import { dieuChinhLuot } from "@/lib/hoc-bu/so-luot";
import { GIAO_TRINH_PHAM_VI, kiemBuoiBatDau, kiemSoBuoiBu } from "@/lib/lms/xep-lop-theo-buoi-bat-dau";
import { docPhamViDong } from "@/lib/orders/pham-vi/doc-dong";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { notifyStaff, thuHoiThongBao } from "@/lib/notifications/notify";
import { nguoiGiuQuyenTaiCoSo } from "@/lib/org/nguoi-giu-quyen-tai-co-so";

// lib/orders/hoc-vuot-chuyen-doi.ts — HỌC VƯỢT BÙ KHI CHUYỂN ĐỔI ĐƠN [chủ dự án chốt 27/10/2026].
//
// *"khi chuyển đổi học viên cần học vượt để kịp tiến độ của lớp thì sale điền số buổi học vượt để qlcs duyệt, và số buổi đó sẽ thêm vào trần
//  miễn phí của học bù, để sale book lịch học bù cho học viên đó học lại các buổi mà lớp đã học trước đó."*
//
// MỘT dòng `EnrollmentCatchUpRequest` cho mỗi ghi danh. Vòng đời:
//   · Sale chuyển đổi, chọn lớp phải học vượt  ⇒ yêu cầu PENDING (ghi danh vẫn tạo; chưa có dòng cần bù, chưa cộng lượt);
//   · QLCS / Quản trị tối cao tự chuyển đổi    ⇒ yêu cầu APPROVED ngay (tự duyệt — `tuDuyetHocVuot`);
//   · DUYỆT ⇒ (1) dòng cần bù ORDER_CONVERSION cho các buổi lớp đã dạy từ buổi bé bắt đầu tới nay, (2) cộng b vào trần học bù (sổ lượt ADJUSTMENT
//     `hocvuot:<id>`);
//   · Quản trị tối cao đổi buổi bắt đầu SAU ĐÓ ⇒ `suaBuoiBatDauGhiDanh`: sửa ghi danh + yêu cầu + dòng cần bù + sổ lượt trong cùng giao dịch.
//
// ⚠️ Mọi hàm nhận `tx` (người gọi mở giao dịch). Cổng QUYỀN ở server action, không ở đây (cùng khuôn `cap-them-luot-db.ts`).
// ⚠️ Dòng cần bù tạo KHÔNG kèm `nguonBaoLuu` — đúng như đường chuyển đổi cũ (không gắn nhãn miễn phí): chúng tiêu lượt như buổi vắng thường, và đó là lý do
// phải cộng b lượt khi duyệt.

type Tx = Prisma.TransactionClient;

export const HANH_DONG_HOC_VUOT = {
  tao: "enrollment.catch-up.request",
  duyet: "enrollment.catch-up.approve",
  tuChoi: "enrollment.catch-up.reject",
  doiBuoiBatDau: "enrollment.catch-up.change-start",
} as const;

/** Khoá bút toán sổ lượt của một yêu cầu. KHÔNG bắt đầu bằng `don:` — `don-doi-db.ts` coi `ADJUSTMENT:don:*` là lượt THEO ĐƠN và thu hồi khi đơn huỷ. */
export const nguonLuotHocVuot = (requestId: string): string => `hocvuot:${requestId}`;

export const khoaTinHocVuot = (requestId: string): string => `chuyen-doi.hoc-vuot:${requestId}`;

export type VaoYeuCau = {
  orderId: string;
  orderItemId: string;
  enrollmentId: string;
  studentId: string;
  classId: string;
  courseId: string;
  centerId: string;
  orgUnitId: string | null;
  startLesson: number;
  sessionsToCatchUp: number;
  makeupSessions: number;
  proposedById: string;
};

type Nguoi = { id: string | null; name: string };

async function buoiDaQua(tx: Tx, classId: string, bayGio: Date): Promise<{ id: string }[]> {
  return tx.classSession.findMany({
    where: { classId, date: { lte: bayGio } },
    select: { id: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
}

/** Tạo yêu cầu (PENDING). Ném khi dữ kiện sai — cổng đứng TRƯỚC phép ghi (luật rollback). */
export async function taoYeuCauHocVuot(tx: Tx, v: VaoYeuCau, nguoi: Nguoi, bayGio: Date): Promise<{ id: string }> {
  const sai = kiemSoBuoiBu(v.sessionsToCatchUp, v.makeupSessions);
  if (sai) throw new Error(sai);
  if (!Number.isInteger(v.startLesson) || v.startLesson < 1) throw new Error("Buổi bắt đầu phải là số nguyên từ 1");
  const r = await tx.enrollmentCatchUpRequest.create({
    data: { ...v, status: "PENDING", proposedAt: bayGio },
    select: { id: true },
  });
  await writeAudit({
    tx,
    actor: nguoi,
    module: "enrollment",
    entityType: "EnrollmentCatchUpRequest",
    entityId: r.id,
    action: HANH_DONG_HOC_VUOT.tao,
    newValues: {
      orderId: v.orderId,
      enrollmentId: v.enrollmentId,
      studentId: v.studentId,
      classId: v.classId,
      startLesson: v.startLesson,
      sessionsToCatchUp: v.sessionsToCatchUp,
      makeupSessions: v.makeupSessions,
    },
  });
  return r;
}

/**
 * DUYỆT: sinh dòng cần bù + cộng lượt. IDEMPOTENT: dòng cần bù (`@@unique studentId+missedSessionId`) và bút toán (`idemKey`) đều chống trùng, nên gọi lại không nhân đôi.
 * Chỉ yêu cầu PENDING được duyệt; `updateMany … where PENDING` là khoá chống hai người duyệt cùng lúc (FIX-H9) — thua cuộc đua ⇒ trả `daXuLy`.
 */
export async function duyetYeuCauHocVuot(
  tx: Tx,
  requestId: string,
  nguoi: Nguoi,
  bayGio: Date,
  lyDo?: string | null,
): Promise<{ ok: true; soDongBu: number; luotCong: number } | { ok: false; error: string }> {
  const r = await tx.enrollmentCatchUpRequest.findUnique({ where: { id: requestId } });
  if (!r) return { ok: false, error: "Không tìm thấy yêu cầu" };
  if (r.status !== "PENDING") return { ok: false, error: "Yêu cầu này đã được xử lý" };

  const chiem = await tx.enrollmentCatchUpRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: {
      status: "APPROVED",
      decidedById: nguoi.id ?? "he-thong",
      decidedAt: bayGio,
      decisionReason: lyDo?.trim() || null,
      creditEntryKey: `ADJUSTMENT:${nguonLuotHocVuot(requestId)}`,
    },
  });
  if (chiem.count === 0) return { ok: false, error: "Yêu cầu này vừa được xử lý ở nơi khác" };

  const soDongBu = await sinhDongCanBu(tx, r, nguoi, bayGio);
  const ap = await dieuChinhLuot(tx, {
    studentId: r.studentId,
    courseId: r.courseId,
    classId: r.classId,
    delta: r.makeupSessions,
    nguon: nguonLuotHocVuot(requestId),
    lyDo: `Học vượt bù khi chuyển đổi đơn: bắt đầu buổi ${r.startLesson}, cần bù ${r.sessionsToCatchUp} buổi — QLCS duyệt cộng ${r.makeupSessions} lượt`,
    actorId: nguoi.id,
  });
  await writeAudit({
    tx,
    actor: nguoi,
    module: "enrollment",
    entityType: "EnrollmentCatchUpRequest",
    entityId: requestId,
    action: HANH_DONG_HOC_VUOT.duyet,
    newValues: { soDongBu, luotCong: ap, makeupSessions: r.makeupSessions },
  });
  return { ok: true, soDongBu, luotCong: ap };
}

/** TỪ CHỐI (lý do ≥ 10 ký tự, CHECK ở DB). Ghi danh GIỮ NGUYÊN — người từ chối tự xử lý tiếp (đổi lớp / đổi buổi bắt đầu); yêu cầu không sinh dòng cần bù nào. */
export async function tuChoiYeuCauHocVuot(
  tx: Tx,
  requestId: string,
  nguoi: Nguoi,
  bayGio: Date,
  lyDo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ly = lyDo.trim();
  if (ly.length < 10) return { ok: false, error: "Ghi lý do từ chối ít nhất 10 ký tự" };
  const r = await tx.enrollmentCatchUpRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "REJECTED", decidedById: nguoi.id ?? "he-thong", decidedAt: bayGio, decisionReason: ly },
  });
  if (r.count === 0) return { ok: false, error: "Yêu cầu không còn ở trạng thái chờ duyệt" };
  await writeAudit({
    tx,
    actor: nguoi,
    module: "enrollment",
    entityType: "EnrollmentCatchUpRequest",
    entityId: requestId,
    action: HANH_DONG_HOC_VUOT.tuChoi,
    newValues: { lyDo: ly },
  });
  return { ok: true };
}

/** Sinh dòng cần bù cho các buổi lớp ĐÃ DẠY từ buổi `startLesson` tới nay (chỉ số 1-based theo ngày). Idempotent. */
async function sinhDongCanBu(
  tx: Tx,
  r: { studentId: string; classId: string; startLesson: number; orgUnitId: string | null },
  nguoi: Nguoi,
  bayGio: Date,
): Promise<number> {
  const buoi = await buoiDaQua(tx, r.classId, bayGio);
  const can = buoi.slice(Math.max(0, r.startLesson - 1));
  let dem = 0;
  for (const b of can) {
    const k = await taoDongHocBu(tx, {
      studentId: r.studentId,
      missedSessionId: b.id,
      nguon: "ORDER_CONVERSION",
      createdById: nguoi.id,
      note: `Học vượt — bé bắt đầu từ buổi ${r.startLesson}, lớp đã học trước khi bé vào (chuyển đổi đơn).`,
      orgUnitId: r.orgUnitId,
    });
    if (k.ket === "TAO") dem++;
  }
  return dem;
}

/**
 * Quản trị tối cao ĐỔI BUỔI BẮT ĐẦU của một ghi danh đã chuyển đổi [chốt 27/10/2026: "khi sale add nhầm hoặc phụ huynh xin dời… admin chỉnh được, và data
 * liên quan đều được sửa để đồng bộ"]. Trong CÙNG giao dịch: (1) `Enrollment.buoiBatDau` (cột cổng điểm danh đọc), (2) yêu cầu học vượt (tạo / sửa / huỷ), (3) dòng cần bù
 * (thêm cho buổi mới phải bù; gỡ dòng chưa dùng của buổi không còn phải bù), (4) sổ lượt (cộng / trừ phần chênh), (5) audit.
 *
 * [28/10/2026 — chủ dự án: "làm luôn cho tất cả các đơn trừ đơn trọn khoá 48 buổi"] áp cho CẢ dòng theo phạm vi học mua KHÔNG trọn: ngoài các bước trên còn sửa
 * `StudyEntitlement` (bài bắt đầu / kết thúc / ảnh chụp bài trước start) trong CÙNG giao dịch — NHƯNG chỉ khi quyền học chưa tiêu thụ buổi nào (đổi phạm vi dưới chân một quyền
 * đã có điểm danh là làm lệch số buổi đã học). Dòng phạm vi mua TRỌN khoá: từ chối.
 */
export async function suaBuoiBatDauGhiDanh(
  tx: Tx,
  p: { enrollmentId: string; buoiBatDauMoi: number; soBuoiBu?: number | null; lyDo: string },
  nguoi: Nguoi,
  bayGio: Date,
): Promise<{ ok: true; buoiBatDau: number; canBu: number } | { ok: false; error: string }> {
  const ly = p.lyDo.trim();
  if (ly.length < 10) return { ok: false, error: "Ghi lý do đổi buổi bắt đầu ít nhất 10 ký tự" };

  const gd = await tx.enrollment.findUnique({
    where: { id: p.enrollmentId },
    select: {
      id: true,
      studentId: true,
      classId: true,
      courseId: true,
      centerId: true,
      buoiBatDau: true,
      status: true,
      class: { select: { orgUnitId: true } },
      course: { select: { totalSessions: true } },
    },
  });
  if (!gd) return { ok: false, error: "Không tìm thấy ghi danh" };
  if (!gd.classId || !gd.courseId || !gd.centerId) return { ok: false, error: "Ghi danh thiếu lớp / khoá / cơ sở" };

  const dong = await tx.orderItem.findFirst({
    where: { enrollmentId: gd.id },
    select: { id: true, orderId: true, metadata: true },
  });
  if (!dong) return { ok: false, error: "Ghi danh này không đi từ một dòng đơn — không đổi buổi bắt đầu theo luật chuyển đổi được" };

  const ht = docHinhThucLop(dong.metadata);
  const sai = kiemBuoiBatDau({ tongSoBuoiKhoa: gd.course?.totalSessions ?? null, soBuoiMua: ht.soBuoi }, p.buoiBatDauMoi);
  if (sai) return { ok: false, error: sai };

  // ── DÒNG THEO PHẠM VI HỌC: quyền học là nguồn bài bắt đầu ⇒ sửa cả nó, hoặc từ chối TRƯỚC phép ghi đầu tiên ─────────────────────────────────────
  const laDongPhamVi = docPhamViDong(dong.metadata) !== null;
  const tongKhoa = gd.course?.totalSessions ?? null;
  if (laDongPhamVi && (tongKhoa === null || (ht.soBuoi ?? tongKhoa) >= tongKhoa)) {
    return { ok: false, error: "Đơn mua trọn khoá không đổi buổi bắt đầu được (luôn bắt đầu từ buổi 1)" };
  }
  const quyen = laDongPhamVi
    ? await tx.studyEntitlement.findFirst({
        where: { enrollmentId: gd.id, status: { not: "VOIDED" } },
        select: { id: true, purchaseKind: true, purchaseSessions: true, startLessonOrder: true, endLessonOrder: true, consumedSessions: true, configSnapshot: true },
      })
    : null;
  let quyenMoi: { start: number; end: number } | null = null;
  if (quyen) {
    if (quyen.purchaseKind === "FULL") return { ok: false, error: "Quyền học gói trọn khoá không đổi buổi bắt đầu được" };
    if (quyen.startLessonOrder !== null && quyen.endLessonOrder !== null) {
      // Chỉ đọc bộ đếm `consumedSessions` — sổ `StudyEntitlementUsage` chỉ được đụng trong lib/entitlements/** (INV-32b).
      if (quyen.consumedSessions > 0) {
        return { ok: false, error: "Quyền học của bé đã có buổi tiêu thụ — không đổi buổi bắt đầu được (sẽ làm lệch số buổi đã học). Xử lý bằng điều chỉnh quyền học." };
      }
      const cuoi = p.buoiBatDauMoi + quyen.purchaseSessions - 1;
      if (cuoi > GIAO_TRINH_PHAM_VI) {
        return { ok: false, error: `Phạm vi ${p.buoiBatDauMoi}–${cuoi} vượt giáo trình ${GIAO_TRINH_PHAM_VI} bài` };
      }
      quyenMoi = { start: p.buoiBatDauMoi, end: cuoi };
    }
  }

  const buoi = await buoiDaQua(tx, gd.classId, bayGio);
  const P = buoi.length;
  const canBu = Math.max(0, P + 1 - p.buoiBatDauMoi);

  const yc = await tx.enrollmentCatchUpRequest.findUnique({ where: { enrollmentId: gd.id } });
  if (canBu > 0 && yc === null && (p.soBuoiBu === undefined || p.soBuoiBu === null)) {
    // Chưa có yêu cầu mà nay phải bù ⇒ người sửa khai số buổi bù (mặc định bằng số buổi cần bù).
    p = { ...p, soBuoiBu: canBu };
  }
  const bMoi = Math.min(canBu, p.soBuoiBu ?? yc?.makeupSessions ?? canBu);
  if (canBu > 0) {
    const saiBu = kiemSoBuoiBu(canBu, bMoi);
    if (saiBu) return { ok: false, error: saiBu };
  }

  // (1) Cột cổng điểm danh đọc — cùng quy ước chuyển đổi: buổi 1 ⇒ null. NGOẠI LỆ: dòng phạm vi còn PENDING (quyền học CHƯA chốt phạm vi) giữ cả buổi 1 — cột
  // này là LỰA CHỌN của Sale mà quyền học sẽ đọc (`batDauChon`), NULL nghĩa "không ai chọn".
  const giuBuoiMot = laDongPhamVi && gd.status === "PENDING";
  await tx.enrollment.update({ where: { id: gd.id }, data: { buoiBatDau: giuBuoiMot || p.buoiBatDauMoi > 1 ? p.buoiBatDauMoi : null } });

  // (1b) Quyền học đã chốt phạm vi ⇒ sửa bài bắt đầu / kết thúc + ảnh chụp (bài trước start). Gói không trọn nên không có bài bỏ qua / bù miễn phí trong phạm vi.
  if (quyen && quyenMoi) {
    const cu = quyen.configSnapshot && typeof quyen.configSnapshot === "object" && !Array.isArray(quyen.configSnapshot) ? (quyen.configSnapshot as Record<string, Prisma.InputJsonValue>) : {};
    const xepLopCu = cu.xepLop && typeof cu.xepLop === "object" && !Array.isArray(cu.xepLop) ? (cu.xepLop as Record<string, Prisma.InputJsonValue>) : {};
    await tx.studyEntitlement.update({
      where: { id: quyen.id },
      data: {
        startLessonOrder: quyenMoi.start,
        endLessonOrder: quyenMoi.end,
        configSnapshot: {
          ...cu,
          xepLop: { ...xepLopCu, catchupMode: "NONE", lessonsBeforeStart: Array.from({ length: quyenMoi.start - 1 }, (_, i) => i + 1), requiredCatchupLessons: [], skippedLessons: [], freeMakeupLessons: [], catchupSessions: [] },
        },
      },
    });
    await writeAudit({
      tx,
      actor: nguoi,
      module: "entitlements",
      entityType: "StudyEntitlement",
      entityId: quyen.id,
      action: "DOI_BUOI_BAT_DAU",
      oldValues: { startLessonOrder: quyen.startLessonOrder, endLessonOrder: quyen.endLessonOrder },
      newValues: { startLessonOrder: quyenMoi.start, endLessonOrder: quyenMoi.end },
      reason: ly,
    });
  }

  // (3) Dòng cần bù: gỡ dòng chưa dùng nằm NGOÀI khoảng mới (buổi < S), thêm dòng cho buổi trong khoảng.
  const ngoai = buoi.slice(0, Math.max(0, p.buoiBatDauMoi - 1)).map((b) => b.id);
  await huyDongHocVuotKhiDoiBuoiBatDau(tx, { studentId: gd.studentId, missedSessionIds: ngoai });
  const soDongBu = canBu > 0 ? await sinhDongCanBu(tx, { studentId: gd.studentId, classId: gd.classId, startLesson: p.buoiBatDauMoi, orgUnitId: gd.class?.orgUnitId ?? null }, nguoi, bayGio) : 0;

  // (2)+(4) Yêu cầu và sổ lượt.
  let luotDoi = 0;
  if (yc) {
    if (canBu === 0) {
      if (yc.status === "APPROVED") {
        luotDoi = await dieuChinhLuot(tx, {
          studentId: yc.studentId, courseId: yc.courseId, classId: yc.classId,
          delta: -yc.makeupSessions,
          nguon: `${nguonLuotHocVuot(yc.id)}:doi-${bayGio.getTime()}`,
          lyDo: `Đổi buổi bắt đầu sang ${p.buoiBatDauMoi} — không còn phải học vượt: rút ${yc.makeupSessions} lượt đã cộng. ${ly}`,
          actorId: nguoi.id,
        });
      }
      await tx.enrollmentCatchUpRequest.update({
        where: { id: yc.id },
        data: { status: "CANCELLED", startLesson: p.buoiBatDauMoi, decidedById: nguoi.id ?? "he-thong", decidedAt: bayGio, decisionReason: ly },
      });
    } else {
      if (yc.status === "APPROVED" && bMoi !== yc.makeupSessions) {
        luotDoi = await dieuChinhLuot(tx, {
          studentId: yc.studentId, courseId: yc.courseId, classId: yc.classId,
          delta: bMoi - yc.makeupSessions,
          nguon: `${nguonLuotHocVuot(yc.id)}:doi-${bayGio.getTime()}`,
          lyDo: `Đổi buổi bắt đầu sang ${p.buoiBatDauMoi}: số buổi bù ${yc.makeupSessions} → ${bMoi}. ${ly}`,
          actorId: nguoi.id,
        });
      }
      await tx.enrollmentCatchUpRequest.update({
        where: { id: yc.id },
        data: { startLesson: p.buoiBatDauMoi, sessionsToCatchUp: canBu, makeupSessions: bMoi },
      });
    }
  } else if (canBu > 0) {
    // Chưa có yêu cầu: Quản trị tối cao tự khai ⇒ duyệt ngay + cộng lượt.
    const moi = await tx.enrollmentCatchUpRequest.create({
      data: {
        status: "APPROVED",
        orderId: dong.orderId, orderItemId: dong.id, enrollmentId: gd.id, studentId: gd.studentId, classId: gd.classId, courseId: gd.courseId,
        centerId: gd.centerId, orgUnitId: gd.class?.orgUnitId ?? null,
        startLesson: p.buoiBatDauMoi, sessionsToCatchUp: canBu, makeupSessions: bMoi,
        proposedById: nguoi.id ?? "he-thong", proposedAt: bayGio, decidedById: nguoi.id ?? "he-thong", decidedAt: bayGio, decisionReason: ly,
      },
      select: { id: true },
    });
    luotDoi = await dieuChinhLuot(tx, {
      studentId: gd.studentId, courseId: gd.courseId, classId: gd.classId,
      delta: bMoi,
      nguon: nguonLuotHocVuot(moi.id),
      lyDo: `Học vượt bù: bắt đầu buổi ${p.buoiBatDauMoi}, cần bù ${canBu} buổi — Quản trị tối cao cộng ${bMoi} lượt. ${ly}`,
      actorId: nguoi.id,
    });
    await tx.enrollmentCatchUpRequest.update({ where: { id: moi.id }, data: { creditEntryKey: `ADJUSTMENT:${nguonLuotHocVuot(moi.id)}` } });
  }

  await writeAudit({
    tx,
    actor: nguoi,
    module: "enrollment",
    entityType: "Enrollment",
    entityId: gd.id,
    action: HANH_DONG_HOC_VUOT.doiBuoiBatDau,
    newValues: { buoiBatDauCu: gd.buoiBatDau ?? 1, buoiBatDauMoi: p.buoiBatDauMoi, canBu, soDongBu, luotDoi, lyDo: ly },
  });
  return { ok: true, buoiBatDau: p.buoiBatDauMoi, canBu };
}

/**
 * Vỏ có giao dịch cho `suaBuoiBatDauGhiDanh`: kiểm ghi danh THUỘC ĐƠN này (không cho sửa ghi danh của đơn khác qua một `orderId` hợp lệ) rồi chạy trong `db.$transaction`.
 * Người gọi PHẢI đã kiểm quyền Quản trị tối cao + tầm nhìn cơ sở của đơn.
 */
export async function doiBuoiBatDauCuaDon(
  p: { orderId: string; enrollmentId: string; buoiBatDauMoi: number; soBuoiBu?: number | null; lyDo: string },
  nguoi: Nguoi,
  bayGio: Date,
): Promise<{ ok: true; buoiBatDau: number; canBu: number } | { ok: false; error: string }> {
  const dong = await db.orderItem.findFirst({ where: { orderId: p.orderId, enrollmentId: p.enrollmentId }, select: { id: true } });
  if (!dong) return { ok: false, error: "Ghi danh không thuộc đơn này" };
  return db.$transaction((tx) =>
    suaBuoiBatDauGhiDanh(tx, { enrollmentId: p.enrollmentId, buoiBatDauMoi: p.buoiBatDauMoi, soBuoiBu: p.soBuoiBu ?? null, lyDo: p.lyDo }, nguoi, bayGio),
  );
}

// ── THÔNG BÁO CHO QLCS ──────────────────────────────────────────────────────────────────────────────

/** Quyền của người duyệt — cùng cổng với action duyệt (`duyetHocVuotAction`). Một chỗ, kẻo tin gửi cho người không bấm duyệt được. */
export const QUYEN_DUYET_HOC_VUOT = ["makeup:waive"] as const;

/** Báo QLCS cơ sở có yêu cầu học vượt chờ duyệt. KHÔNG BAO GIỜ NÉM (chạy sau commit chuyển đổi). */
export async function baoChoDuyetHocVuot(p: {
  requestId: string;
  centerId: string;
  tenBe: string;
  maDon: string;
  soBuoiBu: number;
  boQuaUserId?: string | null;
}): Promise<number> {
  try {
    const nguoi = (await nguoiGiuQuyenTaiCoSo(p.centerId, QUYEN_DUYET_HOC_VUOT)).filter((id) => id !== p.boQuaUserId);
    if (nguoi.length === 0) return 0;
    return await notifyStaff({
      userIds: nguoi,
      dedupeKey: khoaTinHocVuot(p.requestId),
      title: `Chờ duyệt học vượt bù — ${p.tenBe}`,
      body: `Đơn ${p.maDon}: bé vào lớp đã học trước, Sale xin học bù ${p.soBuoiBu} buổi. Duyệt để cộng lượt học bù miễn phí.`,
      href: `/hoc-bu/duyet-hoc-vuot`,
      entityId: p.requestId,
      reopen: true,
    });
  } catch (err) {
    console.error("[chuyen-doi] khong bao duoc cho duyet hoc vuot:", err);
    return 0;
  }
}

/** Thu hồi tin khi yêu cầu đã duyệt / từ chối. KHÔNG BAO GIỜ NÉM. */
export async function thuHoiBaoHocVuot(p: { requestId: string; centerId: string }): Promise<number> {
  try {
    const nguoi = await nguoiGiuQuyenTaiCoSo(p.centerId, QUYEN_DUYET_HOC_VUOT);
    if (nguoi.length === 0) return 0;
    return await thuHoiThongBao({ userIds: nguoi, dedupeKey: khoaTinHocVuot(p.requestId) });
  } catch (err) {
    console.error("[chuyen-doi] khong thu hoi duoc tin hoc vuot:", err);
    return 0;
  }
}
