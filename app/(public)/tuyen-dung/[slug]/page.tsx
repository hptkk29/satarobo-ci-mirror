import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { FF } from "@/components/public/pub-fonts";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import Link from "next/link";
import { db } from "@/lib/db";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { SATA_ROBO_CONTACT } from "@/lib/locations";
import { HR_CONTACT } from "@/lib/data/job-options";
import { formatDateVN } from "@/lib/format/date";
import { DuongDan } from "@/components/blog/tin-tuc-khung";
import {
  cacBuocUngTuyen,
  dinhDangLuong,
  laViTriGiangDay,
  tachDoan,
  tieuDeThuUngTuyen,
  tomTatMoTa,
} from "@/components/jobs/viec-lam-thuan";

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job || job.status !== "OPEN") return {};

  const description = tomTatMoTa(job.description, 160);
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

const THUOC_TINH_SVG = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const THUOC_TINH_FACT = { ...THUOC_TINH_SVG, width: 18, height: 18 } as const;

function IconDiaDiem({ nho }: { nho?: boolean }) {
  return (
    <svg {...(nho ? THUOC_TINH_FACT : THUOC_TINH_SVG)}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function Fact({ icon, nhan, giaTri }: { icon: React.ReactNode; nhan: string; giaTri: string }) {
  return (
    <div className="fact">
      {icon}
      <small>{nhan}</small>
      <b>{giaTri}</b>
    </div>
  );
}

/** Một khối nội dung (`.blk`): đoạn văn hoặc danh sách gạch đầu dòng có dấu tick. */
function Khoi({ tieuDe, icon, doan, muc }: { tieuDe: string; icon: React.ReactNode; doan?: string[]; muc?: string[] }) {
  return (
    <div className="blk sv a-blur">
      <h2>
        {icon}
        {tieuDe}
      </h2>
      {doan && doan.map((d, i) => (
        <p key={i} style={{ margin: "0 0 10px", lineHeight: 1.65 }}>
          {d}
        </p>
      ))}
      {muc && muc.length > 0 && (
        <ul>
          {muc.map((m, i) => (
            <li key={i} style={{ whiteSpace: "pre-line" }}>
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const job = await getJobBySlug(slug);
  if (!job || job.status !== "OPEN") notFound();

  // "Vị trí khác đang tuyển": các tin đang mở còn lại (thật), mới cập nhật trước.
  const viTriKhac = await db.jobPosting
    .findMany({
      where: { status: "OPEN", slug: { not: slug } },
      orderBy: [{ updatedAt: "desc" }],
      take: 3,
      select: { slug: true, title: true, department: true, location: true },
    })
    .catch(() => []);

  const luong = dinhDangLuong(job);
  const hrEmail = job.contactEmail ?? DEFAULT_HR_EMAIL;
  const hrPhone = job.contactPhone ?? DEFAULT_HR_PHONE;
  const hrPhoneTel = (job.contactPhone ?? HR_CONTACT.phoneRaw).replace(/\D/g, "");
  const lead = tomTatMoTa(job.description, 180);
  const buoc = cacBuocUngTuyen(laViTriGiangDay(job.title, job.department));

  const iconDongHo = (
    <svg {...THUOC_TINH_FACT}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );

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

      {/* Trang chi tiết tuyển dụng — chép từ JobDetail.dc.html (hiệu ứng `.sv`/`.load*` như artifact; fx.js lo). */}
        <header className="gridbg" style={{ borderBottom: "1px solid var(--line)", position: "relative", overflow: "hidden" }}>
          <div className="glow" aria-hidden="true" style={{ width: 680, height: 680, right: -180, top: -240 }} />
          <div className="wrap" style={{ paddingTop: "clamp(40px,5vw,72px)", paddingBottom: 40, position: "relative" }}>
            <DuongDan lop="load2" muc={[{ ten: "Tuyển dụng", href: "/tuyen-dung" }, { ten: job.title }]} />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "30px", alignItems: "end" }}>
              <div className="load2">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {job.department && <span className="tag">{job.department}</span>}
                  {job.openings > 1 && <span className="tag">Số lượng: {job.openings}</span>}
                </div>
                <h1 style={{ marginTop: 14, fontSize: "clamp(32px,4vw,58px)" }}>
                  Tuyển dụng <span className="grad">{job.title}</span>
                </h1>
                {lead && (
                  <p className="lead" style={{ margin: "14px 0 0", maxWidth: 720, color: "var(--muted)", fontSize: "clamp(16px,1.2vw,19px)" }}>
                    {lead}
                  </p>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 24 }}>
                  <a href="#ung-tuyen" className="btn btn-acc">
                    Ứng tuyển ngay
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                    </svg>
                  </a>
                  <Link href="/tuyen-dung" className="btn btn-line">
                    ← Tất cả vị trí
                  </Link>
                </div>
              </div>
              <div className="load3 jd-hero-art" style={{ position: "relative", width: 360, minWidth: 360, height: 260 }}>
                <div
                  className="ph"
                  style={{ position: "absolute", right: 0, top: 0, width: 220, height: 170, rotate: "4deg", borderRadius: 18, overflow: "hidden", border: "3px solid var(--panel)", boxShadow: "0 24px 50px var(--shadow)" }}
                >
                  <PubAnh id="85fbe2407f3b02e50e40d7e94d1c1bb3" alt="Giáo viên hướng dẫn học viên lắp robot" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} sizes="220px" />
                </div>
                <PubAnh id="ebf1d6a859c7f4a485c67c864da4ad4c" className="bob" alt="" aria-hidden="true" style={{ height: "auto", position: "absolute", zIndex: 3, filter: "drop-shadow(0 16px 20px rgba(0,0,0,.35))", left: 0, bottom: -10, width: 120 }} sizes="120px" />
              </div>
            </div>
            <div className="facts load3">
              {job.location && <Fact icon={<IconDiaDiem nho />} nhan="Địa điểm" giaTri={job.location} />}
              {job.type && <Fact icon={iconDongHo} nhan="Hình thức" giaTri={job.type} />}
              {job.workingHours && <Fact icon={iconDongHo} nhan="Giờ làm việc" giaTri={job.workingHours} />}
              {job.experienceLevel && (
                <Fact
                  icon={
                    <svg {...THUOC_TINH_FACT}>
                      <path d="M22 10L12 5 2 10l10 5 10-5z" />
                      <path d="M6 12v5c3 2 9 2 12 0v-5" />
                    </svg>
                  }
                  nhan="Kinh nghiệm"
                  giaTri={EXPERIENCE_LABELS[job.experienceLevel] ?? job.experienceLevel}
                />
              )}
              {luong && (
                <Fact
                  icon={
                    <svg {...THUOC_TINH_FACT}>
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <circle cx="12" cy="12" r="2.5" />
                    </svg>
                  }
                  nhan="Mức lương"
                  giaTri={luong}
                />
              )}
              {job.closesAt && (
                <Fact
                  icon={
                    <svg {...THUOC_TINH_FACT}>
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="12" r="6" />
                      <circle cx="12" cy="12" r="2" />
                    </svg>
                  }
                  nhan="Hạn nộp"
                  giaTri={formatDateVN(job.closesAt)}
                />
              )}
            </div>
          </div>
        </header>

        <section className="sec" style={{ paddingTop: 48 }}>
          <div className="wrap">
            <div className="jd-grid">
              <div className="jd">
                <Khoi
                  tieuDe="Mô tả công việc"
                  icon={
                    <svg {...THUOC_TINH_SVG}>
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="12" r="6" />
                      <circle cx="12" cy="12" r="2" />
                    </svg>
                  }
                  doan={tachDoan(job.description)}
                  muc={job.responsibilities}
                />
                {job.requirements.length > 0 && (
                  <Khoi
                    tieuDe="Yêu cầu ứng viên"
                    icon={
                      <svg {...THUOC_TINH_SVG}>
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    }
                    muc={job.requirements}
                  />
                )}
                {job.benefits.length > 0 && (
                  <Khoi
                    tieuDe="Quyền lợi"
                    icon={
                      <svg {...THUOC_TINH_SVG}>
                        <rect x="3" y="8" width="18" height="13" rx="1" />
                        <path d="M12 8v13M3 12h18M12 8S10 3 7.5 4 9 8 12 8zm0 0s2-5 4.5-4S15 8 12 8z" />
                      </svg>
                    }
                    muc={job.benefits}
                  />
                )}

                <div className="sv a-blur">
                  <h2 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "clamp(20px,1.8vw,26px)", margin: "0 0 14px" }}>
                    <svg {...THUOC_TINH_SVG}>
                      <path d="M23 6l-9.5 9.5-5-5L1 18" />
                      <path d="M17 6h6v6" />
                    </svg>
                    Quy trình ứng tuyển
                  </h2>
                  <div className="facts" style={{ gridTemplateColumns: `repeat(${buoc.length},minmax(0,1fr))`, marginTop: 0 }}>
                    {buoc.map((b, i) => (
                      <div key={b.so} className={`fact sv ${i > 0 ? `d${Math.min(i + 1, 4)}` : ""} a-pop`} style={{ textAlign: "center" }}>
                        <span className="num-big grad" style={{ fontSize: 30 }}>
                          {b.so}
                        </span>
                        <b style={{ display: "block" }}>{b.tieuDe}</b>
                        <small style={{ textTransform: "none", letterSpacing: 0 }}>{b.moTa}</small>
                      </div>
                    ))}
                  </div>
                </div>

                {viTriKhac.length > 0 && (
                  <div style={{ marginTop: 34 }}>
                    <h2 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "clamp(20px,1.8vw,26px)", margin: "0 0 14px" }}>
                      <svg {...THUOC_TINH_SVG}>
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
                      </svg>
                      Vị trí khác đang tuyển
                    </h2>
                    <div style={{ display: "grid", gap: 12 }}>
                      {viTriKhac.map((v) => (
                        <Link key={v.slug} href={`/tuyen-dung/${v.slug}`} className="job" style={{ gridTemplateColumns: "minmax(0,1fr) auto", color: "var(--accT)" }}>
                          <span>
                            <h3 style={{ fontSize: 16 }}>{v.title}</h3>
                            <span className="meta">
                              {v.department && <span className="tag">{v.department}</span>}
                              {v.location && (
                                <span className="chip" style={{ padding: "3px 10px", fontSize: 12 }}>
                                  {v.location}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="go">
                            <b>→</b>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <aside id="ung-tuyen" className="apply">
                {/* Chưa có form nhận hồ sơ trực tuyến (không có Server Action/API ghi JobApplication):
                    ứng tuyển bằng email / điện thoại như trước, trình bày theo thẻ "Ứng tuyển" của artifact. */}
                <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 22, padding: 26, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 30px 60px var(--shadow)" }}>
                  <div>
                    <span className="tag">Ứng tuyển</span>
                    <p style={{ margin: "8px 0 0", fontFamily: FF.unbounded, fontWeight: 600, fontSize: 20 }}>{job.title}</p>
                  </div>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 15 }}>Gửi CV qua email hoặc liên hệ trực tiếp bộ phận Nhân sự Sata Robo.</p>
                  <a href={`mailto:${hrEmail}?subject=${encodeURIComponent(tieuDeThuUngTuyen(job.title))}`} className="btn btn-acc" style={{ width: "100%" }}>
                    Gửi CV qua Email
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                    </svg>
                  </a>
                  <a href={`tel:${hrPhoneTel}`} className="btn btn-line" style={{ width: "100%" }}>
                    Gọi HR Sata Robo
                  </a>
                  <div style={{ display: "grid", gap: 8, paddingTop: 16, borderTop: "1px solid var(--line)", fontSize: 14 }}>
                    <a href={`mailto:${hrEmail}`} style={{ color: "var(--text)", wordBreak: "break-all" }}>
                      {hrEmail}
                    </a>
                    <a href={`tel:${hrPhoneTel}`} style={{ color: "var(--text)" }}>
                      {hrPhone}
                    </a>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Hồ sơ chuyển thẳng đến bộ phận Nhân sự Sata Robo.</p>
                </div>
              </aside>
            </div>
          </div>
        </section>
    </>
  );
}
