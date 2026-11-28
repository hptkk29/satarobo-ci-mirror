"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageUploader } from "@/components/admin/ImageUploader";
import { saveSiteContentAction } from "./actions";

type FieldType = "text" | "textarea" | "avatar";

interface PageMeta {
  pageKey: string;
  label: string;
}

interface Field {
  key: string;
  label: string;
  type: FieldType;
}

interface Props {
  pages: PageMeta[];
  fields: Field[];
  initialContent: Record<string, Record<string, string>>;
}

export function SiteContentClient({ pages, fields, initialContent }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activePage, setActivePage] = useState(pages[0].pageKey);
  const [content, setContent] = useState(initialContent);

  const current = content[activePage] || {};

  const update = (contentKey: string, value: string) => {
    setContent((prev) => ({
      ...prev,
      [activePage]: { ...prev[activePage], [contentKey]: value },
    }));
  };

  const save = (contentKey: string) => {
    const value = current[contentKey] ?? "";
    startTransition(async () => {
      const res = await saveSiteContentAction({
        pageKey: activePage,
        contentKey,
        contentValue: value,
      });
      if (res.ok) {
        toast.success(value ? "Đã lưu" : "Đã reset về mặc định");
        router.refresh();
      } else {
        toast.error(res.error || "Lỗi");
      }
    });
  };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* Sidebar: page list */}
      <aside className="md:w-64 shrink-0">
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {pages.map((p) => {
            const isActive = activePage === p.pageKey;
            const hasOverride = Object.keys(content[p.pageKey] || {}).length > 0;
            return (
              <button
                key={p.pageKey}
                type="button"
                onClick={() => setActivePage(p.pageKey)}
                className={`w-full text-left px-4 py-3 text-sm border-b border-border last:border-b-0 transition-colors ${ isActive ? "bg-primary-soft text-primary font-semibold border-l-2 border-primary" : "text-foreground hover:bg-muted" }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{p.label}</span>
                  {hasOverride && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-normal mt-0.5">
                  /{p.pageKey === "home" ? "" : p.pageKey}
                </p>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Edit panel */}
      <div className="flex-1 space-y-4">
        {fields.map((field) => {
          const value = current[field.key] ?? "";
          return (
            <div
              key={field.key}
              className="bg-card border border-border rounded-xl p-5"
            >
              <label className="block text-sm font-semibold text-foreground mb-2">
                {field.label}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({field.key})
                </span>
              </label>

              {field.type === "text" && (
                <input
                  type="text"
                  value={value}
                  onChange={(e) => update(field.key, e.target.value)}
                  placeholder="Để trống = dùng mặc định"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              )}

              {field.type === "textarea" && (
                <textarea
                  rows={3}
                  value={value}
                  onChange={(e) => update(field.key, e.target.value)}
                  placeholder="Để trống = dùng mặc định"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              )}

              {field.type === "avatar" && (
                <ImageUploader
                  value={value}
                  onChange={(url) => update(field.key, url ?? "")}
                  prefix="uploads/images"
                  aspect="video"
                />
              )}

              <div className="flex justify-end mt-3">
                <button
                  type="button"
                  onClick={() => save(field.key)}
                  disabled={isPending}
                  className="rounded bg-primary hover:bg-primary-dark px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                >
                  {isPending ? "Đang lưu..." : "Lưu"}
                </button>
              </div>
            </div>
          );
        })}

        <div className="bg-state-info-soft border border-state-info-soft rounded-xl p-4 text-sm text-state-info-ink">
          <p className="font-semibold mb-1">💡 Lưu ý:</p>
          <ul className="list-disc list-inside text-state-info-ink space-y-1">
            <li>Để trống ô và bấm Lưu → reset về giá trị mặc định.</li>
            <li>Public page tự revalidate sau khi lưu.</li>
            <li>Ảnh upload qua R2 (max 10MB, JPG/PNG/WebP/GIF/SVG).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
