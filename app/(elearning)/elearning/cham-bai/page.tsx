import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napHangCho } from "@/lib/elearning/exam-grading-queue";

/**
 * EL-14e — HÀNG CHỜ CHẤM TAY.
 *
 * ⚠️ Màn này là LỐI RA của trạng thái `PENDING_GRADE`. Không có nó thì mọi lượt thi
 * có câu tự luận treo vĩnh viễn: điểm mãi `null`, bài không bao giờ xong, và người
 * học đứng nguyên tại một bài nghĩa vụ có hạn chót cứng cho tới lúc bị khoá vì quá
 * hạn — không làm gì sai và không có đường nào tự thoát.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chấm bài | Sata Robo",
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

  const { dong: hangCho, conNua } = await napHangCho(scopedDb(actor), {
    bayGio: new Date(),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <nav className="flex gap-3 text-xs text-muted-foreground">
        <Link href="/elearning/de-thi" className="underline">
          Đề thi
        </Link>
        {/* Nối chéo hai hàng chờ: cùng NGƯỜI chấm, khác nhịp và khác hình dạng nên
            tách màn — nhưng người chấm phải đi lại được giữa hai bên. */}
        <Link href="/elearning/cham-bai-tap" className="underline">
          Chấm bài tập
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Chấm bài</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bài đã nộp còn câu tự luận, đang chờ người đọc. Người chờ lâu nhất xếp
          trước.
        </p>
      </div>

      {conNua ? (
        // Im lặng cắt danh sách là để người chấm đọc hết trang rồi tin là hết việc.
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Còn bài chờ chấm ngoài danh sách này — chấm bớt rồi tải lại trang để thấy
          tiếp.
        </p>
      ) : null}

      {hangCho.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Không có bài nào đang chờ chấm.
        </p>
      ) : (
        <ul className="space-y-2">
          {hangCho.map((d) => (
            <li key={d.attemptId} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{d.tenNguoiHoc}</span>
                <span
                  className={
                    // Chờ quá lâu thì phải NHÌN THẤY được, không nằm lẫn trong danh
                    // sách: đây là hạn chót của một người khác, không phải của người
                    // chấm.
                    (d.soNgayCho ?? 0) >= 3
                      ? "text-xs font-medium text-red-600"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {d.soNgayCho == null
                    ? "chưa rõ mốc nộp"
                    : d.soNgayCho === 0
                      ? "nộp hôm nay"
                      : `đã chờ ${d.soNgayCho} ngày`}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {d.tenDe} · lượt {d.attemptNo}
              </p>
              <Link
                href={`/elearning/cham-bai/${d.attemptId}`}
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
