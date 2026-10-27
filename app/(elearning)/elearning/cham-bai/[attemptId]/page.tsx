import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napLuotDeCham } from "@/lib/elearning/exam-grading-queue";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { GhiChu, QuayLai, TrangQuanTri } from "../../_components/ui/trang";
import { GradingForm } from "../_components/grading-form";

/**
 * EL-14e — ĐỌC VÀ CHO ĐIỂM MỘT LƯỢT.
 *
 * ⚠️ Lượt đọc QUA `scopedDb` — chính lượt đọc đó là cổng cách ly. Chấm bài của cơ sở
 * khác là can thiệp vào hồ sơ nhân sự của họ, và không ai ở đó biết.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chấm bài | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ attemptId: string }>;
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
        <PageHeader title="Chấm bài" />
        <NoPermission permission="elearning:exam:grade" what="màn chấm bài thi" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const { attemptId } = await params;
  const luot = await napLuotDeCham(scopedDb(actor), attemptId);

  if (!luot) {
    // Không phân biệt "không có" với "đã chấm rồi" ở đây thì người chấm bấm vào một
    // dòng cũ sẽ gặp trang trắng và tưởng hỏng. Nói cả hai khả năng.
    return (
      <TrangQuanTri rong="hep">
        <QuayLai href="/elearning/cham-bai">Về hàng chờ chấm</QuayLai>
        <PageHeader title="Chấm bài" />
        <EmptyState
          title="Không mở được lượt này"
          description="Có thể đã có người chấm xong, hoặc lượt thi không thuộc phạm vi của bạn."
        />
      </TrangQuanTri>
    );
  }

  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/cham-bai">Hàng chờ chấm</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title={luot.tenNguoiHoc}
          subtitle={`${luot.tenDe} · lượt ${luot.attemptNo}${
            luot.nopLuc ? ` · nộp ${luot.nopLuc.toLocaleDateString("vi-VN")}` : ""
          }`}
        />
      </div>

      {luot.nguoiHocUserId === session.user.id ? (
        <GhiChu sac="warning">
          <span role="note">
            Đây là bài thi của chính bạn — không tự chấm được. Nhờ một người khác có quyền chấm xử lý.
          </span>
        </GhiChu>
      ) : (
        <GradingForm
          attemptId={luot.attemptId}
          passScore={luot.passScore}
          maxScore={luot.maxScore}
          cacCau={luot.cacCau}
        />
      )}
    </TrangQuanTri>
  );
}
