"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Edit, Eye, EyeOff, UserCheck, UserX, Trash2, Crown, Building2 } from "lucide-react";
import type { Employee, Department, EmploymentStatus, Role } from "@prisma/client";
import {
  deleteEmployeeAction,
  toggleEmployeeActiveAction,
  toggleEmployeePublicAction,
} from "@/app/(admin)/admin/nhan-su/actions";
import { formatDateOrDash } from "@/lib/format/date";
// T8.2 — nhãn/màu vai trò lấy từ nguồn DUY NHẤT `lib/labels.ts` (trước đây bảng này
// khai báo bản cục bộ lệch chữ: "Quản lý" vs "Quản lý cơ sở", "Tư vấn" vs
// "Tư vấn & Chăm sóc"). Đừng khai lại ở component — sửa chữ ở lib/labels.ts.
import { roleLabel, roleColor } from "@/lib/labels";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

interface EmployeeRow extends Employee {
  center: { name: string } | null;
  manager: { fullName: string } | null;
  userAccount: { role: Role; roles: Role[] } | null;
}

const STATUS_LABEL: Record<EmploymentStatus, string> = {
  ACTIVE: "Đang làm",
  ON_LEAVE: "Tạm nghỉ",
  RESIGNED: "Đã nghỉ",
  TERMINATED: "Cho nghỉ",
};

const STATUS_COLOR: Record<EmploymentStatus, string> = {
  ACTIVE: "bg-state-success-soft text-state-success-ink",
  ON_LEAVE: "bg-state-warning-soft text-state-warning-ink",
  RESIGNED: "bg-muted text-muted-foreground",
  TERMINATED: "bg-state-danger-soft text-state-danger-ink",
};

interface Props {
  employees: EmployeeRow[];
  canDelete: boolean;
  /** Id NV có EmployeeOrgAssignment PRIMARY active tới HO → hiển thị "HO (Hội sở)". */
  hoEmployeeIds?: string[];
}

const DEPARTMENT_LABELS: Record<Department, string> = {
  BAN_GIAM_DOC: "Ban Giám đốc",
  DAO_TAO: "Đào tạo",
  MARKETING: "Marketing",
  KINH_DOANH: "Kinh doanh",
  IT: "IT",
  HANH_CHANH_NHAN_SU: "Hành chính - Nhân sự",
  KE_TOAN: "Kế toán",
  TUYEN_SINH: "Tuyển sinh",
  GIAO_VU: "Giáo vụ",
  GIANG_DAY: "Giảng dạy",
};

// Bao cả mốc epoch 1970 (seed cũ set new Date(0)) → "—", không chỉ null.
const fmtDate = formatDateOrDash;

