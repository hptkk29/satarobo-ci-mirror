import { FileText, Download } from "lucide-react";
import { requireActiveStudent } from "@/lib/portal/session";
import { getStudentLessons } from "@/lib/portal/learning";
import { resolveMediaUrl } from "@/lib/storage/signed-url";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bài giảng | Sata Robo" };

export default async function BaiGiangPage() {
  const { studentId } = await requireActiveStudent();
  const rawLessons = await getStudentLessons(studentId);

  // L8.3 — tài liệu đính kèm đi qua signed URL TTL ngắn (flag MEDIA_SIGNED_URL;
  // OFF → resolveMediaUrl trả nguyên fileUrl cũ).
  const lessons = await Promise.all(
    rawLessons.map(async (l) => ({
      ...l,
      documents: await Promise.all(
        l.documents.map(async (d) => ({
          ...d,
          fileUrl: await resolveMediaUrl(d.fileUrl),
        })),
      ),
    })),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-neutral-900">Bài giảng</h1>
      <p className="-mt-4 text-sm text-neutral-500">
        Nội dung các buổi đã học cùng tài liệu đính kèm.
      </p>

      {lessons.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Chưa có bài giảng nào (giáo viên chưa gắn bài học cho buổi đã dạy).
        </p>
      ) : (
        <div className="space-y-3">
          {lessons.map((l) => (
            <article
              key={l.id}
              className="rounded-xl border border-neutral-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-neutral-900">{l.title}</h2>
                {l.taughtAt && (
                  <span className="shrink-0 text-xs text-neutral-600">
                    {formatDateVN(l.taughtAt)}
                  </span>
                )}
              </div>
              {l.description && (
                <p className="mt-1 text-sm text-neutral-600">{l.description}</p>
              )}
              {l.objectives.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Mục tiêu
                  </p>
                  <ul className="mt-1 list-inside list-disc text-sm text-neutral-600">
                    {l.objectives.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
              )}
              {l.content && (
                <p className="mt-2 whitespace-pre-wrap border-t border-neutral-100 pt-2 text-sm text-neutral-600">
                  {l.content}
                </p>
              )}
              {l.materials.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Dụng cụ / vật liệu
                  </p>
                  <p className="mt-0.5 text-sm text-neutral-600">
                    {l.materials.join(" · ")}
                  </p>
                </div>
              )}
              {l.documents.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {l.documents.map((d) => (
                    <a
                      key={d.id}
                      href={d.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {d.title}
                      <Download className="h-3 w-3 text-neutral-500" />
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
