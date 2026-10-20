"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Loader2,
  Plus,
  Check,
  X,
  Pencil,
  Printer,
  Eye,
  EyeOff,
  ShieldAlert,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  recordPaymentAction,
  confirmPaymentAction,
  rejectPaymentAction,
  adjustPaymentAction,
  updatePendingPaymentAction,
  revealPaymentsPii,
  queryPayments,
  type PaymentRow,
} from "../_actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { filterMethodsForCenter } from "@/lib/payments/method-scope";

type OrderOption = {
  id: string;
  code: string;
  customerName: string;
  totalAmount: number;
  /** Cơ sở đứng tên đơn — quyết định phương thức nào chọn được. null = không gán. */
  centerId: string | null;
};

/** Một dòng danh mục phương thức thanh toán (đọc từ DB, đã scope theo cơ sở). */
export type MethodOption = {
  id: string;
  code: string;
  name: string;
  /** null = dùng chung mọi cơ sở. */
  centerId: string | null;
  /**
   * Dòng đã tắt VẪN nằm trong danh sách này — cố ý. Nó bị loại khỏi dropdown CHỌN
   * (lọc ở `availableMethods`) nhưng phải còn trong bảng NHÃN, kẻo khoản thu cũ ghi
   * bằng mã đó in ra mã trần.
   */
  isActive: boolean;
};

const SALE_LABEL: Record<string, string> = {
  RECORDED: "Đã ghi nhận",
  COLLECT_CONFIRMED: "Đã xác nhận thu",
};
const SALE_BADGE: Record<string, string> = {
  RECORDED: "bg-muted text-foreground hover:bg-muted",
  COLLECT_CONFIRMED: "bg-state-info-soft text-state-info-ink hover:bg-state-info-soft",
};

const ACC_LABEL: Record<string, string> = {
  PENDING: "Chờ kế toán",
  CONFIRMED: "Đã xác nhận",
  REJECTED: "Từ chối",
  REFUNDED: "Đã hoàn",
};
const ACC_BADGE: Record<string, string> = {
  PENDING: "bg-state-warning-soft text-state-warning-ink hover:bg-state-warning-soft",
  CONFIRMED: "bg-state-success-soft text-state-success-ink hover:bg-state-success-soft",
  REJECTED: "bg-state-danger-soft text-state-danger-ink hover:bg-state-danger-soft",
  REFUNDED: "bg-primary-soft text-primary hover:bg-primary-soft",
};

// ⚠️ 30/08/2026 — đây KHÔNG còn là danh sách để CHỌN. Danh sách chọn nay đọc từ DB
// (loadPaymentMethodOptions) và lọc theo cơ sở của đơn, vì phương thức riêng của từng cơ
// sở khai ở /payment-methods chứ không nằm trong code.
//
// Bảng dưới đây chỉ còn một việc: dịch nhãn cho `Payment.method` CŨ trong sổ. Cột đó là
// chuỗi tự do và đang chứa cả mã danh mục lẫn nhãn thô ("auto" do đường ghi tự động
// sinh). Xoá bảng này là mọi khoản thu cũ hiện ra mã trần trước mắt kế toán.
const LEGACY_METHOD_LABEL: Record<string, string> = {
  CASH: "Tiền mặt",
  BANK_TRANSFER: "Chuyển khoản",
  VNPAY: "VNPAY",
  TINGEE: "Tingee",
  COD: "COD",
  auto: "Tự động",
};

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + " đ";
}
function fmtDate(d: string | Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(d));
}

import { BulkBackfillConfirm } from "./bulk-backfill-confirm";

