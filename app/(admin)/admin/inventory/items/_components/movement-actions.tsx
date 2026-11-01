"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  ClipboardCheck,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { MoneyInput } from "@/components/ui/money-input";
import {
  recordAdjustment,
  recordIssue,
  recordReceipt,
  recordTransfer,
} from "../../movements/_actions";

type ModalType = "receipt" | "issue" | "transfer" | "adjustment" | null;

// FIX-C4 — map mã lỗi nghiệp vụ từ server action sang thông báo VI.
const ERROR_MESSAGE: Record<string, string> = {
  STOCK_INSUFFICIENT: "Không đủ tồn — vui lòng tải lại số liệu và thử lại.",
};

interface CenterOption {
  id: string;
  name: string;
}

interface Props {
  itemId: string;
  itemUnit: string;
  centerId: string;
  centerName: string;
  currentQty: number;
  allCenters: CenterOption[];
}

export function MovementActions({
  itemId,
  itemUnit,
  centerId,
  centerName,
  currentQty,
  allCenters,
}: Props) {
  const [open, setOpen] = useState<ModalType>(null);

  return (
    <>
      <div className="inline-flex justify-end gap-1">
        <button
          type="button"
          onClick={() => setOpen("receipt")}
          className="inline-flex items-center gap-1 rounded-md border border-state-success bg-card px-2 py-1 text-xs font-semibold text-state-success-ink hover:bg-state-success-soft"
          title="Nhập kho"
        >
          <Plus className="h-3 w-3" />
          Nhập
        </button>
        <button
          type="button"
          onClick={() => setOpen("issue")}
          disabled={currentQty <= 0}
          className="inline-flex items-center gap-1 rounded-md border border-state-danger bg-card px-2 py-1 text-xs font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-40"
          title="Xuất kho"
        >
          <Minus className="h-3 w-3" />
          Xuất
        </button>
        <button
          type="button"
          onClick={() => setOpen("transfer")}
          disabled={currentQty <= 0 || allCenters.length < 2}
          className="inline-flex items-center gap-1 rounded-md border border-state-info bg-card px-2 py-1 text-xs font-semibold text-state-info-ink hover:bg-state-info-soft disabled:opacity-40"
          title="Chuyển kho"
        >
          <ArrowRightLeft className="h-3 w-3" />
          Chuyển
        </button>
        <button
          type="button"
          onClick={() => setOpen("adjustment")}
          className="inline-flex items-center gap-1 rounded-md border border-primary bg-card px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
          title="Kiểm kê"
        >
          <ClipboardCheck className="h-3 w-3" />
          Kiểm kê
        </button>
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <MovementModal
            type={open}
            itemId={itemId}
            itemUnit={itemUnit}
            centerId={centerId}
            centerName={centerName}
            currentQty={currentQty}
            allCenters={allCenters}
            onClose={() => setOpen(null)}
          />,
          document.body,
        )}
    </>
  );
}

