"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Coins, Minus, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { grantCoins } from "../_actions";

type HocVien = { id: string; name: string; studentCode: string | null; soDu: number };
type QuyTac = { code: string; label: string; amount: number };

// CẤP / ĐIỀU CHỈNH COIN (01/10/2026 — thiết kế lại). Đi theo đúng thứ tự người cấp nghĩ:
// ai → bao nhiêu → vì sao. Chọn quy tắc là điền luôn số coin + lý do, nên ca thường gặp
// (thưởng theo quy tắc) chỉ còn 2 lần bấm.
//
// ⚠️ Ô số coin CỐ Ý là `<input type="number">`, KHÔNG phải `<MoneyInput>` — SataCoin là ĐIỂM
// THƯỞNG chứ không phải VNĐ (vòng rà 20/08, đừng lật lại): gắn dấu chấm nghìn làm người sau gõ
// "5.000" tưởng là tiền.
export function CapCoin({
  hocVien,
  quyTac,
  chonSan,
}: {
  hocVien: HocVien[];
  quyTac: QuyTac[];
  /** Mở từ nút "Cấp coin" ở tab Số dư ⇒ chọn sẵn học viên đó. */
  chonSan: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [studentId, setStudentId] = useState(chonSan ?? "");
  const [soCoin, setSoCoin] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [dang, start] = useTransition();

  const locQ = q.trim().toLocaleLowerCase("vi");
  const danhSach = useMemo(
    () =>
      (locQ
        ? hocVien.filter(
            (h) =>
              h.name.toLocaleLowerCase("vi").includes(locQ) ||
              h.studentCode?.toLocaleLowerCase("vi").includes(locQ),
          )
        : hocVien
      ).slice(0, 60),
    [hocVien, locQ],
  );
  const dangChon = hocVien.find((h) => h.id === studentId) ?? null;
  const so = Number(soCoin);
  const hopLe = !!studentId && Number.isInteger(so) && so !== 0 && lyDo.trim().length >= 2;

  function gui() {
    if (!hopLe) return;
    start(async () => {
      const kq = await grantCoins({ studentId, amount: so, reason: lyDo.trim(), note: ghiChu });
      if (!kq.ok) {
        toast.error(kq.error ?? "Không ghi được giao dịch");
        return;
      }
      toast.success(`${so > 0 ? "Đã cộng" : "Đã trừ"} ${Math.abs(so)} coin cho ${dangChon?.name ?? "học viên"}`);
      setSoCoin("");
      setLyDo("");
      setGhiChu("");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      {/* ── 1. Ai ── */}
      <section className="min-w-0 rounded-xl border border-border bg-card shadow-sm" aria-label="Chọn học viên">
        <div className="border-b border-border p-3">
          <label className="relative block">
            <span className="sr-only">Tìm học viên</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm tên hoặc mã học viên…"
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>
        <ul className="max-h-[60vh] divide-y divide-border overflow-auto" role="listbox" aria-label="Học viên">
          {danhSach.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                role="option"
                aria-selected={studentId === h.id}
                onClick={() => setStudentId(h.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                  studentId === h.id ? "bg-primary-soft/60" : "hover:bg-muted/60",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{h.name}</span>
                  {h.studentCode && <span className="block text-xs text-muted-foreground">{h.studentCode}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{h.soDu} coin</span>
              </button>
            </li>
          ))}
          {danhSach.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">Không học viên nào khớp.</li>
          )}
        </ul>
      </section>

      {/* ── 2–3. Bao nhiêu + vì sao ── */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div>
            <p className="text-xs text-muted-foreground">Học viên</p>
            <p className="mt-0.5 font-semibold text-foreground">{dangChon ? dangChon.name : "Chọn ở danh sách bên cạnh"}</p>
            {dangChon && <p className="text-xs tabular-nums text-muted-foreground">Số dư hiện tại: {dangChon.soDu} coin</p>}
          </div>

          {quyTac.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-foreground">Theo quy tắc</legend>
              <div className="flex flex-wrap gap-1.5">
                {quyTac.map((r) => (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => {
                      setSoCoin(String(r.amount));
                      setLyDo(r.code);
                    }}
                    aria-pressed={lyDo === r.code}
                    className={cn(
                      "min-h-8 rounded-full border px-2.5 text-xs transition-colors",
                      lyDo === r.code
                        ? "border-primary bg-primary-soft font-medium text-primary-ink"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    {r.label} <span className="tabular-nums">{r.amount > 0 ? `+${r.amount}` : r.amount}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Số coin</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Giảm 1"
                onClick={() => setSoCoin(String((Number(soCoin) || 0) - 1))}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-muted"
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={soCoin}
                onChange={(e) => setSoCoin(e.target.value)}
                placeholder="0"
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-center text-lg font-semibold tabular-nums focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                aria-label="Tăng 1"
                onClick={() => setSoCoin(String((Number(soCoin) || 0) + 1))}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-muted"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
            <span className="mt-1 block text-xs text-muted-foreground">Số âm là trừ coin (vd đổi quà).</span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Lý do</span>
            <input
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              maxLength={100}
              placeholder="VD: Đổi quà, Thi đấu RoboSim…"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Ghi chú <span className="font-normal text-muted-foreground">(tuỳ chọn)</span></span>
            <textarea
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <Button className="w-full" onClick={gui} disabled={dang || !hopLe}>
            <Coins className="size-4" aria-hidden />
            {dang ? "Đang ghi…" : so < 0 ? `Trừ ${Math.abs(so)} coin` : so > 0 ? `Cộng ${so} coin` : "Ghi giao dịch"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Sổ cái không sửa/xoá được — ghi sai thì “Đảo” ở tab Sổ cái.
          </p>
        </div>
      </aside>
    </div>
  );
}
