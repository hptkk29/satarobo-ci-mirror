"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { createPackage, updatePackage } from "../_actions";
import {
  JsonArrayEditor,
  type JsonArrayItem,
  type JsonObjectItem,
} from "./json-array-editor";
import { ImageUploader } from "@/components/admin/ImageUploader";
import { MoneyInput } from "@/components/ui/money-input";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { FaqEditor, type FaqItem } from "./faq-editor";

type PackageFormValue = {
  id: string;
  slug: string;
  code: string;
  name: string;
  shortName: string | null;
  subtitle: string | null;
  shortDescription: string | null;
  description: string | null;
  ageGroup: string | null;
  level: string | null;
  lessons: number | null;
  duration: string | null;
  priceOriginal: number | null;
  priceEarlyBird: number | null;
  priceMember: number | null;
  features: Prisma.JsonValue;
  highlights: Prisma.JsonValue;
  curriculum: Prisma.JsonValue;
  badge: string | null;
  color: string | null;
  displayOrder: number;
  isPublished: boolean;
  isFeatured: boolean;
  thumbnail: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  parentCourseSlug: string | null;
  // FL1-05 — khoá dạy liên kết
  courseId: string | null;
  // Phase TD-1 — Detail content
  audienceTag: string | null;
  audienceDescription: string | null;
  mission: string | null;
  outcomesJson: Prisma.JsonValue;
  methodsJson: Prisma.JsonValue;
  conditionsJson: Prisma.JsonValue;
  noteForParents: string | null;
  faqsJson: Prisma.JsonValue;
};

function normalizeStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function normalizeFaqArray(value: Prisma.JsonValue): FaqItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is { question: string; answer: string } =>
        typeof v === "object" &&
        v !== null &&
        !Array.isArray(v) &&
        "question" in v &&
        "answer" in v &&
        typeof (v as Record<string, unknown>).question === "string" &&
        typeof (v as Record<string, unknown>).answer === "string",
    )
    .map((v) => ({ question: v.question, answer: v.answer }));
}

/** FL1-05 — khoá dạy có thể liên kết (đổ vào dropdown). */
export type LinkableCourse = { id: string; name: string; code: string | null; slug: string };

interface PackageFormProps {
  pkg?: PackageFormValue;
  /** Danh sách khoá dạy để chọn liên kết (FL1-05). */
  courses?: LinkableCourse[];
  /** R2-LMS-1 — prefill khoá dạy khi tạo gói từ chi tiết khoá (?courseId=). */
  defaultCourseId?: string | null;
}

type FieldProps = {
  label: string;
  name: string;
  /** `money` = ô tiền có chấm phân cách; vẫn submit số trần như `number`. */
  type?: "text" | "number" | "textarea" | "money";
  rows?: number;
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
};

const LEVEL_OPTIONS = [
  "Nhap mon",
  "So cap",
  "Co ban",
  "Trung cap",
  "Kha",
  "Cao cap",
  "Chuyen binh thi dau",
  "Combo",
];

const COLOR_OPTIONS = ["orange", "purple", "green", "blue", "amber", "indigo", "teal", "red"];
const PARENT_COURSE_OPTIONS = ["laptrinhrobot", "luyenthirobosim"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPrimitive(value: unknown): string | number | boolean | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return String(value ?? "");
}

function normalizeJsonArray(value: Prisma.JsonValue): JsonArrayItem[] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    if (typeof item === "string") return item;
    if (!isRecord(item)) return String(item ?? "");

    return Object.fromEntries(
      Object.entries(item).map(([key, fieldValue]) => [key, toPrimitive(fieldValue)]),
    ) as JsonObjectItem;
  });
}

