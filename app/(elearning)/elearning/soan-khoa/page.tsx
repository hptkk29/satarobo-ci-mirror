import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";

/**
 * EL-08 — DANH SÁCH KHOÁ để soạn.
 *
 * ⚠️ Trang này TỪNG KHÔNG TỒN TẠI, trong khi `chuong-trinh/page.tsx` có một link
 * trỏ thẳng `/elearning/soan-khoa` — tức một **404**. Trớ trêu là link chết đó nằm
 * ngay dưới dòng bình luận "Trang không có lối vào thì chỉ người viết nó biết đường
 * tới".
 *
 * Chỉ có `soan-khoa/[courseId]/page.tsx`, nên người soạn phải biết sẵn `courseId`
 * mới vào được màn dựng dàn bài của một khoá.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Soạn khoá | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_TT: Record<string, string> = {
  DRAFT: "nháp",
  PENDING_REVIEW: "chờ duyệt",
  APPROVED: "đã duyệt",
  PUBLISHED: "đang phát hành",
  ARCHIVED: "đã lưu trữ",
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
        <h1 className="text-xl font-bold">Không có quyền soạn khoá</h1>
      </div>
    );
  }

  const db = scopedDb(actor);
  const cacKhoa = await db.trnCourse.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      program: { select: { code: true } },
      _count: { select: { modules: true } },
    },
    // Nháp lên trước: đó là thứ người soạn đang làm dở.
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
        <h1 className="text-2xl font-bold">Soạn khoá</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chọn một khoá để dựng dàn bài, gắn đề thi và khung chấm.
        </p>
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">
          Khoá mới tạo ở{" "}
          <Link href="/elearning/chuong-trinh" className="underline">
            màn chương trình
          </Link>
          .
        </p>
      </div>

      {cacKhoa.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Chưa có khoá nào trong phạm vi của bạn.
        </p>
      ) : (
        <ul className="space-y-2">
          {cacKhoa.map((k) => (
            <li key={k.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/elearning/soan-khoa/${k.id}`}
                  className="font-medium underline"
                >
                  {k.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono">{k.code}</span>
                  {k.program ? ` · ${k.program.code}` : ""} ·{" "}
                  {NHAN_TT[k.status] ?? k.status} · {k._count.modules} chương
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
