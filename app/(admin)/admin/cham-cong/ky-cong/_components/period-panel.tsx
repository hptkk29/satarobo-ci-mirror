"use client";

// app/(admin)/admin/cham-cong/ky-cong/_components/period-panel.tsx — công chuẩn + trạng thái kỳ + 4 thao tác.
//
// Vì sao file này tồn tại: mọi thứ "làm gì được với kỳ này" gom về một chỗ, thay vì rải nút khắp
// đầu trang. Bốn tư cách người dùng phải PHÂN BIỆT ĐƯỢC, vì bản cũ cho cả bốn cùng một ô nhập xám:
//   1. có `close-period`, kỳ đang mở            → sửa được công chuẩn, tính lại, chốt.
//   2. có `close-period` tại Hội sở, kỳ đã chốt → chỉ đọc, và nói rõ "mở lại trước đã" (nút Mở lại có).
//   3. có `close-period` tại CƠ SỞ, kỳ đã chốt  → chỉ đọc, và nói rõ mở lại cần quyền ở Hội sở, hỏi ai.
//   4. chỉ có `view`                            → chỉ đọc, và nói rõ THIẾU QUYỀN GÌ, hỏi ai.
// Ô xám không nói được bốn chuyện đó, nên kế toán cơ sở tưởng hệ thống hỏng.
//
// Ca 3 là ca dễ rơi nhất: `canReopen` đo tại HO (`ky-cong/page.tsx`), nên QLCS / Kế toán cơ sở —
// những người CÓ quyền chốt — lại KHÔNG mở lại được. Bảo họ "mở lại trước đã" rồi giấu nút là
// nói một việc rồi không cho làm; phải nêu key + hỏi ai, đúng khuôn nhánh `!canClose`.
//
// Dễ vỡ: giữ nguyên chữ ký `setStandardUnitsAction` / `recomputePeriodAction`; để trống ô công
// chuẩn rồi Lưu = server tự tính lại từ nghỉ tuần + lễ (đừng "sửa" thành gửi 0).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { PeriodStatusPill } from "@/components/admin/cham-cong/period-status-pill";
import { BTN_OUTLINE, FIELD } from "@/components/admin/cham-cong/classes";
import type { PeriodStatus } from "@/lib/cham-cong/module-scope";
import { recomputePeriodAction, setStandardUnitsAction } from "../_actions";
import { LockDialog, ReopenDialog } from "./lock-dialog";

