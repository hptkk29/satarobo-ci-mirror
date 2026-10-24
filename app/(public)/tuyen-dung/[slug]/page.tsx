import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronRight,
  ArrowLeft,
  MapPin,
  Briefcase,
  DollarSign,
  Phone,
  Mail,
  Users,
  CalendarClock,
  Clock,
  GraduationCap,
} from "lucide-react";
import { db } from "@/lib/db";
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { SATA_ROBO_CONTACT } from "@/lib/locations";
import { HR_CONTACT } from "@/lib/data/job-options";
import { formatDateVN } from "@/lib/format/date";

export const revalidate = 300; // ISR_DETAIL — chi tiết tuyển dụng (convention list=60/detail=300, xem lib/isr.ts)

const BASE_URL = "https://satarobo.vn";
const DEFAULT_HR_EMAIL = SATA_ROBO_CONTACT.emails.recruitment;
// Liên hệ tuyển dụng = bộ phận HR (đặt tại CS1). Đây là contact người tuyển,
// không phải hotline chung của website.
const DEFAULT_HR_PHONE = HR_CONTACT.phone;

const EXPERIENCE_LABELS: Record<string, string> = {
  ENTRY: "Mới ra trường",
  JUNIOR: "1-2 năm kinh nghiệm",
  MID: "3-5 năm kinh nghiệm",
  SENIOR: "5+ năm kinh nghiệm",
  EXPERT: "Chuyên gia 10+ năm",
};

export async function generateStaticParams() {
  const jobs = await db.jobPosting
    .findMany({ where: { status: "OPEN" }, select: { slug: true } })
    .catch(() => []);
  return jobs.map((j) => ({ slug: j.slug }));
}

// PUB-08: dedup fetch giữa generateMetadata + page (cùng slug) trong 1 request.
const getJobBySlug = cache((slug: string) =>
  db.jobPosting.findUnique({ where: { slug } }).catch(() => null),
);

