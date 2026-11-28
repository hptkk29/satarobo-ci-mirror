"use client";

// Các câu hỏi của bài tập, ở góc nhìn HỌC VIÊN làm bài — dùng chung cho cổng phụ huynh (`SubmitForm`) và cổng học sinh (`HvNopBai`).
//
// Component này KHÔNG biết đáp án đúng (xem `CauHoiHocVien` ở lib/assignments/lam-bai.ts) — nó chỉ vẽ câu hỏi và giữ đáp án học viên
// chọn trong state của form cha. Câu «Nộp video» KHÔNG tự lưu gì: nó vẽ ô tải video do form cha đưa vào (`videoSlot`), vì video đi theo
// danh sách tệp của bài nộp chứ không theo đáp án từng câu.
//
// Chỉ dùng token màu `:root` (border/card/foreground/muted-foreground) + cam thương hiệu — hai cổng có bộ màu riêng nhưng cùng token nền.
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CauHoiHocVien, DapAn } from "@/lib/assignments/lam-bai";

export type DapAnTheoCau = Record<string, DapAn>;

/** Đáp án này có thực sự là "đã trả lời" không (chuỗi rỗng / tập rỗng = bỏ trống, không gửi lên). */
export function coNoiDungDapAn(a: DapAn | undefined): a is DapAn {
  if (!a) return false;
  switch (a.k) {
    case "single":
    case "boolean":
      return true;
    case "multiple":
      return a.i.length > 0;
    case "fill":
      return a.t.some((x) => x.trim());
    case "text":
      return a.t.trim().length > 0;
    case "matching":
      return a.r.some((x) => x.trim());
    case "ordering":
      return a.o.length > 0;
  }
}

/** Danh sách gửi lên server — bỏ câu bỏ trống. */
export function dapAnDeGui(d: DapAnTheoCau): { questionId: string; dapAn: DapAn }[] {
  return Object.entries(d)
    .filter(([, a]) => coNoiDungDapAn(a))
    .map(([questionId, dapAn]) => ({ questionId, dapAn }));
}

const CHU = "ABCDEFGHIJKLMNOP";

const o = "rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors";
const chon = "border-orange-500 bg-orange-50 text-foreground";
const chua = "border-border bg-card text-foreground hover:border-orange-300";

export function CauHoiLamBai({
  cauHoi,
  dapAn,
  onChange,
  disabled,
  ketQua,
  videoSlot,
}: {
  cauHoi: CauHoiHocVien[];
  dapAn: DapAnTheoCau;
  onChange: (questionId: string, a: DapAn) => void;
  disabled?: boolean;
  /** Chỉ có khi bài ĐÃ CHẤM: câu nào đúng/sai (null = chấm tay, không đánh dấu). */
  ketQua?: Record<string, boolean | null>;
  /** Ô tải video đặt đúng vị trí câu «Nộp video». */
  videoSlot?: (q: CauHoiHocVien) => ReactNode;
}) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
      {cauHoi.map((q, idx) => {
        const kq = ketQua?.[q.id];
        return (
          <li key={q.id} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-3.5">
            <div className="flex items-start gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-orange-100 text-xs font-bold text-orange-800">{idx + 1}</span>
              <div className="min-w-0 flex-1">
                {q.type !== "fill" && <p className="m-0 whitespace-pre-wrap break-words text-[15px] font-semibold leading-6 text-foreground">{q.question}</p>}
                {q.type === "fill" && <p className="m-0 text-xs font-semibold text-muted-foreground">Điền vào chỗ trống</p>}
              </div>
              {kq === true && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  <Check className="size-3.5" aria-hidden /> Đúng
                </span>
              )}
              {kq === false && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                  <X className="size-3.5" aria-hidden /> Chưa đúng
                </span>
              )}
            </div>
            {q.imageUrl && (
              <img src={q.imageUrl} alt="Hình của câu hỏi" className="max-h-64 w-auto max-w-full self-start rounded-xl border border-border object-contain" />
            )}
            <Than q={q} d={dapAn[q.id]} onChange={(a) => onChange(q.id, a)} disabled={disabled} videoSlot={videoSlot} />
          </li>
        );
      })}
    </ol>
  );
}

