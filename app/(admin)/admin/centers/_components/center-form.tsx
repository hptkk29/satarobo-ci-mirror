"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { ImageUploader } from "@/components/admin/ImageUploader";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { createCenter, updateCenter } from "../_actions";

export type CenterFormValue = {
  id: string;
  name: string;
  slug: string;
  address: string;
  ward: string | null;
  district: string | null;
  city: string;
  phone: string | null;
  email: string | null;
  googleMapUrl: string | null;
  workingHours: string | null;
  managerName: string | null;
  /** 27/08 — TÀI KHOẢN quản lý (nguồn hoa hồng QL_TT 2%), khác `managerName` là chuỗi chữ. */
  managerUserId: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  description: string | null;
  isActive: boolean;
  displayOrder: number;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number | null;
};

/** Một phương thức thanh toán của cơ sở, phẳng hoá cho mục "Thanh toán". */
export type CenterPaymentMethodRow = {
  id: string;
  code: string;
  name: string;
  typeLabel: string;
  isActive: boolean;
  /** Tóm tắt tài khoản nhận tiền — null nếu không phải chuyển khoản / chưa khai đủ. */
  bank: string | null;
};

export type CenterPaymentView = {
  methods: CenterPaymentMethodRow[];
  /** Số phương thức DÙNG CHUNG đang bật — cơ sở nào cũng chọn được. */
  sharedCount: number;
  /** `payments:manage` — thiếu thì chỉ XEM, không hiện nút tạo/sửa. */
  canManage: boolean;
};

/** 27/08/2026 — tài khoản có thể gán làm quản lý cơ sở (nguồn hoa hồng QL_TT 2%). */
export type NguoiChonQuanLy = { id: string; name: string; email: string | null };

