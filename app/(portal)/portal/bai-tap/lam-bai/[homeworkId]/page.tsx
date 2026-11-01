import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock } from "lucide-react";
import { ngayGioVN } from "@/lib/format/date";
import { requireActiveStudent } from "@/lib/portal/session";
import { getStudentHomeworkDetail } from "@/lib/portal/learning";
import { StartExamButton } from "../../../bai-thi/_components/start-exam-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Làm bài | Sata Robo",
  robots: { index: false },
};

interface Props {
  params: Promise<{ homeworkId: string }>;
}

// R7-14 — TẦNG HỌC VIÊN: trang làm bài (nội dung đề). getStudentHomeworkDetail trả
// null nếu profile hiện tại không phải "student" (PH gọi thẳng → 404, AC5) hoặc bài
// không thuộc HV đang chọn (AC4) → notFound.
export default async function LamBaiPage({ params }: Props) {
  const { studentId } = await requireActiveStudent();
  const { homeworkId } = await params;
  const hw = await getStudentHomeworkDetail(studentId, homeworkId);
  if (!hw) notFound();

  return (
    <div className="space-y-5">
      <Link
        href="/portal/bai-tap"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
      >
        <ChevronLeft className="h-4 w-4" /> Tất cả bài tập
      </Link>

      <div>
        <h1 className="text-xl font-bold text-neutral-900">{hw.examTitle}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-600">
          <span>{hw.totalPoints} điểm</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {hw.durationMinutes} phút
          </span>
          {/* 06/09 — GHIM giờ VN. `toLocaleString("vi-VN")` trần lấy giờ tiến trình:
              Vercel chạy UTC nên hạn 23:59 giờ VN in ra "16:59" cho phụ huynh. */}
          {hw.dueAt && <span>Hạn {ngayGioVN(hw.dueAt)}</span>}
        </p>
      </div>

      {/* Đường NỘP bài — trước đây trang chỉ xem đề tĩnh, HV bấm vào là cụt.
          StartExamButton gọi startAttempt (tạo/tiếp tục ExamAttempt) rồi điều hướng
          /portal/bai-thi/[examId] — cùng luồng với danh sách "Bài kiểm tra". */}
      {hw.questions.length > 0 && (
        <div>
          <StartExamButton
            examId={hw.examId}
            resume={false}
            label="Vào làm bài"
          />
        </div>
      )}

      <ol className="space-y-3">
        {hw.questions.map((q, i) => (
          <li
            key={q.id}
            className="rounded-xl border border-neutral-200 bg-white p-4"
          >
            <p className="font-medium text-neutral-900">
              Câu {i + 1}. {q.text}{" "}
              <span className="text-xs font-normal text-neutral-500">
                ({q.points} điểm)
              </span>
            </p>
            {q.choices.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {q.choices.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700"
                  >
                    {c.text}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {hw.questions.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          Bài chưa có câu hỏi.
        </p>
      )}
    </div>
  );
}
