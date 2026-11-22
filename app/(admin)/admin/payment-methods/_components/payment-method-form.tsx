"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Landmark } from "lucide-react";
import { toast } from "sonner";
import type { PaymentMethod, PaymentMethodType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CenterPaymentOption } from "@/lib/payments/method-scope";
import {
  createPaymentMethodAction,
  updatePaymentMethodAction,
} from "../_actions";

const TYPE_OPTIONS: Array<{ value: PaymentMethodType; label: string }> = [
  { value: "CASH", label: "Tiền mặt" },
  { value: "BANK_TRANSFER", label: "Chuyển khoản ngân hàng" },
  { value: "VNPAY", label: "VNPAY" },
  { value: "TINGEE", label: "Tingee" },
  { value: "COD", label: "COD (thu hộ khi giao)" },
  { value: "WALLET", label: "Ví điện tử" },
];

type FlagKey =
  | "canBuyCourse"
  | "canBuyPackage"
  | "canBuyExam"
  | "canBuyProduct"
  | "canDeposit";

const FLAG_DEFINITIONS: Array<{ name: FlagKey; label: string }> = [
  { name: "canBuyCourse", label: "Khoá học offline" },
  { name: "canBuyPackage", label: "Gói khoá học" },
  { name: "canBuyExam", label: "Kỳ thi" },
  { name: "canBuyProduct", label: "Sản phẩm (kit, sensor...)" },
  { name: "canDeposit", label: "Nạp ví (reserved)" },
];

/** Mục "dùng chung" trong <Select>: Radix/base-ui cấm value rỗng nên phải có sentinel. */
const SHARED = "__SHARED__";

