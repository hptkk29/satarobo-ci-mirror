// lib/cham-cong/requests.ts — L5: ĐƠN TỪ DÙNG CHUNG cho mọi nhân sự (GV, tư vấn, giáo vụ, HO) +
// duyệt CÓ HIỆU LỰC THẬT trong một transaction (T-05/T-06/T-07).
//
// Luật cơ sở nhận đơn (kế hoạch v3 §3.2):
//   · Đơn theo NGÀY → cơ sở của ca ACTIVE ngày đó (ShiftAssignment.centerId) — đây là nơi
//     "chịu công", kể cả khi người HO xuống cơ sở làm.
//   · Không có ca → cơ sở nhà (Employee.centerId → User.centerId).
//   · Cơ sở nhà là Hội sở (hoi-so / null) → KHÔNG tự đoán: người nộp phải chọn cơ sở nhận
//     (form hiện ô chọn), vì Hội sở không có Quản lý cơ sở để duyệt.
//   Module chấm công KHÔNG đọc `session.user.centerId` (ảnh chụp JWT lúc login).
//
// Luật duyệt (T-05, BA §13–14): "duyệt + áp hệ quả + audit" là MỘT giao dịch cho MỌI loại đơn —
// kể cả đơn lớp từ đợt 3 (08/10/2026): `cancelSession`/`adjustSession` nhận `tx` của lượt duyệt,
// không còn đường "bù trừ" về PENDING. Hệ quả từng loại nằm ở handler (`./don/registry.ts`). Lỗi
// áp ⇒ rollback cả cụm, rồi ghi `applyError` ở giao dịch riêng để người duyệt thấy vì sao.
//
// Không "use server" — action ở app/ kiểm quyền (`hr_attendance:approve` theo cơ sở nhận
// đơn) rồi mới gọi vào đây.
import { nguoiGiuQuyenTaiCoSo } from "@/lib/org/nguoi-giu-quyen-tai-co-so";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { getSetting } from "@/lib/settings/service";
import { vnAddDays, vnDateOnly, vnYmd } from "@/lib/time/vn";
import { HO_CENTER_ID, loadCenterMap, resolveHomeCenter } from "./home-center";
import { HANDLER_DON } from "./don/registry";
import { DecideError, HREF_DON_CUA_TOI, KHONG_DIEU_CHINH, type DecideNotify, type DieuChinhKhiDuyet } from "./don/kieu";
import type { Prisma } from "@prisma/client";
import { WR_KIND_LABEL, WR_STATUS_LABEL, isClassKind, isRangeKind, type WorkRequestKindV } from "@/lib/work-request";
import { chanSuaKyDaChot } from "./ky-gac";
import { kiemDanhSachMoc, vnTimeOn } from "./sua-gio-quet";
import { khoangTu } from "./khoang-gio";
import { soDuNghiBu } from "./nghi-bu";
import { TRANG_THAI_CON_HIEU_LUC } from "./don-trong-ngay-db";
import { cauXungDot, timXungDot, type DonXet } from "./xung-dot-don";

// ─── Cơ sở nhận đơn ───────────────────────────────────────────────────────────────────

export type RequestCenterResolution = {
  /** null = Hội sở, người nộp phải chọn. */
  centerId: string | null;
  /** Vì sao ra cơ sở đó — hiện cho người nộp thấy để bớt thắc mắc. */
  via: "ASSIGNMENT" | "HOME" | "HO";
  homeUnit: string; // "CS1" | "CS2" | "HO"
  timesheetExempt: boolean;
};

export async function resolveRequestCenter(userId: string, onDate: Date | null): Promise<RequestCenterResolution> {
  const home = await resolveHomeCenter(userId);
  if (onDate) {
    const a = await db.shiftAssignment.findFirst({
      where: { userId, workDate: vnDateOnly(onDate), status: "ACTIVE" },
      select: { centerId: true },
    });
    if (a && a.centerId !== HO_CENTER_ID) {
      return { centerId: a.centerId, via: "ASSIGNMENT", homeUnit: home.centerCode, timesheetExempt: home.timesheetExempt };
    }
  }
  if (home.isHo) return { centerId: null, via: "HO", homeUnit: "HO", timesheetExempt: home.timesheetExempt };
  return { centerId: home.centerId, via: "HOME", homeUnit: home.centerCode, timesheetExempt: home.timesheetExempt };
}

/** Nộp muộn = ngày áp dụng cách hôm nay ít hơn `shift.requestNoticeDays` ngày (tính theo giờ VN). */
export function isSubmittedLate(fromDate: Date, now: Date, noticeDays: number): boolean {
  const today = vnDateOnly(now);
  const deadline = vnDateOnly(vnAddDays(now, noticeDays));
  const target = vnDateOnly(fromDate);
  if (target < today) return true; // đơn hồi tố luôn là muộn
  return target < deadline;
}

