// app/(teacher)/teacher/don-tu/page.tsx — Đơn từ GV (site giáo viên).
//
// Port reference :3001 don-tu: danh sách đơn CỦA MÌNH + form tạo đơn 10 loại/3 nhóm
// (field điều kiện theo loại) + tìm kiếm/lọc. Server fetch đơn của mình + dữ liệu
// dropdown (lớp mình, GV cùng cơ sở, ca sắp tới); client lo form + filter.
// Preset ?type=<kind> / ?swap=<shiftId> mở form + chọn sẵn; ?date=YYYY-MM-DD điền sẵn ngày
// (cùng hợp đồng query với `/don-tu/cua-toi` của admin).
//
// WorkRequest ∉ SCOPED_MODELS → own-scope qua requesterId. ⚠️ Câu 46: đơn từ là dữ
// liệu nhân sự của chính GV — không chạm HV/PH.
import { coTheXinHuy, khiDuyetHuySe } from "@/lib/cham-cong/huy-don-mo-ta";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { loadRequestFormOptions } from "@/lib/cham-cong/request-form-data";
import type { WorkRequestKindV } from "@/lib/work-request";
import { tomTatDon } from "@/lib/cham-cong/tom-tat-don";
import { DonTuClient, type WorkRequestRow } from "./_components/don-tu-client";

export const metadata = { title: "Đơn từ | Giáo viên Sata Robo" };

const dateFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

export default async function DonTuPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; swap?: string; date?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate

  const sp = await searchParams;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const [requests, options] = await Promise.all([
    sdb.workRequest.findMany({
      where: { requesterId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    loadRequestFormOptions(session.user.id),
  ]);

  // Câu tóm tắt: tên loại nghỉ / mã ca / tên đồng nghiệp tra từ CHÍNH dữ liệu form đã nạp —
  // không thêm truy vấn. Không thấy (đồng nghiệp đã nghỉ việc…) thì câu nói "chưa chọn" chứ
  // không đoán.
  const leaveOf = new Map(options.leaveTypes.map((l) => [l.id, l]));
  const codeOf = new Map(options.templates.map((t) => [t.id, t.code]));
  const nameOf = new Map(options.colleagues.map((c) => [c.id, c.name]));
  const rows: WorkRequestRow[] = requests.map((r) => ({
    id: r.id,
    kind: r.kind as WorkRequestKindV,
    status: r.status,
    fromLabel: r.fromDate ? dateFmt.format(r.fromDate) : null,
    toLabel: r.toDate ? dateFmt.format(r.toDate) : null,
    startTime: r.startTime,
    endTime: r.endTime,
    hours: r.hours,
    className: r.className,
    detail: r.detail,
    reason: r.reason,
    reviewNote: r.reviewNote,
    createdAtLabel: dateFmt.format(r.createdAt),
    xinHuy: coTheXinHuy({ status: r.status, effectVersion: r.effectVersion, kind: r.kind as WorkRequestKindV, leaveDurationType: r.leaveDurationType, appliedEffect: r.appliedEffect })
      ? khiDuyetHuySe({ kind: r.kind as WorkRequestKindV, leaveDurationType: r.leaveDurationType })
      : null,
    lyDoHuy: r.cancelReason,
    ghiChuHuy: r.cancelDecisionNote,

    tomTat: tomTatDon(
      {
        kind: r.kind,
        fromDate: r.fromDate,
        toDate: r.toDate,
        startTime: r.startTime,
        endTime: r.endTime,
        className: r.className,
        detail: r.detail,
        moc: [r.requestedInAt, r.requestedOutAt, r.requestedIn2At, r.requestedOut2At],
        leaveName: r.leaveTypeId ? (leaveOf.get(r.leaveTypeId)?.name ?? null) : null,
        leavePaidRatio: r.leaveTypeId ? (leaveOf.get(r.leaveTypeId)?.paidRatio ?? null) : null,
        leaveDurationType: r.leaveDurationType,
        newShiftCode: r.requesterNewTemplateId ? (codeOf.get(r.requesterNewTemplateId) ?? null) : null,
        targetName: r.targetUserId ? (nameOf.get(r.targetUserId) ?? null) : null,
        targetShiftCode: r.targetNewTemplateId ? (codeOf.get(r.targetNewTemplateId) ?? null) : null,
      },
      null,
    ),
  }));
  const presetDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null;

  return (
    <DonTuClient
      rows={rows}
      options={options}
      presetKind={sp.type ?? null}
      presetSwap={sp.swap ?? null}
      presetDate={presetDate}
    />
  );
}
