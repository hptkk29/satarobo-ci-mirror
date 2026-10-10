import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import type {
  Prisma,
  ParentRequestStatus,
  ParentRequestType,
} from "@prisma/client";
import {
  REQUEST_TYPE_LABEL,
  REQUEST_STATUS_LABEL,
} from "@/lib/portal/request-labels";
import { classifyAbsenceUrgency } from "@/lib/students/absence";
import { getSetting } from "@/lib/settings/service";
import { RequestRow } from "./_components/request-row";
import { PageHelp } from "@/components/admin/ui/page-help";

export const metadata = { title: "Yêu cầu phụ huynh | Admin" };
export const dynamic = "force-dynamic";

// Lọc theo TRẠNG THÁI — dùng giá trị enum thật, không thêm enum mới.
const STATUS_FILTERS: {
  key: string;
  label: string;
  status?: ParentRequestStatus;
}[] = [
  // Nhãn tab lấy từ REQUEST_STATUS_LABEL (nguồn chung với thẻ) → không lệch
  // "Đã duyệt" (thẻ) vs "Đã xử lý" (tab) như trước.
  { key: "all", label: "Tất cả" },
  { key: "PENDING", label: REQUEST_STATUS_LABEL.PENDING, status: "PENDING" },
  { key: "APPROVED", label: REQUEST_STATUS_LABEL.APPROVED, status: "APPROVED" },
  { key: "REJECTED", label: REQUEST_STATUS_LABEL.REJECTED, status: "REJECTED" },
  {
    key: "CANCELLED",
    label: REQUEST_STATUS_LABEL.CANCELLED,
    status: "CANCELLED",
  },
];

// Lọc theo LOẠI — mỗi tab là 1 giá trị enum ParentRequestType thật.
const TYPE_FILTERS: { key: string; label: string; type?: ParentRequestType }[] =
  [
    { key: "all", label: "Tất cả" },
    { key: "ABSENCE", label: REQUEST_TYPE_LABEL.ABSENCE, type: "ABSENCE" },
    { key: "MAKEUP", label: REQUEST_TYPE_LABEL.MAKEUP, type: "MAKEUP" },
    {
      key: "TRANSFER_CLASS",
      label: REQUEST_TYPE_LABEL.TRANSFER_CLASS,
      type: "TRANSFER_CLASS",
    },
    {
      key: "TRANSFER_CENTER",
      label: REQUEST_TYPE_LABEL.TRANSFER_CENTER,
      type: "TRANSFER_CENTER",
    },
    { key: "RESERVE", label: REQUEST_TYPE_LABEL.RESERVE, type: "RESERVE" },
    {
      key: "CONSENT_CHANGE",
      label: REQUEST_TYPE_LABEL.CONSENT_CHANGE,
      type: "CONSENT_CHANGE",
    },
    { key: "OTHER", label: REQUEST_TYPE_LABEL.OTHER, type: "OTHER" },
  ];

interface Props {
  searchParams: Promise<{ type?: string; status?: string }>;
}

function buildHref(type: string, status: string): string {
  const sp = new URLSearchParams();
  if (type !== "all") sp.set("type", type);
  if (status !== "all") sp.set("status", status);
  const qs = sp.toString();
  return qs ? `/parent-requests?${qs}` : "/parent-requests";
}