// ─── Nộp đơn ──────────────────────────────────────────────────────────────────────────

export type SubmitRequestInput = {
  requesterId: string;
  kind: WorkRequestKindV;
  fromDate: Date | null;
  toDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  hours: number | null;
  className: string | null;
  classId: string | null;
  targetUserId: string | null;
  requesterNewTemplateId: string | null;
  targetNewTemplateId: string | null;
  leaveTypeId: string | null;
  requestedInAt: string | null;
  requestedOutAt: string | null;
  /**
   * TIMESHEET_FIX mốc thứ 3–4 (Vào 2 / Ra 2) — ca hai buổi (06/10/2026). BẮT BUỘC khai (kể cả
   * `null`) để `tsc` liệt kê mọi đường nộp đơn: quên nối là mốc 3–4 rơi mất im lặng.
   */
  requestedIn2At: string | null;
  requestedOut2At: string | null;
  /**
   * Nghỉ / nghỉ bù (đợt 7–8): cả ngày · nửa sáng · nửa chiều · theo giờ (startTime–endTime). BẮT BUỘC
   * khai (kể cả `null`) — luật 7: quên nối là đơn nghỉ theo giờ rơi thành nghỉ cả ngày im lặng.
   */
  leaveDurationType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURLY" | null;
  /** Người HO chọn tay; bỏ qua nếu hệ thống tự suy ra được. */
  chosenCenterId: string | null;
  detail: string | null;
  reason: string;
  now?: Date;
};

const XET_SELECT = {
  id: true, kind: true, status: true, fromDate: true, toDate: true, startTime: true, endTime: true,
  approvedStartTime: true, approvedEndTime: true, leaveDurationType: true, classId: true, detail: true,
} as const;

/**
 * Đơn của người này phủ khoảng [from, to] ở các trạng thái cho trước — đầu vào của bộ kiểm xung đột
 * (`xung-dot-don.ts`). Đơn cũ một-ngày có thể mang `toDate = null` ⇒ so theo `fromDate`.
 */
async function donPhuKhoang(
  client: Pick<typeof db, "workRequest"> | Prisma.TransactionClient,
  requesterId: string,
  from: Date,
  to: Date,
  trangThai: readonly string[],
): Promise<DonXet[]> {
  const rows = await client.workRequest.findMany({
    where: {
      requesterId,
      status: { in: [...trangThai] as Prisma.EnumWorkRequestStatusFilter["in"] },
      fromDate: { lte: to },
      OR: [{ toDate: { gte: from } }, { toDate: null, fromDate: { gte: from } }],
    },
    select: XET_SELECT,
  });
  return rows.map((r) => ({ ...r, kind: r.kind as WorkRequestKindV }));
}

const nhanNgayDon = (d: Date | null) => (d ? vnYmd(new Date(d.getTime() + 12 * 3_600_000)) : "");

export type SubmitRequestResult =
  | { ok: true; id: string; centerId: string; submittedLate: boolean }
  | { ok: false; error: string };

