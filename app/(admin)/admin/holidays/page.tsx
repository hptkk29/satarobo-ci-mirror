import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, CalendarOff, FileSpreadsheet, Pencil } from "lucide-react";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { loadGlobalHolidays } from "@/lib/cham-cong/holidays";
import { resolveActor } from "@/lib/auth/actor";
import { getTeachingCenterIds } from "@/lib/org/org-service";
import type { Prisma, HolidayType } from "@prisma/client";
import { TypeBadge, ScopeBadge, DateRange, TYPE_LABELS } from "./_components/helpers";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NutXuat } from "@/components/admin/nut-xuat";

export const dynamic = "force-dynamic";

interface SearchParams {
  searchParams: Promise<{ year?: string; centerId?: string; type?: string }>;
}

const VALID_TYPES = new Set<HolidayType>(["HOLIDAY", "MAINTENANCE", "EVENT", "OTHER"]);

export default async function HolidaysAdminPage({ searchParams }: SearchParams) {
  // Cách ly cơ sở: Holiday ∈ SCOPED_MODELS → scopedDb auto-inject centerId IN <tầm
  // nhìn>. CENTER_MANAGER@CS1 không thấy ngày nghỉ riêng của CS2 (ngày nghỉ toàn hệ
  // thống centerId=null bị scope theo cùng cơ chế như trang /admin/sessions).
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const sp = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const year = (() => {
    const parsed = parseInt(sp.year ?? String(currentYear), 10);
    return Number.isFinite(parsed) ? parsed : currentYear;
  })();
  const centerFilter = sp.centerId?.trim() ?? "";
  const typeFilter = sp.type?.trim() ?? "";

  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const endOfYear = new Date(Date.UTC(year + 1, 0, 1));

  const where: Prisma.HolidayWhereInput = {
    date: { gte: startOfYear, lt: endOfYear },
  };
  // "ALL" = chỉ lễ TOÀN HỆ THỐNG. Không đặt `where.centerId = null` rồi đi qua `sdb`: `Holiday`
  // bị scopedDb AND thêm `centerId IN [...]` nên nhánh đó LUÔN RỖNG với người cấp cơ sở — vai
  // CENTER_HR không bao giờ thấy ngày lễ quốc gia. Đọc riêng bằng `loadGlobalHolidays`.
  const chiLeChung = centerFilter === "ALL";
  if (centerFilter && !chiLeChung) where.centerId = centerFilter;
  if (typeFilter && VALID_TYPES.has(typeFilter as HolidayType)) {
    where.type = typeFilter as HolidayType;
  }

  const loaiLoc = typeFilter && VALID_TYPES.has(typeFilter as HolidayType) ? (typeFilter as HolidayType) : undefined;
  const [holidays, centers] = await Promise.all([
    chiLeChung
      ? loadGlobalHolidays({ from: startOfYear, to: endOfYear, type: loaiLoc })
      : sdb.holiday.findMany({
          where,
          orderBy: { date: "asc" },
          include: { center: { select: { id: true, name: true } } },
        }),
    // Chỉ cơ sở vận hành — loại HO/"Hội sở" mồ côi khỏi bộ lọc lịch nghỉ.
    getTeachingCenterIds().then((ids) =>
      sdb.center.findMany({
        where: { id: { in: ids } },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
    ),
  ]);

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-black text-foreground">
            <CalendarOff className="h-7 w-7 text-primary" />
            Lịch nghỉ
          </h1>
          <p className="mt-1 text-muted-foreground">
            Năm {year} — {holidays.length} ngày nghỉ
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NutXuat ma="lich-nghi" />
          <Link
            href="/holidays/import"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-muted"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Import Excel
          </Link>
          <Link
            href="/holidays/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-white shadow-md hover:bg-primary-dark"
          >
            <Plus className="h-5 w-5" />
            Thêm ngày nghỉ
          </Link>
        </div>
      </div>

      <form
        method="GET"
        className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_1fr_auto]"
      >
        <select
          name="year"
          defaultValue={String(year)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              Năm {y}
            </option>
          ))}
        </select>
        <select
          name="centerId"
          defaultValue={centerFilter}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Tất cả phạm vi</option>
          <option value="ALL">Chỉ toàn hệ thống</option>
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={typeFilter}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Tất cả loại</option>
          {(Object.keys(TYPE_LABELS) as HolidayType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark"
        >
          Lọc
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang>
          <table className="w-full">
            <thead className="border-b border-border bg-muted text-left">
              <tr>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">
                  Ngày
                </th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">
                  Tên
                </th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">
                  Phạm vi
                </th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground">
                  Loại
                </th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground" title="Hệ số công ngày lễ (T-04) — Kế toán tự đặt">
                  Hệ số công
                </th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">
                  Ghi chú
                </th>
                <th className="p-4 text-right text-xs font-bold uppercase tracking-wider text-foreground">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-muted-foreground">
                    {centerFilter || typeFilter ? (
                      <>Không có ngày nghỉ nào khớp bộ lọc cho năm {year}.</>
                    ) : (
                      <>
                        Chưa có ngày nghỉ nào trong năm {year}.{" "}
                        <Link href="/holidays/new" className="text-primary hover:underline">
                          Thêm ngày nghỉ đầu tiên →
                        </Link>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                holidays.map((h) => (
                  <tr key={h.id} className="border-b border-border hover:bg-muted">
                    <td className="p-4 text-sm">
                      <DateRange date={h.date} endDate={h.endDate} />
                    </td>
                    <td className="p-4 text-sm font-semibold text-foreground">{h.name}</td>
                    <td className="p-4">
                      <ScopeBadge center={h.center} />
                    </td>
                    <td className="p-4 text-center">
                      <TypeBadge type={h.type} />
                    </td>
                    <td className="p-4 text-center text-sm">
                      {h.attendanceEffect === "UNPAID_OFF" ? (
                        <span className="text-muted-foreground">không công</span>
                      ) : h.attendanceEffect === "INFO_ONLY" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-semibold">×{h.coefficient}</span>
                      )}
                    </td>
                    <td className="p-4 text-xs text-muted-foreground">
                      {h.note ? (
                        <span className="line-clamp-2">{h.note}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/holidays/${h.id}/edit`}
                        className="inline-flex items-center gap-1 rounded p-1.5 text-primary hover:bg-primary-soft"
                        title="Sửa"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
