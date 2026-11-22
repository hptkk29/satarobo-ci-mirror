import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { dsMucSchema } from "@/lib/elearning/rubric-shape";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { GhiChu, QuayLai, TrangQuanTri } from "../../_components/ui/trang";
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
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:content:author")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Dựng khung chấm" />
        <NoPermission permission="elearning:content:author" what="màn dựng khung chấm" askWho="phòng Đào tạo" />
      </TrangQuanTri>
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
      <TrangQuanTri rong="hep">
        <QuayLai href="/elearning/khung-cham">Về danh sách khung</QuayLai>
        <PageHeader title="Dựng khung chấm" />
        <EmptyState
          title="Không tìm thấy khung chấm này"
          description="Khung không tồn tại, đã bị xoá hoặc không thuộc phạm vi của bạn."
        />
      </TrangQuanTri>
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
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/khung-cham">Khung chấm</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title={khung.title}
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{khung.code}</span> ·
              <TrangThaiBadge sac={khung.status === "ACTIVE" ? "success" : "muted"}>
                {khung.status === "ACTIVE" ? "Đã kích hoạt" : khung.status === "ARCHIVED" ? "Đã lưu trữ" : "Nháp"}
              </TrangThaiBadge>
            </span>
          }
        />
      </div>

      {cacTieuChi.some((t) => t.levels.length === 0) ? (
        // Nói RA chỗ hỏng thay vì hiện một tiêu chí trống rỗng trông như lỗi tải.
        <GhiChu sac="warning">
          Có tiêu chí hệ thống không đọc được các mức. Mở ra, nhập lại mức rồi lưu —
          để nguyên thì kích hoạt sẽ bị từ chối.
        </GhiChu>
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
    </TrangQuanTri>
  );
}
