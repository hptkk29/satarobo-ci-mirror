"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TRAN_SO_HOC_PHAN, chiaHocPhan } from "@/lib/lms/chia-hoc-phan";
import { chiaHocPhanAction } from "../_actions";

// CẤU TRÚC HỌC PHẦN của giáo trình (29/09/2026): số học phần + số buổi của TỪNG học phần.
// Học phần của khoá đọc thẳng từ đây — trang khoá (Học bù), lượt bù, nhãn buổi đều khớp theo.
// Chỉ ĐỔI NHÃN học phần trên bài có sẵn: không tạo/xoá bài ⇒ không chạm buổi học của lớp, giáo
// án SCORM, bài tập hay nhận xét. Đổi TỔNG số buổi thì dùng khối "Số buổi" (có xem trước).

function deuTheo(soBai: number, soHp: number): number[] {
  const gan = chiaHocPhan(Array.from({ length: soBai }, (_, i) => i + 1), soHp);
  const dem = new Map<string, number>();
  for (const g of gan) if (g.moduleCode) dem.set(g.moduleCode, (dem.get(g.moduleCode) ?? 0) + 1);
  return [...dem.values()];
}

export function HocPhanForm({
  curriculumId,
  soBai,
  hienTai,
}: {
  curriculumId: string;
  soBai: number;
  hienTai: { moduleCode: string; tu: number; den: number; soBai: number }[];
}) {
  const router = useRouter();
  const [soBuoi, setSoBuoi] = useState<number[]>(() => hienTai.map((h) => h.soBai));
  const [pending, start] = useTransition();

  const tong = soBuoi.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
  const khop = soBuoi.length === 0 || tong === soBai;
  const doi = JSON.stringify(soBuoi) !== JSON.stringify(hienTai.map((h) => h.soBai));
  const hopLe = khop && soBuoi.every((n) => Number.isInteger(n) && n >= 1);

  function luu() {
    start(async () => {
      const kq = await chiaHocPhanAction({ curriculumId, soBuoiMoiHp: soBuoi });
      if (!kq.ok) {
        toast.error(kq.error ?? "Không lưu được");
        return;
      }
      toast.success(soBuoi.length ? `Đã lưu ${soBuoi.length} học phần` : "Đã bỏ chia học phần");
      router.refresh();
    });
  }

  let tu = 1;
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">Cấu trúc học phần</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Số học phần và số buổi của từng học phần. Khoá học dùng giáo trình này tự nhận đúng cấu trúc — lượt
            học bù và phần thu tiền theo học phần tính theo đây.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || soBuoi.length === 0}
            onClick={() => setSoBuoi(deuTheo(soBai, soBuoi.length))}
          >
            Chia đều
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || soBuoi.length >= Math.min(TRAN_SO_HOC_PHAN, soBai)}
            onClick={() => setSoBuoi((cu) => deuTheo(soBai, cu.length + 1))}
          >
            <Plus aria-hidden /> Thêm học phần
          </Button>
        </div>
      </div>

      {soBuoi.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Chưa chia học phần — cả {soBai} buổi là một khối. Bấm “Thêm học phần” để chia.
        </p>
      ) : (
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
          {soBuoi.map((n, i) => {
            const batDau = tu;
            tu += Number.isFinite(n) ? n : 0;
            return (
              <li key={i} className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">HP{i + 1}</span>
                  <button
                    type="button"
                    aria-label={`Bỏ học phần ${i + 1}`}
                    disabled={pending}
                    onClick={() => setSoBuoi((cu) => (cu.length > 1 ? deuTheo(soBai, cu.length - 1) : []))}
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Minus className="size-4" aria-hidden />
                  </button>
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    aria-label={`Số buổi học phần ${i + 1}`}
                    value={Number.isFinite(n) ? n : ""}
                    onChange={(e) =>
                      setSoBuoi((cu) => cu.map((v, j) => (j === i ? Math.floor(Number(e.target.value)) : v)))
                    }
                    className="h-9 w-20 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums text-foreground"
                  />
                  buổi
                </label>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {n >= 1 ? `Bài ${batDau}–${batDau + n - 1}` : "—"}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={cn("text-sm tabular-nums", khop ? "text-muted-foreground" : "font-medium text-[color:var(--state-danger)]")}>
          {soBuoi.length === 0
            ? `${soBai} buổi · không chia học phần`
            : khop
              ? `Tổng ${tong}/${soBai} buổi — khớp`
              : `Tổng ${tong}/${soBai} buổi — ${tong > soBai ? "thừa" : "thiếu"} ${Math.abs(tong - soBai)} buổi. Sửa số buổi các học phần, hoặc đổi số buổi giáo trình ở khối “Số buổi”.`}
        </p>
        <Button size="sm" onClick={luu} disabled={pending || !doi || !hopLe}>
          {pending ? "Đang lưu…" : "Lưu cấu trúc"}
        </Button>
      </div>
    </section>
  );
}