export function PackageForm({ pkg, courses = [], defaultCourseId }: PackageFormProps) {
  const router = useRouter();
  const isEdit = Boolean(pkg);
  const [error, setError] = useState<string | null>(null);
  // FL1-05 — khoá dạy liên kết (điều khiển để hiện banner "giáo trình lấy từ khoá").
  // R2-LMS-1 — khi tạo từ chi tiết khoá: prefill courseId (chỉ khi tạo mới).
  const [courseId, setCourseId] = useState<string>(pkg?.courseId ?? defaultCourseId ?? "");
  const linkedCourse = courses.find((c) => c.id === courseId);
  const [features, setFeatures] = useState<JsonArrayItem[]>(
    normalizeJsonArray(pkg?.features ?? []),
  );
  const [highlights, setHighlights] = useState<JsonArrayItem[]>(
    normalizeJsonArray(pkg?.highlights ?? []),
  );
  const [curriculum, setCurriculum] = useState<JsonArrayItem[]>(
    normalizeJsonArray(pkg?.curriculum ?? []),
  );
  const [thumbnail, setThumbnail] = useState<string | null>(pkg?.thumbnail ?? null);
  // Phase TD-1 — Detail content state
  const [outcomes, setOutcomes] = useState<JsonArrayItem[]>(
    normalizeStringArray(pkg?.outcomesJson ?? []),
  );
  const [methods, setMethods] = useState<JsonArrayItem[]>(
    normalizeStringArray(pkg?.methodsJson ?? []),
  );
  const [conditions, setConditions] = useState<JsonArrayItem[]>(
    normalizeStringArray(pkg?.conditionsJson ?? []),
  );
  const [faqs, setFaqs] = useState<FaqItem[]>(
    normalizeFaqArray(pkg?.faqsJson ?? []),
  );

  const action = async (formData: FormData) => {
    setError(null);
    formData.set("features", JSON.stringify(features));
    formData.set("highlights", JSON.stringify(highlights));
    formData.set("curriculum", JSON.stringify(curriculum));
    formData.set("outcomesJson", JSON.stringify(outcomes));
    formData.set("methodsJson", JSON.stringify(methods));
    formData.set("conditionsJson", JSON.stringify(conditions));
    formData.set(
      "faqsJson",
      JSON.stringify(
        faqs.filter((f) => f.question.trim() && f.answer.trim()),
      ),
    );

    const result = pkg
      ? await updatePackage(pkg.id, formData)
      : await createPackage(formData);

    if (result?.error) {
      setError(result.error);
    }
  };

  return (
    <form action={action} className="max-w-4xl space-y-6">
      {error ? (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm font-medium text-state-danger-ink">
          {error}
        </div>
      ) : null}

      <Section title="Thông tin cơ bản">
        <Grid cols={2}>
          <Field
            label="Code (Sata1, Sata2, ...)"
            name="code"
            defaultValue={pkg?.code}
            required
            readOnly={isEdit}
          />
          <Field
            label="Slug"
            name="slug"
            defaultValue={pkg?.slug}
            placeholder="Tự tạo từ mã"
          />
        </Grid>

        <Field label="Tên" name="name" defaultValue={pkg?.name} required />
        <Field label="Tên ngắn" name="shortName" defaultValue={pkg?.shortName} />
        <Field label="Phụ đề" name="subtitle" defaultValue={pkg?.subtitle} />
        <Field
          label="Mô tả ngắn"
          name="shortDescription"
          type="textarea"
          rows={2}
          defaultValue={pkg?.shortDescription}
        />
        <Field
          label="Mô tả"
          name="description"
          type="textarea"
          rows={6}
          defaultValue={pkg?.description}
        />
      </Section>

      <Section title="Đối tượng và cấp độ">
        <Grid cols={2}>
          <Field
            label="Nhóm tuổi"
            name="ageGroup"
            defaultValue={pkg?.ageGroup}
            placeholder="Lớp 1-8"
          />
          <SelectField label="Cấp độ" name="level" defaultValue={pkg?.level} options={LEVEL_OPTIONS} />
        </Grid>
      </Section>

      <Section title="Lịch và giá">
        <Grid cols={2}>
          <Field label="Số buổi" name="lessons" type="number" defaultValue={pkg?.lessons} />
          <Field
            label="Thời lượng"
            name="duration"
            defaultValue={pkg?.duration}
            placeholder="2 tháng"
          />
        </Grid>
        <Grid cols={3}>
          <Field
            label="Giá niêm yết (VND)"
            name="priceOriginal"
            type="money"
            defaultValue={pkg?.priceOriginal}
          />
          <Field
            label="Giá ưu đãi sớm (VND)"
            name="priceEarlyBird"
            type="money"
            defaultValue={pkg?.priceEarlyBird}
          />
          <Field
            label="Giá hội viên (VND)"
            name="priceMember"
            type="money"
            defaultValue={pkg?.priceMember}
          />
        </Grid>
      </Section>

      <Section title="Tính năng (JSON)">
        <JsonArrayEditor
          value={features}
          onChange={setFeatures}
          template={{ icon: "", title: "", desc: "" }}
          placeholder="Bấm Thêm để thêm tính năng"
        />
      </Section>

      <Section title="Điểm nổi bật (JSON)">
        <JsonArrayEditor
          value={highlights}
          onChange={setHighlights}
          template=""
          type="string"
          placeholder="Bấm Thêm để thêm điểm nổi bật"
        />
      </Section>

      <Section title="Giáo trình">
        {linkedCourse ? (
          <div className="rounded-lg border border-state-info-soft bg-state-info-soft px-4 py-3 text-sm text-state-info-ink">
            Giáo trình hiển thị lấy từ khoá dạy liên kết:{" "}
            <strong>{linkedCourse.name}</strong>
            {linkedCourse.code ? ` (${linkedCourse.code})` : ""}. JSON dưới đây giữ làm
            dữ liệu cũ (fallback) — chưa xoá.
          </div>
        ) : null}
        <JsonArrayEditor
          value={curriculum}
          onChange={setCurriculum}
          template={{ topic: "", lessons: 0 }}
          placeholder="Bấm Thêm để thêm chủ đề"
        />
      </Section>

      <Section title="Hiển thị">
        <Grid cols={3}>
          <Field label="Badge" name="badge" defaultValue={pkg?.badge} />
          <SelectField label="Màu" name="color" defaultValue={pkg?.color} options={COLOR_OPTIONS} />
          <Field
            label="Thứ tự hiển thị"
            name="displayOrder"
            type="number"
            defaultValue={pkg?.displayOrder ?? 0}
          />
        </Grid>
        <div className="flex flex-wrap gap-6">
          <CheckboxField label="Đã đăng" name="isPublished" defaultChecked={pkg?.isPublished} />
          <CheckboxField label="Nổi bật" name="isFeatured" defaultChecked={pkg?.isFeatured} />
        </div>
      </Section>

      <Section title="Hình ảnh">
        <ImageUploader
          label="Ảnh đại diện"
          value={thumbnail}
          onChange={setThumbnail}
          prefix="uploads/courses"
          aspect="video"
        />
        <input type="hidden" name="thumbnail" value={thumbnail ?? ""} />
      </Section>

      <Section title="SEO">
        <Field label="Tiêu đề SEO" name="seoTitle" defaultValue={pkg?.seoTitle} />
        <Field
          label="Mô tả SEO"
          name="seoDescription"
          type="textarea"
          rows={2}
          defaultValue={pkg?.seoDescription}
        />
      </Section>

      {/* FL1-05 — gắn gói BÁN với khoá DẠY (Course) để gỡ "trùng" gói/khoá. */}
      <Section title="Khoá dạy liên kết (chương trình giảng)">
        {/* Bọc bằng <div> chứ không phải <label> nữa: nút "?" cũng là phần tử gắn nhãn
            được, đứng trong <label> thì nó CƯỚP nhãn của <select> (nhãn tính theo phần
            tử gắn-nhãn đầu tiên). Dùng htmlFor để giữ đúng liên kết nhãn ↔ ô chọn. */}
        <div className="space-y-1.5">
          <span className="flex items-center text-sm font-medium text-foreground">
            <label htmlFor="pkg-course-id">
              Khoá dạy (Course) cung cấp giáo trình cho gói này
            </label>
            <HelpHint className="ml-1">
              Gói = đơn vị BÁN (giá, marketing). Khoá dạy = đơn vị GIẢNG (chương
              trình). Liên kết để mỗi gói trỏ đúng khoá dạy, tránh trùng lặp. Giá vẫn
              lấy từ gói — không đổi.
            </HelpHint>
          </span>
          <select
            id="pkg-course-id"
            name="courseId"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">-- Không liên kết (dùng giáo trình JSON) --</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.code ? ` (${c.code})` : ""}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Khoá cha (landing marketing)">
        <SelectField
          label="Slug khoá cha"
          name="parentCourseSlug"
          defaultValue={pkg?.parentCourseSlug}
          options={PARENT_COURSE_OPTIONS}
        />
      </Section>

      {/* Phase TD-1 — Detail content cho /khoa-hoc/[slug] */}
      <Section title="Nội dung trang chi tiết khóa học">
        <Field
          label="Đối tượng (badge ngắn — VD: Học sinh Lớp 1-8)"
          name="audienceTag"
          defaultValue={pkg?.audienceTag}
          placeholder="VD: Học sinh Lớp 1-8"
        />
        <Field
          label="Mô tả đối tượng (1-2 câu)"
          name="audienceDescription"
          type="textarea"
          rows={2}
          defaultValue={pkg?.audienceDescription}
          placeholder="VD: Dành cho học sinh chuẩn bị thi vòng loại Robotics 2026..."
        />
        <Field
          label="Sứ mệnh khóa học (2-4 đoạn)"
          name="mission"
          type="textarea"
          rows={6}
          defaultValue={pkg?.mission}
          placeholder="Mô tả mục đích, đối tượng, giá trị mang lại..."
        />

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-foreground">
            Kết quả đạt được sau khi hoàn thành
          </label>
          <JsonArrayEditor
            value={outcomes}
            onChange={setOutcomes}
            template=""
            type="string"
            placeholder="Chưa có outcome nào"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-foreground">
            Phương pháp đào tạo (tuỳ chọn — cho khóa luyện thi)
          </label>
          <JsonArrayEditor
            value={methods}
            onChange={setMethods}
            template=""
            type="string"
            placeholder="Chưa có phương pháp nào"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-foreground">
            Điều kiện đặc biệt (tuỳ chọn — VD Sata8 cam kết hoàn tiền)
          </label>
          <JsonArrayEditor
            value={conditions}
            onChange={setConditions}
            template=""
            type="string"
            placeholder="Chưa có điều kiện nào"
          />
        </div>

        <Field
          label="Lưu ý cho phụ huynh (yellow alert)"
          name="noteForParents"
          type="textarea"
          rows={3}
          defaultValue={pkg?.noteForParents}
          placeholder="VD: Khóa này nên kết hợp với Sata2..."
        />

        <div>
          {/* <span> chứ không <label>: khối này không có ô nhập nào để gắn nhãn, mà
              trong nó lại có nút "?" — để <label> thì nút hoá thành "ô" được gắn nhãn. */}
          <span className="mb-1.5 flex items-center text-sm font-semibold text-foreground">
            FAQ riêng cho khóa này
            <HelpHint className="ml-1">
              Mỗi FAQ là 1 cặp question/answer. Sẽ render trong section &ldquo;Câu hỏi
              thường gặp&rdquo; trên trang chi tiết.
            </HelpHint>
          </span>
          <FaqEditor value={faqs} onChange={setFaqs} />
        </div>
      </Section>

      <div className="flex gap-3 border-t border-border pt-6">
        <SubmitButton isEdit={isEdit} />
        <button
          type="button"
          onClick={() => router.push("/course-packages")}
          className="rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Huy
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 className="border-b border-border pb-3 text-base font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ cols, children }: { cols: 2 | 3; children: React.ReactNode }) {
  const classes = cols === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2";
  return <div className={`grid ${classes} gap-4`}>{children}</div>;
}

function Field({
  label,
  name,
  type = "text",
  rows,
  defaultValue,
  ...props
}: FieldProps) {
  const inputClasses =
    "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted";

  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {type === "textarea" ? (
        <textarea
          name={name}
          rows={rows || 3}
          defaultValue={defaultValue ?? ""}
          className={inputClasses}
          {...props}
        />
      ) : type === "money" ? (
        // Chỉ đắp thêm `disabled:bg-muted`: class nền của MoneyInput đã trùng
        // `inputClasses`, mà truyền cả chuỗi thì `px-3` trong đó sẽ ăn mất `pr-8`
        // MoneyInput chừa cho chữ "đ" (class truyền vào được ghép sau).
        <MoneyInput
          name={name}
          defaultValue={defaultValue}
          min={0}
          className="disabled:bg-muted"
          {...props}
        />
      ) : (
        <input
          type={type}
          name={name}
          defaultValue={defaultValue ?? ""}
          className={inputClasses}
          {...props}
        />
      )}
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: string[];
  defaultValue?: string | null;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        <option value="">-- Chon --</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
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
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-5 w-5 rounded border-border text-primary focus:ring-primary"
      />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </label>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo mới"}
    </button>
  );
}
