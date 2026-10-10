// lib/crm/trial-teacher-commission.ts — HOA HỒNG GIÁO VIÊN DẠY TRIAL.
//
// Nghiệp vụ (chủ dự án 25/08): học viên **đã học thử** rồi NHẬP HỌC ⇒ giáo viên đã dạy
// buổi trải nghiệm được +1% học phí. Bảng Trial của site GV in trạng thái
// "Đã nhập học · +1% HH", và con số đó phải có sổ thật đằng sau chứ không phải nhãn suông.
//
// ────────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG NHÉT VÀO 4 TẦNG HOA HỒNG SALE
//
// `lib/crm/commission.ts` có 4 tầng QC / SALE_ADMIN / SALE / QL_TT với
// `MAX_TOTAL_RATE = 0.08`, mà Σ 4 tầng ĐANG ĐÚNG BẰNG 8,00%. Thêm tầng thứ 5 vào
// `COMMISSION_TIERS` là `validateRates()` ném `RATE_EXCEEDS_CAP` ở MỌI lần gọi
// `computeCommission()` — tức là giết luôn phần hoa hồng Sale. Nâng trần 8%→9% là
// quyết định CHÍNH SÁCH TIỀN của BGĐ, không phải việc của một ticket giao diện.
//
// Nên tầng `TRIAL_TEACHER` cố ý nằm NGOÀI pool 8%: nó không có mặt trong
// `COMMISSION_TIERS`, không đi qua `validateRates`/`computeCommission`, và tính trên
// học phí của TỪNG ghi danh chứ không trên doanh thu kỳ. `CommissionLine.tier` là
// cột String tự do nên không cần đổi enum.
//
// ⚠️ SỰ THẬT PHẢI BIẾT: tới 25/08 **chưa từng có dòng CommissionLine nào được sinh ra
// trong sản phẩm**. `setStatementLines` (đường của 4 tầng Sale) chỉ có test gọi — bộ
// máy bảng kê hoa hồng Sale được dựng nhưng chưa nối vào dữ liệu thật. Vậy nên các
// dòng TRIAL_TEACHER ở đây là những dòng hoa hồng THẬT ĐẦU TIÊN của hệ thống. Kế toán
// xem ở /admin/crm/commission (lọc theo kỳ) và xuất Excel như các tầng khác.
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

/** Tầng hoa hồng GV dạy Trial — NGOÀI pool 8% của 4 tầng Sale (xem đầu file). */
export const TRIAL_TEACHER_TIER = "TRIAL_TEACHER";

/** 1% học phí ghi danh. Hằng số vì chưa có quy chế cho phép QLCS/BGĐ chỉnh qua UI. */
export const TRIAL_TEACHER_RATE = 0.01;

/** Nhãn tiếng Việt — dùng cho bảng kê, Excel và badge ở site GV. */
export const TRIAL_TEACHER_TIER_LABEL = "GV dạy Trial";

/** Đọc-được-ở-đâu-cũng: client thường hoặc client trong transaction. */
type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Kỳ hoa hồng `"YYYY-MM"` theo THÁNG DƯƠNG LỊCH VIỆT NAM của thời điểm ghi danh.
 *
 * Vercel chạy UTC còn máy dev +07, nên `getMonth()` trần sẽ đẩy đơn chốt lúc 23:30
 * ngày 31 (giờ VN) sang kỳ tháng sau khi chạy trên Vercel. Cộng bù +7h TRƯỚC khi
 * đọc tháng là hết lệch — không dùng `toLocaleString` (khác nhau theo ICU của runtime).
 */
