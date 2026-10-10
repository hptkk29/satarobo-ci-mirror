"use server";

// lib/cham-cong/request-actions.ts — L5: Server Action ĐƠN TỪ dùng chung (site admin lẫn site GV
// cùng gọi — giống `lib/lead/intake/quick-form-action.ts`). Quyền qua `can()`:
//   · nộp đơn   → `hr_attendance:checkin` tại cơ sở nhận đơn (mọi nhân sự có chấm công).
//   · duyệt đơn → `hr_attendance:approve` tại cơ sở nhận đơn (T-06: Quản lý cơ sở / Giám đốc).
// Hệ quả (đổi lưới ca, ghi giờ chỉnh tay, huỷ buổi/dạy thay) nằm trong `lib/cham-cong/requests.ts`.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { notifyStaff } from "@/lib/notifications/notify";
import { db } from "@/lib/db";
import { WORK_REQUEST_KINDS, WR_KIND_LABEL, diffHours, type WorkRequestKindV } from "@/lib/work-request";
import { HO_CENTER_ID, loadCenterMap } from "./home-center";
import { approversOfCenter, decideRequest, resolveRequestCenter, submitAttendanceRequest, withdrawRequest } from "./requests";
import { vnYmd } from "@/lib/time/vn";
import { tomTatDon } from "./tom-tat-don";
import { baoCaseTrialGvVang } from "@/lib/trial/bao-gv-vang";
import { quyetDinhHuy, yeuCauHuyDon } from "./huy-don";

type Res = { ok: true; note?: string } | { ok: false; error: string };

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ");
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, "Giờ không hợp lệ");
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable();

const submitSchema = z.object({
  kind: z.enum(WORK_REQUEST_KINDS),
  fromDate: opt(ymd),
  toDate: opt(ymd),
  startTime: opt(hhmm),
  endTime: opt(hhmm),
  hours: opt(z.coerce.number().min(0).max(24)),
  className: opt(z.string().max(200)),
  classId: opt(z.string().max(60)),
  targetUserId: opt(z.string().max(60)),
  requesterNewTemplateId: opt(z.string().max(60)),
  targetNewTemplateId: opt(z.string().max(60)),
  leaveTypeId: opt(z.string().max(60)),
  // TIMESHEET_FIX — tối đa 4 mốc theo thứ tự [vào 1, ra 1, vào 2, ra 2] (06/10/2026). Hai mốc
  // đầu giữ tên cũ; thứ tự/tăng dần kiểm ở `submitAttendanceRequest` (`kiemDanhSachMoc`).
  requestedInAt: opt(hhmm),
  requestedOutAt: opt(hhmm),
  requestedIn2At: opt(hhmm),
  requestedOut2At: opt(hhmm),
  chosenCenterId: opt(z.string().max(60)),
  leaveDurationType: opt(z.enum(["FULL_DAY", "HALF_DAY_AM", "HALF_DAY_PM", "HOURLY"])),
  detail: opt(z.string().max(500)),
  reason: z.string().trim().min(1, "Nhập lý do").max(3000),
});

