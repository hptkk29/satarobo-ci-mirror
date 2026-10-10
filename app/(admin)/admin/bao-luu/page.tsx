// app/(admin)/admin/bao-luu/page.tsx — HỒ SƠ BẢO LƯU học viên (Quy chế SR.QD.236). Phiên 3: danh sách + duyệt.
//
// Mỗi hàng là MỘT hồ sơ (một ghi danh). Ba tab theo việc người dùng đang làm: "Chờ duyệt" (hàng đợi của Quản lý cơ sở),
// "Đang bảo lưu", "Đã kết thúc". Tab mặc định là hàng đợi nếu người xem duyệt được — đó là câu hỏi đầu tiên của họ.
//
// QUYỀN: vào màn = `bao-luu:view`. Mỗi hàng là link sang chi tiết (cả hàng là vùng bấm — luật 12, không mũi tên trơ).
// Tầm nhìn cơ sở do `scopedDb` (StudentReserve ∈ SCOPED_MODELS): QLCS CS1 không thấy hồ sơ CS2.
// Công tắc `pause.enabled` TẮT cho mọi cơ sở trong tầm nhìn ⇒ màn nói thẳng "chưa bật", không vẽ bảng rỗng đánh lừa.
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState } from "@/components/admin/ui/states";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { scopedDb } from "@/lib/db-scope";
import { ngayVN } from "@/lib/format/date";
import { coNoiNaoBatBaoLuu } from "@/lib/bao-luu/feature";
import { NHAN_TRANG_THAI, NHAN_LOAI, TAB_DANH_SACH, TONE_TRANG_THAI, chonTab } from "@/lib/bao-luu/nhan";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bảo lưu | Admin Sata Robo" };

const GIOI_HAN_HANG = 200;

