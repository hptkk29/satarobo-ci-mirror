"use client";
// PR6 (chủ dự án 24/10/2026): ô có ca trực + buổi HỌC BÙ chưa ai quyết ⇒ hỏi QLCS ngay trong ngăn chi tiết ô. Chỉ vẽ khi trang báo người xem
// phân công được ở cơ sở này + công tắc bật (luật 12); action đọc lại case + dòng trực ở máy chủ.
// Câu hỏi đúng nguyên văn nghiệp vụ; "Không" bắt buộc lý do (dòng trực bị huỷ, có nhật ký).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import { chotTrucBuAction } from "../_actions";

export function QuyetTrucBu({ buoi, shiftLabel, onXong }: { buoi: { caseId: string; gio: string }[]; shiftLabel: string; onXong: () => void }) {
  const router = useRouter();
  const [dang, start] = useTransition();
  const [bo, setBo] = useState<string | null>(null);
  const [lyDo, setLyDo] = useState("");

  const gui = (caseId: string, giu: boolean) =>
    start(async () => {
      const r = await chotTrucBuAction({ caseId, giu, lyDo: giu ? null : lyDo });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setBo(null);
      setLyDo("");
      onXong();
      router.refresh();
    });

  return (
    <section aria-labelledby="quyet-truc" className="rounded-lg border border-state-warning-ink/30 bg-state-warning-soft p-3 text-state-warning-ink">
      <h3 id="quyet-truc" className="text-sm font-semibold">
        Cần quyết định trực
      </h3>
      <p className="mt-1 text-sm">
        GV đang có ca trực {shiftLabel}. Sau khi nhận buổi bù, giáo viên có tiếp tục đảm nhiệm nhiệm vụ trực trong phần còn lại của ca không?
      </p>
      <ul className="mt-2 space-y-2">
        {buoi.map((b) => (
          <li key={b.caseId} className="rounded-md bg-card p-2 text-foreground">
            <p className="text-xs text-muted-foreground">
              Buổi bù <span className="tabular-nums">{b.gio}</span>
            </p>
            {bo === b.caseId ? (
              <div className="mt-2 space-y-2">
                <label className="block text-xs font-medium">
                  Lý do kết thúc trực (bắt buộc — dòng trực bị huỷ, có nhật ký)
                  <textarea rows={2} maxLength={500} className={cn(FIELD, "mt-1 h-auto w-full py-2")} value={lyDo} onChange={(e) => setLyDo(e.target.value)} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={BTN_PRIMARY} disabled={dang || lyDo.trim().length < 5} onClick={() => gui(b.caseId, false)}>
                    {dang ? "Đang lưu…" : "Kết thúc trực — chỉ dạy bù (D)"}
                  </button>
                  <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={() => setBo(null)}>
                    Quay lại
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN_PRIMARY} disabled={dang} onClick={() => gui(b.caseId, true)}>
                  Có — giữ trực (TD)
                </button>
                <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={() => setBo(b.caseId)}>
                  Không — chỉ dạy bù (D)
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs opacity-90">Chưa quyết thì lưới không tính tiền trực của ca này. Huỷ buổi bù sau đó không tự giao lại trực đã kết thúc.</p>
    </section>
  );
}
