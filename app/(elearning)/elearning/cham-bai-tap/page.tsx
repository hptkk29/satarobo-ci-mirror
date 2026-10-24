import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napHangChoTap } from "@/lib/elearning/task-grading-queue";
import { SLA_GRADE_DAYS } from "@/lib/elearning/metrics/constants";

/**
 * EL-15c — HÀNG CHỜ CHẤM BÀI TẬP.
 *
 * ⚠️ Xếp theo HẠN CHẤM, không theo lúc nộp: hai lượt nộp cùng ngày có hạn khác nhau
 * nếu vắt qua cuối tuần, và thứ người chấm cần biết là "cái nào sắp vỡ SLA".
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chấm bài tập | Sata Robo",
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
  if (!can(actor, "elearning:exam:grade")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền chấm bài</h1>
      </div>
    );
  }

  const { dong, conNua } = await napHangChoTap(scopedDb(actor), {
    bayGio: new Date(),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning/cham-bai" className="underline">
          Chấm bài thi
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Chấm bài tập</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hạn chấm là <strong>{SLA_GRADE_DAYS} ngày làm việc</strong> kể từ lúc người
          học nộp. Quá hạn thì hệ thống tự nới hạn của họ — bài nào sắp vỡ hạn xếp
          lên trước.
        </p>
      </div>

      {conNua ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Còn bài chờ chấm ngoài danh sách này — chấm bớt rồi tải lại trang.
        </p>
      ) : null}

      {dong.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Không có bài tập nào đang chờ chấm.
        </p>
      ) : (
        <ul className="space-y-2">
          {dong.map((d) => (
            <li key={d.submissionId} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{d.tenNguoiHoc}</span>
                <span
                  className={
                    // Quá hạn phải NHÌN THẤY được: đây là hạn của một người khác,
                    // và nó đang trôi vì mình chưa đọc.
                    d.quaHanNgayLam > 0
                      ? "text-xs font-medium text-red-600"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {d.quaHanNgayLam > 0
                    ? `quá hạn ${d.quaHanNgayLam} ngày làm việc`
                    : d.dueGradeAt
                      ? `hạn ${d.dueGradeAt.toLocaleDateString("vi-VN")}`
                      : "chưa rõ hạn"}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {d.tenBai} · lượt {d.attemptNo}
              </p>
              <Link
                href={`/elearning/cham-bai-tap/${d.submissionId}`}
                className="mt-2 inline-block rounded-md border px-2 py-1 text-xs"
              >
                Chấm bài này
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