export async function submitAttendanceRequest(input: SubmitRequestInput): Promise<SubmitRequestResult> {
  const now = input.now ?? new Date();
  const from = input.fromDate ? vnDateOnly(input.fromDate) : null;
  const to = isRangeKind(input.kind) ? (input.toDate ? vnDateOnly(input.toDate) : from) : from;
  if (from && to && to < from) return { ok: false, error: "Đến ngày phải sau Từ ngày" };
  if (isRangeKind(input.kind) && from && to && (to.getTime() - from.getTime()) / 86_400_000 > 62) {
    return { ok: false, error: "Đơn khoảng ngày tối đa 62 ngày — tách đơn nếu nghỉ dài hơn" };
  }
  if (input.kind === "TIMESHEET_FIX") {
    const moc = [input.requestedInAt, input.requestedOutAt, input.requestedIn2At, input.requestedOut2At];
    if (moc.every((m) => !m) && input.hours == null) {
      return { ok: false, error: "Chỉnh công cần ít nhất giờ vào hoặc giờ ra đề nghị" };
    }
    // Kiểm thứ tự NGAY lúc nộp (cùng hàm đường duyệt dùng): để tới lúc duyệt mới báo "Ra 1 phải
    // sau Vào 1" là bắt quản lý từ chối một đơn mà người nộp đã có thể tự sửa. Kiểm ở chế độ
    // `GHI_THEM` — lỏng hơn (cho bỏ trống ô giữa); chế độ thật do lúc DUYỆT quyết theo ca.
    if (from && moc.some((m) => m)) {
      const k = kiemDanhSachMoc(from, moc, "GHI_THEM");
      if (!k.ok) return { ok: false, error: k.error };
    }
  }
  // Làm từ xa một phần ngày (đợt 5): khai giờ thì đủ hai đầu, đúng chiều — nửa khung là mở cả ngày.
  if (input.kind === "REMOTE" && (input.startTime || input.endTime) && !khoangTu(input.startTime, input.endTime)) {
    return { ok: false, error: "Khung giờ làm từ xa không hợp lệ — khai đủ giờ bắt đầu và kết thúc, hoặc để trống cả hai" };
  }
  // Đợt 9–10: làm ngày nghỉ / lễ và chấm ngoài địa điểm — một ngày, khung giờ BẮT BUỘC (không khung là
  // mở cả ngày — đúng thứ BA 4.9 cấm); chấm ngoài thì phải nói ở đâu.
  if (input.kind === "HOLIDAY_WORK" || input.kind === "OUTSIDE_ATTENDANCE") {
    if (!khoangTu(input.startTime, input.endTime)) {
      return { ok: false, error: "Nhập khung giờ hợp lệ (giờ kết thúc sau giờ bắt đầu)" };
    }
    if (from && to && to.getTime() !== from.getTime()) {
      return { ok: false, error: "Đơn này chỉ một ngày mỗi đơn — tách thành nhiều đơn" };
    }
    if (input.kind === "OUTSIDE_ATTENDANCE" && !input.detail?.trim()) {
      return { ok: false, error: "Ghi địa điểm bạn sẽ chấm công" };
    }
  }
  if (input.kind === "SHIFT_SWAP" && !input.requesterNewTemplateId) {
    return { ok: false, error: "Đổi ca cần chọn mã ca mới" };
  }
  if (input.kind === "LEAVE" && !input.leaveTypeId) {
    return { ok: false, error: "Chọn loại nghỉ" };
  }
  // Đợt 7–8: nghỉ một phần ca và nghỉ bù — MỘT ngày mỗi đơn; theo giờ thì khung phải hợp lệ.
  const motPhan = input.leaveDurationType === "HALF_DAY_AM" || input.leaveDurationType === "HALF_DAY_PM" || input.leaveDurationType === "HOURLY";
  if ((input.kind === "LEAVE" && motPhan) || input.kind === "COMP_LEAVE") {
    if (from && to && to.getTime() !== from.getTime()) {
      return { ok: false, error: "Nghỉ nửa buổi / theo giờ / nghỉ bù chỉ một ngày mỗi đơn — tách thành nhiều đơn" };
    }
    if (input.leaveDurationType === "HOURLY" && !khoangTu(input.startTime, input.endTime)) {
      return { ok: false, error: "Nghỉ theo giờ cần khung giờ hợp lệ (giờ kết thúc sau giờ bắt đầu)" };
    }
  }
  if (input.kind === "COMP_LEAVE" && (await soDuNghiBu(db, input.requesterId)) <= 0) {
    return { ok: false, error: "Quỹ nghỉ bù của bạn đang bằng 0 — chưa có thời gian tích luỹ để nghỉ bù" };
  }
  if (input.targetUserId && input.targetUserId === input.requesterId) {
    return { ok: false, error: "Người thay không thể là chính bạn" };
  }

  const resolved = await resolveRequestCenter(input.requesterId, from);
  if (resolved.timesheetExempt && !isClassKind(input.kind)) {
    return { ok: false, error: "Bạn thuộc diện miễn chấm công — không cần nộp đơn ca/nghỉ/chỉnh công" };
  }
  let centerId = resolved.centerId;
  if (!centerId) {
    if (!input.chosenCenterId || input.chosenCenterId === HO_CENTER_ID) {
      return { ok: false, error: "Bạn thuộc Hội sở — chọn cơ sở nhận đơn (nơi Quản lý cơ sở sẽ duyệt)" };
    }
    const map = await loadCenterMap();
    if (!Object.values(map.byCode).some((c) => c.centerId === input.chosenCenterId)) {
      return { ok: false, error: "Cơ sở nhận đơn không hợp lệ" };
    }
    centerId = input.chosenCenterId;
  }

  const noticeDays = await getSetting("shift.requestNoticeDays");
  const submittedLate = from ? isSubmittedLate(from, now, noticeDays) : false;

  // ── Hạn báo trước THEO LOẠI NGHỈ (chốt 06/09/2026) ──────────────────────────────────
  //
  // Yêu cầu gốc: "phải xin nghỉ trước 1 ngày để quản lý nắm thông tin và bố trí nhân sự hỗ
  // trợ". Thực hiện đúng ý đó nhưng KHÔNG chặn cửa, vì chặn không làm mất buổi nghỉ — người
  // ốm vẫn nghỉ — mà chỉ làm mất DẤU VẾT: quản lý sẽ sửa thẳng ô trên lưới (`source: MANUAL`)
  // và hệ thống thôi biết đó là ốm hay tang chế, `leaveUnits` không cộng, thống kê sai theo.
  //
  // Thay vào đó đòi đúng thứ câu yêu cầu nói tới: NGƯỜI LÀM THAY. Duyệt xong hệ thống ghi
  // luôn ca cho người đó (`source: "SWAP"`, xem nhánh LEAVE trong `decide`), tức "bố trí nhân
  // sự" thành dữ liệu thật chứ không phải một lời nhắc.
  //
  // Ngưỡng đi theo LOẠI (`LeaveType.noticeDays`) chứ không một số chung: ma chay, ốm, thai sản
  // để `null` vì không ai hẹn trước được ngày; ép chúng theo một hạn chung là biến ba loại đó
  // thành "luôn vi phạm".
  if (input.kind === "LEAVE" && input.leaveTypeId && from && !input.targetUserId) {
    const lt = await db.leaveType.findUnique({
      where: { id: input.leaveTypeId },
      select: { name: true, noticeDays: true },
    });
    if (lt?.noticeDays != null && isSubmittedLate(from, now, lt.noticeDays)) {
      return {
        ok: false,
        error:
          `“${lt.name}” cần báo trước ${lt.noticeDays} ngày. Nộp sát ngày thì phải chọn NGƯỜI LÀM THAY ` +
          `để Quản lý bố trí kịp — hoặc chọn đúng loại nghỉ cho việc đột xuất (ma chay, ốm, thai sản ` +
          `không đòi báo trước).`,
      };
    }
  }

  // Kỳ đã khoá thì không nhận đơn hồi tố (chỉnh công/nghỉ) — sổ đã chốt, mở lại là việc SUPER_ADMIN.
  if (from && !isClassKind(input.kind)) {
    const locked = await db.attendancePeriod.findFirst({
      where: { centerId, status: "LOCKED", periodKey: { in: periodKeysBetween(from, to ?? from) } },
      select: { periodKey: true },
    });
    if (locked) return { ok: false, error: `Kỳ ${locked.periodKey} đã chốt sổ — không nhận đơn cho ngày trong kỳ này` };
  }

  // Đơn trùng: cùng người, cùng loại, cùng ngày, đang chờ ⇒ chặn (bấm hai lần / hai tab).
  if (from) {
    const dup = await db.workRequest.findFirst({
      where: { requesterId: input.requesterId, kind: input.kind, fromDate: from, status: "PENDING" },
      select: { id: true },
    });
    if (dup) return { ok: false, error: "Bạn đã có một đơn cùng loại cho ngày này đang chờ duyệt" };
    // Đợt 12 — bộ kiểm xung đột theo khoảng giờ, so với đơn đang chờ + còn hiệu lực của chính người này.
    const ton = await donPhuKhoang(db, input.requesterId, from, to ?? from, ["PENDING", ...TRANG_THAI_CON_HIEU_LUC]);
    const x = timXungDot(
      {
        id: "",
        kind: input.kind,
        status: "PENDING",
        fromDate: from,
        toDate: to,
        startTime: input.startTime || null,
        endTime: input.endTime || null,
        approvedStartTime: null,
        approvedEndTime: null,
        leaveDurationType: input.kind === "LEAVE" || input.kind === "COMP_LEAVE" ? (input.leaveDurationType ?? "FULL_DAY") : null,
        classId: isClassKind(input.kind) ? input.classId : null,
        detail: input.detail,
      },
      ton,
    );
    if (x) return { ok: false, error: cauXungDot(x, WR_STATUS_LABEL[x.don.status as keyof typeof WR_STATUS_LABEL] ?? x.don.status, nhanNgayDon(x.don.fromDate)) };
  }

  const assignment = from
    ? await db.shiftAssignment.findFirst({ where: { userId: input.requesterId, workDate: from, status: "ACTIVE" }, select: { id: true } })
    : null;
  const map = await loadCenterMap();
  const orgUnitId = Object.values(map.byCode).find((c) => c.centerId === centerId)?.orgUnitId ?? null;

  // Tạo đơn + audit SUBMIT_REQUEST trong MỘT giao dịch (đợt 12, BA §14): không có đơn nào tồn tại mà
  // sổ không ghi ai nộp, lúc nào.
  const nguoiNop = await db.user.findUnique({ where: { id: input.requesterId }, select: { name: true } });
  const created = await db.$transaction(async (tx) => {
    const don = await tx.workRequest.create({
      data: {
        requesterId: input.requesterId,
        centerId,
        orgUnitId,
        kind: input.kind,
        fromDate: from,
        toDate: to,
        startTime: input.startTime || null,
        endTime: input.endTime || null,
        hours: input.hours,
        className: isClassKind(input.kind) ? input.className : null,
        classId: isClassKind(input.kind) ? input.classId : null,
        targetUserId: input.kind === "SUB_TEACH" || input.kind === "SHIFT_SWAP" || input.kind === "LEAVE" ? input.targetUserId : null,
        assignmentId: assignment?.id ?? null,
        requesterNewTemplateId: input.kind === "SHIFT_SWAP" ? input.requesterNewTemplateId : null,
        targetNewTemplateId: input.kind === "SHIFT_SWAP" || input.kind === "LEAVE" ? input.targetNewTemplateId : null,
        leaveTypeId: input.kind === "LEAVE" ? input.leaveTypeId : null,
        leaveDurationType: input.kind === "LEAVE" || input.kind === "COMP_LEAVE" ? (input.leaveDurationType ?? "FULL_DAY") : null,
        requestedInAt: input.kind === "TIMESHEET_FIX" ? input.requestedInAt : null,
        requestedOutAt: input.kind === "TIMESHEET_FIX" ? input.requestedOutAt : null,
        requestedIn2At: input.kind === "TIMESHEET_FIX" ? input.requestedIn2At : null,
        requestedOut2At: input.kind === "TIMESHEET_FIX" ? input.requestedOut2At : null,
        submittedLate,
        detail: input.detail,
        reason: input.reason,
      },
      select: { id: true },
    });
    await writeAudit({
      actor: { id: input.requesterId, name: nguoiNop?.name ?? "Nhân sự" },
      module: "hr_attendance",
      entityType: "WorkRequest",
      entityId: don.id,
      action: "SUBMIT_REQUEST",
      oldValues: null,
      newValues: { status: "PENDING", kind: input.kind, fromDate: from ? vnYmd(new Date(from.getTime() + 12 * 3_600_000)) : null, submittedLate },
      reason: input.reason,
      orgUnitId,
      tx,
    });
    return don;
  });
  return { ok: true, id: created.id, centerId, submittedLate };
}

