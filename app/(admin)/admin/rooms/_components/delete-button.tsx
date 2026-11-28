"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteRoom } from "../_actions";

export function DeleteRoomButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (!confirm(`Xoá phòng "${name}"?`)) return;
    startTransition(async () => {
      const res = await deleteRoom(id);
      if (res?.error) {
        alert(res.error);
        return;
      }
      router.push("/rooms");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-xl border-2 border-state-danger-soft bg-card px-4 py-2 text-sm font-bold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-60"
    >
      <Trash2 className="h-4 w-4" />
      {pending ? "Đang xoá..." : "Xoá phòng"}
    </button>
  );
}
