// lib/enrollments/chuyen-lop.ts — CHUYỂN GHI DANH SANG LỚP KHÁC, phần chạy TRONG transaction.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA [PHIÊN F4 · 22/09/2026]
//
// Phép chuyển lớp vốn nằm trọn trong `transferEnrollment` (`app/(admin)/admin/enrollments/
// _actions.ts`) — một Server Action tự mở transaction Serializable của nó. F4 ("đổi khoá /
// đổi lớp") cần ĐÚNG phép ấy, nhưng phải chạy **trong cùng transaction tiền** (`ghiTienChoDon`,
// khoá advisory theo đơn), vì:
//
//   · `confirmPayment` TỪ CHỐI khoản chưa gắn ghi danh — *"Khoản chưa gắn ghi danh, không thể
//     sinh phiếu thu"* (`lib/finance/payment.ts:631`). Nên khoản tiền chuyển sang dòng MỚI mà
//     dòng ấy chưa có ghi danh là một khoản **không bao giờ xuất được phiếu thu**. Tức phép
//     chuyển lớp không phải "việc học vụ làm sau" — nó là điều kiện để phép ghi tiền đúng.
//   · Hai transaction rời thì hỏng ở giữa để lại: ghi danh đã chuyển mà tiền chưa theo, hoặc
//     ngược lại.
//
// ⚠️ Và vì sao TÁCH chứ không chép: ba bản chép tay của cùng một luật thì vá được hai bản là
// chuyện thường — bài học `lib/payments/don-nhan-tien.ts` sau khi ba nhánh tra đơn lệch nhau.
// Nên `transferEnrollment` NAY GỌI hàm này; luật chuyển lớp chỉ còn một chỗ.
//
// ⚠️ Hàm này KHÔNG kiểm quyền và KHÔNG kiểm cách ly cơ sở. Đó là việc của người gọi, và cố ý:
// nó chạy trong transaction của người gọi, nơi `scopedDb` không còn ở giữa. Hai người gọi hiện
// có đều gác đủ trước khi mở transaction.
import "server-only";
import type { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import { diTheoGhiDanhCu, doiQuyenHocSangGhiDanhMoi } from "@/lib/enrollments/di-theo-ghi-danh";
import { diTheoGiaVaTienSangGhiDanhMoi } from "@/lib/enrollments/di-theo-gia-va-tien-db";
import type { KetQuaDiTheoGiaVaTien } from "@/lib/enrollments/di-theo-gia-va-tien";
import { mocThoiGianGhiDanhMoi, trangThaiGhiDanhMoi } from "@/lib/enrollments/trang-thai-ghi-danh-moi";
import { CAPACITY_COUNT_STATUSES } from "@/lib/lms/assign";

type Tx = Prisma.TransactionClient;

/** Lỗi nghiệp vụ của phép chuyển lớp — người gọi bắt và dịch sang câu cho người dùng. */
export class ChuyenLopError extends Error {}

/** Ghi danh ở trạng thái này không chuyển lớp được nữa (khớp `TERMINAL_STATUSES` của `transferEnrollment`). */
export const TRANG_THAI_KHONG_CHUYEN_LOP = ["COMPLETED", "WITHDREW", "TRANSFERRED", "CANCELLED"] as const;

/**
 * Giá + khoản thu có đi theo ghi danh mới không. BẮT BUỘC khai (luật 7: tham số mặc định nguy hiểm thì bỏ mặc định — để `tsc` liệt kê chỗ gọi).
 *   · `THEO_GHI_DANH` — chuyển lớp thường: cùng khoá thì giá + khoản thu + dòng đơn đi theo (lib/enrollments/di-theo-gia-va-tien.ts).
 *   · `KHONG_DOI`     — đổi khoá F4 (`doi-khoa-db.ts`): nó tự tạo dòng đơn mới + tự chuyển tiền ở mức đơn; dời thêm ở đây là dời ĐÔI.
 */
export type CheDoGiaVaTien = "THEO_GHI_DANH" | "KHONG_DOI";

export type KetQuaChuyenLop = {
  newEnrollmentId: string;
  /** Kết quả mang giá + khoản thu; `null` khi người gọi chọn `KHONG_DOI`. */
  giaVaTien: KetQuaDiTheoGiaVaTien | null;
  /** Khoá học của lớp đích — người gọi cần nó để dựng dòng hàng mới. */
  courseId: string;
  targetClassName: string;
  targetCenterId: string | null;
};

/**
 * Chuyển một ghi danh sang lớp khác, TRONG transaction của người gọi.
 *
 * Người gọi PHẢI đã kiểm: quyền, cách ly cơ sở của lớp nguồn lẫn lớp đích, và ghi danh cũ
 * không ở trạng thái kết thúc.
 *
 * ⚠️ Kiểm sĩ số lớp đích LẠI ở đây, trong transaction — không tin con số đã đọc ngoài
 * transaction (chống TOCTOU, đúng FIX-C4 của bản cũ). Hai người bấm chuyển vào lớp cuối cùng
 * còn một chỗ thì người thứ hai phải bị từ chối, chứ không phải cả hai cùng vào.
 */
export async function chuyenLopTrongTx(
  tx: Tx,
  input: {
    oldEnrollmentId: string;
    targetClassId: string;
    reason: string;
    actor: AuditActor;
    giaVaTien: CheDoGiaVaTien;
  },
): Promise<KetQuaChuyenLop> {
  // KHOÁ hàng ghi danh cũ TRƯỚC khi đọc: hai lượt chuyển cùng một ghi danh (hai người bấm, hoặc bấm đúp) phải nối đuôi nhau — lượt sau đọc lại thấy đã TRANSFERRED và bị từ chối,
  // thay vì cả hai cùng tạo ghi danh mới và cả hai cùng nhận giá + tiền (nợ nhân đôi).
  await tx.$queryRaw`SELECT id FROM "Enrollment" WHERE id = ${input.oldEnrollmentId} FOR UPDATE`;
  const cu = await tx.enrollment.findFirst({
    where: { id: input.oldEnrollmentId, deletedAt: null },
    select: {
      id: true,
      status: true,
      studentId: true,
      classId: true,
      // Hai cột "đi theo học viên" sang ghi danh mới (xem khối sao chép bên dưới).
      courseId: true,
      buoiBatDau: true,
      saleId: true,
      class: { select: { centerId: true } },
    },
  });
  if (!cu) throw new ChuyenLopError("Không tìm thấy ghi danh cũ");
  if ((TRANG_THAI_KHONG_CHUYEN_LOP as readonly string[]).includes(cu.status)) {
    throw new ChuyenLopError(`Không thể chuyển ghi danh đang ${cu.status}`);
  }
  if (cu.classId === input.targetClassId) {
    throw new ChuyenLopError("Lớp đích trùng lớp hiện tại");
  }

  const lop = await tx.class.findFirst({
    where: { id: input.targetClassId, deletedAt: null },
    select: { id: true, name: true, courseId: true, centerId: true, maxStudents: true, status: true },
  });
  if (!lop) throw new ChuyenLopError("Không tìm thấy lớp đích");
  if (lop.status === "CANCELLED" || lop.status === "COMPLETED") {
    throw new ChuyenLopError(`Lớp đích đang ${lop.status}`);
  }

  const dangCo = await tx.enrollment.count({
    where: {
      classId: input.targetClassId,
      status: { in: [...CAPACITY_COUNT_STATUSES] },
      deletedAt: null,
    },
  });
  if (dangCo >= lop.maxStudents) {
    throw new ChuyenLopError(`Lớp đích đã đủ học sinh (${lop.maxStudents} chỗ)`);
  }

  // Ghi danh CÒN SỐNG của chính bé ở lớp đích ⇒ chặn. Tầng nền của `lib/db.ts` không hook
  // được quan hệ lồng, nhưng đây là truy vấn cấp cao nhất nên `deletedAt: null` vẫn cần khai
  // tay trong transaction thô.
  const daCo = await tx.enrollment.findFirst({
    where: { studentId: cu.studentId, classId: input.targetClassId, deletedAt: null },
    select: { status: true },
  });
  if (daCo) {
    throw new ChuyenLopError(`Học sinh đã có ghi danh ở lớp đích (đang ${daCo.status})`);
  }

  const trangThaiMoi = trangThaiGhiDanhMoi(lop.status, "CONFIRMED");
  const diTheo = diTheoGhiDanhCu(cu, lop.courseId);
  const moi = await tx.enrollment.create({
    data: {
      student: { connect: { id: cu.studentId } },
      class: { connect: { id: input.targetClassId } },
      course: { connect: { id: lop.courseId } },
      // FL3-02 — phi chuẩn hoá từ lớp ĐÍCH cho `scopedDb`. Lấy từ lớp cũ là bé chuyển sang
      // cơ sở khác mà vẫn nằm trong tầm nhìn cơ sở cũ.
      centerId: lop.centerId,
      // 11/10/2026 — lớp đích ĐANG CHẠY ⇒ "Đang học"; chưa khai giảng ⇒ "Đã xếp lớp" như cũ
      // (lib/enrollments/trang-thai-ghi-danh-moi.ts, ca [TGM-*]).
      status: trangThaiMoi,
      ...mocThoiGianGhiDanhMoi(trangThaiMoi, new Date()),
      notes: `Chuyển từ ghi danh ${cu.id}`,
      // [21/10/2026] ĐI THEO HỌC VIÊN, trước đây rơi mất: (1) `buoiBatDau` — NULL là "học đủ khoá" (fail-open), nên học viên mua gói từ bài N mà chuyển lớp xong
      // thì bảng điểm danh hiện lại cả bài trước N; (2) `saleId` — sale phụ trách không được mất học viên của mình chỉ vì đổi lớp.
      // CỐ Ý KHÔNG chép `leadChildId` (tín hiệu "đã chốt" của báo cáo trial-sale — ghi thêm là thổi phồng số chuyển đổi, schema `Student.leadId`)
      // và `renewedFromEnrollmentId` (chuỗi tái tục thuộc ghi danh gốc).
      // Đổi KHOÁ (F4 `doi-khoa-db.ts` đi qua hàm này) thì số bài của khoá cũ vô nghĩa ở khoá mới ⇒ không chép.
      buoiBatDau: diTheo.buoiBatDau,
      ...(diTheo.saleId ? { sale: { connect: { id: diTheo.saleId } } } : {}),
    },
    select: { id: true },
  });

  // QUYỀN HỌC ĐI THEO GHI DANH [21/10/2026]: quyền học trỏ mềm vào ghi danh + lớp; để nguyên thì nó vẫn trỏ ghi danh TRANSFERRED ở lớp cũ (điểm danh / tiến độ
  // đọc sai chỗ, `xetXepLopChoDon` thấy "ghi danh vừa đổi"). Chỉ dời quyền CÙNG KHOÁ còn sống: đổi khoá (F4) là một quyền học khác, không dời ở đây.
  await doiQuyenHocSangGhiDanhMoi(tx, { enrollmentCuId: cu.id, enrollmentMoiId: moi.id, courseId: lop.courseId, classId: input.targetClassId });

  // Có điều kiện: ghi danh cũ phải còn đúng trạng thái vừa đọc dưới khoá và chưa trỏ ghi danh nào (chặn lượt chồng).
  const dong = await tx.enrollment.updateMany({
    where: { id: cu.id, status: cu.status, transferredToId: null },
    data: {
      status: "TRANSFERRED",
      transferredToId: moi.id,
      transferReason: input.reason,
      endedAt: new Date(),
    },
  });
  if (dong.count !== 1) throw new ChuyenLopError("Ghi danh đã được phiên khác chuyển — làm mới trang rồi thử lại");

  // GIÁ + KHOẢN THU + DÒNG ĐƠN đi theo ghi danh mới [P7-G2 · 27/10/2026] — sau khi ghi danh cũ đã chuyển, cùng transaction. Luật + lý do: lib/enrollments/di-theo-gia-va-tien.ts.
  let giaVaTien: KetQuaDiTheoGiaVaTien | null = null;
  if (input.giaVaTien === "THEO_GHI_DANH") {
    giaVaTien = await diTheoGiaVaTienSangGhiDanhMoi(tx, {
      cuId: cu.id,
      moiId: moi.id,
      khoaCu: cu.courseId,
      khoaMoi: lop.courseId,
      actor: input.actor,
      lyDo: `Chuyển lớp: giá và khoản thu đi theo ghi danh mới — ${input.reason}`,
      orgUnitId: lop.centerId,
    });
    // Không đi theo vì lý do cần người xem (hoàn tiền / bảo lưu đang chạy, ghi danh mới đã có giá) ⇒ để dấu vết; khác khoá / không có gì để mang là bình thường.
    if (!giaVaTien.daDoi && (giaVaTien.ma === "CO_HOAN_TIEN_HOAC_BAO_LUU" || giaVaTien.ma === "GHI_DANH_MOI_DA_CO_GIA")) {
      await writeAudit({
        tx,
        actor: input.actor,
        module: "finance",
        entityType: "Enrollment",
        entityId: cu.id,
        action: "CHUYEN_LOP_KHONG_DI_THEO_GIA_VA_TIEN",
        newValues: { moiId: moi.id, ma: giaVaTien.ma },
        changedFields: [],
        reason: `Chuyển lớp không mang giá và khoản thu sang ghi danh mới (${giaVaTien.ma}) — cần kế toán xử lý`,
        orgUnitId: lop.centerId,
      });
    }
  }

  await tx.enrollmentAuditLog.create({
    data: {
      enrollmentId: cu.id,
      fromStatus: cu.status,
      toStatus: "TRANSFERRED",
      changedByUserId: input.actor.id || null,
      changedByName: input.actor.name,
      reason: input.reason,
      extraData: { transferredToId: moi.id, targetClassId: input.targetClassId },
    },
  });
  await tx.enrollmentAuditLog.create({
    data: {
      enrollmentId: moi.id,
      fromStatus: "—",
      toStatus: "CONFIRMED",
      changedByUserId: input.actor.id || null,
      changedByName: input.actor.name,
      reason: `Chuyển từ lớp cũ: ${input.reason}`,
      extraData: { transferredFromId: cu.id, sourceClassId: cu.classId },
    },
  });

  await writeAudit({
    tx,
    actor: input.actor,
    module: "enrollment",
    entityType: "Enrollment",
    entityId: cu.id,
    action: "STATUS_CHANGE",
    oldValues: { status: cu.status },
    newValues: { status: "TRANSFERRED", transferredToId: moi.id },
    reason: input.reason,
    orgUnitId: cu.class?.centerId ?? null,
  });
  await writeAudit({
    tx,
    actor: input.actor,
    module: "enrollment",
    entityType: "Enrollment",
    entityId: moi.id,
    action: "CREATE",
    newValues: {
      studentId: cu.studentId,
      classId: input.targetClassId,
      courseId: lop.courseId,
      status: "CONFIRMED",
      transferredFromId: cu.id,
    },
    reason: `Chuyển từ lớp cũ: ${input.reason}`,
    orgUnitId: lop.centerId,
  });

  // US-03 chat / TS-05 — PH rời nhóm cũ + vào nhóm mới, TRONG CÙNG transaction: rollback thì
  // không có chuyện đồng bộ nửa vời.
  await syncConversationMembership(tx, cu.classId);
  await syncConversationMembership(tx, input.targetClassId);

  return {
    newEnrollmentId: moi.id,
    giaVaTien,
    courseId: lop.courseId,
    targetClassName: lop.name,
    targetCenterId: lop.centerId,
  };
}
