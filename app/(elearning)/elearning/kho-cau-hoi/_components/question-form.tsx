"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { taoCauHoiAction, suaCauHoiAction, xoaCauHoiAction } from "../_actions";
// ⚠️ Nhập TỪ module thuần. `question-bank.ts` nhập `orgUnitIdForCenter` (chạm DB),
// nên lấy hằng từ đó sẽ kéo mã máy chủ vào gói client và làm vỡ build.
import { LOAI_CHAM_MAY, LOAI_CHAM_TAY, MUC_KHO } from "@/lib/elearning/exam-grading";

/**
 * EL-14b — SOẠN MỘT CÂU HỎI.
 *
 * ⚠️ Chỉ hiện năm loại DÙNG ĐƯỢC trong đề. Bốn loại còn lại của enum
 * (`FILL_BLANK`/`MATCHING`/`ORDERING`/`CASE`) chưa có mã chấm, và cho soạn là để
 * người ta bỏ công viết những câu không bao giờ dùng được.
 *
 * ⚠️ Ô "đáp án đúng" đổi hình theo loại: câu một-đáp-án dùng nút tròn, câu
 * nhiều-đáp-án dùng ô tích. Dùng nút tròn cho cả hai là biến nhãn "Nhiều đáp án"
 * trên màn hình thành lời nói dối — lỗi đã mắc một lần ở câu hỏi chèn giữa video.
 */

const NHAN_LOAI: Record<string, string> = {
  SINGLE: "Một đáp án",
  MULTIPLE: "Nhiều đáp án",
  TRUE_FALSE: "Đúng / Sai",
  SHORT_ANSWER: "Trả lời ngắn (chấm tay)",
  ESSAY: "Tự luận (chấm tay)",
};

const NHAN_KHO: Record<string, string> = {
  EASY: "Dễ",
  MEDIUM: "Trung bình",
  HARD: "Khó",
};

const canLuaChon = (t: string) => (LOAI_CHAM_MAY as readonly string[]).includes(t);

export type CauHoiHienCo = {
  id: string;
  bankPath: string;
  type: string;
  stem: string;
  explanation: string | null;
  difficulty: string;
  defaultPoints: number;
  choices: { text: string; isCorrect: boolean }[];
};

