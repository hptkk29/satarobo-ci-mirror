import { Sparkles, BookOpen, Award } from "lucide-react";
import type {
  RoadmapCourse,
  RoadmapModule,
} from "@/components/legacy-laptrinhrobot/_data/roadmap-5-years";

type Props = { longterm: RoadmapCourse };

const SESSION_TYPE_COLORS: Record<string, string> = {
  "Dự án": "bg-blue-100 text-blue-700",
  "Ôn tập": "bg-yellow-100 text-yellow-700",
  "Dự án cuối học phần": "bg-orange-100 text-orange-700",
  "Demo cuối học phần": "bg-purple-100 text-purple-700",
  "Báo cáo cuối học phần": "bg-pink-100 text-pink-700",
  "Dự án cuối khóa": "bg-red-100 text-red-700",
  "Demo cuối khóa": "bg-red-100 text-red-700",
  "Báo cáo cuối khóa": "bg-red-100 text-red-700",
};

function getSessionTypeColor(type: string): string {
  return SESSION_TYPE_COLORS[type] ?? "bg-gray-100 text-gray-700";
}

function ModuleCard({
  module: m,
  index,
}: {
  module: RoadmapModule;
  index: number;
}) {
  return (
    <div className="rounded-2xl border-2 border-indigo-200 bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
            HỌC PHẦN {index + 1}
          </div>
          <h3 className="text-xl font-extrabold text-gray-900">{m.name}</h3>
        </div>
        <div className="text-right text-xs text-gray-500">
          <div className="font-bold">{m.sessions} buổi</div>
          <div>{m.totalDuration}</div>
        </div>
      </div>

      <p className="mb-4 text-gray-700">{m.description}</p>

      {/* Skills tags */}
      {m.skills.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {m.skills.map((s, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700"
            >
              <Sparkles size={10} /> {s}
            </span>
          ))}
        </div>
      )}

      {/* Sessions list */}
      <div className="rounded-xl bg-gray-50 p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-600">
          {m.sessions} buổi học
        </div>
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {m.sessionList.map((session) => (
            <li
              key={session.num}
              className="flex items-start gap-2 rounded-md bg-white px-3 py-2 text-sm"
            >
              <span className="font-bold text-indigo-600">{session.num}.</span>
              <span className="flex-1 text-gray-800">{session.content}</span>
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${getSessionTypeColor(session.type)}`}
              >
                {session.type}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Achievement */}
      <div className="mt-4 flex items-start gap-3 rounded-lg border-l-4 border-green-500 bg-green-50 p-4">
        <Award
          className="mt-0.5 flex-shrink-0 text-green-700"
          size={20}
        />
        <div>
          <div className="mb-1 text-xs font-bold uppercase text-green-700">
            Kết quả đạt được
          </div>
          <p className="text-sm text-gray-800">{m.achievement}</p>
        </div>
      </div>
    </div>
  );
}

export function LongtermDetailSections({ longterm }: Props) {
  return (
    <>
      {/* YEAR SKILLS */}
      {longterm.yearSkills && longterm.yearSkills.length > 0 && (
        <section className="bg-gradient-to-br from-indigo-50 to-purple-50 py-12">
          <div className="container mx-auto max-w-5xl px-4">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
              {longterm.yearSkills.length} KỸ NĂNG CỐT LÕI NĂM {longterm.year}
            </div>
            <h2 className="mb-6 text-3xl font-extrabold text-gray-900">
              Con phát triển kỹ năng gì trong năm này?
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {longterm.yearSkills.map((skill, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-white p-4 shadow-sm"
                >
                  <Sparkles
                    className="mt-0.5 flex-shrink-0 text-indigo-600"
                    size={16}
                  />
                  <span className="text-sm font-semibold text-gray-800">
                    {skill}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TEACHING METHOD (từ note) */}
      {longterm.note && (
        <section className="bg-gray-50 py-12">
          <div className="container mx-auto max-w-4xl px-4">
            <div className="rounded-2xl border-l-4 border-purple-500 bg-white p-6 shadow-sm">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-700">
                PHƯƠNG PHÁP ĐÀO TẠO
              </div>
              <p className="whitespace-pre-line text-gray-800">
                {longterm.note}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 4 MODULES */}
      <section className="bg-white py-12">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
            <BookOpen size={14} /> LỘ TRÌNH 4 HỌC PHẦN
          </div>
          <h2 className="mb-2 text-3xl font-extrabold text-gray-900">
            {longterm.totalSessions} buổi · {longterm.structure}
          </h2>
          <p className="mb-8 text-gray-600">
            Tổng thời lượng: <strong>{longterm.totalDuration}</strong> ·{" "}
            {longterm.durationPerSession}/buổi
          </p>

          <div className="grid gap-6">
            {longterm.modules.map((m, i) => (
              <ModuleCard key={m.id} module={m} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* STRUCTURE & DEVICE info */}
      <section className="bg-gradient-to-br from-orange-50 to-yellow-50 py-12">
        <div className="container mx-auto max-w-4xl px-4">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="mb-2 text-xs font-bold uppercase text-gray-500">
                Cấu trúc khoá học
              </div>
              <div className="text-lg font-bold text-gray-900">
                {longterm.structure}
              </div>
              <div className="mt-1 text-sm text-gray-600">
                {longterm.totalSessions} buổi · {longterm.totalDuration}
              </div>
            </div>
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="mb-2 text-xs font-bold uppercase text-gray-500">
                Thiết bị sử dụng
              </div>
              <div className="text-lg font-bold text-gray-900">
                {longterm.device}
              </div>
              <div className="mt-1 text-sm text-gray-600">
                Lớp: {longterm.grade}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