export default async function BaoLuuPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fbao-luu");
  if (!(await checkPermission(PAGE_GATES["/bao-luu"][0]!))) redirect("/dashboard?error=unauthorized");

  const [coQuyenDuyet, coQuyenLap, coTamDung, actor, sp] = await Promise.all([
    checkPermission("bao-luu:approve"),
    checkPermission("bao-luu:create"),
    checkPermission("bao-luu:center-pause"),
    resolveActor(session.user.id),
    searchParams,
  ]);
  const sdb = scopedDb(actor);
  const bat = await coNoiNaoBatBaoLuu(actor.isHoLevel ? [] : actor.visibleOrgUnitIds ?? []);
  const tab = chonTab(sp.tab, coQuyenDuyet);
  const tabHienTai = TAB_DANH_SACH.find((t) => t.ma === tab)!;

  const [dem, hang] = await Promise.all([
    sdb.studentReserve.groupBy({ by: ["status"], _count: { _all: true } }),
    sdb.studentReserve.findMany({
      where: { status: { in: [...tabHienTai.trangThai] } },
      orderBy: [{ requestedAt: "desc" }, { startedAt: "desc" }],
      take: GIOI_HAN_HANG,
      select: {
        id: true,
        status: true,
        type: true,
        centerId: true, // passesScope đọc cột này khi lọc hậu kỳ
        startedAt: true,
        requestedAt: true,
        expectedEndAt: true,
        standardEndDate: true,
        createdByName: true,
        student: { select: { name: true, studentCode: true } },
        enrollment: { select: { course: { select: { name: true } }, class: { select: { name: true } } } },
      },
    }),
  ]);
  const soTheoTrangThai = new Map(dem.map((d) => [d.status, d._count._all]));
  const soTab = (t: (typeof TAB_DANH_SACH)[number]) => t.trangThai.reduce((s, tt) => s + (soTheoTrangThai.get(tt) ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <PageHeader
        title="Bảo lưu"
        subtitle="Hồ sơ bảo lưu theo Quy chế SR.QD.236 — lập hồ sơ, duyệt, theo dõi hạn."
        actions={
          (coQuyenLap || coTamDung || coQuyenDuyet) && bat ? (
            <>
              {coQuyenLap && (
                <Link
                  href="/students"
                  className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold transition-colors hover:bg-muted"
                >
                  Chọn học viên để lập hồ sơ
                </Link>
              )}
              {coQuyenDuyet && (
                <Link
                  href="/bao-luu/nhap-legacy"
                  className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold transition-colors hover:bg-muted"
                >
                  Nhập ca bảo lưu cũ
                </Link>
              )}
              {coTamDung && (
                <Link
                  href="/bao-luu/tam-dung-lop"
                  className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold transition-colors hover:bg-muted"
                >
                  Tạm dừng cả lớp
                </Link>
              )}
            </>
          ) : undefined
        }
      />

      {!bat && (
        <div role="status" className="mb-4 rounded-xl border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          Chức năng bảo lưu theo quy chế <strong>chưa được bật</strong> cho cơ sở của bạn. Nút Bảo lưu ở hồ sơ học viên vẫn chạy theo cách cũ cho tới khi quản trị bật
          <code className="mx-1 rounded bg-muted px-1">pause.enabled</code>
          ở Cấu hình vận hành.
        </div>
      )}

      <div role="group" aria-label="Lọc theo trạng thái" className="mb-4 flex flex-wrap gap-2">
        {TAB_DANH_SACH.map((t) => {
          const chon = t.ma === tab;
          return (
            <Link
              key={t.ma}
              href={`/bao-luu?tab=${t.ma}`}
              aria-current={chon ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                chon ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {t.nhan}
              <span className="tabular-nums">{soTab(t)}</span>
            </Link>
          );
        })}
      </div>

      {hang.length === 0 ? (
        <EmptyState
          title={tab === "cho-duyet" ? "Không có hồ sơ nào đang chờ duyệt." : "Chưa có hồ sơ ở mục này."}
          description={
            tab === "cho-duyet" && coQuyenLap && bat
              ? "Khi nhân viên lập hồ sơ bảo lưu, hồ sơ hiện ở đây và Quản lý cơ sở nhận thông báo."
              : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang tenDonVi="hồ sơ" khoaGhiNho={`bao-luu-${tab}`} cuonNgang className="[&>div:last-child]:px-5 [&>div:last-child]:pb-4">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className={adminTh}>Học viên · lớp</th>
                  <th scope="col" className={cn(adminTh, "hidden md:table-cell")}>Lập bởi</th>
                  <th scope="col" className={cn(adminTh, "hidden lg:table-cell")}>Thời gian</th>
                  <th scope="col" className={adminTh}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {hang.map((h) => (
                  <tr key={h.id} className={cn(adminTr, "relative cursor-pointer")}>
                    <td className={cn(adminTd, "max-w-0 align-top")}>
                      <Link
                        href={`/bao-luu/${h.id}`}
                        className="block truncate font-semibold text-primary-ink after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:underline"
                      >
                        {h.student.name}
                        {h.student.studentCode ? <span className="ml-2 font-normal text-muted-foreground">{h.student.studentCode}</span> : null}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {h.enrollment ? `${h.enrollment.course.name} — ${h.enrollment.class.name}` : "Toàn bộ khoá đang học"}
                      </p>
                    </td>
                    <td className={cn(adminTd, "hidden align-top md:table-cell")}>
                      <p>{h.createdByName}</p>
                      <p className="text-xs text-muted-foreground">{NHAN_LOAI[h.type]}</p>
                    </td>
                    <td className={cn(adminTd, "hidden align-top tabular-nums lg:table-cell")}>
                      <p>{ngayVN(h.startedAt)}{h.standardEndDate ?? h.expectedEndAt ? ` → ${ngayVN((h.standardEndDate ?? h.expectedEndAt)!)}` : ""}</p>
                      {h.requestedAt && <p className="text-xs text-muted-foreground">Lập {ngayVN(h.requestedAt)}</p>}
                    </td>
                    <td className={cn(adminTd, "align-top")}>
                      <StatusPill tone={TONE_TRANG_THAI[h.status]}>{NHAN_TRANG_THAI[h.status]}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
          {hang.length >= GIOI_HAN_HANG && (
            <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
              Chỉ hiện {GIOI_HAN_HANG} hồ sơ mới nhất của mục này.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
