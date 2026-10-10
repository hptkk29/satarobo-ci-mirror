"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  Cake,
  School,
  HeartPulse,
  BookOpen,
  TriangleAlert,
  Sparkles,
  IdCard,
  Users,
  GraduationCap,
} from "lucide-react";
import { SKILL_LABEL, LEVEL_LABEL } from "@/lib/lms/skills";
import type { SkillLevel } from "@prisma/client";
import type { ChildDetail } from "@/lib/portal/child-detail";
import { updateChildProfile } from "@/app/(portal)/portal/ho-so-con/chi-tiet/actions";
import { MediaConsentToggle } from "@/components/portal/media-consent-toggle";

const LEVEL_CLS: Record<SkillLevel, string> = {
  NEED_SUPPORT: "bg-destructive/10 text-destructive",
  BASIC: "bg-caution/10 text-caution",
  GOOD: "bg-info/10 text-info",
  EXCELLENT: "bg-success/10 text-success",
};

function initials(n: string): string {
  const w = n
    .trim()
    .split(/\s+/)
    .filter((x) => /\p{L}/u.test(x[0] ?? ""));
  return (
    w
      .slice(-2)
      .map((x) => x[0])
      .join("") || "HS"
  ).toUpperCase();
}
function dateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputCls =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium text-foreground outline-none focus:border-primary/60";

export function ChildDetailPage({ data }: { data: ChildDetail }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [dob, setDob] = useState(dateInput(data.dateOfBirth));
  const [gender, setGender] = useState<string>(data.gender ?? "");
  const [grade, setGrade] = useState<string>(
    data.currentGrade ? String(data.currentGrade) : "",
  );
  const [school, setSchool] = useState(data.school ?? "");
  const [health, setHealth] = useState(data.healthNotes ?? "");
  const [allergies, setAllergies] = useState((data.allergies ?? []).join(", "));

  function save() {
    start(async () => {
      const res = await updateChildProfile({
        dateOfBirth: dob,
        gender: gender || null,
        currentGrade: grade ? Number(grade) : null,
        school,
        healthNotes: health,
        allergies: allergies
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      });
      if (res.ok) {
        toast.success("Đã lưu hồ sơ con");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi lưu hồ sơ");
    });
  }

  return (
    <div className="portal-v2 mx-auto w-full max-w-4xl space-y-6">
      <Link
        href="/portal/ho-so-con"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Các con
      </Link>

      {/* Header con */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent text-lg font-bold text-accent-foreground">
            {initials(data.name)}
          </span>
          <div>
            <h1 className="text-xl font-bold text-foreground">{data.name}</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <IdCard className="size-4" />{" "}
              {data.studentCode ?? "Chưa có mã HV"}
            </p>
          </div>
        </div>
        <MediaConsentToggle
          studentId={data.id}
          studentName={data.name}
          consentGranted={data.mediaConsent}
        />
      </div>

      {/* Thông tin sửa được */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-foreground">
          Thông tin học viên
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Mã học viên, lớp và khoá học do trung tâm quản lý. Phụ huynh có thể
          cập nhật các thông tin bên dưới.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field icon={Cake} label="Ngày sinh">
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field icon={Users} label="Giới tính">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={inputCls}
            >
              <option value="">— Chưa chọn —</option>
              <option value="MALE">Nam</option>
              <option value="FEMALE">Nữ</option>
              <option value="OTHER">Khác</option>
            </select>
          </Field>
          <Field icon={GraduationCap} label="Khối lớp (văn hoá)">
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className={inputCls}
            >
              <option value="">— Chưa chọn —</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                <option key={g} value={g}>
                  Lớp {g}
                </option>
              ))}
            </select>
          </Field>
          <Field icon={School} label="Trường">
            <input
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="Trường đang học"
              className={inputCls}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field icon={HeartPulse} label="Ghi chú sức khoẻ">
              <textarea
                value={health}
                onChange={(e) => setHealth(e.target.value)}
                rows={2}
                placeholder="Tình trạng sức khoẻ cần lưu ý (nếu có)"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field icon={TriangleAlert} label="Dị ứng (cách nhau bởi dấu phẩy)">
              <input
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="VD: Hải sản, Phấn hoa"
                className={inputCls}
              />
            </Field>
          </div>
          {/* 06/09 — GỠ ô "Ghi chú khác". Nó ghi thẳng vào `Student.notes`, tức ô GHI
              CHÚ NỘI BỘ của nhân viên: phụ huynh vừa đọc được ghi chú nội bộ về con
              mình, vừa xoá đè lên nó mỗi lần bấm Lưu. Muốn nhắn cho trung tâm thì đi
              qua /portal/yeu-cau — kênh có người nhận và có trạng thái xử lý. */}
          <div className="sm:col-span-2">
            <p className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <BookOpen className="mr-1.5 inline size-3.5 align-[-2px] text-primary" />
              Cần nhắn gì thêm cho trung tâm (đổi lịch, xin học bù, thắc mắc học phí)?
              Gửi ở mục{" "}
              <a
                href="/portal/yeu-cau"
                className="font-semibold text-primary underline underline-offset-2"
              >
                Yêu cầu
              </a>{" "}
              để có người tiếp nhận và trả lời.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Save className="size-4" /> {pending ? "Đang lưu…" : "Lưu thay đổi"}
          </button>
        </div>
      </section>

      {/* Lớp / khoá */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
          <BookOpen className="size-4 text-primary" /> Lớp / khoá đang học
        </h2>
        {data.classes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có lớp đang học.</p>
        ) : (
          <ul className="space-y-2">
            {data.classes.map((c) => (
              <li key={c.id} className="rounded-xl bg-muted/40 px-3 py-2.5">
                <p className="text-sm font-bold text-foreground">
                  {c.classCode ? `${c.classCode} · ` : ""}
                  {c.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.courseName}
                  {c.centerName ? ` · ${c.centerName}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Năng lực */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
          <Sparkles className="size-4 text-primary" /> Năng lực robotics
        </h2>
        {data.skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có đánh giá năng lực.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data.skills.map((s) => (
              <li
                key={s.skill}
                className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2.5"
              >
                <span className="text-sm font-medium text-foreground">
                  {SKILL_LABEL[s.skill]}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${LEVEL_CLS[s.level]}`}
                >
                  {LEVEL_LABEL[s.level]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Cake;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </span>
      {children}
    </label>
  );
}