function parseYmd(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export async function submitRequestAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = submitSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = p.data;
  const from = parseYmd(d.fromDate);

  // Cổng quyền: người nộp phải có quyền chấm công tại cơ sở nhận đơn (đúng nơi sẽ chịu công).
  const resolved = await resolveRequestCenter(session.user.id, from);
  const gateCenter = resolved.centerId ?? d.chosenCenterId ?? null;
  if (!gateCenter) return { ok: false, error: "Bạn thuộc Hội sở — chọn cơ sở nhận đơn" };
  if (!(await checkPermission("hr_attendance:checkin", { centerId: gateCenter }))) {
    return { ok: false, error: "Không có quyền nộp đơn tại cơ sở này" };
  }

  const r = await submitAttendanceRequest({
    requesterId: session.user.id,
    kind: d.kind,
    fromDate: from,
    toDate: parseYmd(d.toDate),
    startTime: d.startTime ?? null,
    endTime: d.endTime ?? null,
    hours: d.kind === "OT" ? diffHours(d.startTime, d.endTime) : d.kind === "TIMESHEET_FIX" ? (d.hours ?? null) : null,
    className: d.className ?? null,
    classId: d.classId ?? null,
    targetUserId: d.targetUserId ?? null,
    requesterNewTemplateId: d.requesterNewTemplateId ?? null,
    targetNewTemplateId: d.targetNewTemplateId ?? null,
    leaveTypeId: d.leaveTypeId ?? null,
    requestedInAt: d.requestedInAt ?? null,
    requestedOutAt: d.requestedOutAt ?? null,
    requestedIn2At: d.requestedIn2At ?? null,
    requestedOut2At: d.requestedOut2At ?? null,
    chosenCenterId: d.chosenCenterId ?? null,
    leaveDurationType: d.leaveDurationType ?? null,
    detail: d.detail ?? null,
    reason: d.reason,
  });
  if (!r.ok) return r;

  // Báo người duyệt tại cơ sở nhận đơn (không báo chính người nộp nếu họ cũng là người duyệt).
  const approvers = (await approversOfCenter(r.centerId)).filter((id) => id !== session.user.id);
  if (approvers.length > 0) {
    const label = WR_KIND_LABEL[d.kind as WorkRequestKindV] ?? d.kind;
    // Thân thông báo = CÂU TÓM TẮT (`tomTatDon`, cùng câu màn `/don-tu` in) + lý do — người duyệt
    // đọc trên chuông là biết đơn xin gì, không phải mở ra mới biết (06/10/2026). Tên/mã tra ở đây
    // vì payload chỉ mang id; thiếu thì câu nói "chưa chọn", không đoán.
    const [leave, codes, target] = await Promise.all([
      d.leaveTypeId
        ? db.leaveType.findUnique({ where: { id: d.leaveTypeId }, select: { name: true, paidRatio: true } })
        : null,
      d.requesterNewTemplateId || d.targetNewTemplateId
        ? db.shiftTemplate.findMany({
            where: { id: { in: [d.requesterNewTemplateId, d.targetNewTemplateId].filter((x): x is string => !!x) } },
            select: { id: true, code: true },
          })
        : [],
      d.targetUserId ? db.user.findUnique({ where: { id: d.targetUserId }, select: { name: true, email: true } }) : null,
    ]);
    const codeOf = new Map(codes.map((c) => [c.id, c.code]));
    const tomTat = tomTatDon(
      {
        kind: d.kind,
        fromDate: from,
        toDate: parseYmd(d.toDate),
        startTime: d.startTime ?? null,
        endTime: d.endTime ?? null,
        className: d.className ?? null,
        detail: d.detail ?? null,
        moc: [d.requestedInAt, d.requestedOutAt, d.requestedIn2At, d.requestedOut2At],
        leaveName: leave?.name ?? null,
        leavePaidRatio: leave?.paidRatio ?? null,
        leaveDurationType: d.leaveDurationType ?? null,
        newShiftCode: d.requesterNewTemplateId ? (codeOf.get(d.requesterNewTemplateId) ?? null) : null,
        targetName: target ? (target.name ?? target.email ?? null) : null,
        targetShiftCode: d.targetNewTemplateId ? (codeOf.get(d.targetNewTemplateId) ?? null) : null,
      },
      session.user.name ?? "Nhân sự",
    );
    await notifyStaff({
      userIds: approvers,
      dedupeKey: `request.submitted:${r.id}`,
      title: `Đơn ${label}${d.fromDate ? ` ${d.fromDate}` : ""} — ${session.user.name ?? "nhân sự"}${r.submittedLate ? " (nộp muộn)" : ""}`,
      body: `${tomTat}. Lý do: ${d.reason}`.slice(0, 300),
      href: "/don-tu",
      entityId: r.id,
    });
  }
  revalidatePath("/teacher/don-tu");
  revalidatePath("/don-tu");
  revalidatePath("/don-tu/cua-toi");
  return { ok: true, note: r.submittedLate ? "Đơn nộp muộn so với quy định báo trước — quản lý sẽ thấy cờ này." : undefined };
}

const withdrawSchema = z.object({ id: z.string().min(1) });

/**
 * Người nộp thu hồi đơn còn chờ duyệt (đợt 1 đơn từ, chốt Q-2 08/10/2026). Cổng là QUYỀN SỞ HỮU
 * (đúng người nộp) — kiểm trong `withdrawRequest` bằng chính điều kiện của phép ghi, không phải
 * quyền theo cơ sở: người đã nộp được đơn thì thu hồi được đơn của chính mình.
 */