export function periodKeysBetween(from: Date, to: Date): string[] {
  const out = new Set<string>();
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) out.add(vnYmd(new Date(d.getTime() + 12 * 3_600_000)).slice(0, 7));
  return [...out];
}

// ─── Thu hồi (đợt 1 đơn từ, 08/10/2026) ───────────────────────────────────────────────

/**
 * Câu báo khi đơn KHÔNG còn chờ — một chỗ cho cả đường duyệt lẫn đường thu hồi, để người bấm
 * biết đơn đi đâu rồi chứ không chỉ "đã xử lý".
 */
export function loiDonKhongConCho(status: string): string {
  if (status === "WITHDRAWN") return "Người nộp đã thu hồi đơn này";
  if (status === "APPROVED") return "Đơn đã được duyệt";
  if (status === "REJECTED") return "Đơn đã bị từ chối";
  if (status === "CANCEL_REQUESTED") return "Đơn đã duyệt và đang chờ duyệt huỷ";
  if (status === "CANCELLED") return "Đơn đã được huỷ";
  return "Đơn đã được xử lý";
}

export type WithdrawResult =
  | { ok: true; centerId: string | null; kind: WorkRequestKindV; fromDate: Date | null }
  | { ok: false; error: string };

/**
 * Người nộp THU HỒI đơn còn chờ duyệt (chủ dự án chốt Q-2: chỉ người nộp; đơn đã duyệt thì không
 * — đó là "yêu cầu huỷ", đợt 8).
 *
 * Đơn chờ duyệt chưa ghi gì lên lưới ca / lượt quét / lịch lớp, nên thu hồi chỉ đổi trạng thái —
 * không có gì để hoàn tác. Phép ghi là `updateMany` CÓ ĐIỀU KIỆN (`requesterId` + `PENDING`): thua
 * cuộc đua với người duyệt thì đổi 0 dòng và trả câu báo theo trạng thái mới đọc lại.
 */
