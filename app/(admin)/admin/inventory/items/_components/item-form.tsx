"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUploader } from "@/components/admin/ImageUploader";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { MoneyInput } from "@/components/ui/money-input";
import { StringArrayEditor } from "@/app/(admin)/admin/kits/_components/string-array-editor";
import {
  createItemAndRedirect,
  deleteItemAndRedirect,
  updateItem,
  updateMinThreshold,
} from "../_actions";
import { MovementActions } from "./movement-actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

type Category =
  | "MAINBOARD"
  | "SENSOR"
  | "MOTOR"
  | "BATTERY"
  | "MECHANICAL"
  | "WIRE"
  | "TOOL"
  | "CONSUMABLE"
  | "ROBOSIM"
  | "OTHER";

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "MAINBOARD", label: "Bo mạch chính" },
  { value: "SENSOR", label: "Cảm biến" },
  { value: "MOTOR", label: "Động cơ" },
  { value: "BATTERY", label: "Pin" },
  { value: "MECHANICAL", label: "Cơ khí" },
  { value: "WIRE", label: "Dây & đầu nối" },
  { value: "TOOL", label: "Dụng cụ" },
  { value: "CONSUMABLE", label: "Vật tư" },
  { value: "ROBOSIM", label: "Bộ Robosim" },
  { value: "OTHER", label: "Khác" },
];

const UNIT_OPTIONS = [
  "Cái",
  "Bộ",
  "Cuộn",
  "Mét",
  "Hộp",
  "Túi",
  "Kg",
  "Chiếc",
  "Đôi",
];

export type ItemFormValue = {
  id: string;
  itemCode: string;
  name: string;
  description: string | null;
  category: Category;
  unit: string;
  pricePerUnit: number | null;
  supplier: string | null;
  defaultMinThreshold: number;
  imageUrl: string | null;
  tags: string[];
  isActive: boolean;
  notes: string | null;
};

export interface BalanceRow {
  id: string;
  centerId: string;
  centerName: string;
  quantity: number;
  reserved: number;
  minThreshold: number | null;
}

export interface CenterOption {
  id: string;
  name: string;
}

