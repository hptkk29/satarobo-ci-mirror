import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { TRAN_HANG_CHO } from "@/lib/elearning/exam-grading-queue";
import { NewExamForm } from "./_components/new-exam-form";

/**
 * EL-14c — DANH SÁCH ĐỀ THI.
 *
 * ⚠️ Đề KHÔNG tự tới người học. Nó tới qua một bài dạng `QUIZ`, và đường nối là
 * `TrnLesson.examId` — đặt ở màn soạn bài. Màn này nói rõ bước tiếp, vì dựng xong
 * một đề rồi không biết làm gì với nó là bỏ dở giữa chừng.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Đề thi | Sata Robo",
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
        <h1 className="text-xl font-bold">Không có quyền xem đề thi</h1>
      </div>
    );
  }

  const db = scopedDb(actor);
  // Đếm bài đang chờ chấm để lối vào hàng chờ KHÔNG trông như một liên kết chết.
  // Người chấm không mở một màn "có thể trống"; họ mở một màn có N người đang đợi.
  // Đếm CHẶN ở đúng trần của hàng chờ: đếm không giới hạn rồi hiện "247 bài" trong
  // khi hàng chờ chỉ liệt kê 200 là hai con số lệch nhau mà không ai giải thích được.
  const demChoCham = can(actor, "elearning:exam:grade")
    ? await db.trnExamAttempt.count({
        where: { status: "PENDING_GRADE" },
        take: TRAN_HANG_CHO + 1,
      })
    : 0;
  const demTran = demChoCham > TRAN_HANG_CHO;
  const [cacDe, cacKhoa] = await Promise.all([
    db.trnExam.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        title: true,
        isActive: true,
        passScore: true,
        maxScore: true,
        durationMin: true,
        _count: { select: { questions: true, attempts: true } },
      },
      orderBy: [{ isActive: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    db.trnCourse.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      take: 200,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Đề thi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dựng đề từ{" "}
          <Link href="/elearning/kho-cau-hoi" className="underline">
            kho câu hỏi
          </Link>
          .
        </p>
        {/* Nói rõ ĐƯỜNG ĐI, vì đề chỉ tới được người học qua một bài dạng
            "Bài kiểm tra" — dựng xong đề mà không biết bước tiếp là bỏ dở giữa chừng. */}
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">
          Đề chỉ tới người học qua một bài dạng <strong>Bài kiểm tra</strong>: kích
          hoạt đề xong, mở bài đó ở màn soạn khoá rồi gắn đề vào.
        </p>
      </div>

      {/* Lối vào HÀNG CHỜ CHẤM. Khu e-learning không có thanh điều hướng chung, nên
          mỗi màn mới phải được một màn cũ dẫn tới — không thì chỉ người viết nó biết
          đường. Đặt ở đây vì cả ba vai có `elearning:exam:grade` đều có
          `elearning:content:author`; ngày nào tách ra thì phải tìm cho nó lối vào khác. */}
      {can(actor, "elearning:exam:grade") ? (
        <Link
          href="/elearning/cham-bai"
          className="block rounded-md border p-3 text-sm underline"
        >
          {demChoCham > 0
            ? `Chấm bài — ${demTran ? `hơn ${TRAN_HANG_CHO}` : demChoCham} bài đang chờ`
            : "Chấm bài — không có bài nào chờ"}
        </Link>
      ) : null}

      <NewExamForm cacKhoa={cacKhoa} />

      {cacDe.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có đề nào.</p>
      ) : (
        <ul className="space-y-2">
          {cacDe.map((d) => (
            <li key={d.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/elearning/de-thi/${d.id}`} className="font-medium underline">
                  {d.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {d.isActive ? "đã kích hoạt" : "nháp"} · {d._count.questions} câu ·{" "}
                  {d.durationMin} phút · đạt {d.passScore}
                  {d.isActive ? `/${d.maxScore}` : ""}
                  {d._count.attempts > 0 ? ` · ${d._count.attempts} lượt thi` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