function Than({
  q,
  d,
  onChange,
  disabled,
  videoSlot,
}: {
  q: CauHoiHocVien;
  d: DapAn | undefined;
  onChange: (a: DapAn) => void;
  disabled?: boolean;
  videoSlot?: (q: CauHoiHocVien) => ReactNode;
}) {
  switch (q.type) {
    case "single":
      return (
        <div role="radiogroup" className="flex flex-col gap-2">
          {q.options.map((text, i) => {
            const dangChon = d?.k === "single" && d.i === i;
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={dangChon}
                disabled={disabled}
                onClick={() => onChange({ k: "single", i })}
                className={cn(o, "flex min-h-11 items-center gap-2.5", dangChon ? chon : chua)}
              >
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-xs font-bold", dangChon ? "border-orange-600 bg-orange-600 text-white" : "border-border text-muted-foreground")}>{CHU[i] ?? i + 1}</span>
                <span className="min-w-0 break-words">{text}</span>
              </button>
            );
          })}
        </div>
      );
    case "multiple": {
      const dangChon = d?.k === "multiple" ? d.i : [];
      return (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs text-muted-foreground">Chọn một hoặc nhiều đáp án.</p>
          {q.options.map((text, i) => {
            const co = dangChon.includes(i);
            return (
              <button
                key={i}
                type="button"
                role="checkbox"
                aria-checked={co}
                disabled={disabled}
                onClick={() => onChange({ k: "multiple", i: co ? dangChon.filter((x) => x !== i) : [...dangChon, i].sort((a, b) => a - b) })}
                className={cn(o, "flex min-h-11 items-center gap-2.5", co ? chon : chua)}
              >
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-md border", co ? "border-orange-600 bg-orange-600 text-white" : "border-border")}>{co && <Check className="size-4" aria-hidden />}</span>
                <span className="min-w-0 break-words">{text}</span>
              </button>
            );
          })}
        </div>
      );
    }
    case "boolean":
      return (
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {[true, false].map((v) => {
            const dangChon = d?.k === "boolean" && d.v === v;
            return (
              <button key={String(v)} type="button" role="radio" aria-checked={dangChon} disabled={disabled} onClick={() => onChange({ k: "boolean", v })} className={cn(o, "min-h-11 text-center font-semibold", dangChon ? chon : chua)}>
                {v ? "Đúng" : "Sai"}
              </button>
            );
          })}
        </div>
      );
    case "fill": {
      const t = d?.k === "fill" ? d.t : [];
      const phan = q.question.split(/_{2,}/);
      const set = (i: number, v: string) => {
        const moi = Array.from({ length: q.soCho }, (_, k) => t[k] ?? "");
        moi[i] = v;
        onChange({ k: "fill", t: moi });
      };
      const o_ = (i: number) => (
        <input
          key={`o${i}`}
          type="text"
          value={t[i] ?? ""}
          onChange={(e) => set(i, e.target.value)}
          disabled={disabled}
          maxLength={200}
          aria-label={`Chỗ trống ${i + 1}`}
          className="mx-1 inline-block h-9 w-32 max-w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground focus:border-orange-500 focus:outline-none"
        />
      );
      return (
        <p className="m-0 whitespace-pre-wrap break-words text-[15px] leading-9 text-foreground">
          {phan.map((p, i) => (
            <span key={i}>
              {p}
              {i < phan.length - 1 && i < q.soCho ? o_(i) : null}
            </span>
          ))}
          {/* Đề có ít dấu ______ hơn số chỗ trống đã khai ⇒ vẫn cho điền đủ, kẻo mất chỗ làm. */}
          {phan.length - 1 < q.soCho && Array.from({ length: q.soCho - (phan.length - 1) }, (_, k) => o_(phan.length - 1 + k))}
        </p>
      );
    }
    case "short":
      return (
        <input type="text" value={d?.k === "text" ? d.t : ""} onChange={(e) => onChange({ k: "text", t: e.target.value })} disabled={disabled} maxLength={500} placeholder="Câu trả lời của em" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:border-orange-500 focus:outline-none" />
      );
    case "essay":
      return (
        <textarea value={d?.k === "text" ? d.t : ""} onChange={(e) => onChange({ k: "text", t: e.target.value })} disabled={disabled} rows={5} maxLength={2000} placeholder="Viết câu trả lời của em…" className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-6 text-foreground focus:border-orange-500 focus:outline-none" />
      );
    case "matching": {
      const r = d?.k === "matching" ? d.r : [];
      return (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs text-muted-foreground">Chọn mục bên phải ghép với mỗi mục bên trái.</p>
          {q.trai.map((tr, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <span className="min-w-0 flex-1 break-words rounded-xl bg-muted px-3 py-2 text-sm text-foreground">{tr}</span>
              <span aria-hidden className="text-muted-foreground">↔</span>
              <select
                value={r[i] ?? ""}
                disabled={disabled}
                onChange={(e) => {
                  const moi = Array.from({ length: q.trai.length }, (_, k) => r[k] ?? "");
                  moi[i] = e.target.value;
                  onChange({ k: "matching", r: moi });
                }}
                aria-label={`Ghép với “${tr}”`}
                className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-2 text-sm text-foreground focus:border-orange-500 focus:outline-none"
              >
                <option value="">— Chọn —</option>
                {q.phai.map((p, k) => (
                  <option key={k} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      );
    }
    case "ordering": {
      const ds = d?.k === "ordering" ? d.o : q.muc;
      const doi = (i: number, j: number) => {
        if (j < 0 || j >= ds.length) return;
        const moi = [...ds];
        [moi[i], moi[j]] = [moi[j] as string, moi[i] as string];
        onChange({ k: "ordering", o: moi });
      };
      return (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs text-muted-foreground">Dùng mũi tên để sắp các mục theo đúng thứ tự.</p>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {ds.map((m, i) => (
              <li key={`${m}-${i}`} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 break-words text-sm text-foreground">{m}</span>
                <button type="button" onClick={() => doi(i, i - 1)} disabled={disabled || i === 0} aria-label={`Đưa “${m}” lên`} className="grid size-9 place-items-center rounded-lg border border-border text-foreground disabled:opacity-30">
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button type="button" onClick={() => doi(i, i + 1)} disabled={disabled || i === ds.length - 1} aria-label={`Đưa “${m}” xuống`} className="grid size-9 place-items-center rounded-lg border border-border text-foreground disabled:opacity-30">
                  <ArrowDown className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case "video":
      return <div className="flex flex-col gap-1.5">{videoSlot ? videoSlot(q) : <p className="m-0 text-sm text-muted-foreground">Câu này nộp bằng video.</p>}</div>;
  }
}