export async function withdrawRequest(input: {
  requestId: string;
  requesterId: string;
  requesterName: string;
  now?: Date;
}): Promise<WithdrawResult> {
  const now = input.now ?? new Date();
  const req = await db.workRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, requesterId: true, status: true, centerId: true, orgUnitId: true, kind: true, fromDate: true },
  });
  // Đơn của người khác trả CÙNG câu với đơn không tồn tại — không xác nhận id của người khác có thật.
  if (!req || req.requesterId !== input.requesterId) return { ok: false, error: "Không tìm thấy đơn" };
  if (req.status !== "PENDING") return { ok: false, error: loiDonKhongConCho(req.status) };

  return db.$transaction(async (tx) => {
    const r = await tx.workRequest.updateMany({
      where: { id: req.id, requesterId: input.requesterId, status: "PENDING" },
      data: { status: "WITHDRAWN", withdrawnAt: now },
    });
    if (r.count === 0) {
      const sau = await tx.workRequest.findUnique({ where: { id: req.id }, select: { status: true } });
      return { ok: false as const, error: loiDonKhongConCho(sau?.status ?? "") };
    }
    await writeAudit({
      actor: { id: input.requesterId, name: input.requesterName },
      module: "hr_attendance",
      entityType: "WorkRequest",
      entityId: req.id,
      action: "WITHDRAW_REQUEST",
      oldValues: { status: "PENDING" },
      newValues: { status: "WITHDRAWN", kind: req.kind },
      orgUnitId: req.orgUnitId,
      tx,
    });
    return { ok: true as const, centerId: req.centerId, kind: req.kind as WorkRequestKindV, fromDate: req.fromDate };
  });
}

