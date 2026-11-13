import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { buildFormDays } from "@/lib/working-hours/form";
import { WILDCARD } from "@/lib/working-hours/rules";
import {
  listRoleOptions,
  loadWorkingHourAdminView,
  orgUnitIdForCenterBridged,
} from "@/lib/working-hours/admin-service";
import { WorkingHoursEditor } from "./_components/working-hours-editor";

// Cấu hình đọc mỗi lần vào (ít lượt truy cập, và xem nhầm giờ cũ thì tai hại hơn nhiều
// so với một truy vấn thừa).
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vai?: string }>;
}

export default async function GioLamViecPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // Đọc trước, gác sau — CÓ CHỦ ĐÍCH: `centers:view` mang scope CENTER ở một số vai, mà
  // scope CENTER chỉ so được khi lời gọi có ĐÍCH. Gác trần ở đây là `can()` trả false cho
  // đúng những vai đó (test `lib/auth/rbac-scope.test.ts` khoá đúng cái bẫy này — 09/07/2026
  // audit từng tìm ra 34 chỗ như vậy). Đọc trước không hở: `scopedDb` đã giới hạn truy vấn
  // trong danh sách cơ sở người này được thấy, và người gọi thì đã đăng nhập.
  const center = await sdb.center.findUnique({
    where: { id },
    select: { id: true, name: true, code: true },
  });
  if (!center) notFound();

  const orgUnitId = await orgUnitIdForCenterBridged(center);

  // XEM mở cho mọi vai có `centers:view` (quản lý cơ sở, GV, kế toán… cần biết giờ mở cửa),
  // còn SỬA gác riêng bằng `centers:edit`. Cố ý DÙNG LẠI hai quyền sẵn có: quyền mới bắt
  // buộc chạy `seed-prod-roles.yml` sau merge, quên là màn này trắng với mọi vai trên prod.
  const target = { centerId: center.id, ...(orgUnitId ? { orgUnitId } : {}) };
  if (!(await checkPermission("centers:view", target))) {
    redirect("/dashboard?error=unauthorized");
  }
  const canEdit = await checkPermission("centers:edit", target);
  const roleChoices = await listRoleOptions();

  const sp = await searchParams;
  // Chỉ chấp nhận mã vai CÓ THẬT trong RoleDef: chuỗi tuỳ ý trên URL mà lọt xuống DB sẽ
  // đẻ ra cụm cấu hình mồ côi, không đường nào đọc tới và cũng không màn nào xoá được.
  const requestedRole = sp.vai?.trim() ?? "";
  const roleCode =
    requestedRole && roleChoices.some((r) => r.code === requestedRole)
      ? requestedRole
      : WILDCARD;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link
          href={`/centers/${center.id}/edit`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Quay lại cơ sở
        </Link>
        <h1 className="mt-2 text-3xl font-black text-foreground">
          Giờ làm việc: <span className="font-bold text-primary">{center.name}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Khai giờ mở/đóng cửa từng thứ cho cơ sở này. Thứ nào không khai sẽ chạy theo cấu
          hình toàn hệ thống.
        </p>
      </div>

      {orgUnitId === null ? (
        // Center "mồ côi" (không OrgUnit nào trỏ tới, và không khớp được theo mã) — ghi
        // xuống sẽ không có đơn vị để gắn. Nói thẳng thay vì hiện form rồi báo lỗi lúc lưu.
        <div className="rounded-xl border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          <p className="font-bold">Chưa khai được giờ cho cơ sở này.</p>
          <p className="mt-1">
            Cơ sở <span className="font-semibold">{center.name}</span> chưa được gắn với đơn
            vị nào trong cây tổ chức (OrgUnit), mà giờ làm việc lưu theo đơn vị. Vui lòng
            tạo đơn vị tương ứng — hoặc đặt mã cơ sở trùng mã đơn vị — rồi quay lại.
          </p>
        </div>
      ) : (
        <WorkingHoursEditorLoader
          centerId={center.id}
          centerName={center.name}
          orgUnitId={orgUnitId}
          roleCode={roleCode}
          roleChoices={roleChoices}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

/** Tách phần cần truy vấn theo (đơn vị, vai) để nhánh "cơ sở mồ côi" không phải chạy nó. */
async function WorkingHoursEditorLoader({
  centerId,
  centerName,
  orgUnitId,
  roleCode,
  roleChoices,
  canEdit,
}: {
  centerId: string;
  centerName: string;
  orgUnitId: string;
  roleCode: string;
  roleChoices: { code: string; name: string }[];
  canEdit: boolean;
}) {
  const { ownRows, inheritedWeek } = await loadWorkingHourAdminView(orgUnitId, roleCode);
  const days = buildFormDays(ownRows, inheritedWeek);

  // Chữ ký dữ liệu server. Sau khi lưu, editor gọi `router.refresh()`: state cục bộ của
  // component KHÔNG tự cập nhật theo prop mới, nên không có `key` thì màn hình sẽ còn giữ
  // giá trị người dùng vừa gõ ở những thứ mà server vừa xoá (trả về kế thừa) — nhìn như
  // đã lưu mà thật ra chưa. Chữ ký đổi ⇒ React remount ⇒ luôn hiện đúng thứ DB đang có.
  const stateKey = `${roleCode}|${days
    .map((d) => `${d.weekday}${d.declared ? "R" : "K"}${d.isClosed ? "N" : `${d.openTime}-${d.closeTime}`}`)
    .join(",")}`;

  return (
    <WorkingHoursEditor
      key={stateKey}
      centerId={centerId}
      centerName={centerName}
      roleCode={roleCode}
      roleChoices={roleChoices}
      initialDays={days}
      canEdit={canEdit}
    />
  );
}
