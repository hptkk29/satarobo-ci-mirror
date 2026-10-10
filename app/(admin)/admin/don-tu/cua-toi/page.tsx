// app/(admin)/admin/don-tu/cua-toi/page.tsx — ĐƠN CỦA TÔI trên site admin (tư vấn, giáo vụ, kế
// toán, người Hội sở…). Cùng FORM với site giáo viên (`components/cham-cong/request-form.tsx`).
//
// Vì sao màn này tồn tại: đơn từ là việc của CHÍNH người đăng nhập — nộp ở đây, xem ở đây, và biết
// đơn đang chờ ai. Nó nằm ngoài segment `cham-cong/` nên KHÔNG dùng chung layout với 11 màn kia;
// hàng tab cụm "Của tôi" phải tự render (MeNav).
//
// DỄ VỠ:
// 1. ĐƯỜNG DẪN LÀ HREF TRONG DB — thông báo `request.decided` trỏ về đây
//    (`lib/cham-cong/requests.ts:245`). Đổi route là làm chết thông báo đã gửi.
// 2. Không gate quyền: đọc đơn của chính mình. Thêm `checkPermission` là khoá màn của nhân viên.
// 3. `?type=` mở sẵn form theo loại (site GV dùng cùng hợp đồng query); `?date=` điền sẵn ngày —
//    hai tham số này do màn "Lịch ca của tôi" phát ra, đừng đổi tên.
// 4. `?month=` màn này KHÔNG dùng để đọc dữ liệu (đơn của tôi không chia theo tháng) — nó chỉ đi
//    NHỜ qua đây để tab "Lịch ca" trả người dùng về đúng tháng họ đang xem. Bỏ nó là bấm sang
//    "Đơn của tôi" rồi bấm về là rơi từ tháng 08 xuống tháng hiện tại.
import { coTheXinHuy, khiDuyetHuySe } from "@/lib/cham-cong/huy-don-mo-ta";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { loadRequestFormOptions } from "@/lib/cham-cong/request-form-data";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";
import {
  WORK_REQUEST_KINDS,
  WORK_REQUEST_STATUSES,
  type WorkRequestKindV,
  type WorkRequestStatusV,
} from "@/lib/work-request";
import { MyRequests, type MyRequestRow } from "@/components/cham-cong/my-requests";
import { moTaMoc } from "@/lib/cham-cong/sua-gio-quet";
import { tomTatDon } from "@/lib/cham-cong/tom-tat-don";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { MeNav } from "@/components/admin/cham-cong/me-nav";

export const metadata = { title: "Đơn của tôi | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" });
const dtFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** "YYYY-MM" tháng 01–12. Kiểm tại chỗ thay vì nhập `parsePeriodKey` — file đó kéo cả `@/lib/db`
 *  vào chỉ để so một chuỗi, mà màn này không đọc dữ liệu theo tháng. */
const KY = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function DonCuaToiPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; date?: string; status?: string; month?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fdon-tu%2Fcua-toi");
  const sp = await searchParams;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const [requests, options] = await Promise.all([
    sdb.workRequest.findMany({ where: { requesterId: session.user.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    loadRequestFormOptions(session.user.id),
  ]);
  const centerLabel = new Map(options.centers.map((c) => [c.id, c.label]));
  // Tên loại nghỉ / mã ca / đồng nghiệp cho câu tóm tắt — tra từ CHÍNH dữ liệu form đã nạp.
  const leaveOf = new Map(options.leaveTypes.map((l) => [l.id, l]));
  const codeOf = new Map(options.templates.map((t) => [t.id, t.code]));
  const nameOf = new Map(options.colleagues.map((c) => [c.id, c.name]));
  const rows: MyRequestRow[] = requests.map((r) => ({
    id: r.id,
    kind: r.kind as WorkRequestKindV,
    status: r.status as WorkRequestStatusV,
    centerLabel: r.centerId ? (centerLabel.get(r.centerId) ?? (r.centerId === HO_CENTER_ID ? "Hội sở" : r.centerId)) : "—",
    fromLabel: r.fromDate ? dateFmt.format(r.fromDate) : null,
    toLabel: r.toDate ? dateFmt.format(r.toDate) : null,
    // Đủ 4 mốc (06/10/2026) — bản cũ chỉ in vào/ra 1 nên đơn ca hai buổi mất nửa sau.
    time:
      moTaMoc([r.requestedInAt, r.requestedOutAt, r.requestedIn2At, r.requestedOut2At]) ||
      (r.startTime ? `${r.startTime}${r.endTime ? `–${r.endTime}` : ""}` : null),
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
    detail: r.detail,
    reason: r.reason,
    submittedLate: r.submittedLate,
    applyError: r.applyError,
    reviewNote: r.reviewNote,
    reviewedByName: r.reviewedByName,
    createdAtLabel: dtFmt.format(r.createdAt),
    xinHuy: coTheXinHuy({ status: r.status, effectVersion: r.effectVersion, kind: r.kind as WorkRequestKindV, leaveDurationType: r.leaveDurationType, appliedEffect: r.appliedEffect })
      ? khiDuyetHuySe({ kind: r.kind as WorkRequestKindV, leaveDurationType: r.leaveDurationType })
      : null,
    lyDoHuy: r.cancelReason,
    ghiChuHuy: r.cancelDecisionNote,
  }));

  const preset = (WORK_REQUEST_KINDS as readonly string[]).includes(sp.type ?? "") ? (sp.type as WorkRequestKindV) : null;
  const presetDate = sp.date && YMD.test(sp.date) ? sp.date : null;
  const presetStatus = (WORK_REQUEST_STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as WorkRequestStatusV)
    : null;
  const month = sp.month && KY.test(sp.month) ? sp.month : null;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Đơn của tôi"
        subtitle="Đổi ca, nghỉ phép, chỉnh công (quên quét), tăng ca, đi muộn/về sớm, công tác."
      />
      <MeNav active="cua-toi" month={month} />
      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Đơn gửi tới Quản lý của cơ sở chịu công ngày đó (người Hội sở phải tự chọn cơ sở nhận đơn). Duyệt xong thì
          lịch ca và công ngày đổi ngay, và bạn nhận thông báo.
        </p>
        <p className="mt-2">
          Nộp trước hạn báo trước; nộp muộn vẫn gửi được nhưng đơn mang cờ <em>Nộp muộn</em>. Đơn đang
          <b> Chờ duyệt</b> mà cột &ldquo;Phản hồi&rdquo; báo <em>không áp được</em> nghĩa là lần duyệt trước hệ
          thống không ghi được thay đổi (ca đã đổi, kỳ công đã chốt…) nên đơn tự quay lại hàng chờ — báo Quản lý
          duyệt lại. Không bao giờ có đơn &ldquo;đã duyệt&rdquo; mà lịch chưa đổi.
        </p>
      </PageHelp>
      <MyRequests
        rows={rows}
        options={options}
        presetKind={preset}
        presetDate={presetDate}
        presetStatus={presetStatus}
      />
    </div>
  );
}
