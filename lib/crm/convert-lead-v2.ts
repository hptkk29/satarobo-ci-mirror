// lib/crm/convert-lead-v2.ts — R7-05 ⚠️ Convert v2: guard PAYMENT_REQUIRED + đa học viên
// + dedupe parent/student + consent + mã HV v2, tất cả ATOMIC. Giữ convert-lead.ts cũ cho
// regression (flag CONVERT_V2_ENABLED). Side-effect (notify) đi DomainEvent SAU commit.
import { db } from "@/lib/db";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { chanGuiRaNgoai, donNhiemTheoDon } from "@/lib/orders/don-nhiem";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { recordLeadStatusChange } from "@/lib/lead/status-trail-write";
import { genStudentCodeV2 } from "@/lib/codegen";
import { computeEnrollmentPrice } from "@/lib/finance/pricing";
// HTL-09 — giá ghi danh lấy từ DÒNG ĐƠN (chủ dự án chốt 23/09/2026). Xem lý lẽ đầy đủ ở
// `lib/finance/gia-tu-dong-don.ts`: thay ĐẦU VÀO `listPrice`, không thay công thức, nên
// giảm giá/học bổng khai lúc convert vẫn áp bình thường.
import { listPriceChoGhiDanh, soBuoiChoGhiDanh } from "@/lib/finance/gia-tu-dong-don";
import { dongDonCuaLead } from "@/lib/finance/dong-don-cua-lead";
import { phamViBuoiDangKy } from "@/lib/orders/dot-theo-hoc-phan";
import { linkRecordedPaymentsToEnrollments } from "@/lib/finance/payment";
import { findParentMatch, findExistingStudent } from "@/lib/crm/dedupe";
import { hocVienDaAnDanhTheoNhatKy, tenLaDaAnDanh } from "@/lib/students/da-an-danh";
import { canonicalPhone } from "@/lib/phone";
// ⚠️ TRÙNG TÊN với `recordLeadStatusChange` của `@/lib/lead/status-trail-write` ngay
// trên — hai hàm KHÁC NHAU, hợp nhất 16/09/2026 kéo cả hai vào file này. Bản dưới đây
// (nhánh `main`) ghi SỔ trạng thái theo `LeadStatusSource`; bản trên (nhánh `test`) ghi
// DÒNG THỜI GIAN và nhận `auditAlreadyWritten`. Đặt bí danh để không ai nhầm.
import { recordLeadStatusChange as ghiSoTrangThaiLead } from "@/lib/leads/set-status";
import {
  createBackfillOrderPaymentInTx,
  type BackfillPaymentInput,
} from "@/lib/crm/backfill-order";
import { inferLeadChildIdForConvert } from "@/lib/orders/lead-child-link";
import { CLOSED_CHILD_STATUS, resolveClosedLeadChildIds } from "@/lib/lead/close-mark";
import { docConChuyenDoiDuoc } from "@/lib/crm/con-chua-chuyen-doi-db";
import { commissionPeriodVN } from "@/lib/crm/commission-thuc-thu";
import { docThangThuocSoMoi } from "@/lib/hoa-hong/cutover";
import { decideLeadLostFields } from "@/lib/lead/lost-status";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import {
  ensureCommissionStatement,
  findAttendedTrialForLeadChild,
  recordTrialTeacherCommission,
  type AttendedTrial,
  type CommissionStatementRef,
} from "@/lib/crm/trial-teacher-commission";
import type { CourseDiscountType } from "@prisma/client";
// 25/09/2026 — liên kết Học viên ↔ Lead nguồn: chốt lead là đường nối TỰ ĐỘNG, và điền
// ô trống của hồ sơ HV từ lead/con theo MỘT luật dùng chung với script nối HV cũ + nút
// "Gắn lead" (chỉ điền ô null, không bao giờ ghi đè).
import {
  dienTuLead,
  type LeadChildDeDien,
  type LeadDeDien,
  type StudentDeDien,
} from "@/lib/students/dien-tu-lead";

export type ConvertV2Result =
  | { ok: true; studentIds: string[]; enrollmentIds: string[]; deduped: boolean }
  | { ok: false; error: { code: string; message: string } };

/**
 * Guard điều kiện convert (THUẦN — AC1/C1/C3): cho convert khi đã có khoản Sale
 * ghi nhận (saleStatus=RECORDED), HOẶC tổng phải-thu = 0 (học bổng toàn phần →
 * cần ghi audit lý do). Theo R7-05-C2: kế toán CHƯA xác nhận vẫn pass — phiếu thu
 * (confirmPayment) sinh per Enrollment nên chỉ confirm được SAU khi convert tạo
 * Enrollment; đòi CONFIRMED trước convert là deadlock.
 */
export function evaluatePaymentGuard(input: {
  hasRecordedPayment: boolean;
  totalFinalPrice: number;
}): { ok: true; scholarshipFull: boolean } | { ok: false } {
  if (input.hasRecordedPayment) return { ok: true, scholarshipFull: false };
  if (input.totalFinalPrice === 0) return { ok: true, scholarshipFull: true };
  return { ok: false };
}

/**
 * FL2-01 — Tính 2 đợt học phí cho convert. THUẦN (testable). Tổng 2 đợt LUÔN bằng
 * `orderTotal` (clamp dot1 vào [0, orderTotal]; dot2 = phần còn lại) để không vi phạm
 * ràng buộc của `recordInstallmentPlan` (dot1+dot2 === order.totalAmount). dot1 = số
 * tiền đã thu ở đợt 1; dot2 = số còn lại hẹn đóng (dueDate).
 */
export function computeInstallmentSplit(
  orderTotal: number,
  dot1Amount: number,
): { dot1: number; dot2: number } {
  const safeTotal = Math.max(0, Math.round(orderTotal));
  const dot1 = Math.min(Math.max(0, Math.round(dot1Amount)), safeTotal);
  return { dot1, dot2: safeTotal - dot1 };
}

export type ConvertV2Student = {
  leadChildId?: string | null;
  name: string;
  dob?: Date | null;
  courseId: string;
  discount?: { type: CourseDiscountType; value: number } | null;
  listPrice: number;
  classId: string;
  consentMedia: boolean;
};