export function CenterForm({
  center,
  payment,
  nguoiChon = [],
}: {
  center?: CenterFormValue;
  /** Danh sách tài khoản cho ô "Tài khoản quản lý cơ sở" (xem `NguoiChonQuanLy`). */
  nguoiChon?: NguoiChonQuanLy[];
  /**
   * Mục "Thanh toán". `null` = người xem không có quyền (RSC quyết định) ⇒ không vẽ gì.
   *
   * ⚠️ Chỉ HIỂN THỊ + link, KHÔNG có nút Lưu riêng — nhờ vậy mục này nằm được BÊN TRONG
   * thẻ <form> của cơ sở (HTML cấm <form> lồng <form>). Việc khai tài khoản nhận tiền đã
   * chuyển hẳn sang form Phương thức thanh toán (chốt 31/08/2026).
   */
  payment?: CenterPaymentView | null;
}) {
  const router = useRouter();
  const isEdit = Boolean(center);
  const [error, setError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(center?.logoUrl ?? null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(center?.bannerUrl ?? null);

  async function action(formData: FormData) {
    setError(null);
    const res = isEdit
      ? await updateCenter(center!.id, formData)
      : await createCenter(formData);
    if (res?.error) {
      setError(res.error);
      return;
    }
    // QA 20/07 — toast thành công thay vì redirect âm thầm.
    toast.success(isEdit ? "Đã cập nhật cơ sở" : "Đã tạo cơ sở mới");
    router.push("/centers");
  }

  return (
    <form action={action} className="max-w-4xl space-y-6">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <Section title="Thông tin cơ sở">
        <Grid cols={2}>
          <Field label="Tên cơ sở" name="name" defaultValue={center?.name} required />
          <Field
            label="Slug (URL)"
            name="slug"
            defaultValue={center?.slug}
            placeholder="danang, ho-chi-minh, ha-noi"
            required
          />
        </Grid>
        <Field
          label="Địa chỉ"
          name="address"
          defaultValue={center?.address}
          placeholder="211 Nguyễn Hữu Thọ"
          required
        />
        <Grid cols={3}>
          <Field
            label="Phường"
            name="ward"
            defaultValue={center?.ward ?? undefined}
            placeholder="Hòa Cường"
          />
          <Field
            label="Quận / Huyện"
            name="district"
            defaultValue={center?.district ?? undefined}
            placeholder="Hải Châu"
          />
          <Field
            label="Tỉnh / TP"
            name="city"
            defaultValue={center?.city}
            placeholder="Đà Nẵng"
            required
          />
        </Grid>
        <Grid cols={2}>
          <Field
            label="Số điện thoại"
            name="phone"
            defaultValue={center?.phone ?? undefined}
            placeholder="Số điện thoại cơ sở"
          />
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={center?.email ?? undefined}
            placeholder="danang@satarobo.vn"
          />
        </Grid>
        <Field
          label="Google Maps URL"
          name="googleMapUrl"
          defaultValue={center?.googleMapUrl ?? undefined}
          placeholder="https://maps.app.goo.gl/..."
        />
        <Grid cols={2}>
          <Field
            label="Giờ làm việc (hiển thị công khai)"
            name="workingHours"
            defaultValue={center?.workingHours ?? undefined}
            placeholder="T2-T6: 17h-21h, T7-CN: 8h-17h"
          />
          <Field
            label="Quản lý cơ sở"
            name="managerName"
            defaultValue={center?.managerName ?? undefined}
            placeholder="Nguyễn Văn A"
          />
        </Grid>
        {/*
          27/08 — TÀI KHOẢN quản lý cơ sở. Khác hẳn ô "Quản lý cơ sở" ngay trên: ô kia là
          CHUỖI CHỮ cho trang liên hệ, còn ô này là thứ hệ thống dùng để trả hoa hồng
          Quản lý trung tâm 2%. Bắt buộc khi TẠO cơ sở mới — cơ sở không có tài khoản
          quản lý thì 2% doanh thu của nó treo mỗi kỳ mà không ai để ý.

          ⚠️ Ô này ĐÃ RƠI MẤT một lần khi hợp nhất `main` → `test` ngày 16/09: bản
          `center-form.tsx` bên `main` không có nó (nhánh đó chưa nhận đợt 27/08).
        */}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">
            Tài khoản quản lý cơ sở{!isEdit ? " *" : ""}
          </span>
          <select
            name="managerUserId"
            defaultValue={center?.managerUserId ?? ""}
            required={!isEdit}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">— Chưa gán —</option>
            {nguoiChon.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email ? `${u.name} · ${u.email}` : u.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            Dùng để trả hoa hồng <strong>Quản lý trung tâm 2%</strong>. Đổi người ở đây sẽ ghi một
            dòng mới vào sổ phân công có hiệu lực <strong>từ hôm nay</strong> — hoa hồng các kỳ đã
            tính GIỮ NGUYÊN. Muốn đặt hiệu lực lùi/tới ngày khác thì khai ở{" "}
            <Link href="/crm/commission/nguoi-huong" className="underline">
              Người hưởng hoa hồng theo cơ sở
            </Link>
            .
          </span>
        </label>
        {isEdit && (
          // Ô "Giờ làm việc" ở trên là CHỮ HIỂN THỊ trên trang công khai — hệ thống không
          // đọc được nó. Giờ mà hệ thống thật sự dùng (tính hạn xử lý, giờ gửi thông báo)
          // khai ở màn riêng, theo từng thứ và từng vai.
          <p className="text-xs text-muted-foreground">
            Dòng trên chỉ là chữ hiển thị cho khách. Giờ làm việc hệ thống dùng để tính
            toán khai tại{" "}
            <Link
              href={`/centers/${center!.id}/gio-lam-viec`}
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              Giờ làm việc theo thứ →
            </Link>
          </p>
        )}
        <Field
          label="Mô tả ngắn"
          name="description"
          type="textarea"
          rows={3}
          defaultValue={center?.description ?? undefined}
          placeholder="Mô tả ngắn về chi nhánh, điểm nổi bật..."
        />
      </Section>

      {isEdit && payment && (
        <Section
          title="Thanh toán"
          hint={
            <>
              Cơ sở nào thu tiền về tài khoản của cơ sở đó. Phương thức gắn cơ sở này CHỈ
              hiện khi tạo đơn cho cơ sở này — cơ sở khác không thấy. Tài khoản nhận tiền
              khai ngay trong từng phương thức chuyển khoản.
            </>
          }
        >
          {payment.methods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Cơ sở này chưa có phương thức riêng — đang dùng {payment.sharedCount} phương
              thức dùng chung.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {payment.methods.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-foreground">{m.name}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {m.code}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {m.typeLabel}
                      {m.bank ? ` · ${m.bank}` : ""}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      m.isActive
                        ? "bg-state-success-soft text-state-success-ink"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {m.isActive ? "Hoạt động" : "Tắt"}
                  </span>
                  {payment.canManage && (
                    <Link
                      href={`/payment-methods/${m.id}/edit`}
                      className="shrink-0 text-sm font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      Sửa
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}

          {payment.methods.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Cộng thêm {payment.sharedCount} phương thức dùng chung cho mọi cơ sở.
            </p>
          )}

          {payment.canManage && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Nút TẠO đi kèm ?centerId= để form chọn sẵn đúng cơ sở này. */}
              <Link
                href={`/payment-methods/new?centerId=${encodeURIComponent(center!.id)}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
              >
                <Plus className="h-4 w-4" />
                Tạo phương thức thanh toán
              </Link>
              <Link
                href={`/payment-methods?centerId=${encodeURIComponent(center!.id)}`}
                className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
              >
                Xem toàn bộ danh mục →
              </Link>
            </div>
          )}
        </Section>
      )}

      <Section title="Hình ảnh">
        <Grid cols={2}>
          <div>
            <ImageUploader
              label="Logo chi nhánh"
              value={logoUrl}
              onChange={setLogoUrl}
              prefix="uploads/centers"
              aspect="square"
              helperText="Logo riêng (để trống = dùng logo Sata Robo chung)"
            />
            <input type="hidden" name="logoUrl" value={logoUrl ?? ""} />
          </div>
          <div>
            <ImageUploader
              label="Ảnh banner"
              value={bannerUrl}
              onChange={setBannerUrl}
              prefix="uploads/centers"
              aspect="video"
              helperText="Cover ảnh hiển thị ở trang chi tiết public"
            />
            <input type="hidden" name="bannerUrl" value={bannerUrl ?? ""} />
          </div>
        </Grid>
      </Section>

      <Section
        title="Chấm công (geofence GPS)"
        hint="Toạ độ để chấm công QR kiểm tra nhân viên đang ở gần cơ sở. Lấy từ Google Maps (chuột phải vào vị trí → toạ độ). Để trống = bỏ qua kiểm tra vị trí."
      >
        <Grid cols={3}>
          <Field
            label="Vĩ độ (latitude)"
            name="latitude"
            defaultValue={center?.latitude ?? undefined}
            placeholder="16.0471"
          />
          <Field
            label="Kinh độ (longitude)"
            name="longitude"
            defaultValue={center?.longitude ?? undefined}
            placeholder="108.2068"
          />
          <Field
            label="Bán kính cho phép (m)"
            name="allowedRadiusMeters"
            type="number"
            defaultValue={center?.allowedRadiusMeters ?? 150}
            placeholder="150"
          />
        </Grid>
      </Section>

      <Section title="Hiển thị">
        <Grid cols={2}>
          <CheckboxField
            label="Đang hoạt động"
            name="isActive"
            defaultChecked={center?.isActive ?? true}
            hint="Cơ sở chưa hoạt động sẽ không hiển thị trên trang công khai và Footer."
          />
          <Field
            label="Display Order"
            name="displayOrder"
            type="number"
            defaultValue={center?.displayOrder ?? 0}
          />
        </Grid>
      </Section>

      <div className="flex gap-3 border-t border-border pt-6">
        <SubmitButton isEdit={isEdit} />
        <button
          type="button"
          onClick={() => router.push("/centers")}
          className="rounded-xl border-2 border-border bg-card px-6 py-3 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:bg-primary-dark disabled:opacity-60"
    >
      {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo cơ sở"}
    </button>
  );
}

// ============== Form primitives ==============

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  /** Có nội dung → icon "?" cạnh tiêu đề khối, thay cho đoạn chữ mờ dài dưới các ô. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-foreground">
        {title}
        {/* `normal-case tracking-normal` đặt trên NỘI DUNG chứ không trên nút: tiêu đề khối
            đang uppercase + giãn chữ, hướng dẫn 2–3 câu mà kế thừa thì đọc không nổi. */}
        {hint && (
          <HelpHint className="ml-1">
            <span className="block normal-case tracking-normal">{hint}</span>
          </HelpHint>
        )}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  const grid = cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return <div className={`grid grid-cols-1 ${grid} gap-4`}>{children}</div>;
}

type FieldProps = {
  label: string;
  name: string;
  type?: "text" | "number" | "email" | "textarea";
  rows?: number;
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
};

function Field({
  label,
  name,
  type = "text",
  rows = 3,
  defaultValue,
  placeholder,
  required,
}: FieldProps) {
  const value = defaultValue ?? "";
  const baseClass =
    "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-state-danger-ink">*</span>}
      </span>
      {type === "textarea" ? (
        <textarea
          name={name}
          rows={rows}
          defaultValue={value}
          placeholder={placeholder}
          required={required}
          className={baseClass + " resize-y"}
        />
      ) : (
        <input
          type={type}
          name={name}
          defaultValue={value}
          placeholder={placeholder}
          required={required}
          className={baseClass}
        />
      )}
    </label>
  );
}

function CheckboxField({
  label,
  name,
  defaultChecked,
  hint,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    // Nút "?" nằm trong <label> vẫn an toàn: <button> là interactive content nên trình
    // duyệt KHÔNG chuyển tiếp cú bấm xuống ô tick.
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30"
      />
      <span className="text-sm font-semibold text-foreground">
        {label}
        {hint && <HelpHint className="ml-1">{hint}</HelpHint>}
      </span>
    </label>
  );
}
