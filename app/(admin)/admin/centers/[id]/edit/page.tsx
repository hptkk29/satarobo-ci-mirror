import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, MapPin } from "lucide-react";
import type { PaymentMethodType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { orgUnitIdForCenterBridged } from "@/lib/working-hours/admin-service";
import {
  CenterForm,
  type CenterPaymentView,
} from "../../_components/center-form";
import { PhongHocCoSo } from "../../_components/phong-hoc-co-so";

interface Props {
  params: Promise<{ id: string }>;
}

/** Nhãn tiếng Việt của loại phương thức — chỉ để hiện trong mục Thanh toán. */
const TYPE_LABEL: Record<PaymentMethodType, string> = {
  CASH: "Tiền mặt",
  BANK_TRANSFER: "Chuyển khoản",
  VNPAY: "VNPAY",
  TINGEE: "Tingee",
  COD: "COD",
  WALLET: "Ví điện tử",
};

export default async function EditCenterPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Center ∈ SCOPE_EXEMPT → sdb pass-through (hành vi y nguyên); gate sửa/xoá nằm ở
  // server actions (`centers:edit`).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const { id } = await params;
  const center = await sdb.center.findUnique({ where: { id } });
  if (!center) notFound();

  // ─── Mục "Thanh toán" ─────────────────────────────────────────────────────
  // Trang này KHÔNG có cổng quyền ở đầu (chỉ kiểm đăng nhập) và `Center` ∈ SCOPE_EXEMPT
  // nên `findUnique` ở trên mở được BẤT KỲ id nào. Mục Thanh toán in tài khoản nhận tiền
  // của cơ sở, nên phải tự gác đủ HAI lớp:
  //
  //  1. CÁCH LY CƠ SỞ — `passesScope`. ⚠️ KHÔNG thay bằng `checkPermission(..., target)`:
  //     `payments:view` được seed `scopeType: "GLOBAL"` cho CENTER_MANAGER và
  //     CENTER_ACCOUNTANT, mà `lib/auth/can.ts:14-15` là `case "GLOBAL": return true` —
  //     ĐÍCH BỊ VỨT. Đường v1 (chạy ở local) còn không có khái niệm target. Gác bằng
  //     permission-có-đích ở đây là gác GIẢ: đo thật thì Kế toán/QLCS của CS1 mở
  //     `/centers/<id-CS2>/edit` đọc trọn số tài khoản của CS2. Khoá ở `[PTTT-11]`.
  //  2. CHỨC NĂNG — `payments:view` để xem, `payments:manage` để hiện nút tạo/sửa.
  const orgUnitId = await orgUnitIdForCenterBridged(center);
  const centerInScope = passesScope("PaymentMethod", { centerId: center.id }, actor);
  const [hasPaymentsView, canManageMethods] = await Promise.all([
    checkPermission("payments:view", {
      centerId: center.id,
      ...(orgUnitId ? { orgUnitId } : {}),
    }),
    checkPermission("payments:manage"),
  ]);
  const canViewPayment = centerInScope && hasPaymentsView;

  // Chỉ truy vấn khi thật sự vẽ — không có quyền xem thì cũng đừng đọc số tài khoản.
  let payment: CenterPaymentView | null = null;
  if (canViewPayment) {
    // PaymentMethod ∈ SCOPED_MODELS: `where` dưới đây lọc theo CƠ SỞ ĐANG SỬA (câu hỏi
    // của màn này), còn scopedDb lọc thêm theo tầm nhìn của người xem. Hai tầng hỏi hai
    // câu khác nhau, cả hai đều cần.
    const [rows, sharedCount] = await Promise.all([
      sdb.paymentMethod.findMany({
        where: { centerId: center.id },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          isActive: true,
          bankBin: true,
          bankAccountNumber: true,
          bankAccountName: true,
        },
      }),
      sdb.paymentMethod.count({ where: { centerId: null, isActive: true } }),
    ]);
    payment = {
      sharedCount,
      canManage: canManageMethods,
      methods: rows.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        typeLabel: TYPE_LABEL[m.type] ?? m.type,
        isActive: m.isActive,
        // Tóm tắt tài khoản: chỉ hiện khi ĐỦ 3 mảnh dựng được QR. Thiếu một mảnh thì
        // nói thẳng "chưa khai đủ" thay vì in nửa vời — người đọc phải biết ngay là mã
        // QR của phương thức này chưa dựng được.
        bank:
          m.type !== "BANK_TRANSFER"
            ? null
            : m.bankBin && m.bankAccountNumber && m.bankAccountName
              ? `${m.bankAccountName} · ${m.bankAccountNumber} (BIN ${m.bankBin})`
              : "⚠ chưa khai đủ tài khoản — chưa dựng được mã QR",
      })),
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/centers"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden /> Tất cả cơ sở
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{center.name}</h1>
          <span
            className={
              center.isActive
                ? "rounded-full bg-state-success-soft px-2.5 py-0.5 text-xs font-medium text-state-success-ink"
                : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
            }
          >
            {center.isActive ? "Đang hoạt động" : "Đã đóng"}
          </span>
        </div>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
          {center.address}
        </p>
      </div>

      {/* 01/10/2026 — phòng học quản lý ngay trong trang cơ sở (chủ dự án gộp mục menu). */}
      <PhongHocCoSo userId={session.user.id} centerId={center.id} />

      <CenterForm
        center={{
          id: center.id,
          name: center.name,
          slug: center.slug,
          address: center.address,
          ward: center.ward,
          district: center.district,
          city: center.city,
          phone: center.phone,
          email: center.email,
          googleMapUrl: center.googleMapUrl,
          workingHours: center.workingHours,
          managerName: center.managerName,
          managerUserId: center.managerUserId,
          logoUrl: center.logoUrl,
          bannerUrl: center.bannerUrl,
          description: center.description,
          isActive: center.isActive,
          displayOrder: center.displayOrder,
          latitude: center.latitude,
          longitude: center.longitude,
          allowedRadiusMeters: center.allowedRadiusMeters,
        }}
        payment={payment}
      />
    </div>
  );
}
