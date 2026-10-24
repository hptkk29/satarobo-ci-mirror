"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { themCueAction, xoaCueAction } from "../_actions";
import { CUE_TOI_DA, LOAI_CUE } from "@/lib/elearning/lesson-cue";

/**
 * EL-12c — SOẠN CÂU HỎI CHÈN GIỮA VIDEO.
 *
 * ⚠️ Màn này chỉ cho ba loại câu: một-đáp-án · nhiều-đáp-án · đúng/sai. Không phải
 * để gọn — mà vì repo KHÔNG có mã chấm cho `fill`/`matching`/`ordering`, và câu hỏi
 * chèn giữa video mặc định CHẶN. Một câu không ai chấm nổi trong một cổng chặn là
 * video khoá cứng vĩnh viễn, và người học không có đường nào ngoài bỏ bài.
 *
 * ⚠️ Nhập mốc bằng PHÚT:GIÂY, không bằng số giây thô. Người soạn nhìn thanh thời
 * gian của trình phát ở dạng `2:30`; bắt họ tự nhân 150 là mời họ gõ sai.
 */

type Cue = {
  id: string;
  atSec: number;
  blocking: boolean;
  cauHoi: string;
  loai: string;
};

const NHAN_LOAI: Record<string, string> = {
  single: "Một đáp án",
  multiple: "Nhiều đáp án",
  boolean: "Đúng / Sai",
};

