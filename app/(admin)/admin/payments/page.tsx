import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  queryPayments,
  loadOrderOptions,
  loadPaymentMethodOptions,
} from "./_actions";
import { PaymentsClient } from "./_components/payments-client";

export const metadata = { title: "Thanh toán | Admin" };
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Gate list-level (nhiều khoản) — không có 1 centerId cụ thể, không truyền target.
  //
  // ⚠️ 03/08/2026 — trước đây chỉ nhận `payments:manage`, TRÁI với chính thiết kế
  // R7-04 AC1/AC5 mà trang này khai ngay dưới tiêu đề ("Ghi nhận khoản thu (Sale) &
  // xác nhận (Kế toán)"): người GHI NHẬN giữ `payments:record`, không phải
  // `payments:manage`. Hậu quả: Quản lý cơ sở và Sale — đúng hai vai phải thu tiền
  // tại quầy — bị đá về dashboard ngay ở cửa. Nhận CẢ HAI quyền.
  const [canManage, canRecord, canConfirm, canAdjust, canViewPii] = await Promise.all([
    checkPermission("payments:manage"),
    checkPermission("payments:record"),
    // Nút xác nhận/từ chối/điều chỉnh phải soi ĐÚNG quyền mà server action đòi
    // (`payments:confirm` trong _actions.ts). Trước đây suy từ `payments:manage` +
    // danh sách role tĩnh nên QLCS thấy nút rồi bấm mới báo lỗi.
    checkPermission("payments:confirm"),
    // Quyền RIÊNG chứ không dùng lại `payments:confirm`: xác nhận và điều chỉnh là hai
    // việc khác nhau, khoá cái này không được khoá luôn cái kia.
    // ⚠️ Ma trận v1 cố ý chỉ có SUPER_ADMIN; kế toán nhận quyền này ở RBAC v2 (DB).
    // Nghĩa là trên máy dev (v1) nút ẩn với kế toán, trên prod (v2 đang BẬT) thì hiện.
    checkPermission("payments:adjust"),
    // #15 (câu 32) — chỉ kế toán/admin (payments:view-pii) mới thấy nút "Xem đầy đủ"
    // CCCD PH + địa chỉ (break-glass). Mặc định mọi người xem bản đã che.
    checkPermission("payments:view-pii"),
  ]);

  if (!canManage && !canRecord) {
    redirect("/dashboard?error=unauthorized");
  }

  const [rows, orders, methods] = await Promise.all([
    queryPayments({}),
    loadOrderOptions(),
    // 30/08/2026 — danh mục phương thức đọc từ DB thay cho danh sách hardcode trong
    // payments-client.tsx, để phương thức riêng của từng cơ sở hiện ra ở đúng cơ sở đó.
    loadPaymentMethodOptions(),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Thanh toán</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ghi nhận khoản thu (Sale) &amp; xác nhận / từ chối / điều chỉnh (Kế toán)
          </p>
        </div>
      </div>

      <PaymentsClient
        initialRows={rows}
        orders={orders}
        methods={methods}
        canConfirm={canConfirm}
        canAdjust={canAdjust}
        canRecord={canRecord}
        canViewPii={canViewPii}
      />
    </div>
  );
}
