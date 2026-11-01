// app/(teacher)/teacher/kho-bai-tap/page.tsx — "Kho bài tập của tôi" (site GV).
//
// Parity 18/08 (port satarobo-ui-giaovien assignments/kho/page.tsx): cùng nội dung
// với tab "Kho bài tập" ở trang Bài tập & kiểm tra — giữ route riêng để liên kết cũ
// vẫn dùng được. Đề GV TỰ SOẠN (8 loại câu hỏi) — list AssignmentTemplate where
// createdById = ownerId (own-scope, xem _owner.ts). Soạn/sửa qua dialog
// CreateAssignmentDialog (không còn trang ?compose=tao). Câu 46: đây là SOẠN NỘI
// DUNG — không chạm dữ liệu HV/PH.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { PageHeader } from "../_components/ui/page-header";
import { BackLink } from "../_components/ui/back-link";
import { AssignmentBankPanel } from "./_components/bank-panel";
import { resolveTemplateOwnerId } from "./_owner";
import { loadTeacherAssignData } from "../cham-bai/_data";

export const metadata = { title: "Kho bài tập | Giáo viên Sata Robo" };

export default async function KhoBaiTapPage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string; back?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate

  // Trang soạn đề full-page CŨ (?compose=tao) — nay soạn bằng dialog tại chỗ.
  const { compose, back } = await searchParams;
  if (compose === "tao") {
    redirect(back && back.startsWith("/teacher/") ? back : "/teacher/kho-bai-tap");
  }

  const [actor, canAuthor] = await Promise.all([
    resolveActor(session.user.id),
    checkPermission("assignments:author-own"),
  ]);
  const sdb = scopedDb(actorGiangDay(actor));
  const { ownerId } = await resolveTemplateOwnerId(sdb, session.user.id);

  const data = await loadTeacherAssignData(sdb, {
    ownerId,
    classIds: [...actor.assignedClassIds],
  });

  return (
    <div>
      <BackLink className="mb-4" href="/teacher/cham-bai" label="Bài tập & kiểm tra" />
      <PageHeader title="Kho bài tập của tôi" />
      <AssignmentBankPanel rows={data.mine} courses={data.courses} canAuthor={canAuthor} />
    </div>
  );
}
