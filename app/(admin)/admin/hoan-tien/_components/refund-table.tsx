"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RefundRow } from "@/lib/finance/refund";
import { approveRefundAction, chiHoanTienAction, rejectRefundAction } from "../_actions";
import { filterMethodsForCenter } from "@/lib/payments/method-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + " đ";
}

const TRIGGER_LABEL: Record<RefundRow["trigger"], string> = {
  WITHDRAW: "Rút học",
  TRANSFER: "Chuyển lớp",
  CLASS_CANCELLED: "Hủy lớp",
  MANUAL: "Thủ công",
};

const STATUS_BADGE: Record<RefundRow["status"], string> = {
  PENDING: "bg-state-warning-soft text-state-warning-ink hover:bg-state-warning-soft",
  APPROVED: "bg-state-success-soft text-state-success-ink hover:bg-state-success-soft",
  REJECTED: "bg-state-danger-soft text-state-danger-ink hover:bg-state-danger-soft",
  PAID: "bg-state-info-soft text-state-info-ink hover:bg-state-info-soft",
};
const STATUS_LABEL: Record<RefundRow["status"], string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
  PAID: "Đã chi",
};

export type PhuongThucChi = { code: string; name: string; centerId: string | null };

/** Hôm nay theo giờ VN, dạng YYYY-MM-DD — mặc định + trần của ô ngày chi. */
function homNayVn(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function RefundTable({
  rows,
  canApprove,
  phuongThuc,
}: {
  rows: RefundRow[];
  /** `payments:confirm` — CÙNG cờ mà approve / reject / chi action gác. */
  canApprove: boolean;
  phuongThuc: PhuongThucChi[];
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  // Hộp thoại "Đánh dấu đã chi" — xác nhận 2 bước: bấm lần 1 hiện câu tóm tắt, lần 2 mới ghi.
  const [chi, setChi] = useState<RefundRow | null>(null);
  const [chiMethod, setChiMethod] = useState("");
  const [chiDate, setChiDate] = useState("");
  const [chiNote, setChiNote] = useState("");
  const [chiArmed, setChiArmed] = useState(false);

  const ptChoDong = chi ? filterMethodsForCenter(phuongThuc, chi.coSoPhuongThuc) : [];

  function moChi(r: RefundRow) {
    setChi(r);
    setChiMethod("");
    setChiDate(homNayVn());
    setChiNote("");
    setChiArmed(false);
  }
  function dongChi() {
    setChi(null);
    setChiArmed(false);
  }
  function onChi() {
    if (!chi) return;
    if (!chiArmed) {
      setChiArmed(true);
      return;
    }
    const id = chi.id;
    startTransition(async () => {
      const res = await chiHoanTienAction({
        refundRequestId: id,
        method: chiMethod,
        paidDate: chiDate,
        note: chiNote.trim() || null,
      });
      if (res.ok) {
        toast.success("Đã ghi chi hoàn tiền vào sổ");
        dongChi();
      } else {
        toast.error(res.error);
        setChiArmed(false);
      }
    });
  }

  function onApprove(id: string) {
    // 2-click confirm: click 1 = arm, click 2 = thực thi.
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    startTransition(async () => {
      const res = await approveRefundAction(id);
      if (res.ok) toast.success("Đã duyệt hoàn tiền");
      else toast.error(res.error);
      setConfirmId(null);
    });
  }

  function onReject() {
    if (!rejectId) return;
    const id = rejectId;
    startTransition(async () => {
      const res = await rejectRefundAction(id, rejectNote);
      if (res.ok) {
        toast.success("Đã từ chối hoàn tiền");
        setRejectId(null);
        setRejectNote("");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border">
        <PhanTrangBang cuonNgang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Học viên / Lớp</TableHead>
                <TableHead>Lý do</TableHead>
                <TableHead className="text-right">Đã thu</TableHead>
                <TableHead className="text-right">Buổi (học/tổng)</TableHead>
                <TableHead className="text-right">Đề xuất hoàn</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Không có yêu cầu hoàn tiền
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {r.studentName ?? "(Không rõ HV)"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.className ?? r.orderCode ?? r.enrollmentId?.slice(0, 8) ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{TRIGGER_LABEL[r.trigger]}</Badge>
                    <div className="mt-1 max-w-[16rem] truncate text-xs text-muted-foreground">
                      {r.reason}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{vnd(r.paidConfirmed)}</TableCell>
                  <TableCell className="text-right">
                    {r.sessionsLearned}/{r.sessionsTotal}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {vnd((r.status === "APPROVED" || r.status === "PAID") && r.approvedAmount != null
                      ? r.approvedAmount
                      : r.proposedAmount)}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_BADGE[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canApprove && r.status === "APPROVED" ? (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => moChi(r)}
                        >
                          Đánh dấu đã chi
                        </Button>
                      </div>
                    ) : r.status === "PAID" ? (
                      <div className="text-right text-xs text-muted-foreground">
                        <div>
                          Chi ngày{" "}
                          {r.paidAt
                            ? new Date(r.paidAt).toLocaleDateString("vi-VN", {
                                timeZone: "Asia/Ho_Chi_Minh",
                              })
                            : "—"}
                        </div>
                        <div>{r.paidByName ?? "—"}</div>
                      </div>
                    ) : canApprove && r.status === "PENDING" ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant={confirmId === r.id ? "default" : "outline"}
                          disabled={isPending}
                          onClick={() => onApprove(r.id)}
                        >
                          {confirmId === r.id ? "Xác nhận duyệt" : "Duyệt"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => {
                            setRejectId(r.id);
                            setRejectNote("");
                          }}
                        >
                          Từ chối
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>

      <Dialog
        open={chi !== null}
        onOpenChange={(o) => {
          if (!o) dongChi();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đánh dấu đã chi hoàn tiền</DialogTitle>
          </DialogHeader>
          {chi && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {chi.studentName ?? "(Không rõ HV)"} · số đã duyệt{" "}
                <span className="font-semibold text-foreground">
                  {vnd(chi.approvedAmount ?? chi.proposedAmount)}
                </span>
                . Ghi xong, khoản hoàn đi vào sổ thu (công nợ, hoá đơn điện tử thấy ngay) và không
                sửa lại được.
              </p>
              <div className="space-y-1">
                <Label htmlFor="chi-pt">Phương thức chi</Label>
                <Select
                  value={chiMethod}
                  onValueChange={(v) => {
                    if (v !== null) {
                      setChiMethod(v);
                      setChiArmed(false);
                    }
                  }}
                >
                  <SelectTrigger id="chi-pt" className="w-full" disabled={isPending}>
                    <SelectValue>
                      {(v: string | null) =>
                        ptChoDong.find((m) => m.code === v)?.name ?? "Chọn phương thức"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ptChoDong.map((m) => (
                      <SelectItem key={m.code} value={m.code}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ptChoDong.length === 0 && (
                  <p className="text-xs text-state-danger-ink">
                    Chưa có phương thức thanh toán nào đang bật cho cơ sở này — khai ở màn Phương
                    thức thanh toán trước.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="chi-ngay">Ngày chi</Label>
                <Input
                  id="chi-ngay"
                  type="date"
                  value={chiDate}
                  max={homNayVn()}
                  onChange={(e) => {
                    setChiDate(e.target.value);
                    setChiArmed(false);
                  }}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="chi-ghi-chu">Ghi chú (tuỳ chọn)</Label>
                <Textarea
                  id="chi-ghi-chu"
                  value={chiNote}
                  onChange={(e) => setChiNote(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  disabled={isPending}
                />
              </div>
              {chiArmed && (
                <p className="rounded-md bg-state-warning-soft px-3 py-2 text-state-warning-ink">
                  Bấm lần nữa để ghi chi {vnd(chi.approvedAmount ?? chi.proposedAmount)} vào sổ.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={dongChi} disabled={isPending}>
              Hủy
            </Button>
            <Button
              onClick={onChi}
              variant={chiArmed ? "default" : "outline"}
              disabled={isPending || !chiMethod || !chiDate}
            >
              {chiArmed ? "Xác nhận đã chi" : "Ghi đã chi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRejectId(null);
            setRejectNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Từ chối hoàn tiền</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Nhập lý do từ chối (≥5 ký tự)…"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectId(null);
                setRejectNote("");
              }}
              disabled={isPending}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={onReject}
              disabled={isPending || rejectNote.trim().length < 5}
            >
              Xác nhận từ chối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