export function QuestionForm(props: {
  /** Có = sửa; không có = tạo mới. */
  cauHienCo?: CauHoiHienCo;
  bankPathMacDinh: string;
  onXong?: () => void;
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const c = props.cauHienCo;

  const [bankPath, setBankPath] = useState(c?.bankPath ?? props.bankPathMacDinh);
  const [type, setType] = useState(c?.type ?? "SINGLE");
  const [stem, setStem] = useState(c?.stem ?? "");
  const [explanation, setExplanation] = useState(c?.explanation ?? "");
  const [difficulty, setDifficulty] = useState(c?.difficulty ?? "MEDIUM");
  const [diem, setDiem] = useState(c?.defaultPoints ?? 1);
  const [luaChon, setLuaChon] = useState<{ text: string; isCorrect: boolean }[]>(
    c?.choices?.length
      ? c.choices
      : [
          { text: "", isCorrect: true },
          { text: "", isCorrect: false },
          { text: "", isCorrect: false },
          { text: "", isCorrect: false },
        ],
  );

  const doiLoai = (t: string) => {
    setType(t);
    // Đổi sang Đúng/Sai thì dựng sẵn đúng hai lựa chọn — đòi người soạn tự xoá bớt
    // hai ô thừa rồi mới báo lỗi là bắt họ đoán luật.
    if (t === "TRUE_FALSE") {
      setLuaChon([
        { text: "Đúng", isCorrect: true },
        { text: "Sai", isCorrect: false },
      ]);
    }
    // Đổi sang câu một-đáp-án mà đang tích nhiều ô thì giữ lại ô đầu tiên.
    if (t === "SINGLE" && luaChon.filter((x) => x.isCorrect).length > 1) {
      const dau = luaChon.findIndex((x) => x.isCorrect);
      setLuaChon((cu) => cu.map((x, i) => ({ ...x, isCorrect: i === dau })));
    }
  };

  const danhDau = (i: number) => {
    setLuaChon((cu) =>
      cu.map((x, j) =>
        type === "MULTIPLE"
          ? j === i
            ? { ...x, isCorrect: !x.isCorrect }
            : x
          : { ...x, isCorrect: j === i },
      ),
    );
  };

  const luu = () => {
    // ⚠️ LỌC TRƯỚC khi gửi, và cờ `isCorrect` đi CÙNG từng ô — không gửi chỉ số
    // riêng. Gửi chỉ số của mảng chưa lọc kèm mảng đã lọc là sinh ra câu trỏ đáp
    // án ra ngoài danh sách, tức câu không ai trả lời đúng được. Lỗi đã mắc một
    // lần ở màn soạn câu hỏi chèn giữa video.
    const ds = canLuaChon(type)
      ? luaChon.filter((x) => x.text.trim()).map((x) => ({ ...x, text: x.text.trim() }))
      : undefined;

    if (canLuaChon(type) && !ds?.some((x) => x.isCorrect)) {
      toast.error("Ô được đánh dấu đúng đang để trống — chọn lại đáp án đúng");
      return;
    }

    const than = {
      bankPath: bankPath.trim(),
      type,
      stem: stem.trim(),
      explanation: explanation.trim() || null,
      difficulty: difficulty as "EASY" | "MEDIUM" | "HARD",
      defaultPoints: diem,
      ...(ds ? { choices: ds } : {}),
    };

    batDau(async () => {
      const r = c
        ? await suaCauHoiAction({ ...than, questionId: c.id })
        : await taoCauHoiAction(than);
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(c ? "Đã lưu câu hỏi" : "Đã thêm câu hỏi");
      props.onXong?.();
      router.refresh();
    });
  };

  const xoa = () => {
    if (!c) return;
    batDau(async () => {
      const r = await xoaCauHoiAction({ questionId: c.id });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã xoá câu hỏi");
      props.onXong?.();
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={bankPath}
          onChange={(e) => setBankPath(e.target.value)}
          placeholder="/an-toan/pccc/"
          className="w-52 rounded-md border px-2 py-1 font-mono text-sm"
        />
        <select
          value={type}
          onChange={(e) => doiLoai(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
        >
          {[...LOAI_CHAM_MAY, ...LOAI_CHAM_TAY].map((t) => (
            <option key={t} value={t}>
              {NHAN_LOAI[t]}
            </option>
          ))}
        </select>
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
        >
          {MUC_KHO.map((m) => (
            <option key={m} value={m}>
              {NHAN_KHO[m]}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={100}
          value={diem}
          onChange={(e) => setDiem(Number(e.target.value))}
          title="Điểm mặc định"
          className="w-20 rounded-md border px-2 py-1 text-sm"
        />
      </div>

      <textarea
        value={stem}
        onChange={(e) => setStem(e.target.value)}
        rows={2}
        placeholder="Đề bài"
        className="w-full rounded-md border px-2 py-1 text-sm"
      />

      {canLuaChon(type) ? (
        <div className="space-y-1">
          {luaChon.map((x, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type={type === "MULTIPLE" ? "checkbox" : "radio"}
                checked={x.isCorrect}
                onChange={() => danhDau(i)}
                title="Đáp án đúng"
              />
              <input
                value={x.text}
                onChange={(e) =>
                  setLuaChon((cu) =>
                    cu.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)),
                  )
                }
                placeholder={`Lựa chọn ${i + 1}`}
                className="flex-1 rounded-md border px-2 py-1 text-sm"
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Loại này chấm tay — người chấm đọc bài và cho điểm, hệ thống không tự chấm.
        </p>
      )}

      <textarea
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        rows={2}
        placeholder="Giải thích đáp án (người học chỉ thấy theo chính sách của đề)"
        className="w-full rounded-md border px-2 py-1 text-sm"
      />

      <div className="flex gap-2">
        <button
          type="button"
          disabled={dangChay || !stem.trim()}
          onClick={luu}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang lưu…" : c ? "Lưu" : "Thêm câu hỏi"}
        </button>
        {c ? (
          <button
            type="button"
            disabled={dangChay}
            onClick={xoa}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Xoá
          </button>
        ) : null}
        {props.onXong ? (
          <button
            type="button"
            onClick={props.onXong}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Thôi
          </button>
        ) : null}
      </div>
    </div>
  );
}
