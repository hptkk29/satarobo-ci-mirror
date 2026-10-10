import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { docConChuyenDoiDuoc } from "@/lib/crm/con-chua-chuyen-doi-db";
import { ChevronLeft, MessageSquareText } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import type { LeadStatus } from "@prisma/client";
import { LeadActivityPanel, LichSuLead } from "./_components/lead-activity-panel";
import { LeadStatusSelect } from "../_components/status-select";
import { ReassignButton } from "./_components/reassign-button";
import { AssignSelect } from "./_components/assign-select";
import { TransferDialog } from "./_components/transfer-dialog";
import { LeadChildrenManager } from "../_components/lead-children";
import { TrialEnrollWidget } from "./_components/trial-enroll-widget";
import { DaThanhHocVien } from "./_components/hoc-vien-tu-lead";
import { laLopTheoKhung } from "@/lib/trial/nghia-null";
import { LeadPaymentCard } from "../_components/lead-payment-card";
import { getLeadPaymentSummary } from "@/lib/payments/summary";
// 30/08 — SĐT HIỂN THỊ dạng `0987654321`, không phải `84987654321`. Dạng `84…` là
// quy ước LƯU TRỮ (QĐ-4, để so khớp và gửi ZNS); người Việt đọc/đọc-cho-nhau bằng số
// 0 đầu, và sale hay chép từ màn hình ra để gọi. `formatPhoneVN` trả nguyên chuỗi khi
// không chuẩn hoá được, nên giá trị đã bị che PII vẫn hiện đúng bản che.
import { formatPhoneVN, telHrefVN } from "@/lib/phone";
import { maskFreeText, maskPersonName, maskLeadPiiFields } from "@/lib/lead/pii";
import { canSeeLead, leadSharingEnabled } from "@/lib/lead/sharing";
import { canViewLeadPii } from "@/lib/auth/check-permission";
import { ShareToggle } from "./_components/share-toggle";
import { formatDateTimeVNZoned } from "@/lib/format/date";
import { boDongMaNguoiNhap, hasSystemLines, splitLeadNote } from "@/lib/lead/note-view";
import {
  canViewLeadAuditHistory,
  getLeadAuditHistory,
  getLeadStatusHistory,
  maskLeadAuditValues,
} from "@/lib/lead/audit-history";
import { isZalocrmEnabled } from "@/lib/flags";
import { duongDanNhanZalo, orgCodeCuaCoSo } from "@/lib/integrations/zalocrm/compose-url";
import { getSetting } from "@/lib/settings/service";

