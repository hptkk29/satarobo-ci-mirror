"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { assignUserOrgRoleAction, revokeUserOrgRoleAction } from "../actions";
import { roleCodeLabel } from "@/lib/labels";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

type Opt = { id: string; code: string; name: string };

// BGĐ 31/07 — Việt hoá trạng thái phân quyền (enum AssignStatus).
const ASSIGN_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Hiệu lực",
  SUSPENDED: "Tạm ngưng",
  EXPIRED: "Hết hạn",
};
type Assignment = {
  orgUnitId: string;
  roleId: string;
  orgCode: string;
  roleCode: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function OrgRolesManager({
  userId,
  roles,
  orgUnits,
  assignments,
}: {
  userId: string;
  roles: Opt[];
  orgUnits: Opt[];
  assignments: Assignment[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [orgUnitId, setOrgUnitId] = useState(orgUnits[0]?.id ?? "");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [reason, setReason] = useState("");

  function assign() {
    startTransition(async () => {
      const res = await assignUserOrgRoleAction({ userId, orgUnitId, roleId, reason });
      if (res.ok) {
        toast.success("Đã gán vai trò");
        setReason("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function revoke(a: Assignment) {
    startTransition(async () => {
      const res = await revokeUserOrgRoleAction({
        userId,
        orgUnitId: a.orgUnitId,
        roleId: a.roleId,
        reason: "Thu hồi qua UI",
      });
      if (res.ok) {
        toast.success("Đã thu hồi");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-muted p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Gán vai trò</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="org">Đơn vị</Label>
            <select
              id="org"
              value={orgUnitId}
              onChange={(e) => setOrgUnitId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {orgUnits.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} — {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="role">Vai trò</Label>
            <select
              id="role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || roleCodeLabel(r.code)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="assign-reason">Lý do</Label>
            <Input
              id="assign-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Vì sao gán"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={assign}
              disabled={pending || !orgUnitId || !roleId}
              className="w-full"
            >
              {pending ? "Đang lưu..." : "Gán"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border">
        <PhanTrangBang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Đơn vị</TableHead>
                <TableHead>Vai trò</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Hiệu lực</TableHead>
                <TableHead className="text-right">Hành động</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Chưa có phân quyền nào.
                  </TableCell>
                </TableRow>
              ) : (
                assignments.map((a) => (
                  <TableRow key={`${a.orgUnitId}:${a.roleId}`}>
                    <TableCell>
                      {orgUnits.find((o) => o.id === a.orgUnitId)?.name ?? a.orgCode}
                    </TableCell>
                    <TableCell>
                      {roles.find((r) => r.id === a.roleId)?.name ?? roleCodeLabel(a.roleCode)}
                    </TableCell>
                    <TableCell>
                      {a.status === "ACTIVE" ? (
                        <Badge>Hiệu lực</Badge>
                      ) : (
                        <Badge variant="outline">{ASSIGN_STATUS_LABELS[a.status] ?? a.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.effectiveFrom.slice(0, 10)}
                      {a.effectiveTo ? ` → ${a.effectiveTo.slice(0, 10)}` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.status === "ACTIVE" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => revoke(a)}
                        >
                          Thu hồi
                        </Button>
                      )}
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
