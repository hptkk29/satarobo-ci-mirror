"use client";

// Ô "Khoá học" của MỘT bé trong lớp trial (26/09/2026).
//
// Giá trị là KHOÁ QUAN TÂM của bé — đổi ở đây là đổi luôn khoá quan tâm trên hồ sơ lead
// (cùng một cột, xem `lib/trial/khoa-truoc-case.ts`). Nói thẳng điều đó ở `title` để người
// bấm không tưởng mình chỉ đổi một ô của lớp này.
//
// Không có quyền / bé đã học xong / lớp đã kết thúc ⇒ in CHỮ (tên khoá), không vẽ một ô
// chọn bị khoá: ô khoá mà vẫn trông như chọn được là lời hứa suông (luật 12).

import type { JSX } from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { datKhoaHocTrialAction } from "../_actions";
import type { EnrollmentRow, KhoaHocOption } from "../_lib/types";

export function OKhoaHoc({
  trialClassId,
  row,
  options,
  sua,
}: {
  trialClassId: string;
  row: EnrollmentRow;
  options: KhoaHocOption[];
  /** Được đổi khoá không — bên gọi đã xét quyền + trạng thái bé + trạng thái lớp. */
  sua: boolean;
}): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!sua) {
    return row.khoaHocTen ? (
      <span className="text-foreground">{row.khoaHocTen}</span>
    ) : (
      <span className="text-xs font-medium text-state-warning-ink">Chưa chọn khoá</span>
    );
  }

  function doi(courseId: string) {
    if (!courseId || courseId === row.khoaHocId) return;
    startTransition(async () => {
      const res = await datKhoaHocTrialAction({
        trialClassId,
        trialEnrollmentId: row.id,
        courseId,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Đã chọn khoá học cho ${row.childName}`);
      router.refresh();
    });
  }

  const chuaCo = !row.khoaHocId;
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={row.khoaHocId ?? ""}
        disabled={pending}
        onChange={(ev) => doi(ev.target.value)}
        aria-label={`Khoá học của ${row.childName}`}
        title="Khoá học thử của bé = khoá quan tâm của bé. Đổi ở đây là đổi luôn khoá quan tâm trên hồ sơ lead."
        className={[
          "max-w-[220px] rounded-lg border bg-card px-2.5 py-1.5 text-xs text-foreground disabled:opacity-50",
          chuaCo ? "border-state-warning" : "border-border",
        ].join(" ")}
      >
        <option value="" disabled>
          {/* `khoaHocTen` khi bé CHƯA có khoá là khoá của LỚP (chỉ lớp cũ) — nói rõ đó
              là của lớp. Bé đã có khoá thì dòng này chỉ là gợi ý trống, không nhắc lớp. */}
          {chuaCo && row.khoaHocTen ? `Khoá của lớp: ${row.khoaHocTen}` : "Chọn khoá học…"}
        </option>
        {options.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {/* Bé chưa có khoá riêng, đang lấy khoá quan tâm của phụ huynh — nói ra để Sale biết
          giá trị này ĐẾN TỪ ĐÂU (đổi ở đây là ghi riêng cho bé, và lead đổi theo). */}
      {row.khoaTuLead && !pending && (
        <span className="text-[11px] text-muted-foreground">theo khoá của PH</span>
      )}
    </span>
  );
}