export function EmployeesAdminTable({ employees, canDelete, hoEmployeeIds = [] }: Props) {
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const hoSet = new Set(hoEmployeeIds);

  const handleToggleActive = (id: string) => {
    startTransition(async () => {
      const res = await toggleEmployeeActiveAction(id);
      if (res.ok) toast.success("Đã cập nhật trạng thái");
      else toast.error(res.error);
    });
  };

  const handleTogglePublic = (id: string) => {
    startTransition(async () => {
      const res = await toggleEmployeePublicAction(id);
      if (res.ok) toast.success("Đã cập nhật hiển thị public");
      else toast.error(res.error);
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await deleteEmployeeAction(id);
      if (res.ok) {
        toast.success("Đã xoá nhân sự");
        setDeleteId(null);
      } else {
        toast.error(res.error);
        setDeleteId(null);
      }
    });
  };

  if (employees.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        <p>Chưa có nhân sự nào khớp bộ lọc.</p>
        <Link
          href="/nhan-su/new"
          className="mt-2 inline-block text-primary hover:underline"
        >
          Thêm nhân sự đầu tiên →
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <PhanTrangBang cuonNgang>
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Họ tên</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">SĐT</th>
              <th className="px-4 py-3">Cơ sở</th>
              <th className="px-4 py-3">Bộ phận</th>
              <th className="px-4 py-3">Vai trò</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Ngày vào làm</th>
              <th className="px-4 py-3 text-right">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {employees.map((emp) => (
              <tr key={emp.id} className="hover:bg-muted">
                {/* Họ tên */}
                <td className="px-4 py-3">
                  <p className="font-semibold text-foreground">
                    {emp.fullName}
                    {emp.isCEO && (
                      <span title="CEO" className="ml-1 inline-block align-middle">
                        <Crown className="inline h-3.5 w-3.5 text-state-warning-ink" />
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {emp.jobTitle}
                    <span className="ml-1 font-mono text-muted-foreground">· {emp.employeeCode}</span>
                  </p>
                </td>
                {/* Email */}
                <td className="px-4 py-3 text-xs text-foreground">{emp.email || "—"}</td>
                {/* SĐT */}
                <td className="px-4 py-3 text-xs text-foreground">{emp.phone || "—"}</td>
                {/* Cơ sở (HO badge nếu là nhân viên Hội sở) */}
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {hoSet.has(emp.id) ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-state-info-soft px-2 py-0.5 text-xs font-semibold text-state-info-ink">
                      <Building2 className="h-3 w-3" /> HO (Hội sở)
                    </span>
                  ) : (
                    emp.center?.name || "—"
                  )}
                  {emp.manager && (
                    <p className="text-muted-foreground">↑ {emp.manager.fullName}</p>
                  )}
                </td>
                {/* Bộ phận */}
                <td className="px-4 py-3 text-foreground">
                  {DEPARTMENT_LABELS[emp.department]}
                </td>
                {/* Vai trò (hiện đủ role, vai trò chính có viền nổi bật) */}
                <td className="px-4 py-3">
                  {emp.userAccount ? (
                    (() => {
                      const acc = emp.userAccount;
                      const effective =
                        acc.roles.length > 0 ? acc.roles : [acc.role];
                      const ordered = [
                        ...effective.filter((r) => r === acc.role),
                        ...effective.filter((r) => r !== acc.role),
                      ];
                      return (
                        <div className="flex flex-wrap items-center gap-1">
                          {ordered.map((r) => (
                            <span
                              key={r}
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${roleColor(r)} ${ r === acc.role ? "ring-2 ring-state-warning ring-offset-1" : "" }`}
                              title={
                                r === acc.role
                                  ? "Vai trò chính · Đổi: Sửa → Đổi vai trò"
                                  : "Đổi vai trò: bấm Sửa → nút Đổi vai trò"
                              }
                            >
                              {roleLabel(r)}
                            </span>
                          ))}
                        </div>
                      );
                    })()
                  ) : (
                    <span className="text-xs text-muted-foreground">Chưa có TK</span>
                  )}
                </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[emp.status]}`}
                    >
                      {STATUS_LABEL[emp.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(emp.joinedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(emp.id)}
                        disabled={isPending}
                        className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                        title={emp.isActive ? "Đang làm việc (legacy) — bấm để tắt" : "Bật đang làm việc"}
                      >
                        {emp.isActive ? (
                          <UserCheck className="h-4 w-4 text-state-success-ink" />
                        ) : (
                          <UserX className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTogglePublic(emp.id)}
                        disabled={isPending}
                        className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                        title={emp.isPublic ? "Đang hiển thị public — bấm để ẩn" : "Hiển thị public"}
                      >
                        {emp.isPublic ? (
                          <Eye className="h-4 w-4 text-state-info-ink" />
                        ) : (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <Link
                        href={`/nhan-su/${emp.id}/edit`}
                        className="rounded p-1.5 text-state-info-ink hover:bg-state-info-soft"
                        title="Sửa"
                      >
                        <Edit className="h-4 w-4" />
                      </Link>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            if (deleteId === emp.id) handleDelete(emp.id);
                            else setDeleteId(emp.id);
                          }}
                          disabled={isPending}
                          className={`rounded p-1.5 ${ deleteId === emp.id ? "bg-state-danger-soft text-state-danger-ink" : "text-state-danger-ink hover:bg-state-danger-soft" }`}
                          title={deleteId === emp.id ? "Xác nhận xoá" : "Xoá"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}
