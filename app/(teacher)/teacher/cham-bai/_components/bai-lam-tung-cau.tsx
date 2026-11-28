// Bài làm TỪNG CÂU của học viên, ở màn chấm của giáo viên: câu trả lời của em + đáp án đúng + kết quả máy chấm.
// Điểm máy chấm chỉ là GỢI Ý (ô điểm bên phải được điền sẵn, thầy cô sửa rồi bấm lưu); câu tự luận / trả lời ngắn / video do thầy cô chấm.
import { Check, CircleDashed, Minus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BaiLamXem, CauXemChoGV } from "@/lib/assignments/xem-bai-lam";

function Ket({ c }: { c: CauXemChoGV }) {
  if (c.tiLe === null)
    return (
      <Badge variant="outline" className="gap-1">
        <CircleDashed className="size-3.5" aria-hidden /> Thầy cô chấm
      </Badge>
    );
  if (c.tiLe === 1)
    return (
      <Badge variant="outline" className="gap-1 border-state-success-soft text-state-success-ink dark:border-state-success">
        <Check className="size-3.5" aria-hidden /> Đúng
      </Badge>
    );
  if (c.tiLe === 0)
    return (
      <Badge variant="outline" className="gap-1 border-state-danger-soft text-state-danger-ink dark:border-state-danger">
        <X className="size-3.5" aria-hidden /> Sai
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 border-state-warning-soft text-state-warning-ink dark:border-state-warning">
      <Minus className="size-3.5" aria-hidden /> Đúng một phần ({Math.round(c.tiLe * 100)}%)
    </Badge>
  );
}

export function BaiLamTungCau({ bai, totalPoints }: { bai: BaiLamXem; totalPoints: number }) {
  const soTuDong = bai.cau.length - bai.soCauChamTay;
  return (
    <section aria-label="Bài làm từng câu" className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">Bài làm từng câu ({bai.cau.length} câu)</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {soTuDong > 0 && (
            <>
              Máy đã chấm {soTuDong} câu: <b className="text-foreground">{bai.diemTuDong}/{totalPoints} điểm</b>.{" "}
            </>
          )}
          {bai.conChamTay ? `Còn ${bai.soCauChamTay} câu thầy cô chấm (tự luận, trả lời ngắn, video) — điểm chốt do thầy cô nhập bên phải.` : "Không còn câu nào phải chấm tay."}
        </p>
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {bai.cau.map((c) => (
          <li key={c.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm font-semibold text-foreground">
                Câu {c.so}. {c.de}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">{c.nhanLoai}</span>
                <Ket c={c} />
              </div>
            </div>
            {c.loai === "video" ? (
              <p className="text-sm text-muted-foreground">Video của em nằm ở phần tệp bài nộp bên dưới.</p>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Em trả lời</p>
                  {c.traLoi ? (
                    <ul className="mt-1 list-none space-y-0.5 p-0 text-sm text-foreground">
                      {c.traLoi.map((d, i) => (
                        <li key={i} className="whitespace-pre-wrap break-words">
                          {d}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm italic text-muted-foreground">Bỏ trống</p>
                  )}
                </div>
                {c.dapAnDung && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.tiLe === null ? "Đáp án gợi ý" : "Đáp án đúng"}</p>
                    <ul className="mt-1 list-none space-y-0.5 p-0 text-sm text-muted-foreground">
                      {c.dapAnDung.map((d, i) => (
                        <li key={i} className="whitespace-pre-wrap break-words">
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
