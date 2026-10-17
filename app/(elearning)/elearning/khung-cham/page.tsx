import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { NewRubricForm } from "./_components/new-rubric-form";

/**
 * EL-15b — DANH SÁCH KHUNG CHẤM.
 *
 * ⚠️ Khung KHÔNG tự tới người học. Nó tới qua một bài dạng `TASK`, và đường nối là
 * `TrnLesson.rubricId`. Màn này nói rõ bước tiếp — dựng xong một khung rồi không
 * biết làm gì với nó là bỏ dở giữa chừng, đúng bài học của màn đề thi.
 *
 * ⚠️ Loại bài `TASK` CHƯA MỞ ở PR này: đường nộp và đường chấm chưa có. Nói thẳng
 * điều đó ra thay vì để người soạn dựng khung xong rồi đi tìm chỗ gắn.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Khung chấm | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:content:author")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền xem khung chấm</h1>
      </div>
    );
  }

  const db = scopedDb(actor);
  const cacKhung = await db.trnRubric.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      totalPoints: true,
      passPoints: true,
      _count: { select: { criteria: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning/chuong-trinh" className="underline">
          Chương trình
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Khung chấm</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Thước đo cho bài tập chấm tay: các tiêu chí, mỗi tiêu chí vài mức, mỗi mức
          một số điểm.
        </p>
        {/* Nói rõ BƯỚC TIẾP. Dựng xong một khung rồi không biết làm gì với nó là
            bỏ dở giữa chừng — đúng bài học của màn đề thi. */}
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">
          Khung chỉ tới người học qua một bài dạng <strong>Bài tập</strong>: kích hoạt
          khung xong, mở bài đó ở màn soạn khoá rồi gắn khung vào.
        </p>
      </div>

      <NewRubricForm />

      {cacKhung.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có khung nào.</p>
      ) : (
        <ul className="space-y-2">
          {cacKhung.map((k) => (
            <li key={k.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/elearning/khung-cham/${k.id}`}
                  className="font-medium underline"
                >
                  {k.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono">{k.code}</span> ·{" "}
                  {k.status === "ACTIVE"
                    ? "đã kích hoạt"
                    : k.status === "ARCHIVED"
                      ? "đã lưu trữ"
                      : "nháp"}{" "}
                  · {k._count.criteria} tiêu chí · đạt {k.passPoints}/{k.totalPoints}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
