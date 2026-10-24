import {
  Target,
  BookOpen,
  GraduationCap,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import type { ExamRoadmapItem } from "@/components/legacy-laptrinhrobot/_data/exam-roadmap";

const SATA8_CONDITIONS = [
  "Điều kiện: phụ huynh đã đăng ký Combo hoặc Robosim Master.",
  "Phạm vi: vòng loại quốc gia / vòng loại cuộc thi Robotics 2026.",
  "Học sinh đi đủ 5/5 buổi chuyên sâu.",
  "Hoàn thành học liệu E-learning được giao.",
  "Nếu đã đi đủ lộ trình mà vẫn không vượt vòng loại, Sata Robo hoàn 100% học phí gói Sata8.",
];

type Props = {
  exam: ExamRoadmapItem;
  slug: string;
};

export function ExamDetailSections({ exam, slug }: Props) {
  const isSata8 = slug.toLowerCase() === "sata8";

  return (
    <>
      {/* GOAL */}
      {exam.goal && (
        <section className="bg-white py-12">
          <div className="container mx-auto max-w-4xl px-4">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">
              <Target size={14} /> MỤC TIÊU KHOÁ HỌC
            </div>
            <h2 className="mb-4 text-3xl font-extrabold text-gray-900">
              Khoá học hướng đến điều gì?
            </h2>
            <p className="text-lg leading-relaxed text-gray-700">
              {exam.goal}
            </p>
          </div>
        </section>
      )}

      {/* METHODS */}
      {exam.methods && exam.methods.length > 0 && (
        <section className="bg-gray-50 py-12">
          <div className="container mx-auto max-w-4xl px-4">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
              <GraduationCap size={14} /> PHƯƠNG PHÁP ĐÀO TẠO
            </div>
            <h2 className="mb-6 text-3xl font-extrabold text-gray-900">
              Học bằng cách nào?
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {exam.methods.map((m, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-white p-4"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
                    {i + 1}
                  </div>
                  <span className="font-medium text-gray-800">{m}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* LESSONS LIST */}
      {exam.lessons && exam.lessons.length > 0 && (
        <section className="bg-white py-12">
          <div className="container mx-auto max-w-4xl px-4">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
              <BookOpen size={14} /> LỘ TRÌNH {exam.lessons.length} BUỔI
            </div>
            <h2 className="mb-2 text-3xl font-extrabold text-gray-900">
              Con sẽ học gì qua {exam.sessions} buổi?
            </h2>
            <p className="mb-6 text-sm text-gray-600">
              {exam.sessions} buổi × 90 phút = {exam.totalDuration}
            </p>
            <ol className="grid gap-2 sm:grid-cols-2">
              {exam.lessons.map((lesson, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-lg bg-orange-50/50 p-3"
                >
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-sm text-gray-800">{lesson}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* HIGHLIGHTS DETAILED (cho Combo và các khoá có exam.highlights) */}
      {exam.highlights && exam.highlights.length > 0 && (
        <section className="bg-gradient-to-br from-purple-50 to-pink-50 py-12">
          <div className="container mx-auto max-w-4xl px-4">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-700">
              ƯU ĐIỂM ĐẶC BIỆT
            </div>
            <h2 className="mb-6 text-3xl font-extrabold text-gray-900">
              Tại sao chọn gói này?
            </h2>
            <div className="grid gap-3">
              {exam.highlights.map((h, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm"
                >
                  <CheckCircle2
                    className="mt-0.5 flex-shrink-0 text-purple-600"
                    size={20}
                  />
                  <span className="text-gray-800">{h}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* SATA8 CONDITIONS (chỉ Sata8) */}
      {isSata8 && (
        <section className="bg-gradient-to-br from-yellow-50 to-orange-50 py-12">
          <div className="container mx-auto max-w-4xl px-4">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange-600 px-3 py-1 text-xs font-bold text-white">
              <ShieldCheck size={14} /> CAM KẾT HOÀN TIỀN 100%
            </div>
            <h2 className="mb-6 text-3xl font-extrabold text-gray-900">
              Điều kiện cam kết hoàn tiền
            </h2>
            <div className="rounded-2xl border-2 border-orange-300 bg-white p-6 shadow-lg">
              <ul className="space-y-3">
                {SATA8_CONDITIONS.map((c, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2
                      className="mt-0.5 flex-shrink-0 text-orange-600"
                      size={20}
                    />
                    <span className="text-gray-800">{c}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-lg bg-orange-100 p-4 text-center">
                <p className="text-sm font-bold text-orange-800">
                  Có hợp đồng ký tên đóng dấu pháp lý từ Sata Robo
                </p>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
