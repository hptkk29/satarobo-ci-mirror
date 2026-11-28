import Link from "next/link";
import { DoorOpen, Pencil, Plus, Users } from "lucide-react";
import type { RoomStatus } from "@prisma/client";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { cn } from "@/lib/utils";
import { NutXoaPhong } from "./nut-xoa-phong";

// PHÒNG HỌC CỦA CƠ SỞ (01/10/2026 — chủ dự án gộp mục "Phòng học" vào "Cơ sở").
//
// Quyền giữ NGUYÊN của màn /rooms: xem = `rooms:view`, thêm/sửa/xoá = `rooms:edit` (QLCS có,
// dù QLCS KHÔNG có `centers:edit` để sửa thông tin cơ sở). Trang sửa cơ sở không có cổng ở
// đầu và `Center` ∉ SCOPED_MODELS, nên khối này tự gác cách ly: phòng của cơ sở ngoài tầm
// nhìn thì không vẽ (passesScope), và đọc qua `sdb.room` (Room ∈ SCOPED_MODELS) lần nữa.

const NHAN: Record<RoomStatus, { nhan: string; mau: string }> = {
  ACTIVE: { nhan: "Hoạt động", mau: "bg-state-success-soft text-state-success-ink" },
  MAINTENANCE: { nhan: "Bảo trì", mau: "bg-state-warning-soft text-state-warning-ink" },
  INACTIVE: { nhan: "Tạm ngừng", mau: "bg-muted text-muted-foreground" },
};

export async function PhongHocCoSo({ userId, centerId }: { userId: string; centerId: string }) {
  const actor = await resolveActor(userId);
  if (!passesScope("Room", { centerId }, actor)) return null;
  const [xem, sua] = await Promise.all([
    checkPermission("rooms:view", { centerId }),
    checkPermission("rooms:edit", { centerId }),
  ]);
  if (!xem) return null;

  const phong = await scopedDb(actor).room.findMany({
    where: { centerId },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      capacity: true,
      status: true,
      equipment: true,
      _count: { select: { classes: true } },
    },
  });
  const ve = encodeURIComponent(`/centers/${centerId}/edit`);
  const tongCho = phong.filter((p) => p.status === "ACTIVE").reduce((s, p) => s + p.capacity, 0);

  return (
    <section id="phong-hoc" className="scroll-mt-20 rounded-xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <DoorOpen className="size-4 text-primary" aria-hidden />
            Phòng học
            <span className="rounded-full bg-muted px-2 text-xs font-medium tabular-nums text-muted-foreground">
              {phong.length}
            </span>
          </h2>
          {phong.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {tongCho} chỗ ở các phòng đang hoạt động
            </p>
          )}
        </div>
        {sua && (
          <Link
            href={`/rooms/new?centerId=${centerId}&ve=${ve}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden />
            Thêm phòng
          </Link>
        )}
      </header>

      {phong.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          Cơ sở chưa có phòng học nào.{sua ? " Thêm phòng để xếp lớp và lịch học." : ""}
        </p>
      ) : (
        <ul className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3 2xl:grid-cols-4">
          {phong.map((p) => (
            <li
              key={p.id}
              className="flex flex-col rounded-lg border border-border bg-background p-3.5 transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{p.code}</p>
                  <p className="truncate font-semibold text-foreground">{p.name}</p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", NHAN[p.status].mau)}>
                  {NHAN[p.status].nhan}
                </span>
              </div>
              <p className="mt-2 flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" aria-hidden />
                  {p.capacity} chỗ
                </span>
                <span>{p._count.classes} lớp</span>
              </p>
              {p.equipment.length > 0 && (
                <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{p.equipment.join(" · ")}</p>
              )}
              {sua && (
                <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-2">
                  <Link
                    href={`/rooms/${p.id}/edit?ve=${ve}`}
                    className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    Sửa
                  </Link>
                  <NutXoaPhong id={p.id} ten={`${p.code} — ${p.name}`} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
