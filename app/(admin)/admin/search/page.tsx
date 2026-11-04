import Link from "next/link";
import { redirect } from "next/navigation";
import { Search as SearchIcon, Users, GraduationCap, Newspaper } from "lucide-react";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission, checkPermissionDetail } from "@/lib/auth/check-permission";
import { canViewLeadPii } from "@/lib/auth/check-permission";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import { leadOwnershipWhere } from "@/lib/lead/ownership";
import { LEAD_STATUS_LABEL } from "@/lib/leads/status";
import { phoneSearchTerm } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tìm kiếm | Admin" };

// Tìm kiếm nhanh toàn cục từ ô "Tìm leads, học viên, blog..." trên thanh trên cùng.
// Gộp 3 nhóm (Lead / Học viên / Tin tức) — mỗi nhóm gate riêng theo quyền, dữ liệu qua
// scopedDb (cách ly cơ sở) và mask PII lead cho actor thiếu leads:view-pii.
const RESULT_LIMIT = 6;
const MIN_LENGTH = 2;

type SP = { q?: string };

export default async function GlobalSearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  // SĐT lưu 2 dạng (0… cũ / 84… mới) — tìm theo phần lõi để không sót.
  const qPhone = phoneSearchTerm(q) ?? q;
  const doSearch = q.length >= MIN_LENGTH;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [canLeadsAll, canLeadsOwn, canStudents, canNews] = await Promise.all([
    checkPermission("leads:view-all"),
    checkPermission("leads:view-own"),
    checkPermission("students:view-all"),
    checkPermission("news:view"),
  ]);
  const canLeads = canLeadsAll || canLeadsOwn;
  const scopeToSelf = !canLeadsAll && canLeadsOwn;
  const canViewPii = await canViewLeadPii();
  // NỢ #11 (search-oracle): chỉ cho tìm theo SĐT PH khi actor thấy được SĐT thật —
  // cùng điều kiện với hiển thị (canViewPii VÀ không bị DENY cấp trường TS-02).
  // Mỗi nhóm kết quả gate theo ĐÚNG trục PII của nó: học viên = mask "parentPhone"
  // của students:view-all; lead = mask "phone" của leads:view-pii (Q7 cai PII lead).
  const { fieldMask: studentMask } = await checkPermissionDetail("students:view-all");
  const canSearchStudentPhone = canViewPii && !studentMask.includes("parentPhone");
  const { fieldMask: leadMask } = await checkPermissionDetail("leads:view-pii");
  const canSearchLeadPhone = canViewPii && !leadMask.includes("phone");

  const [leads, students, news] = doSearch
    ? await Promise.all([
        canLeads
          ? sdb.lead.findMany({
              where: {
                deletedAt: null,
                // Sale chỉ view-own → giới hạn về "khách của tôi" (bọc AND để
                // không đè key OR của search bên dưới). Cách ly cơ sở do scopedDb lo.
                //
                // S-8 (27/08) — khối này TỪNG CHỈ CÓ HAI VẾ: `assignedToId` +
                // nhánh dùng chung. Vế "phiếu chính mình nhập" được thêm vào
                // `/admin/leads` từ 23/08 và vào site Sale ở S-4 (27/08), nhưng ô
                // tìm thì không ai nhớ. Hệ quả người dùng thấy: Sale Hội sở nhập
                // một phiếu (phiếu tự chia về Sale cơ sở nên họ không bao giờ là
                // assignee), gõ đúng tên phụ huynh vào đây thì KHÔNG RA GÌ — mà
                // cũng phiếu đó mở được từ danh sách. Nay hỏi chung một nguồn.
                ...(scopeToSelf ? { AND: [leadOwnershipWhere(session.user.id)] } : {}),
                OR: [
                  { parentName: { contains: q, mode: "insensitive" } },
                  // Lead.phone = SĐT PH — chỉ tìm được khi thấy SĐT thật (NỢ #11).
                  ...(canSearchLeadPhone ? [{ phone: { contains: qPhone } }] : []),
                  { childName: { contains: q, mode: "insensitive" } },
                ],
              },
              select: {
                id: true,
                parentName: true,
                phone: true,
                childName: true,
                status: true,
              },
              orderBy: { createdAt: "desc" },
              take: RESULT_LIMIT,
            })
          : Promise.resolve([]),
        canStudents
          ? sdb.student.findMany({
              where: {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { studentCode: { contains: q, mode: "insensitive" } },
                  { parentName: { contains: q, mode: "insensitive" } },
                  // SĐT PH/HV — chỉ tìm được khi thấy SĐT thật (NỢ #11).
                  ...(canSearchStudentPhone
                    ? [
                        { parentPhone: { contains: qPhone } },
                        { phone: { contains: qPhone } },
                      ]
                    : []),
                ],
              },
              select: { id: true, name: true, studentCode: true, parentName: true },
              orderBy: { createdAt: "desc" },
              take: RESULT_LIMIT,
            })
          : Promise.resolve([]),
        canNews
          ? sdb.news.findMany({
              where: { title: { contains: q, mode: "insensitive" } },
              select: { id: true, slug: true, title: true, isPublished: true, category: true },
              orderBy: { updatedAt: "desc" },
              take: RESULT_LIMIT,
            })
          : Promise.resolve([]),
      ])
    : [[], [], []];

  const maskedLeads = leads.map((l) => maskLeadPiiFields(l, canViewPii));
  const totalResults = maskedLeads.length + students.length + news.length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">Kết quả tìm kiếm</h1>
        {doSearch ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {totalResults > 0
              ? `${totalResults} kết quả cho “${q}”`
              : `Không tìm thấy kết quả cho “${q}”`}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Nhập ít nhất {MIN_LENGTH} ký tự để tìm lead, học viên hoặc tin tức.
          </p>
        )}
      </div>

      {/* Ô tìm lại ngay trên trang kết quả (GET → /search?q=). */}
      <form method="GET" action="/search" className="relative mb-6">
        <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="Tìm leads, học viên, blog..."
          className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft"
        />
      </form>

      {doSearch && totalResults > 0 && (
        <div className="space-y-6">
          {maskedLeads.length > 0 && (
            <Section
              icon={<Users className="h-4 w-4" />}
              title="Lead"
              moreHref={`/leads?q=${encodeURIComponent(q)}`}
            >
              {maskedLeads.map((l) => (
                <Link
                  key={l.id}
                  href={`/leads/${l.id}`}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-muted"
                >
                  <span className="text-sm font-medium text-foreground">
                    {l.parentName ?? "(chưa có tên)"}
                    {l.childName ? (
                      <span className="text-muted-foreground"> · {l.childName}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {l.phone ?? ""} · {LEAD_STATUS_LABEL[l.status] ?? l.status}
                  </span>
                </Link>
              ))}
            </Section>
          )}

          {students.length > 0 && (
            <Section
              icon={<GraduationCap className="h-4 w-4" />}
              title="Học viên"
              moreHref={`/students?q=${encodeURIComponent(q)}`}
            >
              {students.map((s) => (
                <Link
                  key={s.id}
                  href={`/students/${s.id}`}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-muted"
                >
                  <span className="text-sm font-medium text-foreground">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.studentCode ?? ""}
                    {s.parentName ? ` · PH: ${s.parentName}` : ""}
                  </span>
                </Link>
              ))}
            </Section>
          )}

          {news.length > 0 && (
            <Section
              icon={<Newspaper className="h-4 w-4" />}
              title="Tin tức"
              moreHref="/news"
            >
              {/* Bài đã đăng → mở bài public (mọi role có news:view đọc được);
                  bản nháp → trang sửa (route /news/{id} không tồn tại). */}
              {news.map((n) => (
                <Link
                  key={n.id}
                  href={n.isPublished ? `/tin-tuc/${n.slug}` : `/news/${n.id}/edit`}
                  target={n.isPublished ? "_blank" : undefined}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-muted"
                >
                  <span className="text-sm font-medium text-foreground">{n.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {n.category ? `${n.category} · ` : ""}
                    {n.isPublished ? "Đã đăng" : "Nháp"}
                  </span>
                </Link>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  moreHref,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  moreHref: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </h2>
        <Link href={moreHref} className="text-xs font-medium text-primary hover:underline">
          Xem tất cả →
        </Link>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}
