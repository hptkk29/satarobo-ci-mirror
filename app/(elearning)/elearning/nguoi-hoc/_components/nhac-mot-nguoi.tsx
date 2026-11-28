"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { tomTatKetQuaNhac } from "@/lib/elearning/nhac-hoc-pure";
import { NUT_CHINH } from "../../_components/ui/dieu-khien";
import { nhacHocAction } from "../_actions";

/** Nút "Nhắc học" ở hồ sơ một người. Quyền + phạm vi do server kiểm; `daNhacLuc` (giờ VN) chỉ để khoá nút khi hôm nay đã nhắc. */
export function NhacMotNguoi({ userId, daNhacLuc }: { userId: string; daNhacLuc: string | null }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  if (daNhacLuc) return <span className="text-sm text-muted-foreground">Đã nhắc {daNhacLuc}</span>;
  return (
    <button
      type="button"
      disabled={dangChay}
      className={NUT_CHINH}
      onClick={() =>
        chuyen(async () => {
          const r = await nhacHocAction({ userIds: [userId] });
          if (!r.ok) return void toast.error(r.error.message);
          const t = tomTatKetQuaNhac(r.data);
          (t.sac === "success" ? toast.success : t.sac === "warning" ? toast.warning : toast.info)(t.chu);
          router.refresh();
        })
      }
    >
      Nhắc học
    </button>
  );
}
