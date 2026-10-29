import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { xemRankOMotCoSo } from "@/lib/parttime/quyen-rank";
import { GiaoVienTabs } from "./_components/giao-vien-tabs";
import type { Prisma } from "@prisma/client";
import {
  EMPLOYMENT_LABEL,
  TEACHER_STATUS_LABEL,
  TEACHER_STATUS_COLOR,
} from "@/lib/teachers/labels";
import { computeTeachingLoad } from "@/lib/teachers/load";
import { getSetting } from "@/lib/settings/service";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { rankHomNayCua } from "@/lib/parttime/rank-don-gia-db";

export const metadata = { title: "Giáo viên | Admin" };

interface SearchParams {
  searchParams: Promise<{ q?: string }>;
}

export default async function TeachersPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // CENTER_MANAGER chỉ xem GV trong cơ sở mình.
  const centerScope =
    hasRole(session.user, "CENTER_MANAGER") ? session.user.centerId : null;
  if (
    !(await checkPermission("employees:view-all", {
      centerId: centerScope ?? session.user.centerId ?? null,
    }))
  ) {
    // Mục "Giáo viên" ở sidebar mở cho cả người CHỈ có quyền xem Rank (Giám đốc · Đào tạo — không có `employees:view-all`): đưa họ
    // thẳng vào màn con Rank thay vì đá về Dashboard (chốt 25/10/2026: Rank là màn con của mục này).
    redirect((await xemRankOMotCoSo()) ? "/teachers/rank" : "/dashboard");
  }
  const xemRank = await xemRankOMotCoSo();

  const params = await searchParams;
  const q = params.q?.trim();

  const where: Prisma.UserWhereInput = {
    isActive: true,
    deletedAt: null,
    ...(centerScope ? { centerId: centerScope } : {}),
    // P1-b: là GV nếu CÓ TEACHER ở roles[] HOẶC role chính = TEACHER (user cũ chưa
    // sync roles[]) HOẶC đã có hồ sơ giáo viên → không sót GV nào.
    AND: [
      {
        OR: [
          { roles: { has: "TEACHER" } },
          { role: "TEACHER" },
          { teacherProfile: { isNot: null } },
        ],
      },
      ...(q
        ? [
            {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { email: { contains: q, mode: "insensitive" as const } },
              ],
            },
          ]
        : []),
    ],
  };

  let staff: Array<{
    id: string;
    name: string | null;
    email: string | null;
    centerId: string | null;
    center: { name: string } | null;
    teacherProfile: {
      employmentType: keyof typeof EMPLOYMENT_LABEL;
      status: keyof typeof TEACHER_STATUS_LABEL;
    } | null;
    teacherClass: { scheduleDays: number[]; startTime: string | null; endTime: string | null }[];
  }> = [];

  // Cách ly cơ sở (A0-04): User exempt (pass-through) — migrate cho sạch whitelist;
  // scope cơ sở đã đi qua where.centerId (CM) ở trên.
  const sdb = scopedDb(await resolveActor(session.user.id));

  try {
    staff = await sdb.user.findMany({
      where,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        centerId: true,
        center: { select: { name: true } },
        teacherProfile: {
          select: { employmentType: true, status: true },
        },
        teacherClass: {
          where: { isActive: true, deletedAt: null },
          select: { scheduleDays: true, startTime: true, endTime: true },
        },
      },
    });
  } catch {
    /* empty DB returns [] */
  }

  const overloadHours = await getSetting("teacher.overloadHoursPerWeek");
  // Cột "Rank lương" (R1–R4, SR.QD.238 — thay ô "Ngạch" cũ, chốt 24/10/2026): cùng `rankTaiNgay` với hồ sơ và lưới phân công, MỘT câu đọc.
  // Chỉ in khi người xem có `parttime_rank:view` tại cơ sở của GV (scope CENTER — hỏi một lần mỗi cơ sở).
  const coSoStaff = [...new Set(staff.map((u) => u.centerId).filter((c): c is string => c != null))];
  const [rankLuong, xemRankTai] = await Promise.all([
    rankHomNayCua(staff.map((u) => u.id), new Date()),
    Promise.all(coSoStaff.map(async (c) => [c, await checkPermission("parttime_rank:view", { centerId: c })] as const)).then((x) => new Map(x)),
  ]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">Giáo viên</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {staff.length} giáo viên · Quản lý toàn bộ nhân sự ở mục{" "}
          <Link href="/nhan-su" className="font-medium text-primary hover:underline">
            Nhân sự
          </Link>
        </p>
      </div>
      <GiaoVienTabs active="danh-sach" danhSach rank={xemRank} />

      <form method="GET" className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          name="q"
          defaultValue={q}
          placeholder="Tìm theo tên, email..."
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm sm:max-w-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Tìm
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          {/* DESIGN.md §2: `whitespace-nowrap` trên th VÀ td — ở 375px cột "Cơ sở" bị bóp mỗi chữ một dòng; bảng đã cuộn ngang trong khung (cuonNgang). */}
          <table className="min-w-full divide-y divide-border [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tên</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cơ sở</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rank lương</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Loại HĐ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trạng thái</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lớp</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tải / tuần</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Chưa có giáo viên nào
                  </td>
                </tr>
              ) : (
                staff.map((u) => {
                  const load = computeTeachingLoad(u.teacherClass, overloadHours);
                  return (
                  <tr key={u.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3">
                      <Link href={`/teachers/${u.id}`} className="flex items-center gap-3 group">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary text-xs font-bold text-white">
                          {(u.name ?? u.email ?? "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-foreground group-hover:text-primary">
                            {u.name ?? "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{u.center?.name ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {(() => {
                        const r = rankLuong.get(u.id);
                        if (!r || !(u.centerId && xemRankTai.get(u.centerId))) return <span className="text-xs text-muted-foreground">—</span>;
                        return r.nguon === "LICH_SU" ? (
                          <span className="inline-flex whitespace-nowrap rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary-ink tabular-nums">R{r.rank}</span>
                        ) : (
                          <span className="inline-flex whitespace-nowrap rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums" title="Chưa có quyết định — Rank mặc định">
                            R{r.rank} · mặc định
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {u.teacherProfile ? EMPLOYMENT_LABEL[u.teacherProfile.employmentType] : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {u.teacherProfile ? (
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${TEACHER_STATUS_COLOR[u.teacherProfile.status]}`}>
                          {TEACHER_STATUS_LABEL[u.teacherProfile.status]}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Chưa có hồ sơ</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-medium tabular-nums text-foreground">
                      {load.classCount}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="text-sm tabular-nums text-foreground">
                        {load.sessionsPerWeek} buổi · {load.hoursPerWeek}h
                      </div>
                      {load.overloaded && (
                        <span className="mt-0.5 inline-flex rounded-full bg-state-danger-soft px-2 py-0.5 text-[10px] font-semibold text-state-danger-ink">
                          Quá tải
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