// ─── Duyệt / từ chối ──────────────────────────────────────────────────────────────────

export type DecideInput = {
  requestId: string;
  decision: "APPROVED" | "REJECTED";
  note: string | null;
  actor: { id: string; name: string };
  /** Quyền GHI ca theo cơ sở — action tính sẵn từ `hr_attendance:approve`. */
  canWriteCenter: (centerId: string) => boolean;
  /**
   * Đường vượt cổng "kỳ đã chốt sổ" — CHỈ cấp Hội sở, và action phải tự kiểm quyền đó
   * trước khi truyền `true` vào đây. Cùng khuôn `generateMonthAction`.
   */
  boQuaKyDaChot?: boolean;
  /** Đợt 4: quản lý sửa khung OT trước khi duyệt ("HH:mm"). Bỏ trống ⇒ duyệt đúng khung xin. */
  dieuChinh?: DieuChinhKhiDuyet;
  now?: Date;
};

export type { DecideNotify };
export type DecideResult =
  | { ok: true; applied: boolean; message?: string; notify: DecideNotify[] }
  | { ok: false; error: string };

export const REQ_SELECT = {
  id: true,
  orgUnitId: true,
  requesterId: true,
  centerId: true,
  kind: true,
  status: true,
  fromDate: true,
  toDate: true,
  classId: true,
  targetUserId: true,
  requesterNewTemplateId: true,
  targetNewTemplateId: true,
  leaveTypeId: true,
  requestedInAt: true,
  requestedOutAt: true,
  requestedIn2At: true,
  requestedOut2At: true,
  startTime: true,
  endTime: true,
  detail: true,
  leaveDurationType: true,
  reason: true,
} as const;

/**
 * Đơn có ngày rơi vào kỳ ĐÃ CHỐT SỔ của cơ sở không ⇒ câu chặn, hoặc null. MỘT chỗ cho cả duyệt đơn lẫn
 * duyệt HUỶ đơn (đợt 11): hoàn tác cũng là ghi vào kỳ — hai cổng viết hai lần là hai lần trôi khỏi nhau.
 * Đơn lớp không qua cổng này (buổi học không thuộc kỳ công).
 */
export async function loiKyDaChotCuaDon(req: { centerId: string | null; kind: string; fromDate: Date | null; toDate: Date | null }): Promise<string | null> {
  if (!req.centerId || !req.fromDate || isClassKind(req.kind as WorkRequestKindV)) return null;
  const kyChot = await db.attendancePeriod.findFirst({
    where: {
      centerId: req.centerId,
      status: "LOCKED",
      periodKey: { in: periodKeysBetween(req.fromDate, req.toDate ?? req.fromDate) },
    },
    select: { periodKey: true, status: true },
  });
  return kyChot ? chanSuaKyDaChot({ status: kyChot.status, periodKey: kyChot.periodKey }) : null;
}

