"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Honor, Department } from "@prisma/client";
import { FieldLabel, HelpHint } from "@/components/admin/ui/help-hint";
import {
  createHonorAction,
  updateHonorAction,
} from "@/app/(admin)/admin/honors/actions";

interface EmployeeOption {
  id: string;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  department: Department;
  avatarUrl: string | null;
  joinedAt: Date | null;
}

interface Props {
  mode: "create" | "edit";
  initial?: Honor;
  employees: EmployeeOption[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function computeYears(joinedAt: Date | null): number | "" {
  if (!joinedAt) return "";
  const months = (Date.now() - new Date(joinedAt).getTime()) / (1000 * 60 * 60 * 24 * 30);
  return Math.max(0, Math.floor(months / 12));
}

const CATEGORIES = [
  { value: "SPARK", label: "⚡ Spark — Tia sáng đột phá" },
  { value: "GROWTH", label: "🌱 Growth — Phát triển vượt bậc" },
  { value: "IMPACT", label: "🚀 Impact — Dấu ấn cộng đồng" },
  { value: "GRAND_CHAMPION", label: "👑 Grand Champion — Đỉnh cao toàn diện" },
];

export function HonorForm({ mode, initial, employees }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [jobTitleAtTime, setJobTitleAtTime] = useState(initial?.jobTitleAtTime ?? "");
  const [yearsAtTime, setYearsAtTime] = useState<number | "">(
    initial?.yearsAtTime ?? "",
  );

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  function handleEmployeeChange(newId: string) {
    setEmployeeId(newId);
    const emp = employees.find((e) => e.id === newId);
    if (!emp) return;

    // Auto-fill nếu chưa có giá trị
    if (mode === "create" || !jobTitleAtTime) {
      setJobTitleAtTime(emp.jobTitle);
    }
    if (mode === "create" || yearsAtTime === "") {
      setYearsAtTime(computeYears(emp.joinedAt));
    }
    // Auto-suggest slug
    if (mode === "create" && !slug && emp.fullName) {
      setSlug(`${slugify(emp.fullName)}-${new Date().getFullYear()}`);
    }
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!employeeId) {
      toast.error("Vui lòng chọn nhân sự");
      return;
    }

    const form = new FormData(e.currentTarget);
    const input = {
      slug,
      employeeId,
      jobTitleAtTime: jobTitleAtTime || null,
      yearsAtTime: yearsAtTime === "" ? null : Number(yearsAtTime),
      category: form.get("category") as string,
      awardName: form.get("awardName") as string,
      awardedAt: form.get("awardedAt") as string,
      awardQuarter: (form.get("awardQuarter") as string) || null,
      story: form.get("story") as string,
      shortBio: (form.get("shortBio") as string) || null,
      pullQuote: (form.get("pullQuote") as string) || null,
      achievements: (form.get("achievements") as string) || null,
      isFeatured: form.get("isFeatured") === "on",
      isPublished: form.get("isPublished") === "on",
      displayOrder: Number(form.get("displayOrder") || 0),
    };

    startTransition(async () => {
      const res =
        mode === "create"
          ? await createHonorAction(input)
          : await updateHonorAction(initial!.id, input);

      if (res.ok) {
        toast.success(mode === "create" ? "Đã tạo vinh danh" : "Đã cập nhật");
        router.push("/honors");
        router.refresh();
      } else {
        toast.error(res.error || "Có lỗi xảy ra");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ─── Step 1: Chọn nhân sự ─── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-bold">
          <span className="text-primary">1.</span> Chọn nhân sự được vinh danh
        </h2>

        <div>
          <label className="mb-1 block text-sm font-semibold">Nhân sự *</label>
          <select
            required
            value={employeeId}
            onChange={(e) => handleEmployeeChange(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="">— Chọn nhân sự —</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                [{emp.employeeCode}] {emp.fullName} — {emp.jobTitle} ·{" "}
                {emp.department.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Chưa có nhân sự?{" "}
            <a
              href="/nhan-su/new"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Thêm nhân sự mới ↗
            </a>
          </p>
        </div>

        {selectedEmployee && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-primary-soft bg-primary-soft p-3">
            {selectedEmployee.avatarUrl ? (
              <img
                src={selectedEmployee.avatarUrl}
                alt={selectedEmployee.fullName}
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">
                {selectedEmployee.fullName.charAt(0)}
              </div>
            )}
            <div className="flex-1 text-sm">
              <p className="font-semibold">{selectedEmployee.fullName}</p>
              <p className="text-xs text-muted-foreground">
                {selectedEmployee.jobTitle} · {selectedEmployee.department.replace(/_/g, " ")}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ─── Step 2: Snapshot tại thời điểm trao giải ─── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-bold">
          <span className="text-primary">2.</span> Snapshot lúc trao giải
          <HelpHint className="ml-1">
            Lưu lại chức danh + số năm gắn bó tại thời điểm trao giải (giữ history nếu
            nhân sự đổi chức sau này).
          </HelpHint>
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel
              label="Chức danh lúc đó"
              hint="Để trống = dùng chức danh hiện tại của nhân sự"
            />
            <input
              value={jobTitleAtTime}
              onChange={(e) => setJobTitleAtTime(e.target.value)}
              placeholder={selectedEmployee?.jobTitle || "Chức danh khi trao giải"}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Số năm gắn bó lúc đó</label>
            <input
              type="number"
              min={0}
              value={yearsAtTime}
              onChange={(e) =>
                setYearsAtTime(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* ─── Step 3: Danh hiệu ─── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-bold">
          <span className="text-primary">3.</span> Danh hiệu
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-semibold">Hạng mục *</label>
            <select
              name="category"
              required
              defaultValue={initial?.category || "SPARK"}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Slug *</label>
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="ten-award-quy"
              pattern="[a-z0-9-]+"
              className="w-full rounded-lg border border-border px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-xs text-muted-foreground">/vinh-danh/{slug || "..."}</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Tên giải thưởng *</label>
            <input
              name="awardName"
              required
              defaultValue={initial?.awardName}
              placeholder="Grand Champion 2026 Q1"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Ngày trao giải *</label>
            <input
              name="awardedAt"
              type="date"
              required
              defaultValue={
                initial?.awardedAt
                  ? new Date(initial.awardedAt).toISOString().slice(0, 10)
                  : ""
              }
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Quý / Năm</label>
            <input
              name="awardQuarter"
              defaultValue={initial?.awardQuarter ?? ""}
              placeholder="Q1/2026"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Display order</label>
            <input
              name="displayOrder"
              type="number"
              defaultValue={initial?.displayOrder ?? 0}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* ─── Step 4: Nội dung ─── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-bold">
          <span className="text-primary">4.</span> Nội dung
        </h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold">Tóm tắt (shortBio)</label>
            <textarea
              name="shortBio"
              rows={2}
              maxLength={280}
              defaultValue={initial?.shortBio ?? ""}
              placeholder="1-2 câu hiển thị trong card (tối đa 280 ký tự)"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Pull quote</label>
            <textarea
              name="pullQuote"
              rows={2}
              maxLength={500}
              defaultValue={initial?.pullQuote ?? ""}
              placeholder="Câu trích dẫn nhân sự tự nói"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">
              Câu chuyện đầy đủ (Markdown) *
            </label>
            <textarea
              name="story"
              rows={10}
              required
              defaultValue={initial?.story}
              placeholder="2-5 đoạn kể câu chuyện. Hỗ trợ Markdown."
              className="w-full rounded-lg border border-border px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">
              Thành tựu (Markdown bullets)
            </label>
            <textarea
              name="achievements"
              rows={5}
              defaultValue={initial?.achievements ?? ""}
              placeholder={`- Thành tựu 1\n- Thành tựu 2`}
              className="w-full rounded-lg border border-border px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* ─── Step 5: Trạng thái ─── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-bold">
          <span className="text-primary">5.</span> Trạng thái
        </h2>

        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="isFeatured"
              defaultChecked={initial?.isFeatured ?? false}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm font-semibold">
              Person of the Month
              <HelpHint className="ml-1">
                Hiển thị spotlight ở /vinh-danh. Chỉ 1 honor được featured tại 1 thời
                điểm.
              </HelpHint>
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="isPublished"
              defaultChecked={initial?.isPublished ?? true}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm font-semibold">
              Published
              <HelpHint className="ml-1">Bỏ tick để ẩn khỏi public site.</HelpHint>
            </span>
          </label>
        </div>
      </section>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {isPending
            ? "Đang lưu..."
            : mode === "create"
              ? "Tạo vinh danh"
              : "Cập nhật"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/honors")}
          disabled={isPending}
          className="rounded-lg border border-border px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}