export type ConvertV2Input = {
  leadId: string;
  /** AUTH-SĐT P5 — KHÔNG còn bắt buộc; khoá định danh là `parentPhone`. */
  parentEmail: string | null;
  parentName: string;
  /** Canonical `84…` (validator `phoneVn` đã transform). Khoá định danh tài khoản. */
  parentPhone: string;
  // C5 — CCCD + địa chỉ phụ huynh (lưu trên User, KHÔNG lưu trên Student). Optional/additive.
  parentCccd?: string | null;
  parentAddress?: string | null;
  parentWard?: string | null; // phường/xã (2 cấp 2025)
  parentCity?: string | null; // tỉnh/thành
  students: ConvertV2Student[];
  /** Khoá idempotency ổn định theo submit (chống double-submit / 2 Sale song song). */
  idempotencyKey: string;
  /**
   * BACKFILL (chốt hàng loạt lead nhập từ Excel cũ) — cho qua guard PAYMENT_REQUIRED
   * khi lead lịch sử không có Payment RECORDED trong hệ thống. BẮT BUỘC kèm lý do
   * (ghi vào AuditLog). Chỉ đường bulk-convert (gate leads:view-all + leads:import)
   * được set — form convert thường KHÔNG truyền field này.
   */
  allowNoPayment?: { reason: string } | null;
  /**
   * BACKFILL có tiền: khoản khách đã đóng TRƯỚC hệ thống. Order + Payment RECORDED
   * được tạo TRONG transaction convert (convert fail → tiền rollback theo, không
   * để khoản ma; race 2 lượt song song do atomic-claim giải). Có field này thì
   * guard PAYMENT_REQUIRED coi như thoả.
   */
  backfillPayment?: BackfillPaymentInput | null;
  /**
   * 27/08 — GIẢI TRÌNH ƯU ĐÃI (miễn phí / học bổng / giảm giá) do người chốt gõ ở
   * form convert. KHÔNG phải cổng quyền: guard tiền vẫn là `evaluatePaymentGuard`
   * (tổng sau ưu đãi = 0 ⇒ qua). Field này chỉ để lý do đi vào `AuditLog.reason` —
   * "ai cho em này miễn phí, vì cái gì" phải tra được, vì tiền biến mất khỏi công
   * nợ ngay tại đây. Rỗng/không truyền ⇒ giữ nguyên hành vi cũ.
   */
  discountReason?: string | null;
};

