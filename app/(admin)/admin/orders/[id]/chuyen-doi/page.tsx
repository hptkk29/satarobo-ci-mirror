import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { docDuLieuChuyenDoi } from "@/lib/orders/chuyen-doi-don";
import {
  duocChuyenDoi,
  lyDoChuaChuyenDoiDuoc,
  tienWebhookCuaDon,
} from "@/lib/payments/tien-webhook-vao-don";
import { FormChuyenDoi } from "./_components/form-chuyen-doi";

export const metadata = { title: "Chuyển đổi đơn | Admin" };
export const dynamic = "force-dynamic";

/**
 * Màn CHUYỂN ĐỔI — xếp học viên của một đơn vào lớp.
 *
 * Mode **Operate** (DESIGN.md): người dùng tới để làm xong một việc. Nên trang không có
 * gì để "thuyết phục" — mọi pixel phục vụ câu hỏi *"bé này vào lớp nào"*.
 *
 * Bốn trạng thái đủ (DESIGN.md §5): không có quyền · không thấy đơn · chưa đủ điều kiện
 * tiền · không có dòng nào xếp được. Trạng thái thứ nhất là hạng nhất ở hệ này vì phân
 * quyền theo module × cơ sở.
 */
export default async function ChuyenDoiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;

  // Cùng quyền mà `enrollStudent` đòi — đẻ một quyền riêng cho màn này là mở một đường
  // ghi danh thứ hai đi qua một cổng khác.
  const [coQuyen, laAdmin] = await Promise.all([
    checkPermission("enrollments:create"),
    checkPermission("enrollments:override-progress"),
  ]);
  if (!coQuyen) {
    return (
      <div className="mx-auto w-full max-w-[104rem]">
        {/* Dùng khuôn dùng chung — nó đã nói đủ ba vế mà DESIGN.md §5 đòi: thiếu quyền
            NÀO, hỏi AI, và tên quyền để người cấp tra được. Tự dựng một khối thứ hai là
            hai màn "không có quyền" nói hai kiểu. */}
        <NoPermission
          what="màn chuyển đổi đơn"
          permission="enrollments:create"
          askWho="Quản lý cơ sở hoặc Quản trị hệ thống"
        />
      </div>
    );
  }

  // Cổng IDOR: đơn ngoài tầm nhìn cơ sở của actor trả `null`, không trả dữ liệu.
  const actor = await resolveActor(session.user.id);
  const trongTam = await scopedDb(actor).order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });

  const bayGio = new Date();
  const [tien, duLieu] = await Promise.all([
    trongTam ? tienWebhookCuaDon(id) : Promise.resolve({ soTien: 0, soLuot: 0 }),
    trongTam ? docDuLieuChuyenDoi(id, bayGio) : Promise.resolve(null),
  ]);

  if (!trongTam || !duLieu) {
    return (
      <div className="mx-auto w-full max-w-[104rem]">
        <EmptyState
          title="Không tìm thấy đơn"
          description="Đơn không tồn tại, đã xoá, hoặc thuộc cơ sở ngoài tầm nhìn của bạn."
          action={
            <Link
              href="/orders"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Về danh sách đơn
            </Link>
          }
        />
      </div>
    );
  }

  const quayLai = (
    <Link
      href={`/orders/${id}`}
      className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
      Quay lại đơn {duLieu.maDon}
    </Link>
  );

  if (!duocChuyenDoi(tien)) {
    return (
      <div className="mx-auto w-full max-w-[104rem]">
        {quayLai}
        <EmptyState
          title="Đơn chưa đủ điều kiện chuyển đổi"
          description={lyDoChuaChuyenDoiDuoc(tien)}
          action={
            <Link
              href={`/orders/${id}`}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Xem phiếu thu &amp; mã QR của đơn
            </Link>
          }
        />
      </div>
    );
  }

  const chuaXep = duLieu.dong.filter((d) => d.enrollmentId === null);

  return (
    /* Trần 104rem (1664px) — CÙNG con số với màn chi tiết đơn, và cùng lý do: ở 4k/8k một
       form trải hết bề ngang thì mắt phải quét cả mét giữa nhãn và ô nhập. Dưới trần thì
       co theo màn, tới tận 320px. */
    <div className="mx-auto w-full max-w-[104rem]">
      {quayLai}

      <PageHeader
        title={`Chuyển đổi đơn ${duLieu.maDon}`}
        subtitle={
          <>
            Xếp học viên vào lớp. <b>Mỗi bé chọn lớp riêng</b> — bé nào chưa xếp được thì
            bỏ qua, quay lại xếp sau lúc nào cũng được.
          </>
        }
      />

      {chuaXep.length === 0 ? (
        <EmptyState
          title="Mọi học viên của đơn này đã được xếp lớp"
          description="Không còn dòng nào chờ chuyển đổi."
          action={
            <Link
              href="/enrollments"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Xem danh sách ghi danh
            </Link>
          }
        />
      ) : (
        <FormChuyenDoi
          orderId={duLieu.orderId}
          maDon={duLieu.maDon}
          phuHuynh={duLieu.phuHuynh}
          dong={duLieu.dong}
          laAdmin={laAdmin}
        />
      )}
    </div>
  );
}
