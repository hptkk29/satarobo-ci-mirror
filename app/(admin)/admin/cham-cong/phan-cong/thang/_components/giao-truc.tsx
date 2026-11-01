"use client";

// Giao trực vận hành TƯỜNG MINH (D-Q3): QLCS chọn người · ngày · ca. Không có lựa chọn "suy từ lịch" — trực chỉ có khi được giao.
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { giaoTrucAction } from "../../_actions-truc";

export function GiaoTruc({ centerId, nguoi, ca, macDinhNgay }: { centerId: string; nguoi: { id: string; ten: string }[]; ca: { ma: string; tu: string; den: string }[]; macDinhNgay: string }) {
  const [userId, setUserId] = useState("");
  const [ngay, setNgay] = useState(macDinhNgay);
  const [shiftCode, setShift] = useState(ca[0]?.ma ?? "");
  const [dang, batDau] = useTransition();
  const id = useId();
  const gui = () =>
    batDau(async () => {
      if (!userId) return void toast.error("Chọn người trực.");
      const r = await giaoTrucAction({ userId, centerId, ngay, shiftCode });
      if (r.ok) toast.success(r.message ?? "Đã giao trực.");
      else toast.error(r.error);
    });
  const o = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`${id}-u`}>
        Người trực
        <select id={`${id}-u`} className={o} value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— chọn —</option>
          {nguoi.map((n) => (
            <option key={n.id} value={n.id}>
              {n.ten}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`${id}-d`}>
        Ngày
        <input id={`${id}-d`} type="date" className={o} value={ngay} onChange={(e) => setNgay(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`${id}-c`}>
        Ca
        <select id={`${id}-c`} className={o} value={shiftCode} onChange={(e) => setShift(e.target.value)}>
          {ca.map((c) => (
            <option key={c.ma} value={c.ma}>
              {c.ma} · {c.tu}–{c.den}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" size="sm" disabled={dang} onClick={gui} className="h-9">
        {dang ? "Đang giao…" : "Giao trực"}
      </Button>
    </div>
  );
}
