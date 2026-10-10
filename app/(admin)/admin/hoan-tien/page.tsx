import { redirect } from "next/navigation";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { listRefundRequests } from "@/lib/finance/refund";
import { layChoDeXuatHoanTien } from "@/lib/finance/cho-de-xuat-hoan-tien";
import type { RefundStatus } from "@prisma/client";
import { RefundTable } from "./_components/refund-table";
import { ChoDeXuat } from "./_components/cho-de-xuat";

export const metadata = { title: "Hoàn tiền | Admin" };
export const dynamic = "force-dynamic";

const STATUSES: { key: RefundStatus | "ALL"; label: string }[] = [
  { key: "PENDING", label: "Chờ duyệt" },
  { key: "APPROVED", label: "Đã duyệt" },
  { key: "REJECTED", label: "Từ chối" },
  { key: "PAID", label: "Đã chi" },
  { key: "ALL", label: "Tất cả" },
];

export default async function HoanTienPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Xem danh sách: quyền tài chính (payments:manage). Duyệt/từ chối: payments:confirm (action gate).
  if (!(await checkPermission("payments:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const uid = session.user.id;
  if (!uid) redirect("/login");

  const sp = await searchParams;
  const statusParam = (sp.status ?? "PENDING").toUpperCase();
  const status = (
    ["PENDING", "APPROVED", "REJECTED", "PAID"].includes(statusParam)
      ? statusParam
      : statusParam === "ALL"
        ? "ALL"
        : "PENDING"
  ) as RefundStatus | "ALL";

  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);
  const rows = await listRefundRequests(
    sdb as unknown as Parameters<typeof listRefundRequests>[0],
    status === "ALL" ? undefined : { status },
  );

  const canApprove = await checkPermission("payments:confirm");
  // Phương thức CHI cho hộp thoại "Đánh dấu đã chi" — chỉ nạp khi nút có thể hiện (cùng cờ
  // `payments:confirm` với `chiHoanTienAction`). Qua `scopedDb`: người cấp cơ sở chỉ thấy phương
  // thức của cơ sở mình + dùng chung; bảng lọc thêm theo cơ sở của từng dòng.
  const phuongThuc = canApprove
    ? await sdb.paymentMethod.findMany({
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        select: { code: true, name: true, centerId: true },
      })
    : [];
  // Việc còn tồn: đã nghỉ học, đã đóng tiền, mà lượt gỡ không sinh được đề xuất nào.
  // Nằm ngoài bộ lọc trạng thái vì nó KHÔNG phải một trạng thái của `RefundRequest` —
  // chính xác là những ca chưa có bản ghi nào để mà lọc.
  const choDeXuat = await layChoDeXuatHoanTien(
    sdb as unknown as Parameters<typeof layChoDeXuatHoanTien>[0],
  );

  return (
    <div>
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
          <Undo2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Hoàn tiền</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Yêu cầu hoàn tiền theo vòng đời (rút học / chuyển lớp / hủy lớp). Đề xuất ={" "}
            Σ đã thu − số buổi đã học × đơn giá.
          </p>
        </div>
      </div>

      <ChoDeXuat
        dong={choDeXuat.dong}
        tongSo={choDeXuat.tongSo}
        daCat={choDeXuat.daCat}
        khongPhaiHoan={choDeXuat.khongPhaiHoan}
        canTao={canApprove}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const active = status === s.key;
          return (
            <Link
              key={s.key}
              href={`/hoan-tien?status=${s.key}`}
              className={
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors " +
                (active
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted")
              }
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <RefundTable rows={rows} canApprove={canApprove} phuongThuc={phuongThuc} />
    </div>
  );
}
