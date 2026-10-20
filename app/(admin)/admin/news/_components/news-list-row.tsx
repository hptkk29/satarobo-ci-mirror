"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Pencil, Trash2, Eye } from "lucide-react";
import { deleteNews, toggleNewsPublished } from "../_actions";
import { formatDateVN } from "@/lib/format/date";

type Row = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  isPublished: boolean;
  isFeatured: boolean;
  publishedAt: Date | null;
};

export function NewsListRow({ news }: { news: Row }) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`Xoá bài viết "${news.title}"?\nHành động này không thể hoàn tác.`)) return;
    startTransition(async () => {
      const res = await deleteNews(news.id);
      if (res?.error) alert(res.error);
    });
  }

  function handleTogglePublish() {
    startTransition(async () => {
      const res = await toggleNewsPublished(news.id, !news.isPublished);
      if (res?.error) alert(res.error);
    });
  }

  return (
    <tr className="border-b border-border hover:bg-muted">
      <td className="p-4">
        <div className="font-bold text-foreground">{news.title}</div>
        <div className="mt-0.5 font-mono text-xs text-muted-foreground">/tin-tuc/{news.slug}</div>
      </td>
      <td className="p-4">
        {news.category ? (
          <span className="inline-block rounded bg-primary-soft px-2 py-1 text-xs font-medium text-primary">
            {news.category}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-4 text-center">
        <button
          type="button"
          onClick={handleTogglePublish}
          disabled={pending}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition disabled:opacity-50 ${ news.isPublished ? "bg-state-success-soft text-state-success-ink hover:bg-state-success-soft" : "bg-muted text-muted-foreground hover:bg-muted" }`}
        >
          {news.isPublished ? "Đã đăng" : "Nháp"}
        </button>
        {news.isFeatured && (
          <span className="ml-1 inline-block rounded-full bg-state-warning-soft px-2 py-1 text-xs font-bold text-state-warning-ink">
            ★
          </span>
        )}
      </td>
      <td className="p-4 text-sm text-muted-foreground">
        {news.publishedAt ? formatDateVN(news.publishedAt) : "—"}
      </td>
      <td className="p-4 text-right">
        <div className="inline-flex items-center gap-1">
          {news.isPublished && (
            <Link
              href={`/tin-tuc/${news.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1.5 text-state-info-ink hover:bg-state-info-soft"
              title="Xem bài"
            >
              <Eye className="h-4 w-4" />
            </Link>
          )}
          <Link
            href={`/news/${news.id}/edit`}
            className="rounded p-1.5 text-primary hover:bg-primary-soft"
            title="Sửa"
          >
            <Pencil className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="rounded p-1.5 text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-50"
            title="Xoá"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
