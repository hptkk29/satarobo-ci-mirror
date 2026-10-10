"use client";

// Form một điểm chấm công, sống trong Sheet phải. Trước đây form mở inline phía trên bảng nên
// người dùng đang so toạ độ của dòng thứ hai lại phải cuộn ngược lên đầu trang.
//
// Điều dễ vỡ:
//  · Bật định vị mà chưa có toạ độ ⇒ server từ chối ("Chưa có toạ độ thì không bật geofence được").
//    Ô định vị ở đây tự khoá khi thiếu toạ độ để người dùng thấy lý do trước khi bấm Lưu.
//  · Định vị chỉ GẮN CỜ, không chặn lượt quét — câu chữ trong form phải giữ đúng nghĩa đó.
//  · `code` là `@unique` TOÀN CỤC (không phải theo cơ sở) ⇒ đặt mã có hậu tố cơ sở: QUAY_CS1.
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { saveWorkLocationAction } from "../_actions";

export type LocationValue = {
  id?: string;
  centerId: string;
  code: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  geofenceEnabled: boolean;
  isActive: boolean;
};

export type LocationCenter = { id: string; name: string };

export function emptyLocation(centerId: string): LocationValue {
  return {
    centerId,
    code: "",
    name: "",
    latitude: null,
    longitude: null,
    radiusMeters: 100,
    geofenceEnabled: false,
    isActive: true,
  };
}

function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block text-sm", wide && "sm:col-span-2")}>
      <span className="mb-1 block text-sm font-semibold text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function LocationForm({
  initial,
  centers,
  onSaved,
  onCancel,
}: {
  initial: LocationValue;
  centers: LocationCenter[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<LocationValue>(initial);
  const [pending, start] = useTransition();
  const hasCoords = v.latitude != null && v.longitude != null;

  function submit() {
    start(async () => {
      const r = await saveWorkLocationAction(v);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(initial.id ? `Đã lưu điểm ${v.code}` : `Đã thêm điểm ${v.code}`);
      onSaved();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cơ sở" wide>
            <select
              className={cn(FIELD, "w-full")}
              value={v.centerId}
              disabled={!!initial.id}
              onChange={(e) => setV({ ...v, centerId: e.target.value })}
            >
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mã" hint="Chữ hoa/số/_/-, duy nhất toàn hệ thống — đặt kèm mã cơ sở.">
            <input
              className={cn(FIELD, "w-full font-mono uppercase")}
              value={v.code}
              maxLength={16}
              onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })}
              placeholder="QUAY_CS1"
            />
          </Field>
          <Field label="Tên">
            <input
              className={cn(FIELD, "w-full")}
              value={v.name}
              maxLength={80}
              onChange={(e) => setV({ ...v, name: e.target.value })}
              placeholder="Quầy lễ tân CS1"
            />
          </Field>
          <Field label="Vĩ độ (lat)" hint="Google Maps: nhấn giữ vị trí quầy rồi chép số đầu.">
            <input
              inputMode="decimal"
              className={cn(FIELD, "w-full tabular-nums")}
              value={v.latitude ?? ""}
              onChange={(e) => setV({ ...v, latitude: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="16.0471"
            />
          </Field>
          <Field label="Kinh độ (lng)" hint="Số thứ hai trong cặp toạ độ." >
            <input
              inputMode="decimal"
              className={cn(FIELD, "w-full tabular-nums")}
              value={v.longitude ?? ""}
              onChange={(e) => setV({ ...v, longitude: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="108.2062"
            />
          </Field>
          <Field label="Bán kính (m)" hint="10–2000. Một toà nhà thường 100m là đủ.">
            <input
              type="number"
              min={10}
              max={2000}
              className={cn(FIELD, "w-full tabular-nums")}
              value={v.radiusMeters}
              onChange={(e) => setV({ ...v, radiusMeters: Number(e.target.value) })}
            />
          </Field>
        </div>

        <label
          className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm"
          title={hasCoords ? undefined : "Nhập toạ độ trước rồi mới bật được định vị"}
        >
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={v.geofenceEnabled}
            disabled={!hasCoords}
            onChange={(e) => setV({ ...v, geofenceEnabled: e.target.checked })}
          />
          <span>
            <span className="font-semibold text-foreground">Bật định vị</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Quét ngoài bán kính vẫn ghi nhận lượt, chỉ kèm cờ &ldquo;Ngoài vùng&rdquo; để quản lý rà.
              {!hasCoords && " Cần nhập toạ độ trước."}
            </span>
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={v.isActive}
            onChange={(e) => setV({ ...v, isActive: e.target.checked })}
          />
          Đang dùng (bỏ chọn = ngưng quầy này)
        </label>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          className={BTN_PRIMARY}
          onClick={submit}
          disabled={pending || !v.code.trim() || !v.name.trim()}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Lưu
        </button>
        <button type="button" className={BTN_OUTLINE} onClick={onCancel} disabled={pending}>
          Huỷ
        </button>
      </div>
    </div>
  );
}

/** Vỏ Sheet — `key` theo bản ghi để mở điểm khác không còn giữ state của điểm cũ. */
export function LocationSheet({
  open,
  onOpenChange,
  value,
  centers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: LocationValue | null;
  centers: LocationCenter[];
  onSaved: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{value?.id ? `Sửa điểm ${value.code}` : "Thêm điểm chấm công"}</SheetTitle>
          <SheetDescription>
            Toạ độ và bán kính chỉ dùng để gắn cờ khi rà công — không chặn ai quét.
          </SheetDescription>
        </SheetHeader>
        {value && (
          <LocationForm
            key={value.id ?? `moi-${value.centerId}`}
            initial={value}
            centers={centers}
            onSaved={onSaved}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
