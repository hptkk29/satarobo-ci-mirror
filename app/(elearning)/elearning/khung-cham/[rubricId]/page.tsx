import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { dsMucSchema } from "@/lib/elearning/rubric-shape";
import { RubricBuilder, type TieuChiTrongKhung } from "../_components/rubric-builder";

/**
 * EL-15b — DỰNG BỘ TIÊU CHÍ CHO MỘT KHUNG.
 *
 * ⚠️ Khung đọc QUA `scopedDb` — chính lượt đọc đó là cổng cách ly. Đọc bằng `db`
 * trần rồi tự so `centerId` là dựng bản kiểm phạm vi thứ hai, và bản thứ hai sẽ lệch.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dựng khung chấm | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ rubricId: string }>;
}) {
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
        <h1 className="text-xl font-bold">Không có quyền dựng khung chấm</h1>
      </div>
    );
  }

  const db = scopedDb(actor);
  const { rubricId } = await params;

  const khung = await db.trnRubric.findFirst({
    where: { id: rubricId, deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      totalPoints: true,
      passPoints: true,
      criteria: {
        select: {
          id: true,
          label: true,
          description: true,
          levelsJson: true,
          orderIndex: true,
        },
        orderBy: { orderIndex: "asc" },
      },
    },
  });

  if (!khung) {
    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-16 text-center text-sm">
        <p>Không tìm thấy khung chấm này.</p>
        <Link href="/elearning/khung-cham" className="underline">
          Về danh sách khung
        </Link>
      </div>
    );
  }

  // ⚠️ Đọc `levelsJson` QUA Zod, không ép kiểu. Cột khai `Json` nên TypeScript
  // không nối bên GHI với bên ĐỌC — đúng chỗ chuỗi đã đứt hai lần ở EL-14. Tiêu chí
  // không đọc được thì hiện danh sách mức RỖNG chứ không làm vỡ cả trang; cổng kích
  // hoạt sẽ gọi tên nó ra.
  const cacTieuChi: TieuChiTrongKhung[] = khung.criteria.map((c) => {
    const r = dsMucSchema.safeParse(c.levelsJson);
    return {
      criterionId: c.id,
      label: c.label,
      description: c.description,
      levels: r.success ? r.data : [],
    };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning/khung-cham" className="underline">
          Khung chấm
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">{khung.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono">{khung.code}</span> ·{" "}
          {khung.status === "ACTIVE"
            ? "đã kích hoạt"
            : khung.status === "ARCHIVED"
              ? "đã lưu trữ"
              : "nháp"}
        </p>
      </div>

      {cacTieuChi.some((t) => t.levels.length === 0) ? (
        // Nói RA chỗ hỏng thay vì hiện một tiêu chí trống rỗng trông như lỗi tải.
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Có tiêu chí hệ thống không đọc được các mức. Mở ra, nhập lại mức rồi lưu —
          để nguyên thì kích hoạt sẽ bị từ chối.
        </p>
      ) : null}

      <RubricBuilder
        rubricId={khung.id}
        code={khung.code}
        title={khung.title}
        status={khung.status}
        totalPoints={khung.totalPoints}
        passPoints={khung.passPoints}
        cacTieuChi={cacTieuChi}
        duocKichHoat={can(actor, "elearning:content:publish")}
      />
    </div>
  );
}
