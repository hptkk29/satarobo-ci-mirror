import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, DoorOpen, FileSpreadsheet, Pencil } from "lucide-react";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { getTeachingCenterIds } from "@/lib/org/org-service";
import type { Prisma, RoomStatus } from "@prisma/client";
import { StatusBadge } from "./_components/status-badge";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NutXuat } from "@/components/admin/nut-xuat";

export const dynamic = "force-dynamic";

interface SearchParams {
  searchParams: Promise<{ q?: string; centerId?: string; status?: string }>;
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "ACTIVE", label: "Hoạt động" },
  { value: "MAINTENANCE", label: "Bảo trì" },
  { value: "INACTIVE", label: "Tạm ngừng" },
];

const VALID_STATUSES = new Set<RoomStatus>(["ACTIVE", "MAINTENANCE", "INACTIVE"]);

export default async function RoomsAdminPage({ searchParams }: SearchParams) {
  // Cách ly cơ sở: Room ∈ SCOPED_MODELS → sdb.room tự inject `centerId IN visible`.
  // CENTER_MANAGER@CS1 không thấy phòng CS2 (kể cả khi tự set centerId=CS2 → giao tập
  // rỗng). SUPER_ADMIN/HO bypass (ALL). Center không scoped → sdb.center = db.center.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const centerFilter = sp.centerId?.trim() ?? "";
  const statusFilter = sp.status?.trim() ?? "";

  const where: Prisma.RoomWhereInput = {};
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
    ];
  }
  if (centerFilter) where.centerId = centerFilter;
  if (statusFilter && VALID_STATUSES.has(statusFilter as RoomStatus)) {
    where.status = statusFilter as RoomStatus;
  }

  const [rooms, centers] = await Promise.all([
    sdb.room.findMany({
      where,
      orderBy: [
        { status: "asc" },
        { centerId: "asc" },
        { displayOrder: "asc" },
        { code: "asc" },
      ],
      take: 200,
      select: {
        id: true,
        name: true,
        code: true,
        capacity: true,
        equipment: true,
        status: true,
        displayOrder: true,
        center: { select: { id: true, name: true } },
      },
    }),
    // Chỉ cơ sở vận hành (có phòng) — loại HO/"Hội sở" mồ côi khỏi bộ lọc.
    getTeachingCenterIds().then((ids) =>
      sdb.center.findMany({
        where: { isActive: true, id: { in: ids } },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
    ),
  ]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-black text-foreground">
            <DoorOpen className="h-7 w-7 text-primary" />
            Phòng học
          </h1>
          <p className="mt-1 text-muted-foreground">
            {rooms.length} phòng{rooms.length >= 200 && " (giới hạn 200, dùng filter để thu hẹp)"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NutXuat ma="phong-hoc" />
          <Link
            href="/rooms/import"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-muted"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Import Excel
          </Link>
          <Link
            href="/rooms/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-white shadow-md hover:bg-primary-dark"
          >
            <Plus className="h-5 w-5" />
            Thêm phòng
          </Link>
        </div>
      </div>

      <form
        method="GET"
        className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
      >
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Tìm theo tên hoặc mã phòng..."
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <select
          name="centerId"
          defaultValue={centerFilter}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Tất cả cơ sở</option>
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={statusFilter}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
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
                  Mã / Tên
                </th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">
                  Cơ sở
                </th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground">
                  Sức chứa
                </th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">
                  Thiết bị
                </th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground">
                  Trạng thái
                </th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground">
                  Order
                </th>
                <th className="p-4 text-right text-xs font-bold uppercase tracking-wider text-foreground">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              {rooms.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-muted-foreground">
                    {q || centerFilter || statusFilter ? (
                      <>Không có phòng nào khớp bộ lọc.</>
                    ) : (
                      <>
                        Chưa có phòng nào.{" "}
                        <Link href="/rooms/new" className="text-primary hover:underline">
                          Thêm phòng đầu tiên →
                        </Link>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                rooms.map((r) => (
                  <tr key={r.id} className="border-b border-border hover:bg-muted">
                    <td className="p-4">
                      <div className="font-mono text-sm font-bold text-foreground">{r.code}</div>
                      <div className="mt-0.5 text-sm text-muted-foreground">{r.name}</div>
                    </td>
                    <td className="p-4 text-sm text-foreground">{r.center.name}</td>
                    <td className="p-4 text-center text-sm">{r.capacity}</td>
                    <td className="p-4 text-xs text-muted-foreground">
                      {r.equipment.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : r.equipment.length <= 3 ? (
                        r.equipment.join(", ")
                      ) : (
                        `${r.equipment.slice(0, 3).join(", ")} +${r.equipment.length - 3}`
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="p-4 text-center text-sm">{r.displayOrder}</td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/rooms/${r.id}/edit`}
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