export function PaymentsClient({
  initialRows,
  orders,
  methods,
  canConfirm,
  canAdjust,
  canRecord,
  canViewPii,
}: {
  initialRows: PaymentRow[];
  orders: OrderOption[];
  /** Danh mục phương thức đọc từ DB, đã lọc theo tầm nhìn cơ sở của người xem. */
  methods: MethodOption[];
  canConfirm: boolean;
  /** 07/09 — nút "Điều chỉnh" đang khoá; xem chú thích ở lib/auth/permissions.ts. */
  canAdjust: boolean;
  canRecord: boolean;
  canViewPii: boolean;
}) {
  const [rows, setRows] = useState<PaymentRow[]>(initialRows);
  const [showForm, setShowForm] = useState(false);

  /**
   * TÌM KHOẢN THU theo mã đơn / tên khách [02/10/2026].
   *
   * ⚠️ LỖ CÓ SẴN, đo được: trang gọi `queryPayments({})` — bộ lọc LUÔN RỖNG — và máy chủ
   * `take: PAGE_SIZE` = **30**. Tức màn này chỉ bao giờ hiện **30 khoản gần nhất**, không
   * ô tìm, không nút tải thêm (`PhanTrangBang` chỉ phân trang đúng 30 dòng ấy).
   *
   * Hệ quả thật: đợt nhập học phí từ file Excel có **119 khoản** chờ kế toán ⇒ **89 khoản
   * không có đường nào tới được**. Chủ dự án đi tìm `ORD-260910-000002` để gỡ một khoản
   * nhập trùng, `Ctrl+F` của trình duyệt trả `0/0` — vì dòng đó chưa bao giờ được tải về.
   *
   * Khả năng lọc VỐN ĐÃ CÓ ở máy chủ (`filters.search` → `order.code` HOẶC
   * `order.customerName`, `_actions.ts:205-213`) nhưng **chưa từng được nối vào giao diện
   * nào**. Đây là nối dây, không phải tính năng mới.
   */
  const [tuKhoa, setTuKhoa] = useState("");
  const [dangTim, batDauTim] = useTransition();

  function timKhoan(kw: string) {
    batDauTim(async () => {
      // Chuỗi rỗng ⇒ `filters.search?.trim()` ở server rơi về falsy ⇒ trả lại 30 dòng mới
      // nhất, đúng trạng thái ban đầu. Không cần nhánh riêng.
      const r = await queryPayments({ search: kw.trim() || undefined });
      setRows(r);
    });
  }
  // Danh mục THẬT thắng nhãn cũ: phương thức riêng của cơ sở ("BANK_CS1") chỉ có tên
  // trong DB. Nhãn cũ chỉ đỡ cho những giá trị không còn dòng danh mục nào.
  const methodLabel = useMemo(
    () => ({
      ...LEGACY_METHOD_LABEL,
      ...Object.fromEntries(methods.map((m) => [m.code, m.name])),
    }),
    [methods],
  );
  // #15 — break-glass: mặc định che CCCD PH + địa chỉ; kế toán mở xem đầy đủ có kiểm soát.
  const revealed = rows.length > 0 ? !rows[0]!.piiMasked : false;

  // Xác nhận/từ chối/điều chỉnh khoản thu chỉ hiện toast; dữ liệu mới về qua
  // revalidatePath("/payments") của action (_actions.ts:384) → prop đổi, nhưng useState
  // giữ nguyên giá trị mount đầu ⇒ trạng thái khoản thu đứng im tới khi F5. Đồng bộ lại.
  // Kèm hệ quả có chủ đích: dữ liệu mới là bản ĐÃ CHE PII → break-glass đóng lại, muốn
  // xem tiếp phải mở lại (và được audit lại) — an toàn hơn là giữ PII mở vô thời hạn.
  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  // Số cột (đồng bộ colSpan hàng rỗng): đơn hàng, tên bé, lớp, số tiền, PT, ngày,
  // người thu, nguồn HV, tên PH, CCCD PH, địa chỉ, Sale, Kế toán, Phiếu thu (+ thao tác).
  const colCount = 14 + (canConfirm ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* Xác nhận hàng loạt khoản nhập liệu ban đầu — chỉ hiện cho người có quyền xác
          nhận (cùng cổng `payments:confirm` với nút xác nhận từng khoản). */}
      {canConfirm && <BulkBackfillConfirm />}
      {canRecord && (
        <div>
          <Button
            variant={showForm ? "outline" : "default"}
            onClick={() => setShowForm((s) => !s)}
          >
            <Plus className="h-4 w-4" />
            {showForm ? "Đóng form" : "Ghi nhận khoản"}
          </Button>
          {showForm && (
            <RecordForm
              orders={orders}
              methods={methods}
              onDone={() => setShowForm(false)}
            />
          )}
        </div>
      )}

      {canViewPii && (
        <div className="flex items-center justify-between rounded-lg border border-state-warning-soft bg-state-warning-soft/60 px-4 py-2.5">
          <p className="text-xs text-state-warning-ink">
            CCCD phụ huynh &amp; địa chỉ được che mặc định (thông tin nhạy cảm).
            {revealed
              ? " Đang xem đầy đủ — hành động đã được ghi log."
              : " Mở xem đầy đủ cần lý do và sẽ được ghi log."}
          </p>
          <PiiRevealControl
            revealed={revealed}
            onRevealed={(unmaskedRows) => setRows(unmaskedRows)}
            onHide={() => setRows(initialRows)}
          />
        </div>
      )}

      {/* Ô TÌM — xem chú thích ở `tuKhoa`. Không có nó thì màn chỉ tới được 30 khoản
          gần nhất, và 89/119 khoản của đợt nhập liệu là vùng không ai chạm tới. */}
      <form
        className="mb-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          timKhoan(tuKhoa);
        }}
      >
        <Input
          value={tuKhoa}
          onChange={(e) => setTuKhoa(e.target.value)}
          placeholder="Mã đơn hoặc tên khách — ví dụ ORD-260910-000002"
          className="h-11 max-w-md"
          aria-label="Tìm khoản thu theo mã đơn hoặc tên khách"
        />
        <Button type="submit" disabled={dangTim} className="min-h-11">
          {dangTim ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tìm"}
        </Button>
        {tuKhoa && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={dangTim}
            onClick={() => {
              setTuKhoa("");
              timKhoan("");
            }}
          >
            Xoá lọc
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {/* Nói THẬT về giới hạn: không có câu này thì người dùng tưởng 30 dòng là tất
              cả, và đó đúng là hiểu nhầm vừa xảy ra. */}
          Hiện {rows.length} khoản{rows.length >= 30 ? " (tối đa 30 mỗi lượt — gõ mã đơn để tới khoản cũ hơn)" : ""}
        </span>
      </form>

      <div className="overflow-hidden rounded-lg border border-border">
        <PhanTrangBang cuonNgang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Đơn hàng</TableHead>
                <TableHead>Tên bé</TableHead>
                <TableHead>Lớp</TableHead>
                <TableHead className="text-right">Số tiền</TableHead>
                <TableHead>Hình thức</TableHead>
                <TableHead>Ngày thu</TableHead>
                <TableHead>Người thu</TableHead>
                <TableHead>
                  Nguồn HV
                  {/* Nhãn cột dễ đọc nhầm thành "cơ sở của học viên". Nó là NGUỒN LEAD
                      (Facebook, giới thiệu…) — chỉ giải thích được bằng một câu, nên để
                      trong "?" thay vì bơm thêm chữ vào hàng tiêu đề đã 14 cột. */}
                  <HelpHint>
                    Kênh mà phụ huynh biết tới Sata Robo, lấy từ lead lúc đăng ký
                    (Facebook, giới thiệu, hội thảo…). Dùng để biết tiền về từ kênh nào.
                    Dấu &ldquo;—&rdquo; là khoản không đi từ lead nào.
                  </HelpHint>
                </TableHead>
                <TableHead>Tên PH</TableHead>
                <TableHead>CCCD PH</TableHead>
                <TableHead>Địa chỉ</TableHead>
                <TableHead>
                  Sale
                  <HelpHint>
                    Trạng thái phía người thu tiền. &ldquo;Đã ghi nhận&rdquo; = nhân viên
                    khai đã nhận tiền của phụ huynh, chưa ai đối chiếu lại.
                  </HelpHint>
                </TableHead>
                <TableHead>
                  Kế toán
                  <HelpHint>
                    &ldquo;Chờ kế toán&rdquo; = mới ghi nhận, chưa đối chiếu nên CHƯA
                    tính là đã thu và chưa trừ công nợ. &ldquo;Đã xác nhận&rdquo; = kế
                    toán đối chiếu xong (tiền có thật), khoản mới trừ công nợ và sinh
                    phiếu thu. &ldquo;Từ chối&rdquo; = khoản không hợp lệ, phải ghi nhận
                    lại cho đúng.
                  </HelpHint>
                </TableHead>
                <TableHead>
                  Phiếu thu
                  <HelpHint>
                    Chỉ có sau khi kế toán xác nhận khoản thu. Bấm vào mã phiếu để mở bản
                    in PDF cho phụ huynh.
                  </HelpHint>
                </TableHead>
                {canConfirm && <TableHead className="text-right">Thao tác</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={colCount}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Chưa có khoản thanh toán nào
                  </TableCell>
                </TableRow>
              )}
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {/* Mã đơn MỞ ĐƯỢC ĐƠN [16/09/2026]. Chủ dự án: *"link giữa trang thanh
                        toán và trang đơn hàng chi tiết cho từng đơn khi bấm vào xem luôn
                        chứ?"*. Trước bản này là một `<div>` chữ trơn, và cả tệp không có
                        MỘT link nào trỏ `/orders/` — kế toán muốn xem đơn phải tự nhớ mã
                        rồi đi tìm ở danh sách đơn.
                        `orderId` có thể `null` với khoản chưa gắn đơn ⇒ khi đó in chữ
                        trơn, KHÔNG dựng một link chết (luật 12: mũi/con trỏ là lời hứa). */}
                    {p.orderId && p.orderCode ? (
                      <Link
                        href={`/orders/${p.orderId}`}
                        className="text-primary underline-offset-2 hover:underline"
                        title={`Mở đơn ${p.orderCode}`}
                      >
                        {p.orderCode}
                      </Link>
                    ) : (
                      <div>{p.orderCode ?? "—"}</div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {p.customerName ?? ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{p.studentName ?? "—"}</TableCell>
                  <TableCell className="text-xs">{p.className ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {vnd(p.amount)}
                  </TableCell>
                  <TableCell className="text-xs">{methodLabel[p.method] ?? p.method}</TableCell>
                  <TableCell className="text-xs">{fmtDate(p.paidDate)}</TableCell>
                  <TableCell className="text-xs">{p.collectedByName ?? "—"}</TableCell>
                  <TableCell className="text-xs">{p.leadSource ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.parentName ?? "—"}</TableCell>
                  <TableCell
                    className={
                      "font-mono text-xs " +
                      (p.piiMasked ? "text-muted-foreground" : "text-foreground")
                    }
                  >
                    {p.parentNationalId ?? "—"}
                  </TableCell>
                  <TableCell
                    className={
                      "max-w-[180px] truncate text-xs " +
                      (p.piiMasked ? "text-muted-foreground" : "text-foreground")
                    }
                    title={p.address ?? undefined}
                  >
                    {p.address ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge className={SALE_BADGE[p.saleStatus] ?? ""}>
                      {SALE_LABEL[p.saleStatus] ?? p.saleStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={ACC_BADGE[p.accountantStatus] ?? ""}>
                      {ACC_LABEL[p.accountantStatus] ?? p.accountantStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {p.hasActiveReceipt ? (
                      <a
                        href={`/payments/${p.id}/phieu-thu`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        title="In phiếu thu (PDF)"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        {p.receiptCode}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  {canConfirm && (
                    <TableCell className="text-right">
                      {/* 07/09 — hai ĐỘNG TỪ, hai nhóm dòng khác nhau:
                          · PENDING  → xác nhận / từ chối / SỬA tại chỗ (bản nháp);
                          · CONFIRMED → ĐIỀU CHỈNH (sinh bút toán delta).
                          Trước đây cụm nút chỉ hiện với PENDING, tức nút "Điều chỉnh"
                          nằm đúng chỗ nó KHÔNG chạy được (adjustPayment đòi CONFIRMED).
                          Dòng ADJUSTMENT không có thao tác nào: điều chỉnh luôn trỏ về
                          phiếu thu gốc. */}
                      {p.paymentType === "ADJUSTMENT" ? (
                        <span className="text-xs text-muted-foreground">
                          bút toán điều chỉnh
                        </span>
                      ) : p.accountantStatus === "CONFIRMED" ? (
                        <RowActions
                          paymentId={p.id}
                          updatedAt={p.updatedAt}
                          canAdjust={canAdjust}
                          daXacNhan
                          hienTai={p.hienTai}
                        />
                      ) : p.accountantStatus === "PENDING" ? (
                        // `thieuGhiDanh` do server tính bằng CHÍNH luật của lõi xác nhận — đơn KIT/THI
                        // không có ghi danh vẫn hiện nút ✓ (lib/finance/can-ghi-danh.ts).
                        !p.thieuGhiDanh ? (
                          <RowActions
                            paymentId={p.id}
                            updatedAt={p.updatedAt}
                            canAdjust={canAdjust}
                            daXacNhan={false}
                            hienTai={p.hienTai}
                          />
                        ) : (
                          // Đơn chưa convert → chưa gắn ghi danh → confirm sẽ lỗi. Chờ convert.
                          // Lời giải thích trước đây nằm ở `title=""` của trình duyệt:
                          // trễ 1–2 giây mới hiện và trên máy tính bảng thì không bao giờ
                          // hiện. Chuyển sang icon "?" — cùng một câu, hiện ngay.
                          // ⚠️ 02/10/2026 — nhánh này TRƯỚC ĐÂY thay cả cụm nút bằng mỗi
                          // dòng chữ, tức giấu luôn "Từ chối" và "Sửa khoản chờ duyệt".
                          // Hai đường đó KHÔNG đòi ghi danh (xem prop `anXacNhan`), nên
                          // một khoản NHẬP TRÙNG chưa gắn ghi danh thì không có cách nào
                          // gỡ khỏi sổ trên giao diện. Nay chỉ giấu đúng nút sẽ hỏng.
                          <span className="inline-flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                            Chờ convert
                            <HelpHint>
                              Khoản này chưa gắn ghi danh nào nên kế toán chưa xác nhận
                              được. Chốt lead thành học viên (màn Chuyển đổi) là nút xác
                              nhận sẽ hiện ra. Vẫn sửa hoặc từ chối được ngay tại đây —
                              dùng khi khoản bị nhập trùng.
                            </HelpHint>
                            <RowActions
                              paymentId={p.id}
                              updatedAt={p.updatedAt}
                              canAdjust={canAdjust}
                              daXacNhan={false}
                              hienTai={p.hienTai}
                              anXacNhan
                            />
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>
    </div>
  );
}

// ─── #15 — BREAK-GLASS "Xem đầy đủ" CCCD PH + địa chỉ (reason ≥10 + audit) ────────
const MIN_PII_REASON = 10;

function PiiRevealControl({
  revealed,
  onRevealed,
  onHide,
}: {
  revealed: boolean;
  onRevealed: (rows: PaymentRow[]) => void;
  onHide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  if (revealed) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onHide}
        className="border-state-warning text-state-warning-ink hover:bg-state-warning-soft"
      >
        <EyeOff className="h-4 w-4" />
        Ẩn lại
      </Button>
    );
  }

  function submit() {
    if (reason.trim().length < MIN_PII_REASON) {
      toast.error(`Vui lòng nhập lý do tối thiểu ${MIN_PII_REASON} ký tự`);
      return;
    }
    start(async () => {
      // 1 đường DUY NHẤT: reveal vừa audit vừa trả rows raw (server đã reason≥10 + log).
      const res = await revealPaymentsPii({}, reason.trim());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Đã mở xem đầy đủ. Hành động này đã được ghi log.");
      setOpen(false);
      setReason("");
      onRevealed(res.rows);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-state-warning text-state-warning-ink hover:bg-state-warning-soft"
      >
        <Eye className="h-4 w-4" />
        Xem đầy đủ
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-state-warning-ink" />
              Xem đầy đủ CCCD phụ huynh &amp; địa chỉ
            </DialogTitle>
            <DialogDescription>
              CCCD phụ huynh và địa chỉ đang được che mặc định. Mở xem đầy đủ là
              hành động có kiểm soát — bắt buộc nhập lý do và sẽ được ghi log riêng
              (ai, lúc nào, lý do gì).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="pii-reason" className="text-xs">
              Lý do (tối thiểu {MIN_PII_REASON} ký tự)
            </Label>
            <Textarea
              id="pii-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: đối soát hóa đơn/công nợ tháng 07 cho phụ huynh..."
              rows={3}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              {reason.trim().length}/{MIN_PII_REASON}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Huỷ
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || reason.trim().length < MIN_PII_REASON}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận xem đầy đủ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── RECORD FORM ─────────────────────────────────────────────────────
function RecordForm({
  orders,
  methods,
  onDone,
}: {
  orders: OrderOption[];
  methods: MethodOption[];
  onDone: () => void;
}) {
  const [orderId, setOrderId] = useState("");
  const [enrollmentId, setEnrollmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [paidDate, setPaidDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  // Phương thức chọn được = phương thức của CƠ SỞ ĐỨNG TÊN ĐƠN + phương thức dùng chung.
  // Dùng chung một luật với cổng server trong recordPaymentAction, nên không có ca chọn
  // được ở đây rồi bị từ chối lúc Lưu.
  const selectedOrder = orders.find((o) => o.id === orderId) ?? null;
  const availableMethods = useMemo(
    () =>
      filterMethodsForCenter(
        methods.filter((m) => m.isActive),
        selectedOrder?.centerId ?? null,
      ),
    [methods, selectedOrder],
  );

  // Đổi đơn sang cơ sở khác thì phương thức đang chọn có thể không còn hợp lệ. Bỏ ngay
  // thay vì để nó nằm im: `Payment.method` là con số kế toán đối chiếu với sao kê, ghi
  // nhầm mã của cơ sở khác là khoản treo không tìm ra tiền.
  useEffect(() => {
    if (method && !availableMethods.some((m) => m.code === method)) setMethod("");
  }, [availableMethods, method]);

  // ⚠️ `<Select>` dựng trên base-ui: `<SelectValue>` in GIÁ TRỊ THÔ, không tự tra nhãn từ
  // `<SelectItem>`. Trước đây ô này chứa mã kiểu "CASH" nên đọc tạm được; nay mã có thể
  // là "BANK_CS1" — thiếu map `items` là kế toán nhìn thấy mã nội bộ thay vì tên phương thức.
  const methodItems = useMemo(
    () => Object.fromEntries(availableMethods.map((m) => [m.code, m.name])),
    [availableMethods],
  );

  function submit() {
    if (!orderId) {
      toast.error("Chọn đơn hàng");
      return;
    }
    if (!method) {
      toast.error("Chọn phương thức");
      return;
    }
    start(async () => {
      const res = await recordPaymentAction({
        orderId,
        enrollmentId: enrollmentId || null,
        amount: Number(amount),
        method,
        paidDate,
        evidenceUrl: evidenceUrl || null,
        note: note || null,
      });
      if (res.ok) {
        toast.success("Đã ghi nhận khoản thu");
        onDone();
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Ghi nhận khoản thu</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>
            Đơn hàng *
            <HelpHint>
              Khoản thu này trừ vào công nợ của đơn được chọn, nên chọn sai đơn là sai
              công nợ của phụ huynh khác. Không thấy đơn cần tìm thì kiểm tra lại đơn đã
              được tạo chưa.
            </HelpHint>
          </Label>
          <Select value={orderId} onValueChange={(v) => setOrderId(v ?? "")}>
            <SelectTrigger>
              <SelectValue placeholder="Chọn đơn hàng" />
            </SelectTrigger>
            <SelectContent>
              {orders.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.code} — {o.customerName} ({vnd(o.totalAmount)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>
            Số tiền *
            <HelpHint>
              Số tiền THẬT nhận được trong lần thu này, không phải tổng đơn. Phụ huynh
              đóng làm nhiều lần thì ghi nhận nhiều khoản, mỗi lần một khoản.
            </HelpHint>
          </Label>
          {/* Ô tiền: gõ 10000000 → hiện 10.000.000. Giữ state dạng CHUỖI (ô trống = "")
              để `Number(amount)` lúc submit ra đúng con số như trước, server không đổi. */}
          <MoneyInput
            name="amount"
            min={0}
            value={amount}
            onValueChange={(v) => setAmount(v === null ? "" : String(v))}
            placeholder="0"
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            Phương thức *
            <HelpHint>
              Tiền đi bằng đường nào: tiền mặt tại quầy, chuyển khoản, hay qua cổng
              thanh toán. Kế toán đối chiếu khoản này với đúng sổ đó (két hoặc sao kê
              ngân hàng), nên chọn sai là khoản treo không tìm ra tiền.
            </HelpHint>
          </Label>
          <Select items={methodItems} value={method} onValueChange={(v) => setMethod(v ?? "")}>
            <SelectTrigger>
              <SelectValue placeholder="Chọn phương thức" />
            </SelectTrigger>
            <SelectContent>
              {availableMethods.map((m) => (
                <SelectItem key={m.id} value={m.code}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {orderId && availableMethods.length === 0 && (
            <p className="text-xs text-state-warning-ink">
              Cơ sở của đơn này chưa có phương thức thanh toán nào đang bật. Khai ở trang
              Cơ sở → mục Thanh toán.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>
            Ngày thu *
            <HelpHint>
              Ngày tiền thực sự về theo biên lai / sao kê ngân hàng, không phải ngày bạn
              ngồi nhập vào phần mềm.
            </HelpHint>
          </Label>
          <Input
            type="date"
            value={paidDate}
            onChange={(e) => setPaidDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            Enrollment ID (tuỳ chọn)
            <HelpHint>
              Mã ghi danh để gắn khoản thu vào đúng học viên trong lớp. Bỏ trống được,
              nhưng khoản chưa gắn ghi danh sẽ nằm ở &ldquo;Chờ convert&rdquo; và kế toán
              chưa xác nhận được.
            </HelpHint>
          </Label>
          <Input
            value={enrollmentId}
            onChange={(e) => setEnrollmentId(e.target.value)}
            placeholder="—"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>
            Link chứng từ (tuỳ chọn)
            <HelpHint>
              Đường dẫn tới ảnh biên lai / màn hình chuyển khoản đã lưu ở nơi khác. Có
              chứng từ thì kế toán đối chiếu và xác nhận nhanh hơn nhiều.
            </HelpHint>
          </Label>
          <Input
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Ghi chú</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
        </div>
        <div className="sm:col-span-2">
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Ghi nhận
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// FIX-H9 — mã lỗi optimistic lock (đồng bộ với lib/finance/payment.ts STALE_WRITE).
const STALE_WRITE = "STALE_WRITE";

function handleStale(): void {
  toast.error("Người khác vừa sửa khoản này. Đang tải lại…");
  // reload để lấy updatedAt mới nhất; tránh tiếp tục ghi đè trên snapshot cũ.
  setTimeout(() => window.location.reload(), 800);
}

// ─── PER-ROW ACCOUNTANT ACTIONS ──────────────────────────────────────
function RowActions({
  paymentId,
  updatedAt,
  canAdjust,
  daXacNhan,
  hienTai,
  anXacNhan = false,
}: {
  paymentId: string;
  updatedAt: string;
  canAdjust: boolean;
  /** Khoản đã CONFIRMED → chỉ ĐIỀU CHỈNH. Chưa → xác nhận / từ chối / sửa nháp. */
  daXacNhan: boolean;
  /** Giá trị hiện tại của phiếu (gốc + các điều chỉnh) — nền để tính delta. */
  hienTai: number;
  /**
   * Giấu RIÊNG nút "Xác nhận" — dùng cho khoản chưa gắn ghi danh ("Chờ convert").
   *
   * ⚠️ VÌ SAO CÓ PROP NÀY [02/10/2026]. Trước đây nhánh `thieuGhiDanh` ở bảng trên
   * KHÔNG vẽ `<RowActions>` chút nào: nó thay cả cụm bằng chữ "Chờ convert". Chú thích
   * tại chỗ chỉ biện minh được cho việc giấu nút XÁC NHẬN (*"chưa gắn ghi danh → confirm
   * sẽ lỗi"*), nhưng hệ quả là giấu luôn **Từ chối** và **Sửa khoản chờ duyệt** — hai
   * đường mà server KHÔNG hề đòi ghi danh:
   *   · `rejectPayment` (lib/finance/payment.ts) chỉ chặn khi đã REJECTED hoặc khoản đã
   *     bị khoá bởi hoá đơn điện tử — không có vế enrollment nào;
   *   · `updatePendingPayment` chỉ đòi `accountantStatus === "PENDING"`.
   * Hệ quả đo được: một khoản NHẬP TRÙNG mà chưa gắn ghi danh thì **không có đường nào
   * gỡ khỏi sổ trên giao diện** — phải nhờ kỹ thuật. Đó là ca thật, chủ dự án gặp
   * 02/10 khi đi lọc khoản trùng của đợt nhập từ file Excel.
   *
   * Giấu đúng thứ sẽ hỏng, bày đủ thứ còn chạy — luật 12 (affordance phải nói thật).
   */
  anXacNhan?: boolean;
}) {
  const [mode, setMode] = useState<null | "reject" | "adjust" | "sua">(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();

  function confirm() {
    // FIX-H8 — key ổn định cho lần bấm này → double-click/retry không sinh phiếu 2 lần.
    const idempotencyKey = crypto.randomUUID();
    start(async () => {
      const res = await confirmPaymentAction(paymentId, idempotencyKey);
      if (res.ok) {
        toast.success(
          res.receiptId ? "Đã xác nhận — đã sinh phiếu thu" : "Đã xác nhận",
        );
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  function doReject() {
    start(async () => {
      const res = await rejectPaymentAction(paymentId, reason, updatedAt);
      if (res.ok) {
        toast.success("Đã từ chối khoản");
        setMode(null);
      } else if (res.error === STALE_WRITE) {
        handleStale();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  function doSuaNhap() {
    start(async () => {
      const res = await updatePendingPaymentAction({
        paymentId,
        amount: Number(amount),
        reason,
        expectedUpdatedAt: updatedAt,
      });
      if (res.ok) {
        toast.success("Đã sửa khoản");
        setMode(null);
      } else if (res.error === STALE_WRITE) {
        handleStale();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  function doAdjust() {
    start(async () => {
      const res = await adjustPaymentAction({
        paymentId,
        amount: Number(amount),
        reason,
        expectedUpdatedAt: updatedAt,
      });
      if (res.ok) {
        toast.success(
          `Đã điều chỉnh — bút toán ${res.delta > 0 ? "+" : ""}${res.delta.toLocaleString("vi-VN")} đ`,
        );
        setMode(null);
      } else if (res.error === STALE_WRITE) {
        handleStale();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  if (mode === "reject") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Lý do từ chối (≥5 ký tự)"
          className="w-56"
        />
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setMode(null)}>
            Huỷ
          </Button>
          <Button size="sm" variant="destructive" onClick={doReject} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Từ chối
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "sua") {
    // Khoản CHƯA xác nhận = bản nháp → sửa thẳng, không sinh bút toán nào.
    return (
      <div className="flex flex-col items-end gap-1.5">
        <MoneyInput
          name="suaAmount"
          min={0}
          value={amount}
          onValueChange={(v) => setAmount(v === null ? "" : String(v))}
          placeholder="Số tiền đúng"
          className="w-56"
        />
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Lý do sửa (không bắt buộc)"
          className="w-56"
        />
        <p className="w-56 text-right text-[11px] text-muted-foreground">
          Khoản chưa xác nhận — sửa trực tiếp, không sinh bút toán điều chỉnh.
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setMode(null)}>
            Huỷ
          </Button>
          <Button size="sm" onClick={doSuaNhap} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Lưu
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "adjust") {
    // Ô nhập là SỐ TUYỆT ĐỐI (số đúng của DÒNG NÀY), backend tự tính delta. Hiện trước
    // delta để kế toán xác nhận: gõ "3.500.000" mà không thấy nó nghĩa là "−500.000" thì
    // rất dễ nhầm số đúng của phiếu với tổng của cả ghi danh.
    const soDung = amount === "" ? null : Number(amount);
    const delta = soDung === null ? null : soDung - hienTai;
    return (
      <div className="flex flex-col items-end gap-1.5">
        <p className="w-56 text-right text-[11px] text-muted-foreground">
          Số đúng <b className="text-foreground">của phiếu thu này</b> (không phải tổng
          của ghi danh). Hiện đang là <b className="text-foreground">{vnd(hienTai)}</b>.
        </p>
        <MoneyInput
          name="adjustAmount"
          min={0}
          value={amount}
          onValueChange={(v) => setAmount(v === null ? "" : String(v))}
          placeholder="Số tiền đúng của phiếu này"
          className="w-56"
        />
        {delta !== null && (
          <p
            className={`w-56 text-right text-xs font-semibold ${
              delta === 0
                ? "text-muted-foreground"
                : delta > 0
                  ? "text-state-success-ink"
                  : "text-state-danger-ink"
            }`}
          >
            {delta === 0
              ? "Bằng số hiện tại — không có gì để điều chỉnh"
              : `Sẽ sinh bút toán ${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("vi-VN")} đ`}
          </p>
        )}
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Lý do điều chỉnh (≥5 ký tự)"
          className="w-56"
        />
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setMode(null)}>
            Huỷ
          </Button>
          <Button
            size="sm"
            onClick={doAdjust}
            disabled={pending || delta === null || delta === 0}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Lưu
          </Button>
        </div>
      </div>
    );
  }

  // Khoản ĐÃ XÁC NHẬN: chỉ còn một đường — điều chỉnh bằng bút toán delta.
  if (daXacNhan) {
    return (
      <div className="flex justify-end gap-1.5">
        {/* Ẩn khi thiếu `payments:adjust` (v2: kế toán HO + kế toán cơ sở). Đây chỉ
            là lớp ngoài — Server Action tự kiểm lại, vì endpoint gọi thẳng được. */}
        {canAdjust ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode("adjust")}
            title="Điều chỉnh"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex justify-end gap-1.5">
      {/* `anXacNhan` CHỈ giấu nút Xác nhận — xem chú thích ở khai báo prop. Sửa nháp và
          Từ chối vẫn phải còn: cả hai đường server đều KHÔNG đòi ghi danh. */}
      {!anXacNhan && (
        <Button size="sm" onClick={confirm} disabled={pending} title="Xác nhận">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
      {/* Khoản chưa xác nhận là BẢN NHÁP → sửa thẳng, không sinh bút toán. Đây là
          động từ khác với "Điều chỉnh", nên là nút khác. */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setMode("sua")}
        title="Sửa khoản chờ duyệt"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => setMode("reject")}
        title="Từ chối"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