export async function withdrawRequestAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = withdrawSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };

  const r = await withdrawRequest({
    requestId: p.data.id,
    requesterId: session.user.id,
    requesterName: session.user.name ?? "Nhân sự",
  });
  if (!r.ok) return r;

  // Người duyệt đã nhận chuông lúc đơn được nộp — báo luôn là đơn đã rút, kẻo họ mở hàng chờ đi tìm.
  if (r.centerId) {
    const approvers = (await approversOfCenter(r.centerId)).filter((id) => id !== session.user.id);
    if (approvers.length > 0) {
      const label = WR_KIND_LABEL[r.kind] ?? r.kind;
      const ngay = r.fromDate ? ` ${vnYmd(new Date(r.fromDate.getTime() + 12 * 3_600_000))}` : "";
      await notifyStaff({
        userIds: approvers,
        dedupeKey: `request.withdrawn:${p.data.id}`,
        title: `Đơn ${label}${ngay} đã được thu hồi — ${session.user.name ?? "nhân sự"}`,
        body: "Người nộp đã rút đơn trước khi duyệt — không cần xử lý nữa.",
        href: "/don-tu",
        entityId: p.data.id,
      });
    }
  }
  revalidatePath("/teacher/don-tu");
  revalidatePath("/don-tu");
  revalidatePath("/don-tu/cua-toi");
  return { ok: true };
}

const decideSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(1000).optional().nullable(),
  /** Đường vượt cổng "kỳ đã chốt sổ" — chỉ cấp Hội sở, bắt buộc lý do. */
  boQuaKyDaChot: z.boolean().optional(),
  /** Đợt 4: khung OT quản lý duyệt (thu hẹp từ khung xin). Handler kiểm lại. */
  otTu: hhmm.optional().nullable(),
  otDen: hhmm.optional().nullable(),
});

/** Tập cơ sở người này được duyệt đơn — tính một lần cho mỗi lượt gọi. */
export async function approvableCenters(): Promise<Set<string>> {
  const map = await loadCenterMap();
  const allowed = new Set<string>();
  for (const id of [...Object.values(map.byCode).map((c) => c.centerId), HO_CENTER_ID]) {
    if (await checkPermission("hr_attendance:approve", { centerId: id })) allowed.add(id);
  }
  return allowed;
}

export async function decideRequestAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = decideSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (p.data.decision === "REJECTED" && !p.data.note?.trim()) return { ok: false, error: "Nhập lý do từ chối" };
  const allowed = await approvableCenters();
  if (allowed.size === 0) return { ok: false, error: "Không có quyền duyệt đơn" };

  const before = await db.workRequest.findUnique({ where: { id: p.data.id }, select: { status: true, kind: true, centerId: true, requesterId: true, fromDate: true, toDate: true, targetUserId: true } });
  // ── Đường vượt cổng "kỳ đã chốt" — kiểm quyền Ở ĐÂY, không ở tầng lib ────────
  //
  // `decideRequest` chỉ NHẬN kết quả kiểm; để nó tự hỏi quyền thì cơ sở tự vượt cổng của
  // chính mình, và cổng đó không tồn tại. Cùng khuôn `generateMonthAction`.
  let boQua = false;
  if (p.data.boQuaKyDaChot) {
    if (!(await checkPermission("hr_attendance:close-period", { centerId: HO_CENTER_ID }))) {
      return { ok: false, error: "Chỉ cấp Hội sở mới duyệt được đơn vào kỳ đã chốt" };
    }
    if ((p.data.note ?? "").trim().length < 5) {
      return { ok: false, error: "Duyệt đơn vào kỳ đã chốt phải ghi lý do (tối thiểu 5 ký tự)" };
    }
    boQua = true;
  }

  const r = await decideRequest({
    requestId: p.data.id,
    decision: p.data.decision,
    note: p.data.note ?? null,
    actor: { id: session.user.id, name: session.user.name ?? "Quản lý" },
    canWriteCenter: (c) => allowed.has(c),
    boQuaKyDaChot: boQua,
    dieuChinh: { otTu: p.data.otTu ?? null, otDen: p.data.otDen ?? null },
  });
  if (!r.ok) return r;

  // Audit (APPROVE_REQUEST / REJECT_REQUEST, kèm giá trị cũ → mới) ghi TRONG giao dịch của
  // `decideRequest` từ đợt 3 (08/10/2026) — trước đó ghi ở đây, sau khi đã commit, và chỉ có `status`.
  for (const n of r.notify) {
    if (n.userId === session.user.id) continue;
    await notifyStaff({ userIds: [n.userId], dedupeKey: `request.decided:${p.data.id}:${n.userId}`, title: n.title, body: n.body, href: n.href, entityId: p.data.id, reopen: true });
  }
  // 29/09/2026 — đơn nghỉ / đổi ca vừa duyệt có thể làm giáo viên vắng ở case trial đã xếp
  // ⇒ báo Sale chủ case + Đào tạo (`lib/trial/bao-gv-vang.ts`). Đọc lại chính ô ca vừa ghi,
  // nên phải đứng SAU `decideRequest`; non-fatal.
  if (
    p.data.decision === "APPROVED" &&
    before?.fromDate &&
    (before.kind === "LEAVE" || before.kind === "SHIFT_SWAP")
  ) {
    await baoCaseTrialGvVang({
      teacherIds: [before.requesterId, before.targetUserId ?? ""],
      tu: before.fromDate,
      den: before.toDate ?? before.fromDate,
    });
    revalidatePath("/lop-trial");
  }
  revalidatePath("/teacher/don-tu");
  revalidatePath("/don-tu");
  revalidatePath("/don-tu/cua-toi");
  revalidatePath("/cham-cong/phan-ca");
  revalidatePath("/cham-cong");
  revalidatePath("/lich");
  return { ok: true, note: r.message };
}

