import { redirect } from "next/navigation";
import { Star } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { FeedbackForm } from "./_components/feedback-form";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Đánh giá | Sata Robo",
  robots: { index: false },
};

export default async function DanhGiaPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") redirect("/login");

  // ParentFeedback KHÔNG thuộc SCOPED_MODELS → scopedDb pass-through (cách ly bằng
  // ownership: where parentUserId của chính PH đang đăng nhập).
  const sdb = scopedDb(await resolveActor(session.user.id));
  const mine = await sdb.parentFeedback.findMany({
    where: { parentUserId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Đánh giá</h1>

      <FeedbackForm />

      {mine.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
            Đánh giá đã gửi
          </h2>
          <ul className="space-y-2">
            {mine.map((f) => (
              <li
                key={f.id}
                className="rounded-xl border border-neutral-200 bg-white p-4"
              >
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${
                        i < f.rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-neutral-300"
                      }`}
                    />
                  ))}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600">
                  {f.content}
                </p>
                <p className="mt-1 text-xs text-neutral-600">
                  {formatDateVN(f.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