export async function convertLeadV2(actor: AuditActor, input: ConvertV2Input): Promise<ConvertV2Result> {
  if (input.students.length === 0) {
    return { ok: false, error: { code: "NO_STUDENT", message: "Cần ít nhất 1 học viên" } };
  }

  // 0) Idempotency — đã xử lý key này → trả kết quả cũ (AC2 double-submit).
  const seen = await db.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
  if (seen?.result) {
    const r = seen.result as { studentIds?: string[]; enrollmentIds?: string[] };
    return { ok: true, studentIds: r.studentIds ?? [], enrollmentIds: r.enrollmentIds ?? [], deduped: true };
  }

  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    // T3.2 — assignedToId = sale đang phụ trách lead → thành Enrollment.saleId.
    select: {
      id: true,
      status: true,
      // 27/09/2026 — rẽ nhánh "chốt thêm bé cho lead ĐÃ chuyển đổi" (xem khối ngay dưới).
      convertedAt: true,
      centerId: true,
      parentName: true,
      phone: true,
      assignedToId: true,
      // 25/09 — nguồn điền ô trống hồ sơ học viên (dienTuLead). Chỉ ĐỌC ở đây.
      email: true,
      facebookUrl: true,
      parentGender: true,
      parentDob: true,
      city: true,
      ward: true,
      addressLine: true,
    },
  });
  if (!lead) return { ok: false, error: { code: "LEAD_NOT_FOUND", message: "Không tìm thấy lead" } };
  if (!lead.centerId) return { ok: false, error: { code: "LEAD_NO_CENTER", message: "Lead chưa thuộc cơ sở" } };

  // ── CHỐT THÊM BÉ cho lead ĐÃ chuyển đổi (27/09/2026) ─────────────────────────────
  // Sự cố prod: khoá chống đua bám `Lead.convertedAt` ⇒ bé đầu đã vào học thì bé thứ hai
  // của cùng gia đình KHÔNG BAO GIỜ chốt được (gộp lead Phương Tuyết lộ ra; luật chống trùng
  // mới gộp phiếu bé thứ hai vào lead đã đăng ký nên nay là ca thường). Nhánh này CHỈ nhận
  // bé qua được `conConChuyenDoiDuoc` (có chốt an toàn cho dữ liệu trước 26/08), khoá chống
  // đua chuyển sang TỪNG BÉ, và KHÔNG đổi trạng thái / mốc chốt của lead.
  const laChotBeSau = lead.convertedAt !== null;
  if (laChotBeSau) {
    const duoc = new Set(await docConChuyenDoiDuoc(db, lead.id, lead.convertedAt!));
    if (input.students.some((s) => !s.leadChildId || !duoc.has(s.leadChildId))) {
      return {
        ok: false,
        error: {
          code: "ALREADY_CONVERTED",
          message:
            "Lead này đã chuyển đổi — chỉ chốt thêm được bé CHƯA thành học viên và được thêm vào sau lần chốt trước.",
        },
      };
    }
  }
  // 1) C2 — BỎ chặn status (REGISTERED không phải cổng nghiệp vụ thật; xem PH-2). Cho convert
  //    từ MỌI status chưa kết thúc — cổng tiền (PAYMENT_REQUIRED) bên dưới mới là điều kiện chốt.
  //    Atomic-claim bên dưới (status notIn terminal) vẫn chống race double-submit.

  // 2) Guard PAYMENT_REQUIRED (R7-05-C2): ≥1 Payment Sale ghi nhận
  //    (saleStatus=RECORDED) trên order của lead, hoặc Σ finalPrice = 0.
  // HTL-09 — ĐỌC MỘT LẦN cho cả lượt convert, không tra theo từng em (đơn của một lead
  // đếm bằng đơn vị, nhưng N+1 trong một transaction tiền là thứ chỉ lộ ra khi dữ liệu
  // lớn hơn — đúng bài học `goiYDon` đang ghim).
  const dongDon = await dongDonCuaLead(lead.id);
  const prices = input.students.map((s) =>
    computeEnrollmentPrice({
      listPrice: listPriceChoGhiDanh(
        dongDon,
        { leadChildId: s.leadChildId, courseId: s.courseId },
        s.listPrice,
      ),
      discount: s.discount ?? null,
    }),
  );

  // ── PHẠM VI BUỔI KHI MUA ÍT HƠN CẢ KHOÁ [28/09/2026] ────────────────────────
  //
  // Chủ dự án: *"đăng ký 39 buổi thì sẽ bắt đầu học từ buổi 10 → 48 … các buổi không đăng
  // ký thì bỏ qua"*. Tính ở ĐÂY, lưu vào `Enrollment.buoiBatDau`; cổng đọc ở
  // `lib/orders/buoi-duoc-hoc.ts`.
  //
  // ⚠️ MỘT câu tra cho cả lượt, đúng bài học `HTL-09` ngay trên: đơn của một lead đếm bằng
  // đơn vị, nhưng N+1 trong một transaction tiền chỉ lộ ra khi dữ liệu lớn hơn.
  const soBuoiKhoa = new Map(
    (
      await db.course.findMany({
        where: { id: { in: [...new Set(input.students.map((s) => s.courseId))] } },
        select: { id: true, totalSessions: true },
      })
    ).map((c) => [c.id, c.totalSessions]),
  );
  const buoiBatDaus = input.students.map((s) => {
    const pv = phamViBuoiDangKy({
      tongSoBuoiKhoa: soBuoiKhoa.get(s.courseId) ?? null,
      soBuoiMua: soBuoiChoGhiDanh(dongDon, {
        leadChildId: s.leadChildId,
        courseId: s.courseId,
      }),
    });
    // `null` hoặc buổi 1 ⇒ để NULL: "học đủ khoá" là trạng thái mặc định, và ghi một số 1
    // vào đây chỉ làm cột mất khả năng phân biệt "đủ khoá" với "đã tính ra đúng buổi 1".
    return pv && pv.buoiBatDau > 1 ? pv.buoiBatDau : null;
  });
  const totalFinalPrice = prices.reduce((sum, p) => sum + p.finalPrice, 0);
  // 07/09 — thêm `deletedAt: null` cho khớp `lib/crm/bulk-convert.ts:191` (vốn đã có).
  // Thiếu nó thì một khoản đã xoá sổ vẫn mở được cổng chốt ghi danh.
  const recordedCount = await db.payment.count({
    where: { ...KHOAN_DA_GHI_NHAN, order: { leadId: lead.id } },
  });
  const guard = evaluatePaymentGuard({
    // backfillPayment sẽ tạo khoản RECORDED trong chính transaction bên dưới → coi như đã có.
    hasRecordedPayment: recordedCount > 0 || Boolean(input.backfillPayment),
    totalFinalPrice,
  });
  // Backfill KHÔNG tiền: guard fail nhưng caller đã khai lý do → cho qua, ghi audit bên dưới.
  const backfillNoPayment = !guard.ok && Boolean(input.allowNoPayment?.reason?.trim());
  if (!guard.ok && !backfillNoPayment) {
    return { ok: false, error: { code: "PAYMENT_REQUIRED", message: "Cần ghi nhận khoản thanh toán trước khi chốt" } };
  }
  /**
   * ── BƯỚC A3 [16/09/2026]: KHÔNG XẾP LỚP TỪ ĐƠN GHI TÊN CON NHÀ KHÁC ─────────
   *
   * Chủ dự án: *"đơn nhiễm: … không cho xếp lớp từ đơn đó"*.
   *
   * Chốt lead là lúc hệ thống ĐÚC ra `Student` + `Enrollment` + xếp lớp từ những gì đơn
   * đang nói. Đơn đang ghi tên con của gia đình khác mà cho chốt thì cái sai thôi nằm yên
   * trong một bản ghi đơn — nó biến thành ghi danh, thành suất lớp, thành học bạ, và mỗi
   * bước sau lại khó gỡ hơn bước trước.
   *
   * Chặn Ở ĐÂY chứ không chỉ ở màn tạo đơn, vì đơn nhiễm đã tồn tại sẵn trên DB từ trước
   * khi cổng tạo đơn ra đời — cổng mới không hồi tố.
   */
  const donCuaLead = await db.order.findMany({
    where: { leadId: lead.id, deletedAt: null },
    select: { id: true, code: true },
  });
  if (donCuaLead.length > 0) {
    const nhiem = await donNhiemTheoDon(db, donCuaLead.map((o) => o.id));
    const ban = donCuaLead.filter((o) => {
      const d = nhiem.get(o.id);
      return d ? chanGuiRaNgoai(d) : false;
    });
    if (ban.length > 0) {
      const ten = [
        ...new Set(ban.flatMap((o) => nhiem.get(o.id)?.conNhaKhac ?? [])),
      ];
      return {
        ok: false,
        error: {
          code: "DON_NHIEM_DU_LIEU",
          message:
            `Đơn ${ban.map((o) => o.code).join(", ")} đang ghi tên con của gia đình khác` +
            (ten.length ? ` (${ten.join(", ")})` : "") +
            ". Sửa lại học viên trên đơn rồi mới chốt — chốt bây giờ là đúc cái sai " +
            "thành ghi danh và suất lớp.",
        },
      };
    }
  }

  const scholarshipFull = guard.ok ? guard.scholarshipFull : false;
  // Lý do ưu đãi chỉ có nghĩa khi CÓ ưu đãi thật (Σ discountAmount > 0) — không để
  // chuỗi rác của caller bám vào audit của lead chốt giá đầy đủ.
  const totalDiscountAmount = prices.reduce((sum, p) => sum + p.discountAmount, 0);
  const discountReason = totalDiscountAmount > 0 ? input.discountReason?.trim() || null : null;

  // 3) Dedupe parent (3 nhánh). Conflict → tạo ConvertConflict + khoá convert (AC3).
  const parentMatch = await findParentMatch({ email: input.parentEmail, phone: input.parentPhone });
  if (parentMatch.kind === "conflict") {
    await db.convertConflict.upsert({
      where: { id: `${lead.id}` }, // 1 conflict OPEN / lead (id = leadId cho idempotent)
      create: {
        id: lead.id,
        leadId: lead.id,
        parentAId: parentMatch.parentAId,
        parentBId: parentMatch.parentBId,
        status: "OPEN",
      },
      update: { parentAId: parentMatch.parentAId, parentBId: parentMatch.parentBId, status: "OPEN" },
    });
    return { ok: false, error: { code: "PARENT_CONFLICT", message: "Email và SĐT khớp 2 hồ sơ khác nhau — cần Admin xử lý" } };
  }

  // ── Chuẩn bị phần HOA HỒNG TRƯỚC transaction (25/08) ───────────────────────────
  //
  // Hai việc dưới đây CỐ Ý nằm ngoài `db.$transaction`:
  //   • tra "con đã học thử ở lớp nào" — thuần ĐỌC, không cần atomic;
  //   • dựng `CommissionStatement` của kỳ — `upsert` của Prisma trên model nhiều unique
  //     biên dịch thành đọc-rồi-ghi, nên hai lượt convert song song vào lần đầu tiên của
  //     tháng có thể đâm P2002. Ném bên trong transaction là RỔ CẢ LƯỢT CONVERT (mất
  //     lead claim, phụ huynh, học viên, ghi danh, đơn học phí) — đã dựng lại được lỗi
  //     này trên Postgres thật. Ở ngoài thì P2002 chỉ có nghĩa "người khác vừa tạo
  //     trước", bắt và đọc lại là xong.
  //
  // Một mốc thời gian DUY NHẤT cho cả lượt convert: nhiều học viên trong cùng một lượt
  // phải rơi vào CÙNG kỳ hoa hồng, kể cả khi transaction chạy vắt qua nửa đêm.
  const now = new Date();
  const attendedTrials = new Map<string, AttendedTrial>();
  for (const s of input.students) {
    if (!s.leadChildId || attendedTrials.has(s.leadChildId)) continue;
    const t = await findAttendedTrialForLeadChild(db, s.leadChildId);
    if (t) attendedTrials.set(s.leadChildId, t);
  }
  // CUTOVER (CUT-3, A10): tháng của lượt convert đã thuộc sổ hoa hồng MỚI ⇒ KHÔNG tạo bảng kê "ma" và KHÔNG ghi dòng GV Trial cũ — engine mới tính 1% GV
  // Trial trên thực thu. Đây là LỚP TRẢ LỜI SỚM; cổng thật ở tầng `lib` (`ensureCommissionStatement`, `recordTrialTeacherCommission`). Đặt TRƯỚC
  // `ensureCommissionStatement` và NGOÀI transaction (không dời lời gọi vào transaction — lưới `trial-teacher-commission.test.ts`).
  const thangThuocSoMoi = await docThangThuocSoMoi(db, commissionPeriodVN(now));
  const needsCommission = !thangThuocSoMoi && [...attendedTrials.values()].some((t) => t.teacherUserId);
  let commissionStatement: CommissionStatementRef | null = null;
  if (needsCommission) {
    commissionStatement = await ensureCommissionStatement(now);
  }

  // ── 25/09/2026 — dữ liệu để NỐI học viên về lead nguồn + điền ô trống ─────────────
  //
  // MỘT câu cho mọi con trong lượt (không N+1), và lọc `leadId: lead.id`: bulk-convert
  // nhận `leadChildId` từ file, con của phiếu KHÁC thì không được dùng để điền hồ sơ
  // (và không được thành `Student.leadChildId` — cột đó nghĩa là "đứa trẻ trong CHÍNH
  // phiếu `Student.leadId`").
  const conIds = [
    ...new Set(input.students.map((s) => s.leadChildId).filter((x): x is string => !!x)),
  ];
  const conTheoId = new Map<string, LeadChildDeDien & { id: string }>(
    conIds.length > 0
      ? (
          await db.leadChild.findMany({
            where: { id: { in: conIds }, leadId: lead.id },
            select: { id: true, dob: true, gender: true, schoolName: true, gradeLevel: true },
          })
        ).map((c) => [c.id, c])
      : [],
  );
  // Địa chỉ: cụm Sale gõ ở form chốt (C5) MỚI HƠN cụm trên lead ⇒ thắng. Vẫn CẢ CỤM hoặc
  // không (luật 3 của dienTuLead) — không ghép tỉnh của cụm này với số nhà của cụm kia.
  const goDiaChiLucChot = [input.parentCity, input.parentWard, input.parentAddress].some(
    (v) => !!v?.trim(),
  );
  const leadDeDien: LeadDeDien = {
    email: lead.email,
    facebookUrl: lead.facebookUrl,
    parentGender: lead.parentGender,
    parentDob: lead.parentDob,
    ...(goDiaChiLucChot
      ? {
          city: input.parentCity ?? null,
          ward: input.parentWard ?? null,
          addressLine: input.parentAddress ?? null,
        }
      : { city: lead.city, ward: lead.ward, addressLine: lead.addressLine }),
  };

  const result = await db.$transaction(async (tx) => {

    // CLAIM atomic chống race (2 Sale song song): chỉ 1 lượt chuyển khỏi status chưa-kết-thúc.
    // GĐ5 — KHOÁ CHỐNG ĐUA nay bám `convertedAt IS NULL` thay vì bám STATUS.
    //
    // Vì sao BẮT BUỘC đổi trước khi gộp ENROLLED + REGISTERED: khoá cũ dựa vào việc
    // ENROLLED nằm trong danh sách terminal, nên lượt convert thứ hai thấy count=0 và
    // dừng. Gộp hai trạng thái xong thì lead "đã đăng ký" (chưa convert) cũng mang
    // đúng giá trị đó ⇒ nó sẽ KHÔNG BAO GIỜ convert được nữa. Đây là thứ tự bắt buộc,
    // không phải tuỳ chọn.
    //
    // `convertedAt` là mốc do chính lượt convert ghi, nên nó là khoá đúng nghĩa: một
    // lead chỉ convert được một lần, bất kể trạng thái đang là gì. Vẫn atomic vì đây
    // là một lệnh updateMany duy nhất.
    if (laChotBeSau) {
      // Khoá chống đua theo TỪNG BÉ: hai Sale bấm cùng lúc ⇒ lượt sau thấy closedAt đã có.
      const ids = input.students.map((s) => s.leadChildId!);
      const giu = await tx.leadChild.updateMany({
        where: { id: { in: ids }, leadId: lead.id, closedAt: null },
        data: { status: CLOSED_CHILD_STATUS, closedAt: now },
      });
      if (giu.count !== ids.length) throw new Error("ALREADY_CONVERTED");
    } else {
    const claim = await tx.lead.updateMany({
      where: {
        id: lead.id,
        convertedAt: null,
        // Lead đã mất thì vẫn chặn: chưa convert nhưng cũng không nên convert.
        // GĐ5 — trước là `notIn: ["LOST", "DUPLICATE"]`; hai giá trị đó nay cùng là
        // DA_MAT (chống trùng chuyển sang ràng buộc lúc TẠO lead), nên gộp làm một.
        status: { notIn: ["DA_MAT"] },
        deletedAt: null,
      },
      data: { status: "DA_DANG_KY", convertedById: actor.id, convertedAt: new Date() },
    });
    if (claim.count === 0) throw new Error("ALREADY_CONVERTED");
    // GĐ1 — giữ nguyên `updateMany` làm lượt claim atomic (hai Sale bấm cùng lúc thì
    // chỉ một lượt thắng), chỉ nối thêm sổ. `from` là trạng thái đọc TRƯỚC claim.
    await ghiSoTrangThaiLead({
      tx,
      leadId: lead.id,
      from: lead.status,
      to: "DA_DANG_KY",
      // Chữ THƯỜNG: `LeadStatusSource` của `leads/set-status` dùng chữ thường, khác
      // hẳn `source` của `lead/status-trail-write` ở lời gọi dưới (viết HOA). Hai hàm
      // trùng tên nhưng kiểu khác nhau — đây đúng là chỗ dễ đổi nhầm.
      source: "convert",
      actorId: actor.id,
      actorName: actor.name ?? null,
    });
    }

    const center = await tx.center.findUnique({ where: { id: lead.centerId! }, select: { code: true } });
    const centerCode = center?.code ?? "CS";

    // BACKFILL có tiền — tạo Order + Payment RECORDED TRONG tx (sau claim nên
    // 2 lượt song song chỉ 1 lượt tạo được; fail chỗ nào sau đây là rollback cả
    // tiền lẫn ghi danh). Đặt TRƯỚC linkRecordedPaymentsToEnrollments để khoản
    // vừa tạo được gắn vào enrollment ngay trong cùng transaction.
    if (input.backfillPayment) {
      await createBackfillOrderPaymentInTx(tx, {
        actor,
        lead: {
          id: lead.id,
          centerId: lead.centerId,
          parentName: lead.parentName,
          phone: lead.phone,
          email: input.parentEmail,
        },
        paid: input.backfillPayment,
        // N-2 · quyết định B4 — quy đơn backfill về đúng con, KHI VÀ CHỈ KHI lượt chốt
        // này có đúng một học viên gắn `LeadChild`. Chốt 2 con cùng lượt vẫn là MỘT đơn
        // chung ⇒ để `null` và báo cáo hiện "chưa quy được về con"; muốn tách doanh thu
        // thì phải tách thành 2 đơn, đúng như B4 đã lường.
        leadChildId: inferLeadChildIdForConvert(input.students),
      });
    }

    // C5 — CCCD + địa chỉ phụ huynh (chỉ ghi field có giá trị, không ghi đè bằng null).
    const parentExtra = {
      ...(input.parentCccd?.trim() ? { cccd: input.parentCccd.trim() } : {}),
      ...(input.parentAddress?.trim() ? { address: input.parentAddress.trim() } : {}),
      ...(input.parentWard?.trim() ? { ward: input.parentWard.trim() } : {}),
      ...(input.parentCity?.trim() ? { city: input.parentCity.trim() } : {}),
    };

    // AUTH-SĐT P5 — khoá định danh phụ huynh là SĐT canonical, email tuỳ chọn.
    //
    // Trước P5 chỗ này `upsert({ where: { email } })`. Với email nullable, đó là
    // **bom hẹn giờ**: Prisma nhận `where: { email: undefined }` rồi ném lỗi runtime
    // chứ không trả null — mỗi lead không có email sẽ làm vỡ cả transaction convert.
    // Nay khoá theo `phone` (@unique, luôn có mặt vì `phoneVn` bắt buộc).
    const parentPhone = canonicalPhone(input.parentPhone) ?? input.parentPhone;
    const parentEmail = input.parentEmail?.trim().toLowerCase() || null;
    let parent;
    if (parentMatch.kind === "reuse") {
      // Hồ sơ cũ (tạo trước P5) thường chưa có `phone` — bổ sung để lần sau đăng
      // nhập/dedupe đi được bằng SĐT. CHỈ điền khi đang TRỐNG: ghi đè là đổi định
      // danh đăng nhập của người ta. Cùng lý do với email.
      const current = await tx.user.findUnique({
        where: { id: parentMatch.userId },
        select: { phone: true, email: true },
      });
      // SĐT đã thuộc user KHÁC → bỏ qua, để `@unique` không làm vỡ cả convert.
      const phoneFree =
        !current?.phone &&
        !(await tx.user.findFirst({
          where: { phone: parentPhone, id: { not: parentMatch.userId } },
          select: { id: true },
        }));
      parent = await tx.user.update({
        where: { id: parentMatch.userId },
        data: {
          centerId: lead.centerId,
          ...parentExtra,
          ...(phoneFree ? { phone: parentPhone } : {}),
          ...(parentEmail && !current?.email ? { email: parentEmail } : {}),
        },
      });
    } else {
      parent = await tx.user.upsert({
        where: { phone: parentPhone },
        update: { centerId: lead.centerId, ...parentExtra },
        create: {
          phone: parentPhone,
          email: parentEmail,
          name: input.parentName,
          role: "PARENT",
          roles: ["PARENT"],
          accountStatus: "PENDING_ACTIVATION",
          centerId: lead.centerId,
          ...parentExtra,
        },
      });
    }

    const studentIds: string[] = [];
    const enrollmentIds: string[] = [];
    for (let i = 0; i < input.students.length; i++) {
      const s = input.students[i]!;
      const price = prices[i]!;
      // Dedupe student same-parent → dùng lại; chỉ tạo Enrollment mới (AC4).
      const existingId = await findExistingStudent(
        { parentUserId: parent.id, name: s.name, dob: s.dob ?? null },
        tx,
      );
      const con = s.leadChildId ? (conTheoId.get(s.leadChildId) ?? null) : null;
      if (existingId) {
        // 25/09 — HV DÙNG LẠI: `Student.leadId` là lead GỐC. Chỉ nối khi HV CHƯA nối lead
        // nào — gia đình quay lại tạo phiếu mới rồi chốt thì lead gốc vẫn là phiếu cũ.
        // `updateMany` có `leadId: null` trong where ⇒ hai lượt đua không đè nhau.
        // Điền ô trống đi CÙNG lượt nối (một sự kiện "HV được nối lead"), không phải mỗi
        // lần chốt: HV đã có lead gốc thì hồ sơ đã được điền từ phiếu gốc rồi.
        const cu = await tx.student.findUnique({
          where: { id: existingId },
          select: {
            leadId: true,
            name: true,
            dateOfBirth: true,
            gender: true,
            school: true,
            currentGrade: true,
            parentEmail: true,
            parentGender: true,
            parentDob: true,
            parentFacebookUrl: true,
            city: true,
            ward: true,
            address: true,
            district: true,
          },
        });
        // NĐ13: hồ sơ đã ẩn danh KHÔNG được nối + điền lại — `dienTuLead` coi ô vừa xoá là
        // ô trống (lib/students/da-an-danh.ts). Dedupe theo tên + ngày sinh gần như không
        // khớp được hồ sơ tên "[Đã xoá…]", nhưng chặn ở đây thì không phải tin vào điều đó.
        const daAnDanh =
          !!cu &&
          (tenLaDaAnDanh(cu.name) ||
            (await hocVienDaAnDanhTheoNhatKy(tx, [existingId])).has(existingId));
        if (cu && cu.leadId === null && !daAnDanh) {
          await tx.student.updateMany({
            where: { id: existingId, leadId: null },
            data: {
              ...dienTuLead(cu, leadDeDien, con),
              leadId: lead.id,
              leadChildId: con?.id ?? null,
            },
          });
        }
      }
      // HV MỚI: hồ sơ trắng trừ các ô convert vốn ghi — dienTuLead chỉ trả ô đang trống
      // nên trải nó SAU các ô tường minh không bao giờ đè giá trị convert đã chọn.
      const hoSoMoi: StudentDeDien = {
        dateOfBirth: s.dob ?? null,
        gender: null,
        school: null,
        currentGrade: null,
        parentEmail,
        parentGender: null,
        parentDob: null,
        parentFacebookUrl: null,
        city: null,
        ward: null,
        address: null,
        district: null,
      };
      const studentId =
        existingId ??
        (
          await tx.student.create({
            data: {
              name: s.name,
              studentCode: await genStudentCodeV2(centerCode, tx),
              dateOfBirth: s.dob ?? null,
              parentUserId: parent.id,
              centerId: lead.centerId,
              parentName: input.parentName,
              // AUTH-SĐT P1 (gom tồn dư 31/07) — ĐƯỜNG GHI phải ra canonical `84…`.
              // `replace(/\D/g,"")` cũ giữ nguyên `0905…` ⇒ mỗi lần convert lại bào mòn
              // kết quả backfill 29/07. Giữ nguyên fallback digit-strip cho đầu vào không
              // chuẩn hoá được (số cố định gọi thẳng từ lib) — không đổi hành vi ca đó.
              parentPhone: canonicalPhone(input.parentPhone) ?? input.parentPhone.replace(/\D/g, ""),
              parentEmail,
              ...dienTuLead(hoSoMoi, leadDeDien, con),
              // 25/09 — lead NGUỒN (D1): HV sinh ra từ chính lượt chốt này.
              leadId: lead.id,
              leadChildId: con?.id ?? null,
            },
            select: { id: true },
          })
        ).id;
      studentIds.push(studentId);

      const enrollment = await tx.enrollment.create({
        data: {
          studentId,
          classId: s.classId,
          courseId: s.courseId,
          centerId: lead.centerId, // FL3-02 — denormalize từ lead/class (cùng cơ sở) cho scopedDb
          leadChildId: s.leadChildId ?? null, // R7-06 — truy vết về con nguồn
          saleId: lead.assignedToId ?? null, // T3.2 — sale phụ trách theo sang ghi danh
          listPrice: price.listPrice,
          discountType: price.discountType,
          discountAmount: price.discountAmount,
          finalPrice: price.finalPrice,
          tuition: price.finalPrice, // giữ field cũ đồng bộ (2-phase)
          // Mua ít hơn cả khoá ⇒ vào học muộn, kết thúc cùng lớp. `null` = đủ khoá.
          buoiBatDau: buoiBatDaus[i] ?? null,
        },
        select: { id: true },
      });
      enrollmentIds.push(enrollment.id);

      // ── Học thử → nhập học: đóng sổ trải nghiệm + hoa hồng GV dạy Trial (25/08) ──
      //
      // Trước đây convert KHÔNG hề đụng tới các bảng Trial: sau khi con nhập học,
      // `LeadTrialHistory.outcome` vẫn nằm nguyên ở "PENDING" — nghĩa là cột đó chưa
      // bao giờ mang giá trị nào khác, dù `lib/trial/sale-roster.ts` đã đọc
      // `outcome === "ENROLLED"` để bật cờ "đã nhập học". Cờ ấy vì thế luôn tắt.
      //
      // Nay đóng sổ NGAY TRONG transaction convert (cùng chỗ tạo Enrollment) để không
      // có khe hở "đã ghi danh nhưng sổ trải nghiệm chưa biết".
      const trial = s.leadChildId ? (attendedTrials.get(s.leadChildId) ?? null) : null;
      if (trial) {
        // Đóng sổ ĐÚNG lớp trải nghiệm con đã học, và chỉ dòng còn PENDING.
        //
        // Bản đầu lọc mỗi `leadChildId` — hai lỗi trong một: (1) nó đè cả dòng đã mang
        // "LOST" của lần học thử trước (nhánh LOST ở updateLeadStatus có lọc PENDING,
        // nhánh này thì không ⇒ hai đường bất đối xứng, và lịch sử "đã từng rớt" biến
        // mất); (2) nó bật "ENROLLED" cho MỌI lớp trải nghiệm con từng vào, kể cả lớp ở
        // cơ sở khác — mà site GV in nhãn "Đã nhập học · +1% HH" theo cặp
        // (leadChildId, trialClassId), nên giáo viên KHÔNG được trả đồng nào vẫn thấy
        // hệ thống hứa trả 1%. Đó là cãi nhau về lương, không phải lỗi hiển thị.
        await tx.leadTrialHistory.updateMany({
          where: {
            leadChildId: s.leadChildId!,
            trialClassId: trial.trialClassId,
            outcome: "PENDING",
          },
          data: { outcome: "ENROLLED" },
        });

        // +1% học phí cho GV đã dạy buổi trải nghiệm. Bỏ qua khi lớp chưa gán GV hoặc
        // học phí 0 — hoa hồng KHÔNG được phép làm hỏng việc ghi danh (xem đầu
        // lib/crm/trial-teacher-commission.ts).
        if (trial.teacherUserId && commissionStatement) {
          const res = await recordTrialTeacherCommission(tx, {
            statement: commissionStatement,
            teacherUserId: trial.teacherUserId,
            enrollmentId: enrollment.id,
            finalPrice: price.finalPrice,
            leadId: lead.id,
            note: `Trial → nhập học: ${s.name} · ${trial.trialClassName}`,
          });
          // Kỳ đã chốt sổ ⇒ không ghi được dòng nào. KHÔNG được im lặng: giáo viên mất
          // tiền mà không ai biết, và không có job đối soát nào cho tầng này. Để lại
          // dấu vết ở AuditLog để kế toán mở lại kỳ rồi bù tay.
          if (res && !res.ok) {
            await writeAudit({
              actor,
              module: "commission",
              entityType: "Enrollment",
              entityId: enrollment.id,
              action: "TRIAL_TEACHER_COMMISSION_SKIPPED",
              newValues: {
                reason: res.reason,
                period: res.period,
                amount: res.amount,
                recipientId: trial.teacherUserId,
                trialClassId: trial.trialClassId,
              },
              orgUnitId: lead.centerId,
              tx,
            });
          }
        }
      }

      // Consent ảnh per học viên + audit người tick (AC5).
      // ⚠️ KHÔNG lật consent đã THU HỒI: học viên dedupe (dùng lại hồ sơ cũ) có thể
      // mang REVOKED do phụ huynh rút — tick ở form convert/bulk không phải là lời
      // re-grant tường minh (C6.4: thu hồi phải dính cho tới khi có luồng cấp lại riêng).
      const existingConsent = s.consentMedia
        ? await tx.studentConsent.findUnique({
            where: { studentId_type: { studentId, type: "CLASS_MEDIA" } },
            select: { status: true },
          })
        : null;
      if (s.consentMedia && existingConsent?.status !== "REVOKED") {
        await tx.studentConsent.upsert({
          where: { studentId_type: { studentId, type: "CLASS_MEDIA" } },
          create: { studentId, type: "CLASS_MEDIA", status: "GRANTED" },
          update: { status: "GRANTED", revokedAt: null },
        });
        await writeAudit({
          actor,
          module: "enrollment",
          entityType: "StudentConsent",
          entityId: studentId,
          action: "CONSENT_GRANTED_AT_CONVERT",
          newValues: { type: "CLASS_MEDIA", grantedBy: actor.id },
          orgUnitId: lead.centerId,
          tx,
        });
      }
    }

    // FIN-01 (Q1=A) — mắt xích còn thiếu: sau khi tạo Enrollment(s), GẮN (và CHIA khi nhiều
    // ghi danh) các khoản RECORDED của đơn vào ghi danh → confirmPayment sinh Receipt được →
    // getDebtRows phản ánh. Nhiều ghi danh: chia theo finalPrice (bất biến tổng). KHÔNG
    // auto-confirm ở đây (giữ tách vai kế toán). weights ↔ enrollmentIds cùng thứ tự students.
    // `studentIds` / `enrollmentIds` / `prices` cùng thứ tự `input.students` — gộp lại
    // thành MỘT danh sách để hàm chia biết khoản của đơn nào thuộc về em nào.
    //
    // KHOÁ HỌC CỦA LỚP là móc nối CHÍNH, không phải phụ: đơn lập từ `/orders/new?leadId=…`
    // có `OrderItem.studentId` = NULL ở mọi dòng (học viên chỉ ra đời ở chính bước này),
    // nên nếu chỉ khớp theo học viên thì phép chia rơi hết vào đường lui và tiền lại chảy
    // sang em khác — đo được 15/09/2026, xem `lib/finance/chia-khoan-theo-don.ts`.
    const lopCuaGhiDanh = await tx.class.findMany({
      where: { id: { in: [...new Set(input.students.map((s) => s.classId))] } },
      select: { id: true, courseId: true },
    });
    const khoaTheoLop = new Map(lopCuaGhiDanh.map((c) => [c.id, c.courseId]));

    await linkRecordedPaymentsToEnrollments(tx, {
      leadId: lead.id,
      ghiDanh: enrollmentIds.map((enrollmentId, i) => ({
        enrollmentId,
        studentId: studentIds[i]!,
        courseId: khoaTheoLop.get(input.students[i]!.classId) ?? null,
        finalPrice: prices[i]!.finalPrice,
      })),
      actor,
    });

    // ── G-06 · MỐC CHỐT theo TỪNG CON (26/08/2026) ────────────────────────────────
    //
    // Trước đợt này, chốt ghi danh KHÔNG đụng gì tới `LeadChild`: con đã vào học vẫn
    // nằm ở trạng thái cũ (hoặc NULL với phiếu cũ) và không có mốc chốt nào. Hệ quả:
    // C-03 ("Lead đã chuyển đổi") không có cột **thời gian chốt** để tính, còn C-02
    // (tỷ lệ thành công) thì đếm mẫu số bằng số con mà tử số luôn bằng 0.
    //
    // Ghi Ở ĐÂY, trong CÙNG transaction tạo Enrollment — không phải một lượt cập nhật
    // rời sau commit. Rời nhau là đẻ ra khe "đã ghi danh nhưng chưa có mốc chốt", và
    // khe đó không có job nào đối soát: nó chỉ hiện ra dưới dạng một con số báo cáo
    // thấp hơn thực tế.
    //
    // ⚠️ Quy theo CON, và quy được BAO NHIÊU CON THÌ GHI BẤY NHIÊU — khác hẳn luật của
    // ĐƠN HÀNG ngay bên trên (`inferLeadChildIdForConvert`: 2 con ⇒ `null`). Tiền của
    // một đơn chung không chia được cho hai đứa, nhưng sự kiện "đứa này đã thành học
    // viên" thì không mập mờ chút nào. Xem `lib/lead/close-mark.ts`.
    //
    // `updateMany` + `leadId: lead.id`: chặn ca chỗ gọi truyền `leadChildId` của phiếu
    // KHÁC (bulk-convert nhận dữ liệu từ file). Con lạ thì không khớp `where` nên
    // không có gì bị ghi — không ném, không đổ cả lượt chốt vì một mã sai.
    const closedChildIds = resolveClosedLeadChildIds(input.students);
    if (closedChildIds.length > 0) {
      await tx.leadChild.updateMany({
        where: { id: { in: closedChildIds }, leadId: lead.id },
        // `now` là mốc DUY NHẤT của cả lượt convert (dựng trước transaction) — hai con
        // chốt cùng lượt phải mang cùng một mốc, kể cả khi transaction vắt qua nửa đêm.
        data: { status: CLOSED_CHILD_STATUS, closedAt: now },
      });

      // Con từng bị đánh dấu RỚT nay quay lại và vào học: `Lead.lostNote`/`lostAt`
      // (cấp phụ huynh — quyết định B5) có thể đã hết chỗ bám. Đi qua ĐÚNG hàm quyết
      // định của C-06 thay vì tự xoá: nó chỉ xoá khi KHÔNG CÒN con nào rớt, vì xoá vô
      // điều kiện là xoá mất lý do rớt của ĐỨA CÒN LẠI và không có đường dựng lại.
      const lostChildCount = await tx.leadChild.count({
        where: { leadId: lead.id, status: "LOST" },
      });
      const patch = decideLeadLostFields({ intent: "unmark", lostChildCount, now });
      if (patch) await tx.lead.update({ where: { id: lead.id }, data: patch });
    }

    await writeAudit({
      actor,
      module: "enrollment",
      entityType: "Lead",
      entityId: lead.id,
      action: "STATUS_CHANGE",
      oldValues: { status: lead.status },
      newValues: {
        status: "ENROLLED",
        studentIds,
        scholarshipFull,
        backfillNoPayment,
        totalDiscountAmount,
        totalFinalPrice,
      },
      reason: scholarshipFull
        ? `SCHOLARSHIP_FULL${discountReason ? `: ${discountReason}` : ""}`
        : backfillNoPayment
          ? input.allowNoPayment!.reason.trim()
          : discountReason
            ? `DISCOUNT: ${discountReason}`
            : undefined,
      orgUnitId: lead.centerId,
      tx,
    });
    // C-07 — bù mốc trên DÒNG THỜI GIAN của lead (dòng audit ngay trên đã có).
    // `auditAlreadyWritten`: dòng đó thuộc module `enrollment`, mang thêm mã học
    // viên + lý do backfill và đang bị e2e ghim — ghi thêm là đếm đôi một sự việc.
    // Chốt thêm bé: lead VỐN đã ở DA_DANG_KY — ghi thêm một dòng "→ DA_DANG_KY" là đếm đôi.
    if (!laChotBeSau) await recordLeadStatusChange({
      tx,
      leadId: lead.id,
      actorId: actor.id,
      actorName: actor.name,
      from: lead.status,
      // "DA_DANG_KY" chứ không "ENROLLED": GĐ5 gộp ENROLLED vào DA_DANG_KY. Mốc
      // "đã chốt" từ nay đọc bằng `convertedAt` (vừa set ở lượt claim phía trên).
      to: "DA_DANG_KY",
      source: "CONVERT",
      auditAlreadyWritten: true,
    });

    // US-03 chat — HV vào lớp qua convert (kể cả bulk-convert + import lead) → PH vào
    // nhóm lớp trong CÙNG transaction (BR-12). Sync theo tập lớp distinct.
    for (const classId of new Set(input.students.map((s) => s.classId))) {
      await syncConversationMembership(tx, classId);
    }

    // Ghi idempotency key (cùng tx) → double-submit sau trả kết quả này.
    await tx.idempotencyKey.create({
      data: { key: input.idempotencyKey, scope: "convert", result: { studentIds, enrollmentIds } },
    });

    return { parentId: parent.id, studentIds, enrollmentIds };
  },
  {
    // Không đặt thì Prisma dùng mặc định 5s — chốt 1 lead làm RẤT nhiều việc trong
    // cùng transaction (claim lead, tạo/gộp User phụ huynh, N học viên, N ghi danh,
    // đơn hàng + khoản thu backfill, consent, idempotency, audit). 5s vừa đủ khi
    // app và DB cùng vùng, nhưng hết ngay khi đường truyền chậm hoặc lead nhiều con
    // — và lỗi hiện ra dưới dạng khó hiểu ("Transaction not found... old closed
    // transaction"), không phải "quá giờ". Đo 05/08 khi chốt lô nhập liệu đầu tiên.
    timeout: 30_000,
    maxWait: 15_000,
  });

  // SAU commit — side-effect không-atomic.
  await publishEvent("lead.converted", {
    leadId: lead.id,
    studentId: result.studentIds[0],
    parentUserId: result.parentId,
  });
  await publishEvent("consent.granted", { studentIds: result.studentIds, leadId: lead.id });

  return { ok: true, studentIds: result.studentIds, enrollmentIds: result.enrollmentIds, deduped: false };
}