export default async function ParentRequestsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("parent-requests:manage")))
    redirect("/dashboard");

  const { type, status } = await searchParams;
  const activeType =
    TYPE_FILTERS.find((f) => f.key === type) ?? TYPE_FILTERS[0];
  const activeStatus =
    STATUS_FILTERS.find((f) => f.key === status) ?? STATUS_FILTERS[0];

  const where: Prisma.ParentRequestWhereInput = {
    ...(activeType.type ? { type: activeType.type } : {}),
    ...(activeStatus.status ? { status: activeStatus.status } : {}),
  };

  // Cách ly cơ sở: ParentRequest KHÔNG nằm trong SCOPED_MODELS (không có centerId trực
  // tiếp) → phụ thuộc cơ sở qua student.centerId. Scope thủ công bằng tầm nhìn cơ sở của
  // model Student (mẫu như /admin/enrollments scope qua class.centerId). SUPER_ADMIN/HO → ALL.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleStudentCenters = getModelVisibleCenterIds("Student", actor);
  if (visibleStudentCenters !== "ALL") {
    where.student = { centerId: { in: visibleStudentCenters } };
  }

  // ParentRequest ∉ SCOPED_MODELS → sdb pass-through; cách ly nằm ở where.student trên.
  const rows = await sdb.parentRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      type: true,
      status: true,
      content: true,
      preferredDate: true,
      sessionId: true,
      response: true,
      handledByName: true,
      parentUserId: true,
      createdAt: true,
      student: {
        select: {
          name: true,
          studentCode: true,
          enrollments: {
            where: { status: { in: ["CONFIRMED", "STUDYING", "ACTIVE"] } },
            select: { class: { select: { name: true } } },
            take: 1,
          },
        },
      },
    },
  });

  // Enrich báo vắng: ngày buổi (cho phân loại gấp/đúng hạn) + tên lớp từ session.
  const now = new Date();
  const urgentThresholdDays = await getSetting(
    "student.absenceUrgentThresholdDays",
  );
  const sessionIds = rows
    .map((r) => r.sessionId)
    .filter((x): x is string => !!x);
  // ClassSession ∈ SCOPED_MODELS → auto-scope theo tầm nhìn (buổi cùng cơ sở HV).
  const sessions = sessionIds.length
    ? await sdb.classSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, date: true, class: { select: { name: true } } },
      })
    : [];
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  // Tên phụ huynh (cột "Phụ huynh") — map parentUserId → User.name.
  const parentIds = Array.from(
    new Set(rows.map((r) => r.parentUserId).filter((x): x is string => !!x)),
  );
  const parents = parentIds.length
    ? await sdb.user.findMany({
        where: { id: { in: parentIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const parentMap = new Map(parents.map((p) => [p.id, p.name ?? p.email]));

  const items = rows.map((r) => {
    const sess = r.sessionId ? sessionMap.get(r.sessionId) : null;
    const sessionDate = sess?.date ?? r.preferredDate ?? null;
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      content: r.content,
      preferredDate: r.preferredDate?.toISOString() ?? null,
      response: r.response,
      createdAt: r.createdAt.toISOString(),
      parentName: r.parentUserId
        ? (parentMap.get(r.parentUserId) ?? null)
        : null,
      studentName: r.student.name,
      studentCode: r.student.studentCode,
      className:
        sess?.class.name ?? r.student.enrollments[0]?.class.name ?? null,
      handledByName: r.handledByName,
      // Báo vắng: thông tin để giữ luồng resolveAbsence.
      hasSession: !!r.sessionId,
      sessionDate: sessionDate?.toISOString() ?? null,
      urgency:
        r.type === "ABSENCE" && sessionDate
          ? classifyAbsenceUrgency(sessionDate, now, urgentThresholdDays)
          : null,
    };
  });

  return (
    <div className="max-w-4xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">
          Yêu cầu phụ huynh
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Yêu cầu phụ huynh gửi từ cổng thông tin
        </p>
      </div>

      <PageHelp>
        <p>
          Báo vắng · học bù · chuyển lớp/cơ sở · bảo lưu — lọc theo loại &amp;
          trạng thái rồi xử lý nghiệp vụ.
        </p>
      </PageHelp>

      {/* Lọc theo LOẠI yêu cầu */}
      <div className="mb-2 flex flex-wrap gap-2">
        {TYPE_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={buildHref(f.key, activeStatus.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${activeType.key === f.key ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Lọc theo TRẠNG THÁI */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={buildHref(activeType.key, f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${activeStatus.key === f.key ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Không có yêu cầu nào.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <RequestRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