export const metadata = { title: "Chi tiết Lead | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canViewAll = (await checkPermission("leads:view-all"));
  const canViewOwn = (await checkPermission("leads:view-own"));
  if (!canViewAll && !canViewOwn) redirect("/dashboard");

  // Cách ly cơ sở: Lead ∈ SCOPED_MODELS → sdb.lead.findFirst tự inject `centerId IN
  // visible` (CENTER_MANAGER@CS1 không xem lead CS2 → notFound). SUPER_ADMIN/HO bypass.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const { id } = await params;
  const lead = await sdb.lead.findFirst({
    where: { id, deletedAt: null },
    include: {
      // `code` để suy ra `?org=` cho nút "Nhắn Zalo" (xem chỗ dựng `urlNhanZalo`).
      center: { select: { name: true, code: true } },
      course: { select: { name: true } },
      assignedTo: { select: { id: true, name: true } },
      // BGĐ 31/07 — người giới thiệu (affiliate) ra lead này.
      affiliate: { select: { code: true, name: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 100 },
      // LD6 — KHÔNG fetch `tasks` nữa (UI "Việc cần làm" đã gỡ; model LeadTask giữ nguyên).
      children: {
        orderBy: { createdAt: "asc" },
        include: {
          // FL-R2 (item 6/TR-4) — lịch sử "đã từng học thử" (giữ kể cả khi lead quay lại).
          trialHistory: {
            orderBy: { lastAttendedAt: "desc" },
            include: { trialClass: { select: { name: true } } },
          },
          // LD3(a) — lớp trải nghiệm ĐANG học (ACTIVE) của con → banner "đang học thử lớp Y".
          trialEnrollments: {
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "desc" },
            take: 1,
            // 23/09 — thêm khung giờ: biết lớp THEO KHUNG hay lớp cũ thì banner mới nói
            // đúng nghĩa của `scheduledSessionId = NULL` (lib/trial/nghia-null.ts).
            include: {
              trialClass: { select: { id: true, name: true, theoKhung: true } },
            },
          },
        },
      },
      trialClasses: {
        orderBy: { scheduledAt: "desc" },
        include: {
          teacher: { select: { name: true } },
          feedback: { select: { id: true } },
        },
      },
    },
  });
  if (!lead) notFound();

  // Scope: SALES_CSM chỉ xem lead của mình. Cách ly cơ sở đã do scopedDb lo ở trên.
  //
  // ⚠️ Đợt E (22/08) — chủ dự án chốt LEAD ĐỘC QUYỀN TUYỆT ĐỐI (Q8), ĐẢO quyết
  // định BGĐ câu 10 ký 10/07: lead "dùng chung" KHÔNG còn mở cửa cho sale khác.
  // Quy tắc gom vào canSeeLead() để trang này và trang danh sách không trôi lệch.
  if (
    !canSeeLead({
      canViewAll,
      isOwner: lead.assignedToId === session.user.id,
      // 23/08 — người NHẬP phiếu cũng vào được phiếu của mình (Sale Hội sở).
      isCreator: !!lead.createdById && lead.createdById === session.user.id,
      isShared: lead.isSharedWithTeam,
      sharingEnabled: leadSharingEnabled(),
    })
  ) {
    redirect("/leads?view=kanban");
  }

  // #11 T1 Q2 — actor chỉ vào được NHỜ "dùng chung" → read-only về UX: ẩn nút
  // sửa/chuyển/convert/xếp học thử (server action đã chặn mutator qua
  // actorMayMutateLead); GIỮ khối ghi chú/hoạt động (Q2 cho phép ghi chú).
  const isSharedViewer = !canViewAll && lead.assignedToId !== session.user.id;

  // #11 T2 — mask PII ở SERVER trước khi render/truyền client (chặn leak qua RSC
  // payload, không chỉ che ở UI). Non-holder `leads:view-pii` (vd MARKETING) thấy
  // bản mask; canViewLeadPii qua checkPermission (v1+v2 theo cờ) từ sau flip #09.
  const canViewPii = await canViewLeadPii();
  const piiLead = maskLeadPiiFields(
    {
      parentName: lead.parentName,
      phone: lead.phone,
      email: lead.email,
      childName: lead.childName,
      note: lead.note,
    },
    canViewPii,
  );

  // 24/08 — ô "Ghi chú" trộn hai tác giả: chữ người nhập gõ + dòng máy ghi (mã
  // NV, cảnh báo chia lead). Sale chăm khách chỉ cần chữ của người; phần máy ghi
  // là chẩn đoán vận hành nên gác sau `leads:view-all` (Sale cơ sở KHÔNG có key
  // này — xem prisma/seed-roles.ts — nên đúng là thứ phân biệt cần tìm, và không
  // phải đẻ thêm permission key mới rồi seed lại 2 môi trường).
  // Tách trên chuỗi THÔ rồi mới mask, để phần người gõ vẫn được che đúng luật PII.
  // ⚠️ 05/09/2026 — MÃ NHÂN VIÊN PHẢI TRA THEO QUAN HỆ, KHÔNG ĐỌC TỪ `note`.
  // Dòng "Nhân viên nhập: SR.NV.02" trong `note` là ẢNH CHỤP lúc nhập phiếu: đổi mã
  // nhân viên thì mọi lead cũ vẫn in mã cũ mãi mãi (chủ dự án báo). `createdById`
  // (có từ 23/08) mới là danh tính thật — tra ra mã hiện hành thì đổi mã là mọi
  // phiếu cũ theo ngay, không cần đụng tới dữ liệu.
  //
  // Phiếu CŨ hoặc phiếu vào từ webhook có `createdById = null`: lúc đó dòng chữ là
  // dấu vết DUY NHẤT, nên GIỮ nguyên nó thay vì xoá trắng thông tin.
  const nguoiNhap = lead.createdById
    ? await sdb.user.findFirst({
        where: { id: lead.createdById },
        select: { name: true, employee: { select: { employeeCode: true } } },
      })
    : null;
  const maNguoiNhap = nguoiNhap?.employee?.employeeCode ?? null;
  const noteThoView = splitLeadNote(lead.note);
  // Bỏ dòng ảnh chụp CHỈ khi đã có nguồn sống để thay — không thì màn hình hiện hai
  // mã khác nhau của cùng một người.
  const noteView = maNguoiNhap ? boDongMaNguoiNhap(noteThoView) : noteThoView;
  const humanNote = canViewPii ? noteView.human : maskFreeText(noteView.human);

  // S2 — nút "Nhắn Zalo". Ba cổng gộp vào MỘT biến, để JSX không phải so vai:
  //  1. cờ `zalocrm`  2. quyền `zalocrm:use`  3. `canViewPii` (SĐT đi vào query string).
  // `duongDanNhanZalo` trả null khi SĐT rỗng/không hợp lệ ⇒ KHÔNG render nút.
  const duocMoZaloCrm = isZalocrmEnabled() && (await checkPermission("zalocrm:use"));
  // Mang CƠ SỞ CỦA CHÍNH PHIẾU NÀY, nếu không màn nhúng mở cơ sở đầu bảng chữ cái.
  // Chỉ chạm DB khi nút thật sự sắp hiện.
  const orgCodesZalo = canViewPii && duocMoZaloCrm ? await getSetting("zalocrm.orgCodes") : null;
  const urlNhanZalo =
    canViewPii && duocMoZaloCrm
      ? duongDanNhanZalo(lead.phone, lead.id, orgCodeCuaCoSo(lead.center?.code, orgCodesZalo))
      : null;

  const canAssign = (await checkPermission("leads:assign", { centerId: lead.centerId }));
  const canCloseDeal =
    (await checkPermission("students:create", { centerId: lead.centerId })) &&
    (await checkPermission("enrollments:create", { centerId: lead.centerId }));
  const status = lead.status as LeadStatus;

  // PHẦN 2 — danh sách sale để gán tay (ưu tiên sale cùng cơ sở lead).
  // User/Center/Course/Product không scoped (exempt/global) → sdb pass-through.
  const assignableSales = canAssign
    ? await sdb.user.findMany({
        where: {
          roles: { has: "SALES_CSM" },
          isActive: true,
          deletedAt: null,
          ...(lead.centerId ? { centerId: lead.centerId } : {}),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  // PHẦN 3 — chuyển lead: sale tự chuyển (cần leads:edit). Mọi cơ sở + mọi sale.
  const canTransfer = (await checkPermission("leads:edit", { centerId: lead.centerId }));
  // 27/08 — quyền RIÊNG, chỉ Sale đẩy được lead trên phễu. KHÁC `leads:edit`: Quản lý
  // cơ sở / Marketing vẫn sửa hồ sơ + ghi chú, chỉ không đổi bậc.
  const canChangeStatus = await checkPermission("leads:change-status", {
    centerId: lead.centerId,
  });
  const [transferCenters, transferSales] = canTransfer
    ? await Promise.all([
        sdb.center.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" }, select: { id: true, name: true } }),
        sdb.user.findMany({
          where: { roles: { has: "SALES_CSM" }, isActive: true, deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true, centerId: true },
        }),
      ])
    : [[], []];
  // GĐ5 — điều kiện "chưa chốt" nay đọc `convertedAt`, KHÔNG đọc status. Bản cũ dùng
  // `status !== "ENROLLED"` vì ENROLLED là bậc riêng sau REGISTERED; enum mới gộp hai
  // bậc đó thành DA_DANG_KY, nên nếu dịch thẳng thành `status !== "DA_DANG_KY"` thì
  // lead vừa nộp tiền (trước đây là REGISTERED) sẽ mất luôn nút Chuyển đổi — tức là
  // chặn đúng bước tiếp theo của quy trình. `convertedAt` do chính lượt convert ghi nên
  // là mốc "đã chốt" chính xác, khớp ghi chú enum trong schema.
  // 27/09/2026 — lead ĐÃ chuyển đổi vẫn chốt được bé CHƯA thành học viên (bé thứ hai của
  // gia đình). Cùng một phép đọc với server (`docConChuyenDoiDuoc`) để nút không hứa suông.
  const conChotThem = lead.convertedAt
    ? await docConChuyenDoiDuoc(sdb, lead.id, lead.convertedAt)
    : [];
  const dealClosable =
    canCloseDeal && status !== "DA_MAT" && (lead.convertedAt === null || conChotThem.length > 0);

  // E2-LEAD (item 2) — tóm tắt thanh toán (đã nộp / tổng phải thu / còn thiếu).
  const paymentSummary = await getLeadPaymentSummary(sdb, lead.id);

  // R7-01 — options cho khối quản lý con (khoá quan tâm / cơ sở quan tâm).
  // 30/08 — bỏ truy vấn `product` (chỉ phục vụ ô "Loại đơn dự kiến" đã gỡ): một
  // vòng DB mỗi lượt mở lead, cho một danh sách không ai còn nhìn.
  const [childCenters, childCourses] = await Promise.all([
    sdb.center.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true },
    }),
    sdb.course.findMany({
      where: { isActive: true, isTeachable: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, code: true },
    }),
  ]);
  // Lead ĐÃ MẤT (hoặc không có quyền sửa / chỉ xem nhờ "dùng chung") → con read-only.
  const childrenReadOnly = !canTransfer || status === "DA_MAT" || isSharedViewer;

  // R7-02 — lớp trải nghiệm đang mở (cùng cơ sở lead) để xếp con vào.
  const canTrialManage = (await checkPermission("trials:manage", { centerId: lead.centerId }));
  // GAP-5: dùng scopedDb (TrialClassV2 là SCOPED_MODEL) — tránh lộ lớp toàn hệ thống
  // khi lead.centerId null. Cách ly cơ sở theo visibleCenterIds của actor.
  const openTrialClasses = canTrialManage
    ? await sdb.trialClassV2.findMany({
        where: {
          status: "OPEN",
          ...(lead.centerId ? { centerId: lead.centerId } : {}),
        },
        orderBy: { startDate: "asc" },
        take: 50,
        select: {
          id: true,
          name: true,
          code: true,
          capacity: true,
          // 23/09 — lớp theo khung thì phải chọn CASE khi xếp (xem widget).
          theoKhung: true,
          enrollments: { where: { status: "ACTIVE" }, select: { id: true } },
          // LD3(b) — buổi chưa diễn ra để chọn ngày/giờ khi xếp con.
          sessions: {
            where: { status: "SCHEDULED" },
            orderBy: { seq: "asc" },
            select: { id: true, seq: true, date: true, startTime: true, endTime: true },
          },
        },
      })
    : [];

  // LD3 (display) — buổi đã chọn (scheduledSessionId) là scalar, không có relation
  // Prisma → resolve thủ công ra ngày/giờ để hiện trong banner "đang học thử".
  // TrialClassSession không scoped; id đến từ lead ĐÃ qua scope ở trên → an toàn.
  const scheduledSessionIds = lead.children
    .map((c) => c.trialEnrollments[0]?.scheduledSessionId)
    .filter((v): v is string => Boolean(v));
  const scheduledSessions = scheduledSessionIds.length
    ? await sdb.trialClassSession.findMany({
        where: { id: { in: scheduledSessionIds } },
        // 23/09 — cần `status`: case ĐÃ HUỶ không được in như một lịch hẹn còn hiệu lực.
        select: { id: true, seq: true, date: true, startTime: true, endTime: true, status: true },
      })
    : [];
  const sessionById = new Map(scheduledSessions.map((s) => [s.id, s]));

  // V-6 · G-02 — vết sửa 3 ô định danh (Tên PH · SĐT PH · Tên HS) phải ĐỌC ĐƯỢC
  // bởi người có thẩm quyền, chứ không nằm im sau quyền `audit-logs:view`.
  // Màn HẸP: `getLeadAuditHistory` lọc CỨNG entityType "Lead" + đúng lead đang mở,
  // không nhận bộ lọc nào từ URL. Cách ly đã xong ở trên (scopedDb + canSeeLead).
  const canViewAudit = await checkPermission("audit-logs:view");
  const showAuditHistory = canViewLeadAuditHistory({
    canViewAllLeads: canViewAll,
    canViewAuditLogs: canViewAudit,
  });
  const auditRows = showAuditHistory ? await getLeadAuditHistory(sdb, lead.id) : [];
  // C-07 — "Mốc trạng thái" đọc truy vấn RIÊNG chứ không lọc lại `auditRows`: lead
  // bị sửa nhiều thì 50 dòng gần nhất toàn lượt sửa hồ sơ, mốc phễu rơi hết ra ngoài.
  const statusRows = showAuditHistory ? await getLeadStatusHistory(sdb, lead.id) : [];

  return (
    // `max-w-6xl` (1152px) là nếp chung của các trang admin, giữ nguyên tới 2xl.
    // Nới thêm ở màn ≥1536px: trên monitor 1920 thì bản cũ bỏ trống ~40% bề ngang
    // trong khi cột phải chỉ được 314px — mà đây là màn người trực lead mở cả ngày.
    // Không nới vô hạn: quá rộng thì dòng chữ dài quá tầm đọc và mắt phải quét ngang.
    <div className="max-w-6xl p-6 2xl:max-w-[1400px]">
      <Link
        href="/leads?view=table"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          {/* 30/08 — GỠ nhãn trạng thái ở tiêu đề. Ô ĐỔI trạng thái nay đứng ngay
              bên phải cùng hàng; để thêm một nhãn chỉ-đọc nữa là hai chỗ nói cùng
              một điều, và lúc đổi thì hai chỗ đó lệch nhau trong khoảnh khắc. */}
          <h1 className="text-2xl font-bold text-foreground">{piiLead.parentName}</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            {/* #11 T2 — non-holder: hiện SĐT mask + BỎ link tel: (href sẽ lộ số thật) */}
            {canViewPii ? (
              <a href={telHrefVN(lead.phone)} className="font-medium text-primary">
                {formatPhoneVN(piiLead.phone)}
              </a>
            ) : (
              <span className="font-medium text-primary">{formatPhoneVN(piiLead.phone)}</span>
            )}
            {/* S2 — chỉ điều hướng nên <Link> thuần. `urlNhanZalo` đã gộp sẵn cả ba
                cổng lẫn phép chuẩn hoá SĐT — ở đây KHÔNG so vai (ESLint no-inline-authz). */}
            {urlNhanZalo && (
              <Link
                href={urlNhanZalo}
                className="ml-2 inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                title="Mở Zalo CRM và soạn tin cho số này"
              >
                <MessageSquareText className="h-3.5 w-3.5" /> Nhắn Zalo
              </Link>
            )}
            {piiLead.email && <span> · {piiLead.email}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* #11 T1 — bật/tắt "dùng chung": chỉ OWNER hoặc QL cơ sở (leads:assign);
              server action tự guard lại (đây là gate hiển thị).
              Đợt E — chính sách tắt thì ẩn hẳn nút; action cũng từ chối. */}
          {leadSharingEnabled() &&
            (lead.assignedToId === session.user.id || canAssign) && (
            <ShareToggle
              leadId={lead.id}
              isShared={lead.isSharedWithTeam}
              sharedAt={lead.sharedAt ? lead.sharedAt.toISOString() : null}
            />
          )}
          {/* 30/08 — ĐỔI TRẠNG THÁI chuyển về đây, cạnh nút Sửa (chủ dự án chốt).
              Bảng danh sách nay chỉ hiển thị nhãn: đổi bậc phễu là quyết định cần
              nhìn cả hồ sơ, làm được ngay trên một dòng bảng thì dễ bấm nhầm — mà
              bấm nhầm ở đây là lead rơi khỏi phễu.
              Shared-viewer chỉ xem + ghi chú nên không có ô này. */}
          {!isSharedViewer && (
            <LeadStatusSelect
              leadId={lead.id}
              status={lead.status}
              parentName={piiLead.parentName}
              canChangeStatus={canChangeStatus}
            />
          )}
          {/* #11 T1 Q2 — shared-viewer: ẩn nút sửa/chuyển (chỉ xem + ghi chú) */}
          {canTransfer && !isSharedViewer && (
            <Link
              href={`/leads/${lead.id}/edit`}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Sửa
            </Link>
          )}
          {canAssign && (
            <AssignSelect
              leadId={lead.id}
              sales={assignableSales}
              current={lead.assignedToId}
            />
          )}
          {canTransfer && !isSharedViewer && (
            <TransferDialog
              leadId={lead.id}
              centers={transferCenters}
              sales={transferSales}
              currentCenterId={lead.centerId}
              currentSaleId={lead.assignedToId}
            />
          )}
          {canAssign && <ReassignButton leadId={lead.id} />}
        </div>
      </div>

      {/* PHẦN 3 — note bàn giao nổi bật */}
      {lead.handoverNote && (
        <div className="mb-4 rounded-xl border border-state-warning bg-state-warning-soft p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-state-warning-ink">Bàn giao — đã tư vấn</p>
          {/* #11 T2 — nội dung tư vấn là PII (Q7) → non-holder thấy MASKED_TEXT */}
          <p className="mt-1 whitespace-pre-wrap text-sm text-state-warning-ink">
            {canViewPii ? lead.handoverNote : maskFreeText(lead.handoverNote)}
          </p>
        </div>
      )}

      {/* ─── BỐ CỤC 7:3 (chủ dự án chốt 30/08/2026) ────────────────────────────
          CỘT TRÁI (7) — hồ sơ: thông tin khách · con của phụ huynh · đơn & thanh toán.
          CỘT PHẢI (3) — ghi nhanh hoạt động + lịch sử tương tác.

          Vì sao tách vậy: cột trái là thứ ĐỌC (tra cứu, thỉnh thoảng sửa), cột phải là
          thứ GHI và người trực lead lặp lại nhiều lần nhất trong một cuộc gọi. Trước
          đợt này khối ghi nằm tận cuối trang, dưới bốn khối hồ sơ — mỗi lần muốn ghi
          một dòng phải cuộn qua toàn bộ hồ sơ.

          Vì sao 7:3 chứ không 1:1 (đảo bố cục chia đôi sáng 30/08): chia đôi làm mỗi ô
          trong bảng thông tin chỉ còn ~1/4 bề ngang trang, mà giá trị ở đây là tiếng
          Việt DÀI — "Trụ sở chính - Nguyễn Hữu Thọ" xuống 2–3 dòng, chiều cao các ô
          so le nhau và bảng mất nhịp. Cột phải thì ngược lại: nó là một ô nhập hẹp
          cộng một danh sách dòng ngắn, cho nó nửa màn hình là bỏ trống nửa màn hình.

          CHIA CỘT TỪ `xl` (1280px), KHÔNG PHẢI `lg`. Đo thật trên dev server: ở
          1024px khung nội dung chỉ còn 720px (thanh bên admin ăn ~300px), 3/10 của
          nó là **185px** — hẹp hơn cả một ô nhập, cột phải thành một dải không dùng
          được. Ở 1280px cột phải được 262px, ở 1440px được 310px. Dưới `xl` thì xếp
          dọc: một cột rộng vẫn hơn hai cột không cột nào dùng được.

          `items-start` để hai cột không bị kéo cao bằng nhau. */}
      <div className="mb-6 grid items-start gap-6 xl:grid-cols-10">
        {/* `@container`: các khối bên trong đo theo BỀ NGANG CỘT NÀY, không theo bề
            ngang cửa sổ. Bắt buộc ở admin — thanh bên chiếm ~300px nên `sm:`/`lg:`
            (vốn hỏi cửa sổ) luôn nói dối về chỗ thật sự còn lại. */}
        <div className="@container space-y-5 xl:col-span-7">
      {/* 25/09 — "Đã thành học viên" đứng ĐẦU cột: câu người dùng hỏi nhiều nhất khi mở một
          phiếu đã chốt là "em này giờ là học viên nào". Khối tự ẩn khi chưa có học viên. */}
      <DaThanhHocVien leadId={lead.id} childIds={lead.children.map((c) => c.id)} />
      {/* Khối THÔNG TIN KHÁCH HÀNG.
          · Có `h2` như mọi khối anh em ("Con của phụ huynh", "Thanh toán", "Ghi nhanh
            hoạt động"). Trước đợt này nó là khối DUY NHẤT không tên — mở trang ra là
            một mảng chữ trôi nổi, không nói mình là nhóm gì.
          · Hai cột CHỈ KHI CỘT NÀY đủ rộng (`@xl` = 576px), không phải khi cửa sổ đủ
            rộng. Bản trước dùng `sm:` (hỏi cửa sổ) nên ở 768px và 1024px vẫn bung 2
            cột trong khi cột chỉ rộng 416–463px: mỗi ô ~210px, "Trụ sở chính -
            Nguyễn Hữu Thọ" và "16:14 30/08/2026" đều xuống 2 dòng, các ô cao so le.
            Tiếng Việt dài là mặc định ở hệ này, không phải ca biên. */}
      <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Thông tin khách hàng</h2>
      <dl className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
        <Info label="Tên con" value={piiLead.childName} />
        <Info label="Tuổi" value={lead.childAge?.toString() ?? null} />
        {/* 24/08 — KHÔNG fallback sang `source` nữa. "Nguồn" (Facebook, walk-in…)
            và "Khoá quan tâm" là hai chuyện khác hẳn; lấy cái này lấp cái kia làm
            phiếu chưa hỏi khoá nào trông như đã chốt khoá. Trống cho tới khi Sale
            thêm con và chọn khoá — lúc đó `Lead.courseId` được đồng bộ từ lựa chọn
            ấy (xem syncLeadCourseFromChildren trong ../actions.ts). */}
        <Info label="Khoá quan tâm" value={lead.course?.name ?? null} />
        <Info label="Cơ sở" value={lead.center?.name ?? null} />
        <Info label="Nguồn" value={lead.source} />
        {/* Ô "Link Facebook" của biểu mẫu /nhap-khach-hang (22/08/2026). Với lead
            chạy quảng cáo FB đây thường là đường liên hệ DUY NHẤT lúc mới thu về.
            Là PII (chỉ đích danh một người) ⇒ che như SĐT/email khi không có
            quyền xem PII; `rel` đủ bộ vì đây là link ra ngoài do người dùng nhập. */}
        {lead.facebookUrl && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Link Facebook
            </dt>
            <dd className="mt-1 break-words text-sm text-foreground">
              {canViewPii ? (
                <a
                  href={lead.facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="font-medium text-primary hover:underline"
                >
                  Mở hồ sơ Facebook
                </a>
              ) : (
                "•••"
              )}
            </dd>
          </div>
        )}
        {/* BGĐ 31/07 — nguồn giới thiệu (affiliate) khi lead vào qua link ?ref= */}
        {lead.affiliate && (
          <Info
            label="Người giới thiệu"
            value={`${lead.affiliate.name} (${lead.affiliate.code})`}
          />
        )}
        <Info label="Sale phụ trách" value={lead.assignedTo?.name ?? "Chưa gán"} />
        {/* 30/08 — GỌI CÙNG TÊN với cột trên bảng danh sách ("Ngày nhận lead"). Hai
            màn gọi cùng một mốc bằng hai tên là cách nhanh nhất để người dùng tưởng
            đó là hai mốc khác nhau. */}
        <Info
          label="Ngày nhận lead"
          value={formatDateTimeVNZoned(lead.createdAt)}
        />
        {/* 29/08 — LẦN NHẬP GẦN NHẤT.
            Khách gọi lại / điền form lần nữa thì hệ thống KHÔNG đẻ lead mới (trùng
            SĐT), nó nâng mốc này và ghi một dòng nguồn DUPLICATE vào sổ chia lead.
            Không hiện ra thì phiếu vừa nóng lại trông y hệt phiếu nguội ba tháng.
            `inboundCount > 1` mới nói thêm số lần — bằng 1 thì con số đó là nhiễu. */}
        <Info
          label="Lần nhập gần nhất"
          value={
            lead.lastInboundAt
              ? `${formatDateTimeVNZoned(lead.lastInboundAt)}${
                  lead.inboundCount > 1 ? ` · ${lead.inboundCount} lần` : ""
                }`
              : "—"
          }
        />
        {/* Chữ tự do — cho trọn bề ngang, không nhốt vào nửa cột như các ô một dòng. */}
        <div className="@xl:col-span-2">
          <Info label="Ghi chú" value={humanNote} />
        </div>
        {/* Người nhập phiếu — mã tra theo QUAN HỆ nên đổi mã nhân viên là đổi theo. */}
        {canViewAll && nguoiNhap && (
          <Info
            label="Nhân viên nhập"
            value={[nguoiNhap.name, maNguoiNhap].filter(Boolean).join(" · ") || null}
          />
        )}
        {/* Dấu vết máy ghi — chỉ quản lý/quản trị (`leads:view-all`) đọc. */}
        {canViewAll && hasSystemLines(noteView) && (
          <div className="@xl:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nhật ký phiếu (chỉ quản trị)
            </dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {[...noteView.info, ...noteView.warnings].join("\n")}
            </dd>
          </div>
        )}
      </dl>
      </section>

      {/* R7-01 — danh sách con (LeadChild) + field phẳng cũ read-only */}
      <div>
        <LeadChildrenManager
          leadId={lead.id}
          childrenList={lead.children.map((c) => ({
            id: c.id,
            // #11 T2 — tên HS là PII (Q7): non-holder thấy bản mask; dob/trường
            // ẨN HẲN (truyền null — không xuống client qua RSC payload).
            fullName: canViewPii ? c.fullName : maskPersonName(c.fullName),
            dob: canViewPii && c.dob ? c.dob.toISOString() : null,
            ageYears: c.ageYears,
            gender: c.gender,
            schoolName: canViewPii ? c.schoolName : null,
            gradeLevel: c.gradeLevel,
            interestedCourseId: c.interestedCourseId,
            interestedCenterId: c.interestedCenterId,
            // 22/09 — hai trường G-01/G-06 mà `LeadChildrenManager` bản `test` ĐÒI (kiểu
            // `ChildView`). Trang này lấy lại bố cục cũ nhưng KHÔNG hạ cấp được component
            // đó: `edit/page.tsx` và `lead-form.tsx` cùng dùng nó và đang truyền hai trường
            // này — hạ cấp là vỡ lan sang hai màn kia.
            // Dữ liệu có sẵn: truy vấn children dùng `include` nên mọi cột vô hướng của
            // `LeadChild` đã về, không phải sửa câu truy vấn.
            classId: c.classId,
            contractValue: c.contractValue,
            note: canViewPii ? c.note : maskFreeText(c.note),
            trialStatus: c.trialStatus,
            trialHistory: c.trialHistory
              .filter((h) => h.attendedCount > 0)
              .map((h) => ({
              className: h.trialClass?.name ?? "(lớp đã xoá)",
              attendedCount: h.attendedCount,
              totalSessions: h.totalSessions,
              lastAttendedAt: h.lastAttendedAt ? h.lastAttendedAt.toISOString() : null,
              outcome: h.outcome,
            })),
          }))}
          centers={childCenters}
          courses={childCourses}
          readOnly={childrenReadOnly}
          legacyChildName={piiLead.childName}
          legacyChildAge={lead.childAge}
        />
      </div>

      {/* R7-02 — xếp con vào lớp trải nghiệm (shared-viewer: ẩn — chỉ xem + ghi chú) */}
      {canTrialManage && !isSharedViewer && lead.children.length > 0 && (
        <div>
          <TrialEnrollWidget
            children={lead.children.map((c) => {
              const enr = c.trialEnrollments[0];
              const sess = enr?.scheduledSessionId
                ? sessionById.get(enr.scheduledSessionId)
                : null;
              return {
                id: c.id,
                fullName: canViewPii ? c.fullName : maskPersonName(c.fullName),
                currentTrial: enr?.trialClass
                  ? {
                      // 28/08 — cần `classId` để ô chọn lớp mở ra đã hiện SẴN lớp con
                      // đang học, thay vì "— chọn lớp —" như thể chưa xếp gì.
                      classId: enr.trialClass.id,
                      className: enr.trialClass.name,
                      theoKhung: laLopTheoKhung(enr.trialClass),
                      session: sess
                        ? {
                            seq: sess.seq,
                            date: sess.date.toISOString(),
                            startTime: sess.startTime,
                            endTime: sess.endTime,
                            daHuy: sess.status === "CANCELLED",
                          }
                        : null,
                    }
                  : null,
              };
            })}
            openClasses={openTrialClasses.map((cl) => ({
              id: cl.id,
              name: cl.name,
              code: cl.code,
              capacity: cl.capacity,
              used: cl.enrollments.length,
              theoKhung: laLopTheoKhung(cl),
              sessions: cl.sessions.map((s) => ({
                id: s.id,
                seq: s.seq,
                date: s.date.toISOString(),
                startTime: s.startTime,
                endTime: s.endTime,
              })),
            }))}
            canOverride={(await checkPermission("trials:override-capacity", { centerId: lead.centerId }))}
          />
        </div>
      )}

      {/* E2-LEAD (item 2) — khối thanh toán: đã nộp / tổng phải thu / còn thiếu + điều kiện chốt. */}
      {(paymentSummary.hasOrder || dealClosable) && (
        <div>
          <LeadPaymentCard
            leadId={lead.id}
            summary={paymentSummary}
            canCreateOrder={await checkPermission("orders:create")}
          />
        </div>
      )}

      {/* Chốt deal — R7 (quyết định): Convert v2 là entry point DUY NHẤT
          (per-child, guard payment CONFIRMED, dedupe, consent). Bỏ flow gộp lead cũ. */}
      {dealClosable && !isSharedViewer && (
        <div>
          <Link
            href={`/leads/${lead.id}/convert`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-state-success-ink px-3 py-2 text-sm font-semibold text-white hover:bg-state-success-ink-hover"
          >
            {lead.convertedAt ? `Chuyển đổi bé còn lại (${conChotThem.length})` : "Chuyển đổi"}
          </Link>
        </div>
      )}

        </div>

        {/* CỘT PHẢI (3/10) — chỗ GHI. `xl:sticky` để khi cuộn đọc hồ sơ dài, ô ghi
            nhanh vẫn nằm trong tầm mắt: không dính thì mỗi lần ghi một dòng lại phải
            cuộn ngược lên đầu trang. Chỉ dính khi ĐÃ chia cột — lúc xếp dọc mà dính
            thì nó đè lên phần hồ sơ ngay dưới. */}
        <div className="@container xl:sticky xl:top-4 xl:col-span-3">
          <LeadActivityPanel leadId={lead.id} />
        </div>
      </div>

      {/* ─── LỊCH SỬ (GỘP — chủ dự án chốt 22/09/2026) ────────────────────────
          MỘT dòng thời gian duy nhất thay cho ba mục rời trước đây: "Lịch sử
          tương tác", "Mốc trạng thái" (C-07), "Lịch sử thay đổi" (V-6 · G-02).

          Đặt NGOÀI lưới 7:3 (full width) và KHÔNG nhét lại vào cột phải: vết sửa
          hồ sơ bày "cũ → mới" theo từng ô, cột 3/10 chỉ còn ~262px ở 1280 nên
          mỗi dòng xuống 3–4 hàng. Cột phải nay giữ đúng ô GHI (Ghi nhanh hoạt
          động), phần ĐỌC nằm dưới toàn bề ngang.

          Che PII làm Ở ĐÂY, trước khi dữ liệu xuống client — cả ba nguồn đi qua
          CÙNG một cổng `canViewPii` của trang. Component không tự đọc gì. */}
      <LichSuLead
        piiMasked={!canViewPii}
        showAudit={showAuditHistory}
        activities={lead.activities.map((a) => ({
          id: a.id,
          type: a.type,
          // #11 T2 — nội dung tư vấn là PII (Q7): non-holder → mask content + BỎ
          // metadata (JSON chứa notes/recipient... raw) NGAY Ở SERVER; component
          // gặp metadata null sẽ tự fallback render `content` (đã mask).
          content: canViewPii ? a.content : (maskFreeText(a.content) ?? ""),
          metadata: canViewPii ? a.metadata : null,
          actorName: a.actorName,
          createdAt: a.createdAt.toISOString(),
        }))}
        statusRows={statusRows.map((r) => ({
          ...r,
          oldValues: maskLeadAuditValues(r.oldValues, canViewPii),
          newValues: maskLeadAuditValues(r.newValues, canViewPii),
        }))}
        auditRows={auditRows.map((r) => ({
          ...r,
          oldValues: maskLeadAuditValues(r.oldValues, canViewPii),
          newValues: maskLeadAuditValues(r.newValues, canViewPii),
        }))}
      />

      {/* 28/08 — GỠ khối "Buổi học thử" (hệ V1, `TrialClass`).
          Tính năng lịch hẹn học thử đã bị gỡ khỏi hệ thống: không còn màn nào quản lý
          nó, nên in một danh sách chỉ-đọc ở đây là chỉ đường tới một cánh cửa đã khoá.
          Bảng `TrialClass` giữ trong DB theo nếp 2 pha, chưa drop. */}

    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}
