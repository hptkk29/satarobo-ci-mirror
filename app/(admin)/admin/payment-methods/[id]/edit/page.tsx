import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { loadCenterPaymentOptions } from "@/lib/payments/center-options";
import { PaymentMethodForm } from "../../_components/payment-method-form";

export const metadata = { title: "Sửa phương thức thanh toán | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditPaymentMethodPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate mức màn hình gọi trần; quyền đụng ĐÚNG dòng này do scopedDb (đọc) +
  // passesScope trong _actions.ts (ghi) lo — xem ghi chú ở requirePaymentsManage.
  if (!(await checkPermission("payments:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;
  // 30/08/2026 — PaymentMethod ∈ SCOPED_MODELS: câu này nay TỰ LỌC theo cơ sở. Phương
  // thức của cơ sở khác ra null ⇒ notFound(), không còn mở được bằng cách đoán id.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const [method, centers] = await Promise.all([
    sdb.paymentMethod.findUnique({ where: { id } }),
    loadCenterPaymentOptions(actor),
  ]);
  if (!method) notFound();

  return (
    <div>
      <Link
        href="/payment-methods"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại danh sách
      </Link>

      <h1 className="mb-1 text-2xl font-bold text-foreground">{method.name}</h1>
      <p className="mb-6 font-mono text-sm text-muted-foreground">{method.code}</p>

      <PaymentMethodForm method={method} centers={centers} />
    </div>
  );
}
