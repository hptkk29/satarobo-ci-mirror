import Link from "next/link";
import { Plus, CalendarDays } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { type Prisma } from "@prisma/client";
import { SessionListRow } from "./_components/session-list-row";
import { SessionFilters } from "./_components/session-filters";
import { formatDateVN } from "@/lib/format/date";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NutXuat } from "@/components/admin/nut-xuat";

export const dynamic = "force-dynamic";

interface SearchParams {
  searchParams: Promise<{ scope?: string; classId?: string }>;
}

export default async function SessionsAdminPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const actor = await resolveActor(session.user.id);
  // Trước đây gọi thẳng can() v2 (bỏ qua shadow-compare + cờ RBAC_V2_ENABLED) — sửa
  // lại đi qua checkPermission() để hành vi khi flag OFF khớp v1 (matrix cũ).
  if (!(await checkPermission("sessions:view"))) {
    redirect("/dashboard");
  }

  const isManager = actor.isSuperAdmin || actor.orgRoles.some((r) => ["CENTER_MANAGER", "SALES_CSM", "ACCOUNTANT", "HR"].includes(r.roleCode));

  // Cách ly cơ sở (FL3-02): ClassSession giờ ∈ SCOPED_MODELS → scopedDb tự inject
  // `ClassSession.centerId IN visibleCenters`. KHÔNG còn scope tay qua class.centerId.
  // Vẫn giữ ràng buộc teacher (GV chỉ thấy buổi của lớp mình dạy/trợ giảng) — đây là
  // narrowing theo phân công, KHÔNG phải cách ly cơ sở.
  const sp = await searchParams;
  const scope = sp.scope === "past" ? "past" : sp.scope === "all" ? "all" : "upcoming";
  const classFilter = sp.classId?.trim();

  const now = new Date();

  // QA 21/07 — LUÔN loại buổi của lớp đã xoá mềm khỏi listing chung (trước đây
  // lớp biến khỏi /classes nhưng buổi vẫn hiện ở /sessions?scope=all).
  const classWhere: Prisma.ClassWhereInput = { deletedAt: null };
  if (!isManager) {
    classWhere.OR = [
      { teacherId: session.user.id },
      { assistantId: session.user.id },
    ];
  }

  const where: Prisma.ClassSessionWhereInput = {
    ...(scope === "upcoming" ? { date: { gte: now } } : {}),
    ...(scope === "past" ? { date: { lt: now } } : {}),
    ...(classFilter ? { classId: classFilter } : {}),
    class: classWhere,
  };

  // QA 20/07 Vấn đề C — URL hiện tại (kèm bộ lọc) để form Sửa quay về đúng ngữ cảnh.
  const returnParams = new URLSearchParams();
  if (scope !== "upcoming") returnParams.set("scope", scope);
  if (classFilter) returnParams.set("classId", classFilter);
  const returnTo = returnParams.toString()
    ? `/sessions?${returnParams.toString()}`
    : "/sessions";

  const sdb = scopedDb(actor);
  const [sessions, classes, holidays] = await Promise.all([
    sdb.classSession.findMany({
      where,
      orderBy: { date: scope === "past" ? "desc" : "asc" },
      take: 200,
      select: {
        id: true,
        date: true,
        topic: true,
        classId: true,
        class: { select: { name: true } },
        _count: { select: { attendances: true } },
      },
    }),
    sdb.class.findMany({
      where: {
        deletedAt: null,
        ...(!isManager ? {
          OR: [
            { teacherId: session.user.id },
            { assistantId: session.user.id },
          ],
        } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 200,
    }),
    // P1-f — ngày nghỉ sắp tới (90 ngày) để hiển thị trên lịch buổi học.
    sdb.holiday.findMany({
      where: { date: { gte: now, lte: new Date(now.getTime() + 90 * 86400000) } },
      orderBy: { date: "asc" },
      take: 20,
      select: { id: true, name: true, date: true, endDate: true, center: { select: { name: true } } },
    }),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-black text-foreground">
            <CalendarDays className="h-7 w-7 text-primary" />
            Buổi học
          </h1>
          <p className="mt-1 text-muted-foreground">
            Đang xem:{" "}
            <span className="font-semibold text-foreground">
              {scope === "upcoming" ? "Sắp tới" : scope === "past" ? "Đã diễn ra" : "Tất cả"}
            </span>{" "}
            · {sessions.length} buổi
            {sessions.length >= 200 ? "+ (hiển thị 200 mới nhất)" : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
        <NutXuat ma="buoi-hoc" />
        <Link
          href="/sessions/new"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-white shadow-md hover:bg-primary-dark"
        >
          <Plus className="h-5 w-5" />
          Thêm buổi học
        </Link>
        </div>
      </div>

      <SessionFilters scope={scope} classId={classFilter ?? ""} classes={classes} />

      {holidays.length > 0 && (
        <div className="mb-4 rounded-xl border border-state-warning-soft bg-state-warning-soft p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-state-warning-ink">
            🎌 Ngày nghỉ sắp tới (buổi trùng đã được tự dời)
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-state-warning-ink">
            {holidays.map((h) => (
              <span key={h.id} className="rounded-full bg-card px-2.5 py-1">
                {h.name}: {formatDateVN(h.date)}
                {h.endDate ? `–${formatDateVN(h.endDate)}` : ""}
                {h.center?.name ? ` · ${h.center.name}` : " · Toàn hệ thống"}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang>
          <table className="w-full">
            <thead className="border-b border-border bg-muted text-left">
              <tr>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">Thời gian</th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">Lớp / Chủ đề</th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground">Điểm danh</th>
                <th className="p-4 text-right text-xs font-bold uppercase tracking-wider text-foreground">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-12 text-center text-muted-foreground">
                    Chưa có buổi học nào khớp bộ lọc.{" "}
                    <Link href="/sessions/new" className="text-primary hover:underline">
                      Tạo buổi học mới →
                    </Link>
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <SessionListRow
                    key={s.id}
                    returnTo={returnTo}
                    session={{
                      id: s.id,
                      date: s.date,
                      topic: s.topic,
                      className: s.class.name,
                      classId: s.classId,
                      attendanceCount: s._count.attendances,
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
