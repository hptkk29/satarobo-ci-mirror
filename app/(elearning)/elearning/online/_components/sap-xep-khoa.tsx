"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { sapXepKhoaAction } from "../_actions";
import { NUT_CHINH, NUT_NHO } from "../../_components/ui/dieu-khien";

type Khoa = { id: string; code: string; name: string };

/** Sắp thứ tự hiển thị (STT) khoá trên trang công khai — nút lên/xuống, lưu MỘT lần (không kéo thả trong bảng, theo thiết kế). */
export function SapXepKhoa({ khoa }: { khoa: Khoa[] }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [ds, setDs] = useState(khoa);
  const doi = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= ds.length) return;
    const moi = [...ds];
    [moi[i], moi[j]] = [moi[j]!, moi[i]!];
    setDs(moi);
  };
  const daDoi = ds.some((k, i) => k.id !== khoa[i]?.id);
  return (
    <div>
      <ol className="divide-y divide-border">
        {ds.map((k, i) => (
          <li key={k.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-6 text-right text-sm tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{k.name}</span>
              <span className="block text-xs text-muted-foreground">{k.code}</span>
            </span>
            <button type="button" className={NUT_NHO} aria-label={`Đưa ${k.name} lên`} disabled={i === 0} onClick={() => doi(i, -1)}>
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={NUT_NHO} aria-label={`Đưa ${k.name} xuống`} disabled={i === ds.length - 1} onClick={() => doi(i, 1)}>
              <ArrowDown className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex gap-2 border-t border-border p-4">
        <button
          type="button"
          className={NUT_CHINH}
          disabled={!daDoi || dangChay}
          onClick={() =>
            chuyen(async () => {
              const r = await sapXepKhoaAction({ courseIds: ds.map((k) => k.id) });
              if (!r.ok) return void toast.error(r.error.message);
              toast.success(`Đã lưu thứ tự (${r.data.soDaDoi} khoá đổi vị trí)`);
              router.refresh();
            })
          }
        >
          Lưu thứ tự
        </button>
      </div>
    </div>
  );
}