type Res = { ok: true; note?: string } | { ok: false; error: string };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function PeriodPanel({
  centerId,
  ky,
  blockLabel,
  status,
  standardUnits,
  standardUnitsNote,
  canClose,
  canReopen,
  askWho,
}: {
  centerId: string;
  ky: string;
  blockLabel: string;
  status: PeriodStatus | null;
  standardUnits: number | null;
  standardUnitsNote: string | null;
  canClose: boolean;
  /** `close-period` tại HỘI SỞ — chỉ người này mới mở lại được kỳ đã chốt. */
  canReopen: boolean;
  /** Ai cấp được `hr_attendance:close-period` — `ASK_WHO` của module. */
  askWho: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [std, setStd] = useState(standardUnits != null ? String(standardUnits) : "");
  const [stdNote, setStdNote] = useState(standardUnitsNote ?? "");
  const locked = status === "LOCKED";
  const readOnly = locked || !canClose;

  const run = (fn: () => Promise<Res>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.note ?? "Xong");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });

  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Trạng thái kỳ">
          <PeriodStatusPill status={status} />
        </Field>

        {readOnly ? (
          <>
            <Field label="Công chuẩn">
              <span className="text-base font-semibold tabular-nums">
                {standardUnits != null ? standardUnits.toLocaleString("vi-VN") : "Chưa đặt"}
              </span>
            </Field>
            <Field label="Ghi chú công chuẩn">
              {standardUnitsNote ? (
                <span className="break-words">{standardUnitsNote}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Field>
          </>
        ) : (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Công chuẩn
            </dt>
            <dd className="mt-1">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="std-units" className="sr-only">
                  Số công chuẩn của kỳ
                </label>
                <input
                  id="std-units"
                  type="number"
                  step={0.5}
                  min={0}
                  max={31}
                  value={std}
                  onChange={(e) => setStd(e.target.value)}
                  className={cn(FIELD, "w-24 tabular-nums")}
                />
                <label htmlFor="std-note" className="sr-only">
                  Ghi chú công chuẩn
                </label>
                <input
                  id="std-note"
                  value={stdNote}
                  onChange={(e) => setStdNote(e.target.value)}
                  maxLength={200}
                  placeholder="Ghi chú (vd: trừ 1 ngày lễ)"
                  className={cn(FIELD, "w-56 max-w-full")}
                />
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      setStandardUnitsAction({
                        centerId,
                        ky,
                        standardUnits: std === "" ? null : Number(std),
                        note: stdNote,
                      }),
                    )
                  }
                >
                  Lưu
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Để trống rồi Lưu = tính lại tự động từ ngày nghỉ tuần + lễ.
              </p>
            </dd>
          </div>
        )}
      </dl>

      {locked && canClose && canReopen && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Kỳ đã chốt — bấm “Mở lại kỳ” ở đầu trang trước khi sửa công chuẩn hoặc tính lại.
        </p>
      )}
      {locked && canClose && !canReopen && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Kỳ đã chốt — số không sửa được nữa. Mở lại cần quyền{" "}
          <code className="font-mono text-[11px] text-foreground">hr_attendance:close-period</code> tại Hội sở —
          liên hệ {askWho}.
        </p>
      )}
      {!canClose && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Bạn đang xem. Sửa công chuẩn / chốt kỳ cần quyền{" "}
          <code className="font-mono text-[11px] text-foreground">hr_attendance:close-period</code> tại {blockLabel} —
          liên hệ {askWho}.
        </p>
      )}

    </div>
  );
}

/**
 * Bốn thao tác của kỳ, đứng ở `PageHeader` (nơi mắt tìm nút hành động) chứ không lẫn trong thẻ số.
 * Tách khỏi `PeriodPanel` vì hai khối nằm ở hai chỗ trên trang, nhưng vẫn cùng một tệp để "kỳ này
 * làm được gì" chỉ có một nơi quyết định.
 */
export function PeriodActions({
  centerId,
  ky,
  kyLabel,
  blockLabel,
  status,
  canClose,
  canReopen,
  canExport,
  periodEnded,
  periodEndLabel,
  people,
  units,
  flaggedDays,
  notComputedDays,
}: {
  centerId: string;
  ky: string;
  kyLabel: string;
  blockLabel: string;
  status: PeriodStatus | null;
  canClose: boolean;
  canReopen: boolean;
  canExport: boolean;
  periodEnded: boolean;
  periodEndLabel: string;
  people: number;
  units: number;
  flaggedDays: number;
  notComputedDays: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const locked = status === "LOCKED";

  return (
    <>
      {canClose && !locked && (
        <button
          type="button"
          className={BTN_OUTLINE}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r: Res = await recomputePeriodAction({ centerId, ky });
              if (r.ok) {
                toast.success(r.note ?? "Xong");
                router.refresh();
              } else {
                toast.error(r.error);
              }
            })
          }
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Tính lại
        </button>
      )}
      {canExport && (
        <a
          href={`/api/admin/cham-cong/export?centerId=${encodeURIComponent(centerId)}&ky=${encodeURIComponent(ky)}`}
          className={BTN_OUTLINE}
        >
          <Download className="h-4 w-4" aria-hidden /> Xuất Excel{locked ? "" : " (bản tạm)"}
        </a>
      )}
      {canClose && !locked && (
        <LockDialog
          centerId={centerId}
          ky={ky}
          kyLabel={kyLabel}
          blockLabel={blockLabel}
          people={people}
          units={units}
          flaggedDays={flaggedDays}
          notComputedDays={notComputedDays}
          periodEnded={periodEnded}
          periodEndLabel={periodEndLabel}
        />
      )}
      {canReopen && locked && (
        <ReopenDialog centerId={centerId} ky={ky} kyLabel={kyLabel} blockLabel={blockLabel} />
      )}
    </>
  );
}
