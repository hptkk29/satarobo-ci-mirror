"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ROLE_OPTIONS } from "./role-badge";
import { createUserAction, updateUserAction } from "../_actions";

type OrgUnitOption = { id: string; name: string };
type EmployeeOption = { id: string; fullName: string; employeeCode: string | null };

type UserFormInitialData = {
  // id only present in edit mode
  id?: string;
  name?: string | null;
  email?: string;
  role?: Role; // vai trò chính (primary)
  roles?: Role[]; // Đợt 3B — tất cả vai trò đang giữ
  orgUnitId?: string | null;
  employeeId?: string | null;
};

interface UserFormProps {
  mode: "create" | "edit";
  initialData?: UserFormInitialData;
  orgUnits: OrgUnitOption[];
  employees: EmployeeOption[]; // unlinked employees + current employee (if edit) + prefill employee (if create-from-employee)
}

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

export function UserForm({
  mode,
  initialData,
  orgUnits,
  employees,
}: UserFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Đợt 3B — đa vai trò: chọn nhiều role (union quyền) + 1 vai trò chính.
  const initialRoles: Role[] =
    initialData?.roles && initialData.roles.length > 0
      ? initialData.roles
      : initialData?.role
        ? [initialData.role]
        : ["SALES_CSM"];
  const [selectedRoles, setSelectedRoles] = useState<Role[]>(initialRoles);
  const [primaryRole, setPrimaryRole] = useState<Role>(
    initialData?.role ?? initialRoles[0],
  );

  function toggleRole(r: Role) {
    setSelectedRoles((cur) => {
      const next = cur.includes(r)
        ? cur.filter((x) => x !== r)
        : [...cur, r];
      // Bỏ vai trò chính → primary = phần tử đầu còn lại.
      if (!next.includes(primaryRole) && next.length > 0) {
        setPrimaryRole(next[0]);
      }
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (selectedRoles.length === 0) {
      setError("Chọn ít nhất 1 vai trò");
      return;
    }

    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const res =
        mode === "create"
          ? await createUserAction(fd)
          : await updateUserAction(initialData!.id!, fd);

      if (!res.ok) {
        setError(res.error ?? "Lỗi thao tác");
        toast.error(res.error ?? "Lỗi thao tác");
        return;
      }

      toast.success(
        mode === "create" ? "Tạo tài khoản thành công" : "Đã lưu thay đổi",
      );
      if (mode === "create") {
        router.push("/users");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Tên hiển thị *</Label>
          <Input
            id="name"
            name="name"
            required
            maxLength={100}
            defaultValue={initialData?.name ?? ""}
            placeholder="Nguyễn Văn A"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email *</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={initialData?.email ?? ""}
            placeholder="ten@satarobo.vn"
          />
        </div>
      </div>

      {mode === "create" && (
        <div className="space-y-1.5">
          <Label htmlFor="phone">Số điện thoại (tài khoản đăng nhập)</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            maxLength={20}
            placeholder="0901234567"
          />
          <p className="text-xs text-muted-foreground">
            Nhân sự đăng nhập bằng SĐT (hoặc email). Thông tin tài khoản sẽ được
            gửi qua email + Zalo sau khi tạo.
          </p>
        </div>
      )}

      {mode === "create" && (
        <div className="space-y-1.5">
          <Label htmlFor="password">Mật khẩu *</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={72}
            placeholder="Tối thiểu 8 ký tự"
          />
          <p className="text-xs text-muted-foreground">
            User sẽ đổi mật khẩu sau khi đăng nhập lần đầu.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Vai trò * (chọn nhiều)</Label>
        {/* Hidden inputs → FormData mang roles[] + primaryRole cho server action. */}
        {selectedRoles.map((r) => (
          <input key={r} type="hidden" name="roles" value={r} />
        ))}
        <input type="hidden" name="primaryRole" value={primaryRole} />
        <div className="grid gap-1.5 sm:grid-cols-2">
          {ROLE_OPTIONS.map((opt) => {
            const on = selectedRoles.includes(opt.value);
            return (
              <div
                key={opt.value}
                className="flex items-center justify-between gap-2 rounded-lg border border-input px-3 py-1.5"
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleRole(opt.value)}
                    disabled={pending}
                    className="h-4 w-4 rounded border-input"
                  />
                  {opt.label}
                </label>
                <button
                  type="button"
                  onClick={() => on && setPrimaryRole(opt.value)}
                  disabled={!on || pending}
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ primaryRole === opt.value ? "bg-primary text-white" : on ? "bg-muted text-muted-foreground hover:bg-primary-soft" : "bg-muted text-muted-foreground" }`}
                >
                  {primaryRole === opt.value ? "Vai trò chính" : "Đặt chính"}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Quyền = hợp của tất cả vai trò. Vai trò chính dùng cho dashboard mặc
          định. Hội sở (HO) không phải vai trò — chọn ở ô <strong>Đơn vị</strong>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="orgUnitId">
            Đơn vị <span className="text-state-danger-ink">*</span>
          </Label>
          <select
            id="orgUnitId"
            name="orgUnitId"
            defaultValue={initialData?.orgUnitId ?? ""}
            className={selectClass}
          >
            <option value="">— Chọn đơn vị —</option>
            {orgUnits.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Bắt buộc: quyền (RBAC) được gán tại đơn vị này. Chọn Hội sở = vai trò
            xuyên cơ sở.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="employeeId">Nhân sự liên kết</Label>
          <select
            id="employeeId"
            name="employeeId"
            defaultValue={initialData?.employeeId ?? ""}
            className={selectClass}
          >
            <option value="">— Không gán —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
                {e.employeeCode ? ` · ${e.employeeCode}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending
            ? "Đang lưu..."
            : mode === "create"
              ? "Tạo tài khoản"
              : "Lưu thay đổi"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/users")}
          disabled={pending}
        >
          Huỷ
        </Button>
      </div>
    </form>
  );
}