export function commissionPeriodVN(at: Date): string {
  const vn = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Tiền hoa hồng (VND, làm tròn xuống) — 0 khi học phí ≤ 0 (học bổng toàn phần). */
export function trialTeacherCommissionAmount(finalPrice: number): number {
  if (!Number.isFinite(finalPrice) || finalPrice <= 0) return 0;
  return Math.floor(finalPrice * TRIAL_TEACHER_RATE);
}

/** Buổi trải nghiệm mà một `LeadChild` THỰC SỰ đã học, kèm người dạy (nếu có). */
export type AttendedTrial = {
  trialClassId: string;
  trialClassName: string;
  /** userId của GV đứng buổi con đã học. `null` = lớp/buổi chưa gán GV ⇒ không ai để trả. */
  teacherUserId: string | null;
};

/**
 * Con này ĐÃ HỌC THỬ ở lớp nào, và ai dạy?
 *
 * ⚠️ ĐIỀU KIỆN CỨNG LÀ **ĐÃ ĐIỂM DANH CÓ MẶT**, không phải "đã được xếp lớp".
 * Bản đầu (25/08) chỉ lọc `status != WITHDRAWN` và đó là một lỗ tiền thật: ghi danh
 * trải nghiệm mang `status ACTIVE` NGAY khi Sale xếp con vào một buổi TƯƠNG LAI, và
 * `syncTrialProgress` chỉ chuyển sang COMPLETED khi đủ buổi CÓ MẶT — nên con vắng mặt,
 * con no-show, con mới đặt lịch tuần sau đều mang ACTIVE. Phụ huynh đóng tiền trước
 * buổi thử (chuyện thường) là hệ thống trả 1% cho một giáo viên chưa dạy buổi nào.
 *
 * `TrialAttendance.status = PRESENT` là dấu vết duy nhất chứng minh có người đứng lớp
 * cho con đó. Lấy buổi CÓ MẶT GẦN NHẤT: khi con thử ở hai lớp khác nhau, người xứng
 * đáng là người vừa dạy con, không phải cái lịch mới nhất Sale vừa đặt (bản đầu dùng
 * `orderBy createdAt desc` trên ghi danh nên trả nhầm GV của lớp con CHƯA học).
 *
 * Không có buổi PRESENT nào → `null`: con chưa từng học thử, và đó là câu trả lời đúng.
 */
export async function findAttendedTrialForLeadChild(
  client: DbClient,
  leadChildId: string,
): Promise<AttendedTrial | null> {
  const att = await client.trialAttendance.findFirst({
    where: {
      status: "PRESENT",
      trialEnrollment: { leadChildId },
    },
    orderBy: { createdAt: "desc" },
    select: {
      trialSessionId: true,
      trialEnrollment: {
        select: { trialClassId: true, trialClass: { select: { name: true, teacherId: true } } },
      },
    },
  });
  if (!att) return null;

  const enr = att.trialEnrollment;

  // GV của CHÍNH buổi con đã học đứng trước GV chính của lớp: lớp trải nghiệm hay đổi
  // người dạy theo từng buổi (`assignTrialTeacherAction`).
  const ses = await client.trialClassSession.findUnique({
    where: { id: att.trialSessionId },
    select: { teacherId: true },
  });

  return {
    trialClassId: enr.trialClassId,
    trialClassName: enr.trialClass.name,
    teacherUserId: ses?.teacherId ?? enr.trialClass.teacherId ?? null,
  };
}

export type CommissionStatementRef = { id: string; period: string; approved: boolean };

/**
 * Bảo đảm có bảng kê hoa hồng của kỳ — **GỌI NGOÀI TRANSACTION CONVERT**.
 *
 * Vì sao không để trong transaction: `upsert` của Prisma trên model có nhiều unique
 * (ở đây `@id` + `@unique period`) biên dịch thành ĐỌC-RỒI-GHI, không phải
 * `INSERT … ON CONFLICT`. Hai Sale convert hai lead khác nhau vào đúng lần đầu tiên
 * của tháng: cả hai SELECT đều trượt, cả hai INSERT, người thua ăn `P2002`. Ném bên
 * trong `db.$transaction` là **cả lượt convert rollback** — mất luôn lead claim, phụ
 * huynh, học viên, ghi danh, đơn học phí. Đã dựng lại được lỗi này trên Postgres thật.
 *
 * Ở ngoài transaction thì `P2002` chỉ có nghĩa "người khác vừa tạo trước" — bắt và đọc
 * lại là xong, không có gì bị rollback. Bảng kê rỗng thừa (nếu convert lỗi sau đó) vô
 * hại: nó chỉ là cái vỏ theo kỳ, kế toán vẫn thấy 0 dòng.
 */
export async function ensureCommissionStatement(at: Date): Promise<CommissionStatementRef> {
  const period = commissionPeriodVN(at);
  const found = await db.commissionStatement.findUnique({
    where: { period },
    select: { id: true, status: true },
  });
  if (found) return { id: found.id, period, approved: found.status === "APPROVED" };

  try {
    const created = await db.commissionStatement.create({
      data: { period, status: "DRAFT" },
      select: { id: true, status: true },
    });
    return { id: created.id, period, approved: false };
  } catch {
    // Đua với lượt convert song song → người kia tạo rồi, đọc lại.
    const again = await db.commissionStatement.findUnique({
      where: { period },
      select: { id: true, status: true },
    });
    if (!again) throw new Error("Không tạo được bảng kê hoa hồng kỳ " + period);
    return { id: again.id, period, approved: again.status === "APPROVED" };
  }
}

export type TrialTeacherCommissionInput = {
  /** Bảng kê của kỳ — đã dựng sẵn NGOÀI transaction (`ensureCommissionStatement`). */
  statement: CommissionStatementRef;
  /** userId của GV đã dạy buổi Trial (không phải employeeId). */
  teacherUserId: string;
  /** Ghi danh chính thức vừa tạo — khoá chống ghi trùng khi convert chạy lại. */
  enrollmentId: string;
  /** Học phí sau giảm của ghi danh đó. */
  finalPrice: number;
  /** Lead nguồn — để bảng kê truy ngược được về phễu. */
  leadId: string | null;
  /** Ghi chú in trên bảng kê. */
  note?: string | null;
};

export type TrialTeacherCommissionResult =
  | { ok: true; amount: number }
  /** Không ghi được vì kỳ đã chốt sổ — chỗ gọi PHẢI để lại dấu vết (audit). */
  | { ok: false; reason: "statement-approved"; period: string; amount: number };

/**
 * Ghi 1 dòng hoa hồng GV dạy Trial. GỌI TRONG TRANSACTION CONVERT — tiền phải atomic
 * với `Enrollment` (CLAUDE.md: tiền/enrollment đi transaction, không đi DomainEvent).
 *
 * Idempotent bằng unique `(statementId, tier, recipientId, enrollmentId)`: convert chạy
 * lại trên cùng ghi danh không sinh dòng thứ hai. Đua trên khoá này KHÔNG xảy ra vì
 * `enrollmentId` vừa được tạo trong chính transaction này.
 *
 * Kỳ đã APPROVED → KHÔNG ghi, nhưng trả về `reason` để chỗ gọi ghi audit. Cố ý không
 * ném: hoa hồng không được phép làm hỏng việc ghi danh của học viên.
 */
export async function recordTrialTeacherCommission(
  tx: Prisma.TransactionClient,
  input: TrialTeacherCommissionInput,
): Promise<TrialTeacherCommissionResult | null> {
  const amount = trialTeacherCommissionAmount(input.finalPrice);
  if (!input.teacherUserId || amount <= 0) return null;

  if (input.statement.approved) {
    return {
      ok: false,
      reason: "statement-approved",
      period: input.statement.period,
      amount,
    };
  }

  await tx.commissionLine.upsert({
    where: {
      statementId_tier_recipientId_enrollmentId: {
        statementId: input.statement.id,
        tier: TRIAL_TEACHER_TIER,
        recipientId: input.teacherUserId,
        enrollmentId: input.enrollmentId,
      },
    },
    update: { amount, note: input.note ?? null, leadId: input.leadId },
    create: {
      statementId: input.statement.id,
      tier: TRIAL_TEACHER_TIER,
      recipientId: input.teacherUserId,
      enrollmentId: input.enrollmentId,
      leadId: input.leadId,
      amount,
      note: input.note ?? null,
    },
  });

  return { ok: true, amount };
}