export function PaymentMethodForm({
  method,
  centers,
  defaultCenterId,
  onXong,
}: {
  method?: PaymentMethod;
  /** Cơ sở trong tầm nhìn của người đang thao tác (đã lọc ở RSC). */
  centers: CenterPaymentOption[];
  /** Chọn sẵn cơ sở khi vào từ trang Cơ sở (`?centerId=`). */
  defaultCenterId?: string | null;
  /**
   * Gọi khi lưu THÀNH CÔNG, thay cho việc rời trang.
   *
   * Có mặt ⇒ form đang nằm trong HỘP THOẠI (tab Phương thức thanh toán của Cấu hình vận
   * hành, 14/09/2026): đóng hộp thoại và làm mới danh sách tại chỗ. Vắng mặt ⇒ form đang
   * là một trang riêng (`/payment-methods/[id]/edit`) và vẫn quay về danh sách như cũ.
   *
   * ⚠️ KHÔNG tự suy bằng `useSearchParams` hay đoán theo route: chỗ gọi biết rõ nó đang
   * dựng form ở đâu, còn form thì không.
   */
  onXong?: () => void;
}) {
  const router = useRouter();
  const isEdit = !!method;
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<PaymentMethodType>(
    method?.type ?? "CASH",
  );
  const [centerId, setCenterId] = useState<string>(
    method?.centerId ?? defaultCenterId ?? SHARED,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const showBankFields = type === "BANK_TRANSFER";
  const showGatewayFields = type === "VNPAY" || type === "TINGEE";
  const selectedCenter =
    centerId === SHARED ? null : (centers.find((c) => c.id === centerId) ?? null);

  // ⚠️ `<Select>` của repo dựng trên base-ui, KHÔNG phải Radix: `<SelectValue>` in ra
  // GIÁ TRỊ THÔ chứ không tự tra nhãn từ `<SelectItem>` con. Thiếu map `items` là ô "Cơ
  // sở áp dụng" hiện id cơ sở ("co-so-nguyen-huu-tho") thay vì tên, và ô "Loại" hiện
  // "BANK_TRANSFER" thay vì "Chuyển khoản ngân hàng".
  const centerItems = useMemo(
    () => ({
      [SHARED]: "Dùng chung (mọi cơ sở)",
      ...Object.fromEntries(centers.map((c) => [c.id, c.name])),
    }),
    [centers],
  );
  const typeItems = Object.fromEntries(
    TYPE_OPTIONS.map((o) => [o.value, o.label]),
  ) as Record<string, string>;

  const initialGateway = method?.gatewayConfig
    ? JSON.stringify(method.gatewayConfig, null, 2)
    : "";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    const formData = new FormData(e.currentTarget);
    formData.set("type", type);
    // <Select> của shadcn không phải input thật ⇒ giá trị không tự vào FormData.
    formData.set("centerId", centerId === SHARED ? "" : centerId);
    // ⚠️ Ô "Mã" ở chế độ SỬA là readOnly (không phải disabled) nên vẫn vào FormData.
    // Vẫn set lại tường minh ở đây làm lưới thứ hai: bug cũ là ô để `disabled={isEdit}`,
    // mà control disabled KHÔNG nằm trong entry list của FormData theo đặc tả HTML ⇒
    // `code` về server là chuỗi rỗng ⇒ Zod `code.min(1)` trượt ⇒ MỌI lần bấm Lưu ở màn
    // sửa đều trả "Dữ liệu không hợp lệ", không cách nào sửa được phương thức nào.
    if (isEdit && method) formData.set("code", method.code);

    startTransition(async () => {
      const result = isEdit
        ? await updatePaymentMethodAction(method!.id, formData)
        : await createPaymentMethodAction(formData);

      if (result.ok) {
        toast.success(isEdit ? "Đã cập nhật" : "Đã tạo phương thức");
        // Trong hộp thoại: đóng lại rồi làm mới DANH SÁCH ĐANG ĐỨNG. `router.push` ở đây
        // sẽ kéo người dùng ra khỏi tab Cấu hình họ đang mở — mất hẳn ngữ cảnh.
        if (onXong) onXong();
        else router.push("/payment-methods");
        router.refresh();
      } else {
        if ("issues" in result && result.issues) {
          const fieldErrors: Record<string, string> = {};
          for (const [k, v] of Object.entries(result.issues.fieldErrors)) {
            if (Array.isArray(v) && typeof v[0] === "string") {
              fieldErrors[k] = v[0];
            }
          }
          setErrors(fieldErrors);
        }
        toast.error(result.error || "Lỗi xảy ra");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      {/* Basic info */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Thông tin chung
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            {/* Ghi chú "mã không đổi được" chuyển vào icon "?" cạnh nhãn — dòng chữ dưới
                ô đẩy form dài ra mà chỉ đúng ở chế độ sửa. Lỗi validate thì GIỮ dạng chữ. */}
            <Label htmlFor="code">
              Mã *
              {isEdit && <HelpHint>Mã không thể đổi sau khi tạo.</HelpHint>}
            </Label>
            <Input
              id="code"
              name="code"
              defaultValue={method?.code ?? ""}
              placeholder="VD: CASH, BANK_CS1"
              readOnly={isEdit}
              aria-readonly={isEdit}
              className={isEdit ? "bg-muted text-muted-foreground" : undefined}
              required
            />
            {errors.code && (
              <p className="text-xs text-state-danger-ink">{errors.code}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Tên *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={method?.name ?? ""}
              placeholder="VD: Tiền mặt"
              required
            />
            {errors.name && (
              <p className="text-xs text-state-danger-ink">{errors.name}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Loại *</Label>
          <Select
            items={typeItems}
            value={type}
            onValueChange={(v) => setType(v as PaymentMethodType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>
            Cơ sở áp dụng *
            <HelpHint>
              <span className="block normal-case tracking-normal">
                Chọn một cơ sở thì phương thức này CHỈ hiện ở đơn của cơ sở đó — cơ sở
                khác không nhìn thấy và không chọn được. Chọn &ldquo;Dùng chung&rdquo;
                thì mọi cơ sở đều dùng được (hợp với tiền mặt, cổng online). Tài khoản
                nhận tiền của mỗi cơ sở khai ở trang Cơ sở, không phải ở đây.
              </span>
            </HelpHint>
          </Label>
          <Select
            items={centerItems}
            value={centerId}
            onValueChange={(v) => setCenterId(v ?? SHARED)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SHARED}>Dùng chung (mọi cơ sở)</SelectItem>
              {centers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.centerId && (
            <p className="text-xs text-state-danger-ink">{errors.centerId}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Mô tả</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={method?.description ?? ""}
            rows={2}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="image">
            URL hình ảnh (logo)
            <HelpHint>Tạm thời nhập URL. Upload qua R2 sẽ thêm ở sprint sau.</HelpHint>
          </Label>
          <Input
            id="image"
            name="image"
            defaultValue={method?.image ?? ""}
            placeholder="https://..."
          />
          {errors.image && (
            <p className="text-xs text-state-danger-ink">{errors.image}</p>
          )}
        </div>
      </section>

      {/* Allowed-for flags */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Cho phép thanh toán cho
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FLAG_DEFINITIONS.map((f) => (
            <div key={f.name} className="flex items-center gap-2">
              <Switch
                id={f.name}
                name={f.name}
                defaultChecked={method ? method[f.name] : f.name !== "canBuyProduct" && f.name !== "canDeposit"}
              />
              <Label htmlFor={f.name} className="cursor-pointer">
                {f.label}
              </Label>
            </div>
          ))}
        </div>
      </section>

      {/* Tài khoản nhận tiền — NGUỒN DỰNG MÃ QR (31/08/2026) */}
      {showBankFields && (
        <section className="space-y-4 rounded-xl border-y border-r border-l-4 border-border border-l-state-info bg-state-info-soft/20 p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-state-info-ink">
            <Landmark className="h-4 w-4" />
            Tài khoản nhận tiền
            <HelpHint>
              <span className="block normal-case tracking-normal">
                Đây là tài khoản mã QR trỏ vào. Đơn hàng chọn phương thức này thì phụ huynh
                quét QR ra đúng tài khoản này. Mã ngân hàng (BIN) 6 chữ số theo chuẩn
                VietQR — Vietinbank 970415, Vietcombank 970436, MB 970422, Techcombank
                970407, ACB 970416, BIDV 970418.
              </span>
            </HelpHint>
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="bankBin">Mã ngân hàng (BIN) *</Label>
              <Input
                id="bankBin"
                name="bankBin"
                defaultValue={method?.bankBin ?? ""}
                placeholder="970415"
                inputMode="numeric"
                maxLength={6}
              />
              {errors.bankBin && (
                <p className="text-xs text-state-danger-ink">{errors.bankBin}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankAccountNumber">Số tài khoản *</Label>
              <Input
                id="bankAccountNumber"
                name="bankAccountNumber"
                defaultValue={method?.bankAccountNumber ?? ""}
                placeholder="0123456789"
                inputMode="numeric"
              />
              {errors.bankAccountNumber && (
                <p className="text-xs text-state-danger-ink">
                  {errors.bankAccountNumber}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankAccountName">Chủ tài khoản *</Label>
              <Input
                id="bankAccountName"
                name="bankAccountName"
                defaultValue={method?.bankAccountName ?? ""}
                placeholder="CT CP CN GD SATA ROBO"
              />
              {errors.bankAccountName && (
                <p className="text-xs text-state-danger-ink">
                  {errors.bankAccountName}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bankName">
                Tên ngân hàng
                <HelpHint>Chỉ để người trong công ty đọc cho dễ — mã QR không dùng.</HelpHint>
              </Label>
              <Input
                id="bankName"
                name="bankName"
                defaultValue={method?.bankName ?? ""}
                placeholder="Vietinbank"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankBranch">Chi nhánh</Label>
              <Input
                id="bankBranch"
                name="bankBranch"
                defaultValue={method?.bankBranch ?? ""}
                placeholder="Đà Nẵng"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {selectedCenter ? (
              <>
                Mọi đơn của <strong>{selectedCenter.name}</strong> chọn phương thức này sẽ
                nhận tiền về tài khoản trên.
              </>
            ) : (
              <>
                Phương thức <strong>dùng chung</strong>: mọi cơ sở đều chọn được và tiền
                đều về tài khoản trên. Muốn mỗi cơ sở một tài khoản thì tạo phương thức
                riêng cho từng cơ sở.
              </>
            )}
          </p>
        </section>
      )}

      {/* Gateway config */}
      {showGatewayFields && (
        <section className="space-y-4 rounded-xl border-l-4 border-primary border-y border-r border-border bg-primary-soft/20 p-5">
          {/* Ví dụ JSON là hướng dẫn cho MỤC này → gắn "?" cạnh tiêu đề khối. */}
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-primary">
            Cấu hình gateway (JSON)
            <HelpHint>
              VD:{" "}
              {/* Nền tooltip là bg-foreground (đảo màu) nên chip `bg-muted` cũ sẽ thành
                  chữ sáng trên nền sáng. `break-all` vì chuỗi JSON không có dấu cách
                  để xuống dòng. */}
              <code className="rounded bg-background/15 px-1 py-0.5 font-mono break-all">
                {`{"merchantId":"XYZ","apiKey":"...","returnUrl":"..."}`}
              </code>
              . Sprint 5.6.5 sẽ tích hợp thực tế.
            </HelpHint>
          </h2>
          <Textarea
            name="gatewayConfig"
            rows={4}
            defaultValue={initialGateway}
            placeholder='{"merchantId": "..."}'
            className="font-mono text-sm"
          />
          {errors.gatewayConfig && (
            <p className="text-xs text-state-danger-ink">{errors.gatewayConfig}</p>
          )}
        </section>
      )}

      {/* Display & Active */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="displayOrder">Thứ tự hiển thị</Label>
            <Input
              id="displayOrder"
              name="displayOrder"
              type="number"
              min={0}
              defaultValue={method?.displayOrder ?? 0}
            />
          </div>
          <div className="flex items-center gap-2 sm:pt-7">
            <Switch
              id="isActive"
              name="isActive"
              defaultChecked={method?.isActive ?? true}
            />
            <Label htmlFor="isActive" className="cursor-pointer">
              Kích hoạt
            </Label>
          </div>
        </div>
      </section>

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo mới"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Huỷ
        </Button>
      </div>
    </form>
  );
}
