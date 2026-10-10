"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Edit, Eye, EyeOff, Star, Trash2 } from "lucide-react";
import { Honor, HonorCategory } from "@prisma/client";
import { CATEGORY_META } from "@/lib/honors/category-meta";
import {
  deleteHonorAction,
  toggleFeaturedAction,
  togglePublishedAction,
} from "@/app/(admin)/admin/honors/actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

interface HonorRow extends Honor {
  createdBy: { name: string | null } | null;
}

interface Props {
  honors: HonorRow[];
  canDelete: boolean;
}

export function HonorsAdminTable({ honors, canDelete }: Props) {
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleToggleFeatured = (id: string) => {
    startTransition(async () => {
      const res = await toggleFeaturedAction(id);
      if (res.ok) toast.success("Đã cập nhật Person of the Month");
      else toast.error(res.error || "Lỗi khi cập nhật");
    });
  };

  const handleTogglePublished = (id: string) => {
    startTransition(async () => {
      const res = await togglePublishedAction(id);
      if (res.ok) toast.success("Đã cập nhật trạng thái xuất bản");
      else toast.error("Lỗi khi cập nhật");
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await deleteHonorAction(id);
      if (res.ok) {
        toast.success("Đã xoá nhân sự");
        setDeleteId(null);
      } else {
        toast.error(res.error || "Lỗi khi xoá");
      }
    });
  };

  if (honors.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        <p>Chưa có nhân sự nào được vinh danh.</p>
        <Link href="/honors/new" className="mt-2 inline-block text-primary hover:underline">
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
              <th className="px-4 py-3">Họ tên / Chức danh</th>
              <th className="px-4 py-3">Danh hiệu</th>
              <th className="px-4 py-3">Quý/Năm</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3 text-center">Featured</th>
              <th className="px-4 py-3 text-center">Published</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {honors.map((honor) => {
              const meta = CATEGORY_META[honor.category as HonorCategory];
              return (
                <tr key={honor.id} className="hover:bg-muted">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground">{honor.fullName}</p>
                    <p className="text-xs text-muted-foreground">{honor.jobTitle}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: meta.bgColor, color: meta.textColor }}
                    >
                      {meta.title}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground">{honor.awardQuarter || "-"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{honor.displayOrder}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleFeatured(honor.id)}
                      disabled={isPending}
                      className="inline-flex items-center justify-center rounded p-1 hover:bg-muted disabled:opacity-50"
                      title={honor.isFeatured ? "Bỏ Featured" : "Đặt làm Person of the Month"}
                    >
                      <Star
                        className={`h-5 w-5 ${ honor.isFeatured ? "fill-primary text-primary" : "text-muted-foreground" }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleTogglePublished(honor.id)}
                      disabled={isPending}
                      className="inline-flex items-center justify-center rounded p-1 hover:bg-muted disabled:opacity-50"
                    >
                      {honor.isPublished ? (
                        <Eye className="h-5 w-5 text-state-success-ink" />
                      ) : (
                        <EyeOff className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        href={`/vinh-danh/${honor.slug}`}
                        target="_blank"
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                        title="Xem public"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <Link
                        href={`/honors/${honor.id}/edit`}
                        className="rounded p-1.5 text-state-info-ink hover:bg-state-info-soft"
                        title="Sửa"
                      >
                        <Edit className="h-4 w-4" />
                      </Link>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            if (deleteId === honor.id) handleDelete(honor.id);
                            else setDeleteId(honor.id);
                          }}
                          disabled={isPending}
                          className={`rounded p-1.5 ${ deleteId === honor.id ? "bg-state-danger-soft text-state-danger-ink" : "text-state-danger-ink hover:bg-state-danger-soft" }`}
                          title={deleteId === honor.id ? "Xác nhận xoá" : "Xoá"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}
