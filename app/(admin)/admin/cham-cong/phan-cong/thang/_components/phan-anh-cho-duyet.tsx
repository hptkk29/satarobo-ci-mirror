"use client";

// Tab "Phản ánh chờ duyệt" (GĐ6, chốt 5): duyệt = ghi THÊM lượt quét theo mốc giáo viên khai; không duyệt bắt buộc lý do ≥ 10 ký tự.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LY_DO_KHONG_DUYET_TOI_THIEU } from "@/lib/phan-cong/phan-anh";
import { duyetPhanAnhAction } from "../_actions-phan-anh";

type Dong = { id: string; ten: string; ngay: string; ca: string; lyDo: string; moc: (string | null)[] };
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const moTaMoc = (moc: (string | null)[]) =>
  moc
    .map((m, i) => (m ? `${i % 2 === 0 ? "Vào" : "Ra"}${moc.length > 2 ? ` ${Math.floor(i / 2) + 1}` : ""} ${m}` : null))
    .filter(Boolean)
    .join(" · ");

export function PhanAnhChoDuyet({ ds, coQuyen }: { ds: Dong[]; coQuyen: boolean }) {
  if (!ds.length) {
    return <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">Không có phản ánh nào chờ duyệt.</p>;
  }
  return (
    <ul className="space-y-2" data-phan-anh-cho-duyet>
      {ds.map((d) => (
        <MotPhanAnh key={d.id} d={d} coQuyen={coQuyen} />
      ))}
    </ul>
  );
}

function MotPhanAnh({ d, coQuyen }: { d: Dong; coQuyen: boolean }) {
  const router = useRouter();
  const [ghiChu, setGhiChu] = useState("");
  const [pending, start] = useTransition();
  const goi = (duyet: boolean) =>
    start(async () => {
      const r = await duyetPhanAnhAction({ id: d.id, duyet, ghiChu: ghiChu.trim() || null });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.message);
      router.refresh();
    });
  const duLyDo = ghiChu.trim().length >= LY_DO_KHONG_DUYET_TOI_THIEU;
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{d.ten}</span>
        <span className="tabular-nums text-muted-foreground">
          {dm(d.ngay)} · ca {d.ca}
        </span>
        <span className="tabular-nums">Ghi thêm: {moTaMoc(d.moc) || "—"}</span>
      </div>
      <p className="mt-1 text-muted-foreground">“{d.lyDo}”</p>
      {coQuyen ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            aria-label="Lý do không duyệt"
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            placeholder={`Lý do không duyệt (≥ ${LY_DO_KHONG_DUYET_TOI_THIEU} ký tự)`}
            value={ghiChu}
            onChange={(e) => setGhiChu(e.target.value)}
            disabled={pending}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => goi(true)}
            className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Duyệt
          </button>
          <button
            type="button"
            disabled={pending || !duLyDo}
            title={duLyDo ? undefined : `Ghi lý do ít nhất ${LY_DO_KHONG_DUYET_TOI_THIEU} ký tự`}
            onClick={() => goi(false)}
            className="h-9 rounded-md border border-border px-3 text-sm disabled:opacity-50"
          >
            Không duyệt
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Bạn chỉ xem — duyệt cần quyền phân ca ở cơ sở này.</p>
      )}
    </li>
  );
}
