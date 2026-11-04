"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ganKhungVaoBaiAction } from "../_actions";

/**
 * EL-15c — GẮN KHUNG CHẤM VÀO MỘT BÀI TẬP.
 *
 * ⚠️ Màn này tồn tại vì `TASK` mở ở PR này. Mở loại bài mà người soạn không có chỗ
 * gắn khung là đúng cái bẫy `lesson-kind.ts` sinh ra để gỡ, chỉ đổi người bị kẹt:
 * từ người học sang người soạn.
 *
 * ⚠️ Chỉ liệt kê khung ĐÃ KÍCH HOẠT. Gắn khung nháp là để bài đi ra với người học
 * trên một bộ tiêu chí còn sửa được — và khung sửa xong thì điểm của người nộp
 * trước lệch khỏi thang của người nộp sau.
 */
export function TaskLessonEditor(props: {
  lessonId: string;
  rubricIdHienCo: string | null;
  /** Khung đã kích hoạt, trong phạm vi của người soạn. */
  cacKhung: {
    id: string;
    code: string;
    title: string;
    soTieuChi: number;
    totalPoints: number;
    passPoints: number;
  }[];
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [chon, setChon] = useState(props.rubricIdHienCo ?? "");

  const luu = (rubricId: string | null) =>
    batDau(async () => {
      const r = await ganKhungVaoBaiAction({ lessonId: props.lessonId, rubricId });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(rubricId ? "Đã gắn khung chấm" : "Đã gỡ khung chấm");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3 text-sm">
        <p className="font-medium">Khung chấm của bài tập này</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Người học ĐỌC ĐƯỢC khung trước khi làm — ở bài thực hành, biết trước tiêu
          chí là một phần của việc học.
        </p>

        {props.cacKhung.length === 0 ? (
          // Không có khung nào thì nói ĐƯỜNG ĐI, đừng để một ô chọn rỗng.
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Chưa có khung nào được kích hoạt. Dựng khung ở{" "}
            <Link href="/elearning/khung-cham" className="underline">
              màn khung chấm
            </Link>{" "}
            rồi quay lại đây.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            <select
              value={chon}
              onChange={(e) => setChon(e.target.value)}
              className="w-full rounded-md border px-2 py-1 text-sm"
            >
              <option value="">— chưa gắn khung —</option>
              {props.cacKhung.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.code} · {k.title} ({k.soTieuChi} tiêu chí, đạt {k.passPoints}/
                  {k.totalPoints})
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={dangChay || chon === (props.rubricIdHienCo ?? "")}
                onClick={() => luu(chon || null)}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
              >
                {dangChay ? "Đang lưu…" : "Lưu"}
              </button>
            </div>
          </div>
        )}

        {!props.rubricIdHienCo ? (
          // Cổng xuất bản sẽ chặn — nói TRƯỚC, ở đây, thay vì để người soạn bấm
          // xuất bản rồi mới biết.
          <p className="mt-2 text-xs text-amber-800">
            Chưa gắn khung thì khoá này không xuất bản được.
          </p>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Bài đã có lượt nộp đang chờ chấm thì không đổi khung được — chấm xong đã.
      </p>
    </div>
  );
}
