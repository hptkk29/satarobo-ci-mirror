import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { provinces } from "vietnam-address-data";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { toAddressOptions } from "@/lib/address/vn-address";
import { vnYmd } from "@/lib/time/vn";
import { StudentForm } from "../_components/student-form";

export const metadata = { title: "Thêm học viên | Admin" };
export const dynamic = "force-dynamic";

export default async function NewStudentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("students:create"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const [canViewParentCccd, actor, coTheDoiMa] = await Promise.all([
    // #15 — chỉ kế toán/admin (payments:view-pii) mới thấy + nhập CCCD PH (PII).
    checkPermission("payments:view-pii"),
    resolveActor(session.user.id),
    // 26/09 — chỉ Quản trị tối cao đặt tay mã học viên; vai khác để hệ thống tự sinh.
    checkPermission("students:change-code"),
  ]);
  // Hội sở KHÔNG nhận học viên (chốt 04/08) — picker chỉ liệt kê cơ sở dạy học.
  const orgUnits = await getSelectableOrgUnits(actor, { types: ["CENTER"] });

  return (
    // Tờ tạo mới không có cột phải ⇒ khung hẹp hơn trang hồ sơ: một tờ form kéo 1440px
    // thì dòng ô nhập dài quá tầm mắt. Bậc nở chỉ dùng `min-[..]` (xem trang hồ sơ).
    <div className="mx-auto w-full max-w-[960px] space-y-5 min-[1536px]:max-w-[1120px]">
      <Link
        href="/students"
        className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden /> Danh sách học viên
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Thêm học viên mới</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Học viên đến từ lead thì nên tạo bằng nút <b className="font-semibold">Chuyển đổi</b> ở
          trang lead — hồ sơ tự nối lead nguồn và điền sẵn thông tin. Tạo tay ở đây thì sau có thể
          gắn lead ở trang hồ sơ.
        </p>
      </div>
      <StudentForm
        orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))}
        canViewParentCccd={canViewParentCccd}
        provinces={toAddressOptions(provinces)}
        initialWards={[]}
        homNay={vnYmd(new Date())}
        coTheDoiMa={coTheDoiMa}
      />
    </div>
  );
}
