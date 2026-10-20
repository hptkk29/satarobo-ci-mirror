import Link from "next/link";
import {
  Wallet,
  CalendarClock,
  RefreshCw,
  Bell,
  ClipboardList,
  BookOpen,
  GraduationCap,
  Images,
  Star,
} from "lucide-react";
import { requireActiveStudent } from "@/lib/portal/session";
import { getStudentClasses } from "@/lib/portal/learning";
import {
  getParentDashboard,
  getStudentDashboard,
  getParentChildrenOverview,
} from "@/lib/portal/dashboard";
import { getParentNotifications } from "@/lib/portal/notifications";
import { isPortalV2Enabled } from "@/lib/flags";
import { ParentDashboardV2 } from "@/components/portal/parent-dashboard";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + "đ";
}

export default async function PortalHome() {
  const { ctx, studentId } = await requireActiveStudent();

  // Portal v2 (merge SataUI) — bật qua flag PORTAL_V2_ENABLED, chạy SONG SONG
  // dashboard cũ. Dữ liệu thật theo từng con (ownership: parentUserId từ session).
  if (isPortalV2Enabled()) {
    const [overview, notifications] = await Promise.all([
      getParentChildrenOverview(ctx.parentUserId),
      getParentNotifications(ctx.parentUserId),
    ]);
    return (
      <ParentDashboardV2
        parentName={ctx.parentName}
        children={overview}
        notifications={notifications}
      />
    );
  }

  // PH-level data theo parentUserId (gộp các con); HV-level theo studentId con
  // đang chọn — không trộn (regression R4).
  const [parent, student, classes] = await Promise.all([
    getParentDashboard(ctx.parentUserId),
    getStudentDashboard(studentId),
    getStudentClasses(studentId),
  ]);

  const { attendance } = student;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">
          Xin chào, {ctx.parentName}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Đang xem học viên:{" "}
          <span className="font-semibold text-orange-700">
            {ctx.activeStudent?.name}
          </span>
        </p>
      </div>

      {/* ── Dashboard PHỤ HUYNH — 3 card: công nợ, học bù mở, thông báo ── */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
          Tổng quan phụ huynh
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card
            icon={<Wallet className="h-4 w-4" />}
            label="Công nợ còn lại"
            value={
              parent.totalDebt > 0 ? vnd(parent.totalDebt) : "Đã thanh toán đủ"
            }
            tone={parent.totalDebt > 0 ? "amber" : "green"}
            href="/portal/hoc-phi"
            sub={
              parent.nearestDueDate
                ? `Đến hạn: ${formatDateVN(parent.nearestDueDate)}`
                : undefined
            }
            subIcon={
              parent.nearestDueDate ? (
                <CalendarClock className="h-3 w-3" />
              ) : undefined
            }
          />
          <Card
            icon={<RefreshCw className="h-4 w-4" />}
            label="Yêu cầu học bù đang mở"
            value={String(parent.openMakeupRequests)}
            tone={parent.openMakeupRequests > 0 ? "violet" : "neutral"}
            href="/portal/yeu-cau"
          />
          <Card
            icon={<Bell className="h-4 w-4" />}
            label="Thông báo mới (7 ngày)"
            value={String(parent.notificationCount)}
            tone={parent.notificationCount > 0 ? "orange" : "neutral"}
            href="/portal/thong-bao"
          />
        </div>
      </section>

      {/* ── Dashboard HỌC VIÊN — 5 chỉ số điểm danh + bài tập ── */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
          Tiến độ học tập
        </h2>
        <Link
          href="/portal/lich-hoc"
          className="block rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm"
        >
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(
              [
                ["Tổng buổi", attendance.total, "text-neutral-900"],
                ["Đã học", attendance.attended, "text-green-700"],
                ["Vắng", attendance.absent, "text-red-600"],
                ["Chờ học bù", attendance.needMakeup, "text-amber-700"],
                ["Đã học bù", attendance.madeUp, "text-[#7C3AED]"],
              ] as [string, number, string][]
            ).map(([label, value, tone]) => (
              <div
                key={label}
                className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-center"
              >
                <dd className={`text-lg font-bold ${tone}`}>{value}</dd>
                <dt className="text-[11px] text-neutral-500">{label}</dt>
              </div>
            ))}
          </dl>
        </Link>

        <Link
          href="/portal/bai-tap"
          className="mt-3 flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <ClipboardList className="h-4 w-4 text-neutral-500" /> Bài tập về
            nhà
          </span>
          <span className="text-sm font-bold text-neutral-900">
            {student.homeworkDone}/{student.homeworkTotal}
          </span>
        </Link>
      </section>

      {/* ── Lối tắt: học bạ / ảnh / đánh giá ── */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
          Truy cập nhanh
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <QuickLink
            href="/portal/hoc-ba"
            icon={<GraduationCap className="h-5 w-5" />}
            label="Học bạ"
          />
          <QuickLink
            href="/portal/hinh-anh"
            icon={<Images className="h-5 w-5" />}
            label="Hình ảnh"
          />
          <QuickLink
            href="/portal/danh-gia"
            icon={<Star className="h-5 w-5" />}
            label="Đánh giá"
          />
        </div>
      </section>

      {/* ── Lớp đang học ── */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
          <BookOpen className="h-4 w-4 text-[#7C3AED]" /> Lớp đang học
        </h2>
        {classes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
            Học viên chưa được xếp lớp.
          </p>
        ) : (
          <ul className="space-y-2">
            {classes.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-neutral-200 bg-white p-4"
              >
                <p className="font-semibold text-neutral-900">{c.name}</p>
                <p className="text-xs text-neutral-600">
                  {c.classCode ? `${c.classCode} · ` : ""}
                  {c.courseName}
                  {c.centerName ? ` · ${c.centerName}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const TONE: Record<string, string> = {
  amber: "text-amber-700",
  green: "text-green-700",
  violet: "text-[#7C3AED]",
  orange: "text-orange-700",
  neutral: "text-neutral-900",
};

function Card({
  icon,
  label,
  value,
  tone,
  href,
  sub,
  subIcon,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: keyof typeof TONE;
  href: string;
  sub?: string;
  subIcon?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-center gap-1.5 text-neutral-500">
        {icon}
        <span className="text-xs text-neutral-600">{label}</span>
      </div>
      <p className={`mt-1 text-lg font-bold ${TONE[tone]}`}>{value}</p>
      {sub && (
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-500">
          {subIcon}
          {sub}
        </p>
      )}
    </Link>
  );
}

function QuickLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-neutral-200 bg-white p-4 text-neutral-600 transition-shadow hover:shadow-sm"
    >
      <span className="text-orange-500">{icon}</span>
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}