function MovementModal({
  type,
  itemId,
  itemUnit,
  centerId,
  centerName,
  currentQty,
  allCenters,
  onClose,
}: {
  type: Exclude<ModalType, null>;
  itemId: string;
  itemUnit: string;
  centerId: string;
  centerName: string;
  currentQty: number;
  allCenters: CenterOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState<string>("");
  const [toCenterId, setToCenterId] = useState<string>("");
  const [referenceNote, setReferenceNote] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [newQuantity, setNewQuantity] = useState<number>(currentQty);
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const adjustmentDelta = newQuantity - currentQty;

  const close = () => {
    if (pending) return;
    onClose();
  };

  function handleSubmit() {
    setError(null);

    if (type === "adjustment") {
      if (!Number.isFinite(newQuantity) || newQuantity < 0) {
        setError("Số lượng mới phải >= 0");
        return;
      }
      if (adjustmentDelta === 0) {
        setError("Số lượng không thay đổi");
        return;
      }
      if (reason.trim().length < 5) {
        setError("Lý do tối thiểu 5 ký tự");
        return;
      }
    } else {
      if (!Number.isFinite(quantity) || quantity < 1) {
        setError("Số lượng phải >= 1");
        return;
      }
      if (
        (type === "issue" || type === "transfer") &&
        quantity > currentQty
      ) {
        setError(`Không đủ tồn (${currentQty}). Cần ${quantity}.`);
        return;
      }
      if (type === "transfer") {
        if (!toCenterId) {
          setError("Chọn cơ sở đích");
          return;
        }
        if (toCenterId === centerId) {
          setError("Cơ sở đích trùng cơ sở nguồn");
          return;
        }
      }
    }

    startTransition(async () => {
      try {
        let res;
        if (type === "receipt") {
          res = await recordReceipt({
            itemId,
            centerId,
            quantity,
            unitPrice:
              unitPrice.trim() === "" ? null : Number(unitPrice),
            referenceNote: referenceNote.trim() || null,
            notes: notes.trim() || null,
          });
        } else if (type === "issue") {
          res = await recordIssue({
            itemId,
            centerId,
            quantity,
            referenceType: null,
            referenceId: null,
            referenceNote: referenceNote.trim() || null,
            notes: notes.trim() || null,
          });
        } else if (type === "transfer") {
          res = await recordTransfer({
            itemId,
            fromCenterId: centerId,
            toCenterId,
            quantity,
            notes: notes.trim() || null,
          });
        } else {
          res = await recordAdjustment({
            itemId,
            centerId,
            newQuantity,
            reason: reason.trim(),
          });
        }

        if (!res.ok) {
          setError(ERROR_MESSAGE[res.error] ?? res.error);
          // FIX-C4 — refetch tồn mới nhất khi không đủ tồn (race).
          if (res.error === "STOCK_INSUFFICIENT") router.refresh();
          return;
        }
        onClose();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lỗi không xác định");
      }
    });
  }

  const TITLE: Record<typeof type, string> = {
    receipt: `Nhập kho — ${centerName}`,
    issue: `Xuất kho — ${centerName}`,
    transfer: `Chuyển kho từ ${centerName}`,
    adjustment: `Kiểm kê — ${centerName}`,
  };

  const COLOR: Record<typeof type, string> = {
    receipt: "bg-state-success hover:bg-state-success-ink",
    issue: "bg-state-danger hover:bg-state-danger-ink",
    transfer: "bg-state-info hover:bg-state-info-ink",
    adjustment: "bg-primary hover:bg-primary-dark",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8"
      onClick={close}
    >
      <div
        className="relative w-full max-w-md rounded-xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Đóng"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-lg font-bold text-foreground">{TITLE[type]}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Tồn hiện tại: <strong>{currentQty}</strong> {itemUnit}
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {type !== "adjustment" && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground">
                Số lượng <span className="text-state-danger-ink">*</span>
              </span>
              <input
                type="number"
                min={1}
                max={
                  type === "receipt"
                    ? undefined
                    : Math.max(1, currentQty)
                }
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                disabled={pending}
                className="w-full rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
          )}

          {type === "adjustment" && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-foreground">
                  Số lượng thực tế <span className="text-state-danger-ink">*</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={newQuantity}
                  onChange={(e) =>
                    setNewQuantity(
                      Math.max(0, parseInt(e.target.value, 10) || 0),
                    )
                  }
                  disabled={pending}
                  className="w-full rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                {adjustmentDelta !== 0 && (
                  <span
                    className={
                      "mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold " +
                      (adjustmentDelta > 0
                        ? "bg-state-success-soft text-state-success-ink"
                        : "bg-state-danger-soft text-state-danger-ink")
                    }
                  >
                    {adjustmentDelta > 0 ? "Thừa" : "Thiếu"}:{" "}
                    {Math.abs(adjustmentDelta)} {itemUnit}
                  </span>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-foreground">
                  Lý do <span className="text-state-danger-ink">*</span>{" "}
                  <span className="font-normal text-muted-foreground">
                    (≥ 5 ký tự)
                  </span>
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  disabled={pending}
                  placeholder="VD: Phát hiện 2 cái bị hỏng khi kiểm tra cuối tháng, đã loại ra"
                  className="w-full resize-y rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            </>
          )}

          {type === "receipt" && (
            // Không bọc <label> nữa: nút "?" cũng là phần tử gắn-nhãn được, nằm trong
            // <label> thì nó cướp nhãn của ô nhập. Nối bằng htmlFor cho chắc.
            <div>
              <span className="mb-1 flex items-center text-xs font-semibold text-foreground">
                <label htmlFor="mv-unit-price">Giá / đơn vị (VND, tuỳ chọn)</label>
                <HelpHint className="ml-1">
                  Total cost tự tính = SL × giá. Để trống nếu chưa có giá.
                </HelpHint>
              </span>
              {/* pl- chứ không px-: px sẽ đè mất chỗ trống bên phải dành cho chữ "đ". */}
              <MoneyInput
                id="mv-unit-price"
                name="unitPrice"
                min={0}
                value={unitPrice}
                onValueChange={(v) => setUnitPrice(v === null ? "" : String(v))}
                disabled={pending}
                placeholder="850000"
                className="rounded-md py-1.5 pl-2.5"
              />
            </div>
          )}

          {type === "transfer" && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground">
                Cơ sở đích <span className="text-state-danger-ink">*</span>
              </span>
              <select
                value={toCenterId}
                onChange={(e) => setToCenterId(e.target.value)}
                disabled={pending}
                className="w-full rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">— Chọn —</option>
                {allCenters
                  .filter((c) => c.id !== centerId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          )}

          {(type === "receipt" || type === "issue") && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground">
                {type === "receipt" ? "Tham chiếu / NCC" : "Lý do xuất / tham chiếu"}
              </span>
              <input
                type="text"
                value={referenceNote}
                onChange={(e) => setReferenceNote(e.target.value)}
                disabled={pending}
                placeholder={
                  type === "receipt"
                    ? "VD: NK từ ZMROBO ngày 15/05"
                    : "VD: Lớp K1 Đà Nẵng, sự kiện khai trương..."
                }
                className="w-full rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
          )}

          {type !== "adjustment" && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground">
                Ghi chú
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                disabled={pending}
                placeholder="Ghi chú thêm cho phiếu..."
                className="w-full resize-y rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              pending ||
              (type === "adjustment"
                ? adjustmentDelta === 0 || reason.trim().length < 5
                : quantity < 1)
            }
            className={
              "rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 " +
              COLOR[type]
            }
          >
            {pending ? "Đang lưu..." : "Xác nhận"}
          </button>
        </div>
      </div>
    </div>
  );
}
