"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ganKhungVaoBaiAction } from "../_actions";
import { GhiChu } from "../../_components/ui/trang";
import { LIEN_KET_CHU, NUT_CHINH, O_CHON } from "../../_components/ui/dieu-khien";

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
      <div className="space-y-3 text-sm">
        <p className="text-sm text-muted-foreground">
          Người học ĐỌC ĐƯỢC khung trước khi làm — ở bài thực hành, biết trước tiêu
          chí là một phần của việc học.
        </p>

        {props.cacKhung.length === 0 ? (
          // Không có khung nào thì nói ĐƯỜNG ĐI, đừng để một ô chọn rỗng.
          <GhiChu sac="warning">
            Chưa có khung nào được kích hoạt. Dựng khung ở{" "}
            <Link href="/elearning/khung-cham" className={LIEN_KET_CHU}>
              màn khung chấm
            </Link>{" "}
            rồi quay lại đây.
          </GhiChu>
        ) : (
          <div className="space-y-2">
            <select
              value={chon}
              onChange={(e) => setChon(e.target.value)}
              aria-label="Khung chấm gắn vào bài"
              className={O_CHON}
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
                className={NUT_CHINH}
              >
                {dangChay ? "Đang lưu…" : "Lưu"}
              </button>
            </div>
          </div>
        )}

        {!props.rubricIdHienCo ? (
          // Cổng xuất bản sẽ chặn — nói TRƯỚC, ở đây, thay vì để người soạn bấm
          // xuất bản rồi mới biết.
          <GhiChu sac="warning">Chưa gắn khung thì khoá này không xuất bản được.</GhiChu>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        Bài đã có lượt nộp đang chờ chấm thì không đổi khung được — chấm xong đã.
      </p>
    </div>
  );
}