const dinhDangGiay = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** `"2:30"` → 150. Trả `null` nếu không đọc được. */
function docMoc(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (!t.includes(":")) {
    const n = Number(t);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const [p, g] = t.split(":");
  const phut = Number(p);
  const giay = Number(g);
  if (!Number.isInteger(phut) || !Number.isInteger(giay)) return null;
  if (phut < 0 || giay < 0 || giay > 59) return null;
  const tong = phut * 60 + giay;
  return tong > 0 ? tong : null;
}

export function CueEditor(props: {
  lessonId: string;
  durationSec: number | null;
  cues: Cue[];
  /** Số người đã có tiến độ trên bài — quyết định có thêm được câu CHẶN không. */
  soNguoiHoc: number;
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [moc, setMoc] = useState("");
  const [loai, setLoai] = useState<string>("single");
  const [cauHoi, setCauHoi] = useState("");
  const [dapAn, setDapAn] = useState(["", "", "", ""]);
  /**
   * Chỉ số các ô ĐÚNG, theo mảng CHƯA lọc.
   *
   * ⚠️ Là một TẬP, không phải một số. Bản đầu giữ đúng một số nguyên và dựng ô
   * chọn bằng radio cho cả loại "Nhiều đáp án" — nên loại đó chỉ đánh dấu được
   * một ý, và câu người soạn tưởng có hai đáp án đúng thì không ai trả lời đúng
   * được. Với cue CHẶN, đó là video khoá cứng vĩnh viễn.
   */
  const [dung, setDung] = useState<number[]>([0]);
  const [dungBool, setDungBool] = useState(true);
  const [chan, setChan] = useState(true);

  const atSec = docMoc(moc);
  const quaTran = props.cues.length >= CUE_TOI_DA;
  const chanBiKhoa = props.soNguoiHoc > 0;

  const them = () => {
    if (atSec == null) {
      toast.error("Mốc thời gian phải dạng 2:30 hoặc số giây");
      return;
    }
    // ⚠️ LỌC TRƯỚC, rồi ánh xạ chỉ số sang mảng đã lọc.
    //
    // Bản đầu gửi `options` ĐÃ lọc kèm chỉ số của mảng CHƯA lọc. Người soạn tích
    // ô 4 rồi xoá trắng ô 2 là gửi lên `options` 3 phần tử với `correctIndex: 3` —
    // trỏ ra NGOÀI mảng. Zod không kiểm chéo hai trường đó, nên nó lưu thành công,
    // và câu hỏi ấy KHÔNG ĐÁP ÁN NÀO đúng được: với cue chặn là khoá cứng vĩnh
    // viễn, và người học chỉ thấy "Chưa đúng" lặp vô hạn.
    const giu = dapAn
      .map((v, i) => ({ v: v.trim(), i }))
      .filter((x) => x.v.length > 0);
    const options = giu.map((x) => x.v);
    const chiSoMoi = dung
      .map((cu) => giu.findIndex((x) => x.i === cu))
      .filter((x) => x >= 0);

    if (loai !== "boolean" && chiSoMoi.length === 0) {
      toast.error("Ô được đánh dấu đúng đang để trống — chọn lại đáp án đúng");
      return;
    }

    const cau =
      loai === "boolean"
        ? { id: crypto.randomUUID(), type: "boolean" as const, question: cauHoi, correct: dungBool }
        : loai === "multiple"
          ? {
              id: crypto.randomUUID(),
              type: "multiple" as const,
              question: cauHoi,
              options,
              correctIndices: chiSoMoi,
            }
          : {
              id: crypto.randomUUID(),
              type: "single" as const,
              question: cauHoi,
              options,
              correctIndex: chiSoMoi[0]!,
            };

    batDau(async () => {
      const r = await themCueAction({
        lessonId: props.lessonId,
        atSec,
        cauHoi: cau,
        blocking: chan && !chanBiKhoa,
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã thêm câu hỏi");
      setMoc("");
      setCauHoi("");
      setDapAn(["", "", "", ""]);
      setDung([0]);
      router.refresh();
    });
  };

  const xoa = (cueId: string) => {
    batDau(async () => {
      const r = await xoaCueAction({ lessonId: props.lessonId, cueId });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã xoá câu hỏi");
      router.refresh();
    });
  };

  if (!props.durationSec) {
    return (
      <p className="text-sm text-muted-foreground">
        Tải video lên trước rồi mới đặt được câu hỏi chèn giữa bài.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold">Câu hỏi chèn giữa video</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Video dài {dinhDangGiay(props.durationSec)}. Tối đa {CUE_TOI_DA} câu.
        </p>
      </div>

      {props.cues.length > 0 ? (
        <ul className="space-y-2">
          {props.cues.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 rounded-md border p-2 text-sm">
              <div>
                <span className="font-mono text-xs">{dinhDangGiay(c.atSec)}</span>
                <span className="ml-2">{c.cauHoi}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {NHAN_LOAI[c.loai] ?? c.loai}
                  {c.blocking ? " · dừng video" : " · không dừng"}
                </span>
              </div>
              <button
                type="button"
                disabled={dangChay}
                onClick={() => xoa(c.id)}
                className="shrink-0 rounded-md border px-2 py-1 text-xs disabled:opacity-50"
              >
                Xoá
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Chưa có câu hỏi nào.</p>
      )}

      {chanBiKhoa ? (
        // Nói TRƯỚC, không để họ soạn xong rồi mới báo lỗi.
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Bài này đã có {props.soNguoiHoc} người học. Câu hỏi thêm bây giờ sẽ{" "}
          <strong>không dừng video</strong> — thêm câu dừng video lúc này là đổi
          điều kiện hoàn thành dưới chân họ. Cần câu dừng video thì tạo phiên bản
          khoá mới.
        </p>
      ) : null}

      {quaTran ? (
        <p className="text-sm text-muted-foreground">
          Đã đủ {CUE_TOI_DA} câu — xoá bớt nếu muốn thêm câu khác.
        </p>
      ) : (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={moc}
              onChange={(e) => setMoc(e.target.value)}
              placeholder="Mốc, vd 2:30"
              className="w-28 rounded-md border px-2 py-1 text-sm"
            />
            <select
              value={loai}
              onChange={(e) => setLoai(e.target.value)}
              className="rounded-md border px-2 py-1 text-sm"
            >
              {LOAI_CUE.map((t) => (
                <option key={t} value={t}>
                  {NHAN_LOAI[t]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={chan && !chanBiKhoa}
                disabled={chanBiKhoa}
                onChange={(e) => setChan(e.target.checked)}
              />
              Dừng video tới khi trả lời
            </label>
          </div>

          <textarea
            value={cauHoi}
            onChange={(e) => setCauHoi(e.target.value)}
            rows={2}
            placeholder="Nội dung câu hỏi"
            className="w-full rounded-md border px-2 py-1 text-sm"
          />

          {loai === "boolean" ? (
            <div className="flex gap-3 text-sm">
              {[true, false].map((v) => (
                <label key={String(v)} className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={dungBool === v}
                    onChange={() => setDungBool(v)}
                  />
                  Đáp án đúng: {v ? "Đúng" : "Sai"}
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {dapAn.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  {/* Loại "Nhiều đáp án" phải tích được NHIỀU ô. Dùng radio cho cả
                      hai loại là biến nhãn trên màn hình thành lời nói dối. */}
                  <input
                    type={loai === "multiple" ? "checkbox" : "radio"}
                    checked={dung.includes(i)}
                    onChange={() =>
                      setDung((cu) =>
                        loai === "multiple"
                          ? cu.includes(i)
                            ? cu.filter((x) => x !== i)
                            : [...cu, i].sort((a, b) => a - b)
                          : [i],
                      )
                    }
                    title="Đáp án đúng"
                  />
                  <input
                    value={v}
                    onChange={(e) =>
                      setDapAn((cu) => cu.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    placeholder={`Lựa chọn ${i + 1}`}
                    className="flex-1 rounded-md border px-2 py-1 text-sm"
                  />
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={dangChay || !cauHoi.trim() || atSec == null}
            onClick={them}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {dangChay ? "Đang lưu…" : "Thêm câu hỏi"}
          </button>
        </div>
      )}
    </div>
  );
}
