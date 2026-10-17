import { redirect } from "next/navigation";
import { Coins } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatementActions } from "./_components/statement-actions";
import { ChotKyForm } from "./_components/chot-ky-form";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hoa hồng | Admin" };

export default async function CommissionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Cửa VÀO giữ nguyên `payments:manage`: kế toán cơ sở vẫn xem được bảng hoa hồng
  // (đã lọc theo người hưởng thuộc cơ sở mình) và vẫn xuất Excel được.
  if (!(await checkPermission("payments:manage"))) redirect("/admin/dashboard");

  // 27/08/2026 — nhưng ba NÚT ghi (chốt / duyệt / mở lại) đòi key riêng, chỉ Super
  // Admin + kế toán Hội sở. Kiểm ở đây để KHÔNG vẽ nút người ta bấm không được: trước
  // đợt này nút "Mở lại" hiện cho mọi người vào được màn, bấm xong mới ăn toast
  // "Chỉ SUPER_ADMIN…" — cổng đúng nhưng giao diện nói dối.
  const canChotKy = await checkPermission("commission_periods:manage");

  // Cách ly cơ sở (scope TAY): CommissionStatement là bảng KỲ toàn hệ thống
  // (period @unique, KHÔNG có centerId) → scopedDb pass-through. Hoa hồng "theo cơ
  // sở" đi qua NGƯỜI HƯỞNG (CommissionLine.recipientId → User.centerId): actor không
  // phải SUPER_ADMIN/HO chỉ thấy dòng của user thuộc cơ sở trong tầm nhìn.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleCenters = getModelVisibleCenterIds("CommissionStatement", actor);
  const lineWhere =
    visibleCenters === "ALL"
      ? undefined
      : {
          recipientId: {
            in: (
              await sdb.user.findMany({
                where: { centerId: { in: visibleCenters } },
                select: { id: true },
              })
            ).map((u) => u.id),
          },
        };

  const statements = await sdb.commissionStatement.findMany({
    orderBy: { period: "desc" },
    include: { lines: { where: lineWhere, select: { amount: true } } },
  });

  return (
    <div>
      <h1 className="mb-6 flex items-center gap-2 text-3xl font-black text-foreground">
        <Coins className="h-7 w-7 text-primary" />
        Bảng hoa hồng theo kỳ
      </h1>
      <ChotKyForm canChotKy={canChotKy} />
      <div className="rounded-lg border">
        <PhanTrangBang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kỳ</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Số dòng</TableHead>
                <TableHead className="text-right">Tổng (VND)</TableHead>
                <TableHead className="text-right">Hành động</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Chưa có bảng hoa hồng nào.
                  </TableCell>
                </TableRow>
              ) : (
                statements.map((s) => {
                  const total = s.lines.reduce((sum, l) => sum + l.amount, 0);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono font-semibold">{s.period}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === "APPROVED" ? "default" : "secondary"}>{s.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{s.lines.length}</TableCell>
                      <TableCell className="text-right">{total.toLocaleString("vi-VN")}</TableCell>
                      <TableCell>
                        <StatementActions period={s.period} status={s.status} canChotKy={canChotKy} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
