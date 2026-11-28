import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { isElearningOnlineEnabled } from "@/lib/flags";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { TrangQuanTri } from "@/app/(elearning)/elearning/_components/ui/trang";

/**
 * CỔNG VÀO MỌI TRANG E-LEARNING ONLINE — một chỗ cho ba lớp: (1) cờ `ELEARNING_ONLINE_ENABLED` (tắt ⇒ 404, như chưa có trang), (2) đã đăng nhập,
 * (3) quyền `onl:*` của TRANG (từng Server Action vẫn tự hỏi quyền của nó — đây không phải cổng duy nhất).
 *
 * Trả `{ chan }` (một phần tử để trang `return`) hoặc `{ actor }`. Không `redirect` khi thiếu quyền: người dùng cần biết quyền nào thiếu và hỏi ai.
 */
export async function vaoTrangOnline(quyen: string, ten: string, hoiAi = "phòng Đào tạo"): Promise<{ actor: Actor; userId: string } | { chan: React.ReactElement }> {
  if (!isElearningOnlineEnabled()) notFound();
  const session = await auth();
  if (!session?.user?.id) {
    return {
      chan: (
        <TrangQuanTri rong="hep">
          <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
        </TrangQuanTri>
      ),
    };
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, quyen)) {
    return {
      chan: (
        <TrangQuanTri rong="hep">
          <PageHeader title={ten} />
          <NoPermission permission={quyen} what={ten.toLowerCase()} askWho={hoiAi} />
        </TrangQuanTri>
      ),
    };
  }
  return { actor, userId: session.user.id };
}