export function ItemForm({
  item,
  balances,
  allCenters = [],
}: {
  item?: ItemFormValue;
  balances?: BalanceRow[];
  allCenters?: CenterOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(item);

  const [itemCode, setItemCode] = useState(item?.itemCode ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [category, setCategory] = useState<Category>(item?.category ?? "OTHER");
  const [unit, setUnit] = useState(item?.unit ?? "Cái");
  const [pricePerUnit, setPricePerUnit] = useState<number | "">(
    item?.pricePerUnit ?? "",
  );
  const [supplier, setSupplier] = useState(item?.supplier ?? "");
  const [defaultMinThreshold, setDefaultMinThreshold] = useState<number>(
    item?.defaultMinThreshold ?? 5,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(item?.imageUrl ?? null);
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      itemCode,
      name,
      description: description.trim() || null,
      category,
      unit,
      pricePerUnit: pricePerUnit === "" ? null : Number(pricePerUnit),
      supplier: supplier.trim() || null,
      defaultMinThreshold,
      imageUrl: imageUrl ?? null,
      tags,
      isActive,
      notes: notes.trim() || null,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updateItem(item!.id, payload)
        : await createItemAndRedirect(payload);
      if (res && !res.ok) setError(res.error);
      else if (isEdit) router.refresh();
    });
  }

  function handleDelete() {
    if (!item) return;
    if (!confirm(`Xoá hàng "${item.name}"? Hành động này không hoàn tác.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteItemAndRedirect(item.id);
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-5">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      {/* Section 1: Identity */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Thông tin chung
        </h2>

        <div>
          <ImageUploader
            label="Ảnh sản phẩm"
            value={imageUrl}
            onChange={setImageUrl}
            prefix="uploads/inventory"
            aspect="square"
            helperText="JPG/PNG/WEBP/GIF ≤ 10MB"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Mã hàng" required>
            <input
              type="text"
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              required
              disabled={pending}
              placeholder="ZMR-CTRL-01"
              className={inputClass}
            />
          </Field>
          <Field label="Danh mục" required>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              disabled={pending}
              required
              className={inputClass}
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Đơn vị">
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              disabled={pending}
              className={inputClass}
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Tên hàng" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={pending}
            placeholder="Bo điều khiển ZMR-Ctrl rev2"
            className={inputClass}
          />
        </Field>

        <Field label="Mô tả">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            disabled={pending}
            placeholder="Mô tả ngắn về sản phẩm, version, điểm phân biệt..."
            className={`${inputClass} resize-y`}
          />
        </Field>
      </section>

      {/* Section 2: Pricing */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Giá & Nhà cung cấp
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Giá / đơn vị (VND)">
            {/* Ô trống vẫn phải là "" (không phải 0) — payload đang dựa vào đó để gửi
                `pricePerUnit: null`.
                KHÔNG truyền `inputClass`: nó có `px-3`, mà class truyền vào được ghép
                SAU nên sẽ ăn mất `pr-8` mà MoneyInput chừa cho chữ "đ". Class nền của
                MoneyInput vốn đã trùng `inputClass`. */}
            <MoneyInput
              name="pricePerUnit"
              min={0}
              value={pricePerUnit === "" ? null : pricePerUnit}
              onValueChange={(v) => setPricePerUnit(v ?? "")}
              disabled={pending}
              placeholder="450000"
            />
          </Field>
          <Field label="Nhà cung cấp">
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              disabled={pending}
              placeholder="ZMROBO Vietnam"
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {/* Section 3: Threshold + Tags */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="flex items-center text-sm font-bold uppercase tracking-wider text-foreground">
          Ngưỡng cảnh báo &amp; Phân loại
          <HelpHint className="ml-1.5">
            Tồn dưới ngưỡng này sẽ hiển thị cảnh báo. Có thể đặt riêng cho từng cơ sở ở
            mục &ldquo;Tồn kho từng cơ sở&rdquo; bên dưới.
          </HelpHint>
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Ngưỡng tối thiểu mặc định">
            <input
              type="number"
              min={0}
              value={defaultMinThreshold}
              onChange={(e) =>
                setDefaultMinThreshold(Math.max(0, parseInt(e.target.value, 10) || 0))
              }
              disabled={pending}
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={pending}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm font-medium text-foreground">
              Đang sử dụng (hiện ra trong list mặc định)
            </span>
          </label>
        </div>

        <div>
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Tags
          </span>
          <StringArrayEditor
            value={tags}
            onChange={setTags}
            placeholder="VD: zmrobo, k1-curriculum, replacement"
          />
        </div>

        <Field label="Ghi chú nội bộ">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            disabled={pending}
            placeholder="Note cho admin (datasheet, link nhà cung cấp...)"
            className={`${inputClass} resize-y`}
          />
        </Field>
      </section>

      {/* Section 4: Balance per center (edit mode only) */}
      {isEdit && balances && balances.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border p-4">
            <h2 className="flex items-center text-sm font-bold uppercase tracking-wider text-foreground">
              Tồn kho từng cơ sở
              <HelpHint className="ml-1.5">
                Số lượng cập nhật qua phiếu Nhập/Xuất (F2). Có thể đặt ngưỡng cảnh báo
                riêng cho mỗi cơ sở; để trống để dùng ngưỡng mặc định{" "}
                <strong>{defaultMinThreshold}</strong>.
              </HelpHint>
            </h2>
          </header>
          <PhanTrangBang cuonNgang>
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                    Cơ sở
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">
                    Tồn
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">
                    Đã đặt
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">
                    Ngưỡng (override)
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {balances.map((b) => (
                  <BalanceRowEditor
                    key={b.id}
                    row={b}
                    itemId={item!.id}
                    itemUnit={unit}
                    fallbackThreshold={defaultMinThreshold}
                    allCenters={allCenters}
                  />
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </section>
      )}

      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo hàng"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/inventory/items")}
          disabled={pending}
          className="rounded-xl border-2 border-border bg-card px-6 py-3 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="ml-auto rounded-xl border-2 border-state-danger-soft bg-card px-6 py-3 font-bold text-state-danger-ink hover:bg-state-danger-soft"
          >
            Xoá
          </button>
        )}
      </div>
    </form>
  );
}

function BalanceRowEditor({
  row,
  itemId,
  itemUnit,
  fallbackThreshold,
  allCenters,
}: {
  row: BalanceRow;
  itemId: string;
  itemUnit: string;
  fallbackThreshold: number;
  allCenters: CenterOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(
    row.minThreshold === null ? "" : String(row.minThreshold),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const effectiveThreshold = row.minThreshold ?? fallbackThreshold;
  const isLow = row.quantity < effectiveThreshold;

  function save() {
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("Ngưỡng phải >= 0");
      return;
    }
    if (parsed === row.minThreshold) return; // no-op
    setError(null);
    startTransition(async () => {
      const res = await updateMinThreshold({
        itemId,
        centerId: row.centerId,
        minThreshold: parsed,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <tr className={isLow ? "bg-state-danger-soft/40" : undefined}>
      <td className="px-3 py-2 font-medium text-foreground">{row.centerName}</td>
      <td
        className={`px-3 py-2 text-right tabular-nums font-semibold ${ isLow ? "text-state-danger-ink" : "text-foreground" }`}
      >
        {row.quantity}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {row.reserved}
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          disabled={pending}
          placeholder={`${fallbackThreshold}`}
          className="w-24 rounded-md border border-border px-2 py-1 text-right text-sm tabular-nums disabled:opacity-60"
        />
        {error && <div className="mt-0.5 text-xs text-state-danger-ink">{error}</div>}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <MovementActions
          itemId={itemId}
          itemUnit={itemUnit}
          centerId={row.centerId}
          centerName={row.centerName}
          currentQty={row.quantity}
          allCenters={allCenters}
        />
      </td>
    </tr>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-state-danger-ink">*</span>}
      </span>
      {children}
    </label>
  );
}
