import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napLuotNopDeCham } from "@/lib/elearning/task-grading-queue";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { GhiChu, QuayLai, TrangQuanTri } from "../../_components/ui/trang";
import { TaskGradingForm } from "../_components/task-grading-form";

/**
 * EL-15c — CHẤM MỘT LƯỢT NỘP.
 *
 * ⚠️ Lượt nộp đọc QUA `scopedDb` — chính lượt đọc đó là cổng cách ly. Chấm bài của
 * cơ sở khác là can thiệp vào hồ sơ nhân sự của họ, và không ai ở đó biết.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chấm bài tập | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ submissionId: string }>;
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
  if (!can(actor, "elearning:exam:grade")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Chấm bài tập" />
        <NoPermission permission="elearning:exam:grade" what="màn chấm bài tập" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const { submissionId } = await params;
  const luot = await napLuotNopDeCham(scopedDb(actor), submissionId);

  if (!luot) {
    // Không phân biệt "không có" với "đã chấm rồi" thì người chấm bấm vào một dòng
    // cũ sẽ gặp trang trắng và tưởng hỏng. Nói cả hai khả năng.
    return (
      <TrangQuanTri rong="hep">
        <QuayLai href="/elearning/cham-bai-tap">Về hàng chờ chấm bài tập</QuayLai>
        <PageHeader title="Chấm bài tập" />
        <EmptyState
          title="Không mở được lượt nộp này"
          description="Có thể đã có người chấm xong, hoặc lượt nộp không thuộc phạm vi của bạn."
        />
      </TrangQuanTri>
    );
  }

  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/cham-bai-tap">Hàng chờ chấm bài tập</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title={luot.tenNguoiHoc}
          subtitle={`${luot.tenBai} · lượt ${luot.attemptNo} · chấm theo ${luot.tenKhung}${
            luot.nopLuc ? ` · nộp ${luot.nopLuc.toLocaleDateString("vi-VN")}` : ""
          }`}
        />
      </div>

      {luot.nguoiHocUserId === session.user.id ? (
        <GhiChu sac="warning">
          <span role="note">
            Đây là bài nộp của chính bạn — không tự chấm được. Nhờ một người khác có quyền chấm xử lý.
          </span>
        </GhiChu>
      ) : (
        <TaskGradingForm luot={luot} />
      )}
    </TrangQuanTri>
  );
}
