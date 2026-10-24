"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { deleteRoom } from "../../rooms/_actions";

// Xoá phòng ngay trong trang cơ sở — mẫu xác nhận 2 lần bấm của admin (không dùng confirm()).
// Server action giữ nguyên cổng rooms:edit + passesScope.
export function NutXoaPhong({ id, ten }: { id: string; ten: string }) {
  const router = useRouter();
  const [xacNhan, setXacNhan] = useState(false);
  const [dang, start] = useTransition();

  function bam() {
    if (!xacNhan) {
      setXacNhan(true);
      return;
    }
    start(async () => {
      const kq = await deleteRoom(id);
      if (kq?.error) {
        toast.error(kq.error);
        setXacNhan(false);
        return;
      }
      toast.success(`Đã xoá phòng ${ten}`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={bam}
      onBlur={() => setXacNhan(false)}
      disabled={dang}
      aria-label={xacNhan ? `Bấm lần nữa để xoá ${ten}` : `Xoá ${ten}`}
      className={
        xacNhan
          ? "inline-flex h-8 items-center gap-1 rounded-md bg-state-danger-soft px-2.5 text-xs font-semibold text-state-danger-ink"
          : "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-state-danger-soft hover:text-state-danger-ink disabled:opacity-50"
      }
    >
      <Trash2 className="size-3.5" aria-hidden />
      {xacNhan && (dang ? "Đang xoá…" : "Xoá?")}
    </button>
  );
}
