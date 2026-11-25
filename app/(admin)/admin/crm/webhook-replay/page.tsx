import { redirect } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { getFailedDeliveries } from "@/lib/crm/webhook-replay";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReplayButton } from "./_components/replay-button";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";
export const metadata = { title: "Webhook replay | Admin" };

export default async function WebhookReplayPage() {
  await auth();
  if (!(await checkPermission("settings:edit"))) redirect("/admin/dashboard");

  const failed = await getFailedDeliveries(100);

  return (
    <div>
      <h1 className="mb-6 flex items-center gap-2 text-3xl font-black text-foreground">
        <RefreshCw className="h-7 w-7 text-primary" />
        Webhook lỗi — Replay
      </h1>
      <div className="rounded-lg border">
        <PhanTrangBang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nguồn</TableHead>
                <TableHead>External ID</TableHead>
                <TableHead>Nhận lúc</TableHead>
                <TableHead>Lỗi</TableHead>
                <TableHead className="text-right">Hành động</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Không có webhook FAILED.
                  </TableCell>
                </TableRow>
              ) : (
                failed.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono">{d.source}</TableCell>
                    <TableCell className="font-mono text-xs">{d.externalId ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.receivedAt.toISOString().slice(0, 16)}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-state-danger-ink">{d.errorMessage ?? ""}</TableCell>
                    <TableCell className="text-right">
                      <ReplayButton deliveryId={d.id} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
