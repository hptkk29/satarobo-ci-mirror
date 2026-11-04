"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { moKhoaThiAction } from "../_actions";

/**
 * EL-14d — MỞ THÊM MỘT LƯỢT THI.
 *
 * ⚠️ Màn này tồn tại vì trình phát nói với người học "liên hệ Đào tạo nếu cần mở
 * thêm lượt". Không có nút nào để Đào tạo bấm thì câu đó là lời hứa suông, và người
 * học chờ mãi ở một bài nghĩa vụ có hạn chót cứng.
 *
 * ⚠️ Chỉ liệt kê người ĐÃ HẾT lượt. Mở khoá cho người vẫn thi được là để lại một
 * dòng nhiễu trong hồ sơ của họ — server cũng chặn, nhưng để bấm được rồi mới báo
 * lỗi là bắt người xử thao tác một vòng vô ích.
 */
export function UnlockPanel(props: {
  examId: string;
  hetLuot: { userId: string; ten: string; soLuot: number; datChua: boolean }[];
  tranLuot: number;
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState<string | null>(null);
  const [lyDo, setLyDo] = useState("");

  if (props.hetLuot.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Chưa ai dùng hết {props.tranLuot} lượt thi của đề này.
      </p>
    );
  }

  const moKhoa = (userId: string) =>
    batDau(async () => {
      const r = await moKhoaThiAction({
        examId: props.examId,
        userId,
        reason: lyDo.trim(),
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã mở thêm một lượt");
      setMo(null);
      setLyDo("");
      router.refresh();
    });

  return (
    <ul className="space-y-2">
      {props.hetLuot.map((n) => (
        <li key={n.userId} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span>{n.ten}</span>
            <span className="text-xs text-muted-foreground">
              đã thi {n.soLuot} lượt · {n.datChua ? "đã đạt" : "chưa đạt"}
            </span>
          </div>

          {mo === n.userId ? (
            <div className="mt-2 space-y-2">
              <input
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                placeholder="Vì sao mở thêm lượt (bắt buộc, ít nhất 10 ký tự)"
                className="w-full rounded-md border px-2 py-1 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  // Khoá nút cho tới khi đủ lý do: server cũng chặn, nhưng để bấm
                  // được rồi mới báo lỗi là bắt họ gõ lại từ đầu, và họ sẽ học cách
                  // gõ một dấu chấm cho xong.
                  disabled={dangChay || lyDo.trim().length < 10}
                  onClick={() => moKhoa(n.userId)}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                >
                  {dangChay ? "Đang mở…" : "Mở thêm một lượt"}
                </button>
                <button
                  type="button"
                  onClick={() => setMo(null)}
                  className="rounded-md border px-3 py-1.5 text-xs"
                >
                  Thôi
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMo(n.userId)}
              className="mt-2 rounded-md border px-2 py-1 text-xs"
            >
              Mở thêm lượt
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