function summarize(text: string, max = 160): string {
  const stripped = text.replace(/\s+/g, " ").trim();
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

function formatSalary(j: {
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryNote: string | null;
}): string | null {
  if (j.salary) return j.salary;
  if (j.salaryMin && j.salaryMax) {
    return `${j.salaryMin.toLocaleString("vi-VN")} – ${j.salaryMax.toLocaleString("vi-VN")} VND`;
  }
  return j.salaryNote ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job || job.status !== "OPEN") return {};

  const description = summarize(job.description, 160);
  return {
    title: `${job.title} | Tuyển dụng Sata Robo`,
    description,
    alternates: { canonical: `${BASE_URL}/tuyen-dung/${slug}` },
    openGraph: {
      title: `${job.title} — Tuyển dụng Sata Robo`,
      description,
      type: "article",
      url: `${BASE_URL}/tuyen-dung/${slug}`,
    },
  };
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const job = await getJobBySlug(slug);
  if (!job || job.status !== "OPEN") notFound();

  const salaryLabel = formatSalary(job);
  const hrEmail = job.contactEmail ?? DEFAULT_HR_EMAIL;
  const hrPhone = job.contactPhone ?? DEFAULT_HR_PHONE;
  const hrPhoneTel = (job.contactPhone ?? HR_CONTACT.phoneRaw).replace(/\D/g, "");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: "Trang chủ", url: "/" },
              { name: "Tuyển dụng", url: "/tuyen-dung" },
              { name: job.title, url: `/tuyen-dung/${slug}` },
            ]),
          ),
        }}
      />

      <div className="bg-white border-b border-neutral-200 py-3">
        <div className="container mx-auto px-4 max-w-5xl">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-neutral-500">
            <Link href="/" className="hover:text-orange-600 transition-colors">
              Trang chủ
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href="/tuyen-dung" className="hover:text-orange-600 transition-colors">
              Tuyển dụng
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-neutral-800 font-medium line-clamp-1">{job.title}</span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-5xl py-10">
        <Link
          href="/tuyen-dung"
          className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-orange-600 transition mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Quay lại danh sách
        </Link>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <header className="bg-white rounded-2xl border border-neutral-200 p-6">
              {job.department && (
                <div className="text-xs font-bold uppercase tracking-wider text-purple-600 mb-2">
                  {job.department}
                </div>
              )}
              <h1 className="text-2xl md:text-3xl font-black text-neutral-900 mb-3">
                {job.title}
              </h1>

              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {job.location && <MetaRow icon={MapPin} label="Địa điểm" value={job.location} />}
                {job.type && <MetaRow icon={Briefcase} label="Hình thức" value={job.type} />}
                {job.workingHours && (
                  <MetaRow icon={Clock} label="Giờ làm việc" value={job.workingHours} />
                )}
                {job.experienceLevel && (
                  <MetaRow
                    icon={GraduationCap}
                    label="Kinh nghiệm"
                    value={EXPERIENCE_LABELS[job.experienceLevel] ?? job.experienceLevel}
                  />
                )}
                {salaryLabel && (
                  <MetaRow icon={DollarSign} label="Mức lương" value={salaryLabel} />
                )}
                {job.openings > 1 && (
                  <MetaRow icon={Users} label="Số lượng" value={`${job.openings} người`} />
                )}
                {job.closesAt && (
                  <MetaRow
                    icon={CalendarClock}
                    label="Hạn nộp"
                    value={formatDateVN(job.closesAt)}
                  />
                )}
              </div>
            </header>

            <JobSection title="Mô tả công việc" body={job.description} color="orange" />
            {job.responsibilities.length > 0 && (
              <JobBulletSection title="Trách nhiệm công việc" items={job.responsibilities} color="orange" />
            )}
            {job.requirements.length > 0 && (
              <JobBulletSection title="Yêu cầu ứng viên" items={job.requirements} color="purple" />
            )}
            {job.benefits.length > 0 && (
              <JobBulletSection title="Quyền lợi" items={job.benefits} color="green" />
            )}
          </div>

          <aside className="lg:col-span-1">
            <div className="bg-gradient-to-br from-orange-50 to-purple-50 rounded-2xl border-2 border-orange-200 p-6 sticky top-24">
              <h3 className="font-bold text-lg text-neutral-900 mb-3">Ứng tuyển ngay</h3>
              <p className="text-sm text-neutral-700 mb-5">
                Gửi CV qua email hoặc liên hệ trực tiếp HR Sata Robo
              </p>
              <a
                href={`mailto:${hrEmail}?subject=${encodeURIComponent(
                  `Ứng tuyển: ${job.title}`,
                )}`}
                className="block w-full text-center bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-3 rounded-xl transition-colors mb-3"
              >
                Gửi CV qua Email
              </a>
              <a
                href={`tel:${hrPhoneTel}`}
                className="block w-full text-center bg-white border-2 border-purple-300 text-purple-700 hover:bg-purple-50 font-bold px-4 py-3 rounded-xl transition-colors"
              >
                Gọi HR Sata Robo
              </a>

              <div className="mt-6 pt-6 border-t border-orange-200 space-y-2 text-sm">
                <p className="flex items-center gap-2 text-neutral-700">
                  <Mail className="w-4 h-4 text-orange-500 shrink-0" />
                  <a href={`mailto:${hrEmail}`} className="hover:text-orange-600 break-all">
                    {hrEmail}
                  </a>
                </p>
                <p className="flex items-center gap-2 text-neutral-700">
                  <Phone className="w-4 h-4 text-orange-500 shrink-0" />
                  <a href={`tel:${hrPhoneTel}`} className="hover:text-orange-600">
                    {hrPhone}
                  </a>
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 text-neutral-700">
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
      <div>
        <div className="text-xs text-neutral-500">{label}</div>
        <div className="font-semibold">{value}</div>
      </div>
    </div>
  );
}

const SECTION_COLOR: Record<"orange" | "purple" | "green", string> = {
  orange: "border-orange-200 bg-orange-50/40",
  purple: "border-purple-200 bg-purple-50/40",
  green: "border-green-200 bg-green-50/40",
};

function JobSection({
  title,
  body,
  color,
}: {
  title: string;
  body: string;
  color: "orange" | "purple" | "green";
}) {
  return (
    <section className={`rounded-2xl border-2 ${SECTION_COLOR[color]} p-6`}>
      <h2 className="text-xl font-bold text-neutral-900 mb-4">{title}</h2>
      <div className="prose prose-sm max-w-none text-neutral-700 whitespace-pre-line">{body}</div>
    </section>
  );
}

const BULLET_COLOR: Record<"orange" | "purple" | "green", string> = {
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  green: "bg-green-600",
};

function JobBulletSection({
  title,
  items,
  color,
}: {
  title: string;
  items: string[];
  color: "orange" | "purple" | "green";
}) {
  return (
    <section className={`rounded-2xl border-2 ${SECTION_COLOR[color]} p-6`}>
      <h2 className="text-xl font-bold text-neutral-900 mb-4">{title}</h2>
      <ul className="space-y-2 text-neutral-700">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-2 h-1.5 w-1.5 rounded-full ${BULLET_COLOR[color]} shrink-0`} />
            <span className="whitespace-pre-line">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
