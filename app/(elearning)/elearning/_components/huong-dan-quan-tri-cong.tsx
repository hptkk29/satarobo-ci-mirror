import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TieuDeTrang } from "./ui/tieu-de-trang";
import { TrangQuanTri } from "./ui/trang";

/**
 * Cổng của hướng dẫn QUẢN TRỊ: cho vào khi người xem có BẤT KỲ quyền quản trị e-learning nào (cùng tập quyền mà `layout.tsx` dùng để vẽ thanh bên quản trị).
 * Trả `null` khi cho qua; ngược lại trả phần tử để trang vẽ. Không phải cổng bảo vệ dữ liệu (trang chỉ có nội dung tĩnh) — là cổng ĐÚNG KHU: người học thuần
 * không nên thấy hướng dẫn cho những việc họ không làm được.
 */
const QUYEN_QUAN_TRI = [
  "elearning:content:author",
  "elearning:exam:grade",
  "elearning:assignment:create",
  "elearning:progress:view-all",
  "elearning:progress:view-team",
  "elearning:requirement:manage",
  "elearning:program:manage",
] as const;

export async function congHuongDanQuanTri(): Promise<React.ReactNode | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (QUYEN_QUAN_TRI.some((q) => can(actor, q))) return null;
  return (
    <TrangQuanTri rong="hep">
      <TieuDeTrang title="Hướng dẫn sử dụng" />
      <NoPermission permission="elearning:content:author" what="hướng dẫn dành cho quản trị" askWho="phòng Đào tạo" />
    </TrangQuanTri>
  );
}
