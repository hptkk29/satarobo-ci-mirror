"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/admin/ui/states";
import { Khoi } from "../../_components/ui/trang";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_PHU, O_CHON, O_NHAP } from "../../_components/ui/dieu-khien";
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
      <EmptyState
        title="Chưa có khoá học nào để gắn đề"
        description="Tạo khoá ở màn chương trình trước, rồi quay lại dựng đề."
      />
    );
  }

  if (!mo) {
    return (
      <div>
        <button type="button" onClick={() => setMo(true)} aria-expanded={false} className={NUT_CHINH}>
          Tạo đề mới
        </button>
      </div>
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
    <Khoi tieuDe="Tạo đề mới">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className={NHAN_O}>Tên đề thi</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ví dụ: Kiểm tra cuối khoá An toàn lao động"
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
          <label className="block">
            <span className={NHAN_O}>Thuộc khoá</span>
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className={`mt-1 ${O_CHON}`}
            >
              {props.cacKhoa.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="block">
            <span className={NHAN_O}>Thời gian (phút)</span>
            <input
              type="number"
              min={1}
              max={600}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
          <label className="block">
            <span className={NHAN_O}>Điểm đạt</span>
            <input
              type="number"
              min={1}
              value={passScore}
              onChange={(e) => setPassScore(Number(e.target.value))}
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
          <label className="block">
            <span className={NHAN_O}>Số lượt thi</span>
            <input
              type="number"
              min={1}
              max={20}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
          <label className="block">
            <span className={NHAN_O}>Chờ giữa hai lượt (giờ)</span>
            <input
              type="number"
              min={0}
              max={720}
              value={cooldownHours}
              onChange={(e) => setCooldownHours(Number(e.target.value))}
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
        </div>
        {/* Điểm đạt nhập TUYỆT ĐỐI, và tổng điểm chỉ biết sau khi thêm câu — nên nói
            rõ ở đây thay vì để họ đoán con số. */}
        <p className={GOI_Y_O}>
          Điểm đạt là số điểm tuyệt đối. Tổng điểm của đề bằng tổng điểm các câu, chốt
          lại lúc kích hoạt.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={dangChay || title.trim().length < 3}
            onClick={tao}
            className={NUT_CHINH}
          >
            {dangChay ? "Đang tạo…" : "Tạo đề"}
          </button>
          <button type="button" onClick={() => setMo(false)} className={NUT_PHU}>
            Thôi
          </button>
        </div>
      </div>
    </Khoi>
  );
}