export async function decideRequest(input: DecideInput): Promise<DecideResult> {
  const now = input.now ?? new Date();
  const req = await db.workRequest.findUnique({ where: { id: input.requestId }, select: REQ_SELECT });
  if (!req) return { ok: false, error: "Không tìm thấy đơn" };
  if (req.status !== "PENDING") return { ok: false, error: loiDonKhongConCho(req.status) };
  if (!req.centerId || !input.canWriteCenter(req.centerId)) return { ok: false, error: "Đơn thuộc cơ sở bạn không có quyền duyệt" };

  // ── CHẶN CỨNG: không DUYỆT đơn vào kỳ ĐÃ CHỐT SỔ (09/09/2026) ──────────────
  //
  // `createRequest` đã chặn NỘP đơn vào kỳ đã chốt (xem cổng ở trên trong file này),
  // nhưng đó là cổng ở đầu vào. Đơn nộp TRƯỚC khi chốt, duyệt SAU khi chốt thì đi lọt:
  // nhánh TIMESHEET_FIX `createMany` thẳng `StaffTimeLog` rồi `markAttendanceDayDirty`,
  // tức GHI vào một kỳ đã đóng băng.
  //
  // Hậu quả im lặng: `summaryJson` của kỳ đã chốt KHÔNG đổi (nó là ảnh chụp lúc khoá,
  // `ky-cong/page.tsx` đọc thẳng từ đó), nên sổ đã chốt và dữ liệu sống lệch nhau mà
  // không có gì báo. Đo prod 09/09: 0 kỳ LOCKED ⇒ chưa ai rơi vào — nhưng đường ghi
  // còn sống, và nó sẽ cháy đúng lần chốt kỳ ĐẦU TIÊN (luật 1).
  //
  // Chỉ chặn khi DUYỆT: từ chối một đơn cũ không ghi gì vào kỳ, để nguyên cho quản lý
  // dọn hàng chờ.
  if (input.decision === "APPROVED") {
    const loi = await loiKyDaChotCuaDon(req);
    // Cơ sở tự vượt cổng của chính mình thì cổng đó không tồn tại — quyền vượt do
    // ACTION kiểm (cấp Hội sở), ở đây chỉ nhận kết quả.
    if (loi && !input.boQuaKyDaChot) return { ok: false, error: loi };
  }

  const decisionData = {
    status: input.decision,
    reviewedById: input.actor.id,
    reviewedByName: input.actor.name,
    reviewedAt: now,
    reviewNote: input.note?.trim() || null,
  };
  const kindLabel = WR_KIND_LABEL[req.kind as WorkRequestKindV] ?? req.kind;
  const dateLabel = req.fromDate ? vnYmd(new Date(req.fromDate.getTime() + 12 * 3_600_000)) : "";

  const hieuLuc = { kind: req.kind, centerId: req.centerId, fromDate: dateLabel || null, boQuaKyDaChot: input.boQuaKyDaChot === true };

  // ── MỘT giao dịch cho cả quyết định (đợt 3 đơn từ, BA §13–14) ──────────────────────────────
  //
  // khoá đơn → (duyệt) handler theo loại → audit (giá trị cũ → mới) → commit. Bất kỳ bước nào ném ⇒
  // rollback CẢ CỤM, đơn giữ PENDING. Bản trước 08/10/2026: đơn LỚP đổi APPROVED trước rồi gọi hàm
  // có transaction riêng, lỗi thì "bù trừ" về PENDING; audit ghi NGOÀI giao dịch, ở action, và chỉ
  // mang `status`. Handler từ chối bằng `throw` — `return` không rollback (luật rollback).
  // Đọc TRƯỚC giao dịch: chỉ là danh mục, để trong tx là kéo dài giao dịch về phía trần 5 giây.
  const map = await loadCenterMap();
  try {
    const out = await db.$transaction(async (tx) => {
      const lock = await tx.workRequest.updateMany({ where: { id: req.id, status: "PENDING" }, data: { ...decisionData, applyError: null } });
      if (lock.count === 0) {
        const sau = await tx.workRequest.findUnique({ where: { id: req.id }, select: { status: true } });
        throw new DecideError(sau?.status === "PENDING" || !sau ? "Đơn vừa được người khác xử lý" : loiDonKhongConCho(sau.status));
      }

      if (input.decision === "REJECTED") {
        await writeAudit({
          actor: input.actor,
          module: "hr_attendance",
          entityType: "WorkRequest",
          entityId: req.id,
          action: "REJECT_REQUEST",
          oldValues: { status: "PENDING" },
          newValues: { status: "REJECTED", ...hieuLuc },
          reason: input.note ?? undefined,
          orgUnitId: req.orgUnitId,
          tx,
        });
        return {
          applied: false,
          messages: [] as string[],
          notify: [{ userId: req.requesterId, title: `Đơn ${kindLabel} ${dateLabel} bị từ chối`, body: `${input.actor.name} từ chối đơn của bạn${input.note ? ` — ${input.note}` : ""}.`, href: HREF_DON_CUA_TOI }],
        };
      }

      // Đợt 12 — KIỂM XUNG ĐỘT TRONG GIAO DỊCH, dưới khoá tư vấn theo NGƯỜI NỘP: hai quản lý duyệt cùng lúc
      // hai đơn trùng của cùng một người thì lượt sau chờ khoá, rồi (READ COMMITTED) đọc thấy đơn lượt
      // trước vừa duyệt ⇒ ném ⇒ rollback, đơn giữ PENDING. Kiểm ngoài giao dịch (bản đầu) lọt cả hai.
      // Chỉ so với đơn CÒN HIỆU LỰC — đơn khác còn chờ không chặn ai. Chính đơn này (đã giành ở trên) bị
      // `timXungDot` bỏ qua theo id.
      if (req.fromDate) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`don-tu:${req.requesterId}`}))`;
        const ton = await donPhuKhoang(tx, req.requesterId, req.fromDate, req.toDate ?? req.fromDate, TRANG_THAI_CON_HIEU_LUC);
        const x = timXungDot({ ...req, kind: req.kind as WorkRequestKindV, approvedStartTime: null, approvedEndTime: null }, ton);
        if (x) throw new DecideError(cauXungDot(x, WR_STATUS_LABEL[x.don.status as keyof typeof WR_STATUS_LABEL] ?? x.don.status, nhanNgayDon(x.don.fromDate)));
      }

      const kq = await HANDLER_DON[req.kind as WorkRequestKindV]({
        tx,
        don: { ...req, kind: req.kind as WorkRequestKindV, centerId: req.centerId! },
        actor: input.actor,
        note: input.note ?? null,
        now,
        map,
        canWriteCenter: input.canWriteCenter,
        boQuaKyDaChot: input.boQuaKyDaChot === true,
        dateLabel,
        kindLabel,
        dieuChinh: input.dieuChinh ?? KHONG_DIEU_CHINH,
      });
      // DẤU "duyệt theo luật mới" + ảnh chụp hệ quả (đợt 4): chỉ đơn mang dấu mới tác động bảng công
      // khi tính lại (`don-trong-ngay-db.ts`), và huỷ đơn (đợt 11) hoàn tác theo đúng ảnh chụp này.
      // `appliedAt` chỉ khi CÓ hệ quả — trước đây đơn OT/từ xa cũng mang nhãn "Đã áp lên lịch".
      await tx.workRequest.update({
        where: { id: req.id },
        data: {
          effectVersion: 1,
          appliedEffect: (kq.hieuQua ?? {}) as Prisma.InputJsonValue,
          ...(kq.applied ? { appliedAt: now } : {}),
        },
      });
      await writeAudit({
        actor: input.actor,
        module: "hr_attendance",
        entityType: "WorkRequest",
        entityId: req.id,
        action: "APPROVE_REQUEST",
        oldValues: { status: "PENDING" },
        newValues: { status: "APPROVED", applied: kq.applied, ...hieuLuc, hieuQua: kq.hieuQua },
        reason: input.note ?? undefined,
        orgUnitId: req.orgUnitId,
        tx,
      });
      return kq;
    });
    return { ok: true, applied: out.applied, message: out.messages.join(" · ") || undefined, notify: out.notify };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Ghi applyError SAU rollback, ở giao dịch riêng (T-05) — đơn vẫn PENDING. Chỉ khi DUYỆT: từ
    // chối không có hệ quả nào để "không áp được".
    if (input.decision === "APPROVED") {
      await db.workRequest.updateMany({ where: { id: req.id, status: "PENDING" }, data: { applyError: msg.slice(0, 500) } });
    }
    return { ok: false, error: err instanceof DecideError ? msg : `Chưa duyệt được — lỗi áp hệ quả: ${msg}` };
  }
}

// ─── Người duyệt của một cơ sở ─────────────────────────────────────────────────────────

/**
 * User giữ vai có `hr_attendance:approve` neo TẠI đơn vị của cơ sở hoặc đơn vị tổ tiên (HO/REGION).
 * Đọc UserOrgRole ACTIVE còn hiệu lực — nguồn quyền là DB (luật cứng #6), không đọc JWT.
 */
export async function approversOfCenter(centerId: string): Promise<string[]> {
  // ⚠️ Thân hàm đã DỜI sang `lib/org/nguoi-giu-quyen-tai-co-so.ts` [25/09/2026] vì màn
  // Đơn hàng cần đúng thuật toán này cho `discounts:approve` / `installments:approve`.
  // Giữ hàm ở đây làm đường nhập cũ — chép thân sang là chép cả phần dễ sai nhất (leo
  // cây tổ tiên), và một bản quên leo thì người neo vai ở Hội sở im lặng mất quyền duyệt.
  return nguoiGiuQuyenTaiCoSo(centerId, ["hr_attendance:approve"]);
}


// `vnTimeOn` nay ở `sua-gio-quet.ts` cùng phần dựng dòng dùng nó. Tái xuất để giữ nguyên
// đường nhập cũ (`tests/cham-cong/requests.spec.ts` và mọi chỗ khác không phải sửa) — chứ
// KHÔNG chép lại thân hàm: hai bản là hai cơ hội để một bản lệch đi.
export { vnTimeOn };
