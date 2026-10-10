"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, DoorOpen, Mail, MapPin, Phone, Power, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteCenter, toggleCenterActive } from "../_actions";

export type CoSoThe = {
  id: string;
  name: string;
  code: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  dem: { classes: number; students: number; employees: number; rooms: number };
};

// Thẻ một cơ sở trên màn /centers (01/10/2026 — thiết kế lại khi gộp Phòng học vào Cơ sở).
// Chỉ có vài cơ sở nên thẻ hợp hơn bảng: đọc được địa chỉ đầy đủ + số liệu mà không cuộn ngang.
// Bật/tắt + xoá CHỈ vẽ khi có `centers:edit` (server action gác đúng quyền đó) — bản cũ vẽ cho
// mọi người rồi để server từ chối.
export function TheCoSo({ c, coTheSua }: { c: CoSoThe; coTheSua: boolean }) {
  const router = useRouter();
  const [dang, start] = useTransition();
  const [xacNhanXoa, setXacNhanXoa] = useState(false);

  function batTat() {
    start(async () => {
      const kq = await toggleCenterActive(c.id, !c.isActive);
      if (kq?.error) toast.error(kq.error);
      else {
        toast.success(c.isActive ? `Đã đóng ${c.name}` : `Đã mở lại ${c.name}`);
        router.refresh();
      }
    });
  }
  function xoa() {
    if (!xacNhanXoa) {
      setXacNhanXoa(true);
      return;
    }
    start(async () => {
      const kq = await deleteCenter(c.id);
      if (kq?.error) {
        toast.error(kq.error);
        setXacNhanXoa(false);
      } else {
        toast.success(`Đã xoá ${c.name}`);
        router.refresh();
      }
    });
  }

  const soLieu: [string, number][] = [
    ["lớp", c.dem.classes],
    ["học viên", c.dem.students],
    ["nhân sự", c.dem.employees],
  ];

  return (
    <article
      className={cn(
        "flex flex-col rounded-xl border bg-card shadow-sm transition-colors",
        c.isActive ? "border-border" : "border-dashed border-border opacity-80",
      )}
    >
      <div className="flex-1 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {c.code && <p className="font-mono text-xs text-muted-foreground">{c.code}</p>}
            <h2 className="text-base font-semibold leading-snug text-foreground">
              <Link href={`/centers/${c.id}/edit`} className="hover:underline">
                {c.name}
              </Link>
            </h2>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
              c.isActive ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground",
            )}
          >
            {c.isActive ? "Đang hoạt động" : "Đã đóng"}
          </span>
        </div>

        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="line-clamp-2">{c.address}</span>
          </li>
          {c.phone && (
            <li className="flex items-center gap-2">
              <Phone className="size-4 shrink-0" aria-hidden />
              <a href={`tel:${c.phone}`} className="tabular-nums hover:text-foreground">
                {c.phone}
              </a>
            </li>
          )}
          {c.email && (
            <li className="flex items-center gap-2">
              <Mail className="size-4 shrink-0" aria-hidden />
              <a href={`mailto:${c.email}`} className="truncate hover:text-foreground">
                {c.email}
              </a>
            </li>
          )}
        </ul>

        <dl className="mt-4 grid grid-cols-3 gap-2">
          {soLieu.map(([nhan, so]) => (
            <div key={nhan} className="rounded-lg bg-muted/60 px-2.5 py-2">
              <dd className="text-lg font-semibold tabular-nums text-foreground">{so}</dd>
              <dt className="text-xs text-muted-foreground">{nhan}</dt>
            </div>
          ))}
        </dl>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-5">
        <Link
          href={`/centers/${c.id}/edit#phong-hoc`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted"
        >
          <DoorOpen className="size-3.5" aria-hidden />
          <span className="tabular-nums">{c.dem.rooms}</span> phòng học
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {coTheSua && (
            <>
              <button
                type="button"
                onClick={batTat}
                disabled={dang}
                aria-label={c.isActive ? `Đóng ${c.name}` : `Mở lại ${c.name}`}
                title={c.isActive ? "Đóng cơ sở" : "Mở lại cơ sở"}
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Power className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={xoa}
                onBlur={() => setXacNhanXoa(false)}
                disabled={dang}
                aria-label={xacNhanXoa ? `Bấm lần nữa để xoá ${c.name}` : `Xoá ${c.name}`}
                title="Chỉ xoá được khi không còn lớp/học viên/nhân sự/lead liên kết"
                className={
                  xacNhanXoa
                    ? "inline-flex h-8 items-center gap-1 rounded-md bg-state-danger-soft px-2.5 text-xs font-semibold text-state-danger-ink"
                    : "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-state-danger-soft hover:text-state-danger-ink disabled:opacity-50"
                }
              >
                <Trash2 className="size-4" aria-hidden />
                {xacNhanXoa && "Xoá?"}
              </button>
            </>
          )}
          <Link
            href={`/centers/${c.id}/edit`}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-semibold text-primary hover:bg-primary-soft"
          >
            Mở <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </footer>
    </article>
  );
}
