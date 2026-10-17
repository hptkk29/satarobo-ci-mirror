"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { taoDeAction } from "../_actions";

/**
 * EL-14c — TẠO ĐỀ MỚI.
 *
 * ⚠️ Đề mới luôn gắn vào một KHOÁ HỌC ở màn này. Đề gắn vào một BÀI (`lessonId`)
 * cũng hợp lệ về dữ liệu, nhưng đường đó chỉ có nghĩa khi loại bài "Bài kiểm tra"
 * đã mở — mà nó còn khoá. Phơi lựa chọn đó bây giờ là mời người soạn đi vào ngõ cụt.
 */
export function NewExamForm(props: { cacKhoa: { id: string; title: string }[] }) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [dangChay, batDau] = useTransition();

  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState(props.cacKhoa[0]?.id ?? "");
  const [durationMin, setDurationMin] = useState(30);
  const [passScore, setPassScore] = useState(8);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [cooldownHours, setCooldownHours] = useState(24);

  if (props.cacKhoa.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Chưa có khoá học nào để gắn đề — tạo khoá trước.
      </p>
    );
  }

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
      >
        Tạo đề mới
      </button>
    );
  }

  const tao = () =>
    batDau(async () => {
      const r = await taoDeAction({
        title: title.trim(),
        courseId,
        durationMin,
        passScore,
        maxAttempts,
        cooldownHours,
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã tạo đề — thêm câu hỏi rồi kích hoạt");
      setMo(false);
      setTitle("");
      router.refresh();
    });

  return (
    <div className="space-y-2 rounded-md border p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Tên đề thi"
        className="w-full rounded-md border px-2 py-1 text-sm"
      />
      <select
        value={courseId}
        onChange={(e) => setCourseId(e.target.value)}
        className="w-full rounded-md border px-2 py-1 text-sm"
      >
        {props.cacKhoa.map((k) => (
          <option key={k.id} value={k.id}>
            {k.title}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Thời gian (phút)</span>
          <input
            type="number"
            min={1}
            max={600}
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            className="w-20 rounded-md border px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Điểm đạt</span>
          <input
            type="number"
            min={1}
            value={passScore}
            onChange={(e) => setPassScore(Number(e.target.value))}
            className="w-20 rounded-md border px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Số lượt</span>
          <input
            type="number"
            min={1}
            max={20}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(Number(e.target.value))}
            className="w-16 rounded-md border px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Chờ giữa hai lượt (giờ)</span>
          <input
            type="number"
            min={0}
            max={720}
            value={cooldownHours}
            onChange={(e) => setCooldownHours(Number(e.target.value))}
            className="w-20 rounded-md border px-2 py-1"
          />
        </label>
      </div>
      {/* Điểm đạt nhập TUYỆT ĐỐI, và tổng điểm chỉ biết sau khi thêm câu — nên nói
          rõ ở đây thay vì để họ đoán con số. */}
      <p className="text-xs text-muted-foreground">
        Điểm đạt là số điểm tuyệt đối. Tổng điểm của đề bằng tổng điểm các câu, chốt
        lại lúc kích hoạt.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={dangChay || title.trim().length < 3}
          onClick={tao}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang tạo…" : "Tạo đề"}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          Thôi
        </button>
      </div>
    </div>
  );
}
