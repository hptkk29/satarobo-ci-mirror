"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  ProductCategory,
  ProductStatus,
  type Product,
} from "@prisma/client";
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
  PRODUCT_CATEGORY_LABEL,
  PRODUCT_STATUS_LABEL,
} from "@/lib/validators/product";
import { createProductAction, updateProductAction } from "../_actions";

const NO_KIT = "NONE";

/** Dáng ô nhập của shadcn `<Input>` — đắp lên `<MoneyInput>` (vốn theo dáng form tự
 *  viết: cao hơn, nền bg-card) để ô tiền không lệch với các ô khác của form.
 *  `pl-` chứ không `px-`: `px-` sẽ ăn mất lề phải MoneyInput chừa cho chữ "đ". */
const SHADCN_INPUT_LOOK = "h-8 border-input bg-transparent py-1 pl-2.5";

export function ProductForm({
  product,
  zmroboKits,
}: {
  product?: Product;
  zmroboKits: Array<{ id: string; title: string; code: string | null }>;
}) {
  const router = useRouter();
  const isEdit = !!product;
  const [isPending, startTransition] = useTransition();

  const [data, setData] = useState({
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    category: (product?.category ?? "KIT_ROBOT") as ProductCategory,
    status: (product?.status ?? "DRAFT") as ProductStatus,
    salePrice: product?.salePrice ?? 0,
    costPrice: product?.costPrice ?? null,
    rentalPricePerMonth: product?.rentalPricePerMonth ?? null,
    stockOnHand: product?.stockOnHand ?? 0,
    minThreshold: product?.minThreshold ?? 0,
    imageUrls: product?.imageUrls ?? [],
    zmroboKitId: product?.zmroboKitId ?? null,
    notes: product?.notes ?? "",
  });

  function update<K extends keyof typeof data>(
    key: K,
    value: (typeof data)[K],
  ) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = {
        sku: data.sku,
        name: data.name,
        description: data.description || null,
        category: data.category,
        status: data.status,
        salePrice: data.salePrice,
        costPrice: data.costPrice,
        rentalPricePerMonth: data.rentalPricePerMonth,
        stockOnHand: data.stockOnHand,
        minThreshold: data.minThreshold,
        imageUrls: data.imageUrls,
        zmroboKitId: data.zmroboKitId,
        attributes: null,
        notes: data.notes || null,
      };

      const result = isEdit
        ? await updateProductAction(product!.id, payload)
        : await createProductAction(payload);

      if (result.ok) {
        toast.success(isEdit ? "Đã cập nhật" : "Đã tạo sản phẩm");
        if (!isEdit && result.productId) {
          router.push(`/products/${result.productId}/edit`);
        } else {
          router.refresh();
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      {/* Basic info */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Thông tin cơ bản
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              SKU *
              {isEdit && <HelpHint>Mã SKU không sửa được sau khi tạo.</HelpHint>}
            </Label>
            <Input
              value={data.sku}
              onChange={(e) => update("sku", e.target.value.toUpperCase())}
              placeholder="VD: KIT-SMART-V2"
              disabled={isEdit}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Trạng thái *</Label>
            <Select
              value={data.status}
              onValueChange={(v) =>
                update("status", (v ?? "DRAFT") as ProductStatus)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.values(ProductStatus) as ProductStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {PRODUCT_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Tên *</Label>
          <Input
            value={data.name}
            onChange={(e) => update("name", e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Mô tả</Label>
          <Textarea
            value={data.description}
            onChange={(e) => update("description", e.target.value)}
            rows={3}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Loại *</Label>
          <Select
            value={data.category}
            onValueChange={(v) =>
              update("category", (v ?? "KIT_ROBOT") as ProductCategory)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.values(ProductCategory) as ProductCategory[]).map(
                (c) => (
                  <SelectItem key={c} value={c}>
                    {PRODUCT_CATEGORY_LABEL[c]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Pricing */}
      <section className="space-y-4 rounded-xl border border-border bg-muted/50 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Giá (VND)
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Giá bán *</Label>
            {/* Giá bán không cho trống: `null` (xoá sạch ô) quy về 0 để payload giữ đúng
                kiểu number như trước. */}
            <MoneyInput
              name="salePrice"
              min={0}
              value={data.salePrice}
              onValueChange={(v) => update("salePrice", v ?? 0)}
              required
              className={SHADCN_INPUT_LOOK}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Giá vốn (nội bộ)</Label>
            <MoneyInput
              name="costPrice"
              min={0}
              value={data.costPrice}
              onValueChange={(v) => update("costPrice", v)}
              className={SHADCN_INPUT_LOOK}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Giá thuê / tháng</Label>
            <MoneyInput
              name="rentalPricePerMonth"
              min={0}
              value={data.rentalPricePerMonth}
              onValueChange={(v) => update("rentalPricePerMonth", v)}
              className={SHADCN_INPUT_LOOK}
            />
          </div>
        </div>
      </section>

      {/* Stock */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Tồn kho
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              Tồn kho hiện tại
              {isEdit && (
                <HelpHint>
                  Dùng &ldquo;Điều chỉnh tồn kho&rdquo; trên trang chi tiết để thay
                  đổi.
                </HelpHint>
              )}
            </Label>
            <Input
              type="number"
              min={0}
              value={data.stockOnHand}
              onChange={(e) =>
                update("stockOnHand", Number(e.target.value) || 0)
              }
              disabled={isEdit}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Ngưỡng cảnh báo
              <HelpHint>Cảnh báo khi tồn ≤ ngưỡng.</HelpHint>
            </Label>
            <Input
              type="number"
              min={0}
              value={data.minThreshold}
              onChange={(e) =>
                update("minThreshold", Number(e.target.value) || 0)
              }
            />
          </div>
        </div>
      </section>

      {/* Optional ZMRoboKit link */}
      {zmroboKits.length > 0 && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Liên kết catalog kit (tuỳ chọn)
          </h2>
          <div className="space-y-1.5">
            <Label>ZMRoboKit</Label>
            <Select
              value={data.zmroboKitId ?? NO_KIT}
              onValueChange={(v) =>
                update("zmroboKitId", v === NO_KIT || !v ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn kit..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_KIT}>— Không liên kết —</SelectItem>
                {zmroboKits.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.title}
                    {k.code && ` (${k.code})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>
      )}

      {/* Notes */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Ghi chú
        </h2>
        <Textarea
          value={data.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={3}
        />
      </section>

      {/* Image URLs (one per line, R2 uploader deferred) */}
      <section className="space-y-2 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Ảnh sản phẩm
        </h2>
        <Label>
          URL ảnh (mỗi dòng 1 URL, tối đa 10)
          <HelpHint>
            R2 uploader component sẽ thêm sau (Phase 5.10.x). Tạm paste URL.
          </HelpHint>
        </Label>
        <Textarea
          value={data.imageUrls.join("\n")}
          onChange={(e) =>
            update(
              "imageUrls",
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          rows={4}
          placeholder="https://..."
        />
      </section>

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo sản phẩm"}
        </Button>
        <Link href="/products">
          <Button type="button" variant="outline" disabled={isPending}>
            Huỷ
          </Button>
        </Link>
      </div>
    </form>
  );
}