// ─── Huỷ đơn ĐÃ DUYỆT (đợt 11) ────────────────────────────────────────────────────────

const yeuCauHuySchema = z.object({ id: z.string().min(1), lyDo: z.string().trim().min(5, "Ghi lý do xin huỷ (tối thiểu 5 ký tự)").max(1000) });

/**
 * Người nộp xin huỷ đơn đã duyệt. Cùng cổng với thu hồi: QUYỀN SỞ HỮU, kiểm trong `yeuCauHuyDon`
 * bằng chính điều kiện của phép ghi (`requesterId` + `APPROVED`).
 */
export async function yeuCauHuyDonAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = yeuCauHuySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const r = await yeuCauHuyDon({ requestId: p.data.id, requesterId: session.user.id, requesterName: session.user.name ?? "Nhân sự", lyDo: p.data.lyDo });
  if (!r.ok) return r;
  if (r.centerId) {
    const approvers = (await approversOfCenter(r.centerId)).filter((id) => id !== session.user.id);
    if (approvers.length > 0) {
      const label = WR_KIND_LABEL[r.kind] ?? r.kind;
      const ngay = r.fromDate ? ` ${vnYmd(new Date(r.fromDate.getTime() + 12 * 3_600_000))}` : "";
      await notifyStaff({
        userIds: approvers,
        dedupeKey: `request.cancel-requested:${p.data.id}`,
        title: `Xin huỷ đơn ${label}${ngay} đã duyệt — ${session.user.name ?? "nhân sự"}`,
        body: `Lý do: ${p.data.lyDo}`.slice(0, 300),
        href: "/don-tu?status=CANCEL_REQUESTED",
        entityId: p.data.id,
        reopen: true,
      });
    }
  }
  revalidatePath("/teacher/don-tu");
  revalidatePath("/don-tu");
  revalidatePath("/don-tu/cua-toi");
  return { ok: true };
}

const quyetDinhHuySchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(1000).optional().nullable(),
  boQuaKyDaChot: z.boolean().optional(),
});

/** Quản lý duyệt / từ chối yêu cầu huỷ. Quyền = quyền duyệt đơn của cơ sở (`approvableCenters`). */
export async function quyetDinhHuyAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = quyetDinhHuySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (p.data.decision === "REJECTED" && !p.data.note?.trim()) return { ok: false, error: "Nhập lý do từ chối huỷ" };
  const allowed = await approvableCenters();
  if (allowed.size === 0) return { ok: false, error: "Không có quyền duyệt đơn" };
  let boQua = false;
  if (p.data.boQuaKyDaChot) {
    if (!(await checkPermission("hr_attendance:close-period", { centerId: HO_CENTER_ID }))) {
      return { ok: false, error: "Chỉ cấp Hội sở mới duyệt huỷ được đơn trong kỳ đã chốt" };
    }
    if ((p.data.note ?? "").trim().length < 5) return { ok: false, error: "Duyệt huỷ vào kỳ đã chốt phải ghi lý do (tối thiểu 5 ký tự)" };
    boQua = true;
  }
  const r = await quyetDinhHuy({
    requestId: p.data.id,
    decision: p.data.decision,
    note: p.data.note ?? null,
    actor: { id: session.user.id, name: session.user.name ?? "Quản lý" },
    canWriteCenter: (c) => allowed.has(c),
    boQuaKyDaChot: boQua,
  });
  if (!r.ok) return r;
  for (const n of r.notify) {
    if (n.userId === session.user.id) continue;
    await notifyStaff({ userIds: [n.userId], dedupeKey: `request.cancel-decided:${p.data.id}:${n.userId}`, title: n.title, body: n.body, href: n.href, entityId: p.data.id, reopen: true });
  }
  revalidatePath("/teacher/don-tu");
  revalidatePath("/don-tu");
  revalidatePath("/don-tu/cua-toi");
  revalidatePath("/cham-cong/phan-ca");
  revalidatePath("/cham-cong");
  revalidatePath("/cham-cong/nghi-bu");
  revalidatePath("/lich");
  return { ok: true, note: r.message };
}
