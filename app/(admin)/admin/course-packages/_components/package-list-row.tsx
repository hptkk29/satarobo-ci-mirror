"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { deletePackage } from "../_actions";

export type CoursePackageListItem = {
  id: string;
  slug: string;
  code: string;
  name: string;
  level: string | null;
  lessons: number | null;
  priceOriginal: number | null;
  isPublished: boolean;
  isFeatured: boolean;
  // FL1-05 — khoá dạy liên kết (null = chưa gắn).
  course: { id: string; name: string; code: string | null } | null;
};

function formatCurrency(value: number | null) {
  if (value === null) return "--";
  return `${new Intl.NumberFormat("vi-VN").format(value)}đ`;
}

export function PackageListRow({ pkg }: { pkg: CoursePackageListItem }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await deletePackage(pkg.id);
      if (result.error) {
        setError(result.error);
      }
    });
  };

  return (
    <tr className="border-b border-border transition-colors hover:bg-muted/70">
      <td className="px-4 py-3">
        <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
          {pkg.code}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="font-semibold text-foreground">{pkg.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">/{pkg.slug}</div>
        {error ? <div className="mt-1 text-xs font-medium text-state-danger-ink">{error}</div> : null}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{pkg.level ?? "--"}</td>
      <td className="px-4 py-3 text-sm">
        {pkg.course ? (
          <span className="inline-flex items-center rounded-md bg-state-info-soft px-2 py-1 text-xs font-medium text-state-info-ink">
            {pkg.course.name}
            {pkg.course.code ? ` (${pkg.course.code})` : ""}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Chưa gắn</span>
        )}
      </td>
      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-foreground">
        {formatCurrency(pkg.priceOriginal)}
      </td>
      <td className="px-4 py-3 text-center text-sm tabular-nums text-muted-foreground">
        {pkg.lessons ?? "--"}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-center gap-1.5">
          {pkg.isPublished ? (
            <span className="rounded-full bg-state-success-soft px-2.5 py-0.5 text-xs font-semibold text-state-success-ink">
              Đã đăng
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              Nháp
            </span>
          )}
          {pkg.isFeatured ? (
            <span className="rounded-full bg-state-warning-soft px-2.5 py-0.5 text-xs font-semibold text-state-warning-ink">
              Nổi bật
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-1.5">
          <Link
            href={`/course-packages/${pkg.id}/edit`}
            className="rounded-lg p-2 text-primary hover:bg-primary-soft"
            aria-label={`Sua ${pkg.code}`}
          >
            <Pencil className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className={`rounded-lg p-2 hover:bg-state-danger-soft ${ confirmDelete ? "text-state-danger-ink" : "text-state-danger-ink" } disabled:cursor-not-allowed disabled:opacity-60`}
            aria-label={confirmDelete ? `Xac nhan xoa ${pkg.code}` : `Xoa ${pkg.code}`}
            title={confirmDelete ? "Click lan nua de xoa" : "Xoa"}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
