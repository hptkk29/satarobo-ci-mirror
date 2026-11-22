"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ganDeVaoBaiAction } from "../_actions";
import { GhiChu } from "../../_components/ui/trang";
import { LIEN_KET_CHU, NUT_CHINH, O_CHON } from "../../_components/ui/dieu-khien";

/**
 * EL-14d — GẮN ĐỀ VÀO BÀI KIỂM TRA.
 *
 * ⚠️ Chỉ hiện đề ĐÃ KÍCH HOẠT. Cho chọn đề nháp là để bài đi ra với người học trên
 * một bộ câu còn sửa được — server cũng chặn, nhưng để chọn được rồi mới báo lỗi
 * là bắt người soạn đoán luật.
 */
export function QuizLessonEditor(props: {
  lessonId: string;
  examIdHienCo: string | null;
  /** Đề đã kích hoạt, trong phạm vi của người soạn. */
  cacDe: { id: string; title: string; soCau: number; maxScore: number; passScore: number }[];
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [chon, setChon] = useState(props.examIdHienCo ?? "");

  const luu = (examId: string | null) =>
    batDau(async () => {
      const r = await ganDeVaoBaiAction({ lessonId: props.lessonId, examId });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(examId ? "Đã gắn đề vào bài" : "Đã gỡ đề khỏi bài");
      router.refresh();
    });

  if (props.cacDe.length === 0) {
    return (
      <GhiChu sac="warning" tieuDe="Chưa có đề nào đã kích hoạt để gắn vào bài này.">
        {/* Nói LỐI RA, không chỉ nói "chưa có". */}
        Dựng đề ở{" "}
        <Link href="/elearning/de-thi" className={LIEN_KET_CHU}>
          màn đề thi
        </Link>
        , kích hoạt xong rồi quay lại đây.
      </GhiChu>
    );
  }

  const daChon = props.cacDe.find((d) => d.id === chon);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Bài kiểm tra phải gắn một đề thì mới xuất bản khoá được.
      </p>

      <select
        value={chon}
        onChange={(e) => setChon(e.target.value)}
        aria-label="Đề thi gắn vào bài"
        className={O_CHON}
      >
        <option value="">— chưa gắn đề —</option>
        {props.cacDe.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title} ({d.soCau} câu · đạt {d.passScore}/{d.maxScore})
          </option>
        ))}
      </select>

      {daChon ? (
        <p className="text-sm text-muted-foreground">
          Người học phải đạt {daChon.passScore}/{daChon.maxScore} điểm thì bài này mới
          tính là xong.
        </p>
      ) : null}

      <button
        type="button"
        disabled={dangChay || chon === (props.examIdHienCo ?? "")}
        onClick={() => luu(chon || null)}
        className={NUT_CHINH}
      >
        {dangChay ? "Đang lưu…" : "Lưu"}
      </button>
    </div>
  );
}
