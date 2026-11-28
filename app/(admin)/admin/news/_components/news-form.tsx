"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { createNews, updateNews } from "../_actions";
import { MarkdownEditor } from "./markdown-editor";
import { ImageUploader } from "@/components/admin/ImageUploader";

export type NewsFormValue = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImage: string | null;
  category: string | null;
  tags: string[];
  isPublished: boolean;
  isFeatured: boolean;
  displayOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
};

interface NewsFormProps {
  news?: NewsFormValue;
}

export function NewsForm({ news }: NewsFormProps) {
  const router = useRouter();
  const isEdit = Boolean(news);

  const [content, setContent] = useState<string>(news?.content ?? "");
  const [coverImage, setCoverImage] = useState<string | null>(news?.coverImage ?? null);
  const [isContentImageUploading, setIsContentImageUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function action(formData: FormData) {
    if (isContentImageUploading) {
      setError("Vui lòng chờ upload ảnh trong nội dung hoàn tất trước khi lưu.");
      return;
    }
    setError(null);
    formData.set("content", content);
    const res = isEdit
      ? await updateNews(news!.id, formData)
      : await createNews(formData);
    if (res?.error) setError(res.error);
  }

  return (
    <form action={action} className="max-w-5xl space-y-6">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <Section title="Thông tin cơ bản">
        <Field
          label="Tiêu đề"
          name="title"
          defaultValue={news?.title}
          required
        />
        <Field
          label="Slug"
          name="slug"
          defaultValue={news?.slug}
          placeholder="auto từ tiêu đề nếu để trống"
        />
        <Field
          label="Excerpt (mô tả ngắn)"
          name="excerpt"
          defaultValue={news?.excerpt}
          type="textarea"
          rows={2}
          required
        />
      </Section>

      <Section title="Nội dung Markdown">
        <MarkdownEditor
          value={content}
          onChange={setContent}
          onUploadingChange={setIsContentImageUploading}
        />
      </Section>

      <Section title="Phân loại & hiển thị">
        <Grid cols={2}>
          <Field
            label="Danh mục"
            name="category"
            defaultValue={news?.category ?? undefined}
            placeholder="Tin công ty, Khoá học mới, ..."
          />
          <Field
            label="Tags (phân tách bằng dấu phẩy)"
            name="tags"
            defaultValue={news?.tags?.join(", ")}
            placeholder="Robotics, Đà Nẵng"
          />
        </Grid>
        <Grid cols={2}>
          <div>
            <ImageUploader
              label="Cover Image"
              value={coverImage}
              onChange={setCoverImage}
              prefix="uploads/news"
              aspect="video"
              helperText="Ảnh đại diện hiển thị ở /tin-tuc và OG image"
            />
            <input type="hidden" name="coverImage" value={coverImage ?? ""} />
          </div>
          <Field
            label="Display Order"
            name="displayOrder"
            type="number"
            defaultValue={news?.displayOrder ?? 0}
          />
        </Grid>
      </Section>

      <Section title="Trạng thái">
        <div className="flex gap-6">
          <CheckboxField
            label="Đã đăng (hiển thị công khai)"
            name="isPublished"
            defaultChecked={news?.isPublished}
          />
          <CheckboxField
            label="Featured (nổi bật)"
            name="isFeatured"
            defaultChecked={news?.isFeatured}
          />
        </div>
      </Section>

      <Section title="SEO (tùy chọn)">
        <Field
          label="SEO Title"
          name="seoTitle"
          defaultValue={news?.seoTitle ?? undefined}
        />
        <Field
          label="SEO Description"
          name="seoDescription"
          defaultValue={news?.seoDescription ?? undefined}
          type="textarea"
          rows={2}
        />
      </Section>

      <div className="flex gap-3 border-t border-border pt-6">
        <SubmitButton isEdit={isEdit} disabled={isContentImageUploading} />
        <button
          type="button"
          onClick={() => router.push("/news")}
          className="rounded-xl border-2 border-border bg-card px-6 py-3 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}

function SubmitButton({
  isEdit,
  disabled,
}: {
  isEdit: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:bg-primary-dark disabled:opacity-60"
    >
      {disabled ? "Đang tải ảnh..." : pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo bài"}
    </button>
  );
}

// ============== Helpers ==============

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-foreground">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Grid({
  children,
  cols = 2,
}: {
  children: React.ReactNode;
  cols?: 2 | 3;
}) {
  const grid = cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return <div className={`grid grid-cols-1 ${grid} gap-4`}>{children}</div>;
}

type FieldProps = {
  label: string;
  name: string;
  type?: "text" | "number" | "textarea";
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
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30"
      />
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </label>
  );
}
