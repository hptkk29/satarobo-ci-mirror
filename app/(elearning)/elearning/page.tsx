import Link from "next/link";
import { ArrowRight, Award, BookOpenCheck, CalendarClock, CircleCheck, GraduationCap } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napTongQuanHocTap } from "@/lib/elearning/dashboard-view";
import { dongHan, trangThaiHienThi, type KhoaRut } from "@/lib/elearning/dashboard-pure";
import { NHAN_LOAI_BAI } from "@/lib/elearning/lesson-kind";
import { EmptyState } from "@/components/admin/ui/states";
import { PageHeader } from "@/components/admin/ui/page-header";
import { MUC_CHU, TrangThaiBadge } from "./_components/ui/trang-thai-badge";
import { TienDo } from "./_components/ui/tien-do";
import { TheKhoa, nhanHanhDong } from "./_components/ui/the-khoa";

/**
 * TỔNG QUAN HỌC TẬP — trang chủ khu học tập nội bộ.
 *
 * Trả lời "việc gì tiếp theo" trước "có những khoá nào": tiếp tục học · việc cần làm theo độ gấp · khoá được giao.
 * Mọi con số đến từ `napTongQuanHocTap` (số truy vấn cố định, không theo số khoá). KHÔNG KPI giả: ô nào chưa có dữ liệu
 * thì nói là chưa có.
 *
 * ⚠️ Trang này từng là khung tạm 16 dòng của EL-01 với ĐÚNG 0 link, và ở nguyên như thế qua mười bốn ticket. Mọi màn hình
 * đã dựng không ai tới được trừ khi biết sẵn địa chỉ. Giữ lối vào `Dữ liệu của tôi` ở cuối trang: đó cũng là màn
 * khiếu nại cờ nghi ngờ xem video (cửa sổ 14 ngày chạy im lặng — xem `tests/elearning/loi-vao-ui.test.ts`).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tổng quan | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const SO_THE_TOI_DA = 6;
const SO_VIEC_MOI_NHOM = 5;

export default async function ElearningHomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </main>
    );
  }
  const actor = await resolveActor(session.user.id);
  const now = new Date();
  const tq = await napTongQuanHocTap(scopedDb(actor), session.user.id, now);
  const { kpi } = tq;

  const ten = session.user.name?.trim();
  const uuTien = kpi.quaHan + kpi.sapHan;
  const dongUuTien =
    kpi.tong === 0
      ? "Bạn chưa được giao khoá nào."
      : uuTien > 0
        ? `Bạn có ${uuTien} khoá cần ưu tiên: ${kpi.quaHan} quá hạn, ${kpi.sapHan} sắp đến hạn.`
        : "Không có khoá nào quá hạn hoặc sắp đến hạn.";

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title={ten ? `Xin chào, ${ten}` : "Xin chào"}
        subtitle={dongUuTien}
        actions={
          tq.tiepTuc ? (
            <Link
              href={tq.tiepTuc.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Tiếp tục học
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null
        }
      />

      <KpiStrip kpi={kpi} chungNhan={tq.chungNhanConHieuLuc} />

      {kpi.tong === 0 ? (
        // Rỗng ≠ lỗi tải. Nói rõ vì sao rỗng và hỏi ai (phòng Đào tạo là nơi giao khoá).
        <EmptyState
          title="Bạn chưa được giao khoá nào"
          description="Phòng Đào tạo là nơi giao khoá học. Khi có khoá được giao, nó sẽ hiện ở đây cùng hạn hoàn thành. Liên hệ phòng Đào tạo nếu bạn nghĩ đây là nhầm lẫn."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0 space-y-6">
            {tq.tiepTuc ? <TiepTucHoc tt={tq.tiepTuc} now={now} /> : null}

            <section aria-labelledby="khoa-duoc-giao">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id="khoa-duoc-giao" className="text-base font-semibold text-foreground">
                  Khoá được giao
                </h2>
                <Link
                  href="/elearning/khoa-cua-toi"
                  className="inline-flex min-h-6 shrink-0 items-center rounded text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Xem tất cả ({kpi.tong})
                </Link>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {tq.khoa.slice(0, SO_THE_TOI_DA).map((k) => (
                  <li key={k.enrollmentId} className="min-w-0">
                    <TheKhoa khoa={k} now={now} />
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside aria-labelledby="viec-can-lam" className="min-w-0">
            <h2 id="viec-can-lam" className="mb-3 text-base font-semibold text-foreground">
              Việc cần làm
            </h2>
            {tq.viecCanLam.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                Bạn không còn khoá nào cần hoàn thành.
              </p>
            ) : (
              <div className="space-y-4 rounded-xl border border-border bg-card p-4">
                {tq.viecCanLam.map((nhom) => (
                  <div key={nhom.ma}>
                    <h3
                      className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${
                        nhom.ma === "QUA_HAN" ? "text-state-danger-ink" : "text-muted-foreground"
                      }`}
                    >
                      {nhom.nhan} ({nhom.muc.length})
                    </h3>
                    <ul className="divide-y divide-border">
                      {nhom.muc.slice(0, SO_VIEC_MOI_NHOM).map((k) => (
                        <ViecCanLam key={k.enrollmentId} khoa={k} now={now} />
                      ))}
                    </ul>
                    {nhom.muc.length > SO_VIEC_MOI_NHOM ? (
                      <Link
                        href={
                          nhom.ma === "QUA_HAN"
                            ? "/elearning/khoa-cua-toi?tt=qua-han"
                            : nhom.ma === "SAP_HAN"
                              ? "/elearning/khoa-cua-toi?tt=sap-han"
                              : "/elearning/khoa-cua-toi"
                        }
                        className="mt-1 inline-block rounded text-xs font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        và {nhom.muc.length - SO_VIEC_MOI_NHOM} khoá nữa
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Muốn xem hệ thống lưu gì về việc học của bạn?{" "}
        <Link href="/elearning/du-lieu-cua-toi" className="underline">
          Dữ liệu của tôi
        </Link>
      </p>
    </main>
  );
}

function KpiStrip({
  kpi,
  chungNhan,
}: {
  kpi: { dangHoc: number; chuaBatDau: number; hoanThanh: number; sapHan: number; quaHan: number };
  chungNhan: number;
}) {
  const o = [
    {
      nhan: "Đang học",
      so: kpi.dangHoc,
      ghiChu: `${kpi.chuaBatDau} chưa bắt đầu`,
      href: "/elearning/khoa-cua-toi?tt=dang-hoc",
      Icon: BookOpenCheck,
      sac: "text-state-success-ink",
    },
    {
      nhan: "Đã hoàn thành",
      so: kpi.hoanThanh,
      ghiChu: "khoá",
      href: "/elearning/khoa-cua-toi?tt=hoan-thanh",
      Icon: CircleCheck,
      sac: "text-state-info-ink",
    },
    {
      nhan: "Sắp đến hạn",
      so: kpi.sapHan,
      ghiChu: kpi.quaHan > 0 ? `${kpi.quaHan} đã quá hạn` : "trong 7 ngày tới",
      href: kpi.sapHan === 0 && kpi.quaHan > 0 ? "/elearning/khoa-cua-toi?tt=qua-han" : "/elearning/khoa-cua-toi?tt=sap-han",
      Icon: CalendarClock,
      sac: kpi.quaHan > 0 ? "text-state-danger-ink" : "text-state-warning-ink",
    },
    {
      nhan: "Chứng nhận",
      so: chungNhan,
      ghiChu: "còn hiệu lực",
      href: "/elearning/chung-nhan-cua-toi",
      Icon: Award,
      sac: "text-primary-ink",
    },
  ];
  return (
    <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
      {o.map((x) => (
        <li key={x.nhan} className="min-w-0 bg-card">
          <Link
            href={x.href}
            className="flex min-h-[5.5rem] items-center gap-3 p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <x.Icon className={`h-5 w-5 shrink-0 ${x.sac}`} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-muted-foreground">{x.nhan}</span>
              <span className={`block text-xl font-bold leading-tight ${x.sac}`}>{x.so}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{x.ghiChu}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TiepTucHoc({
  tt,
  now,
}: {
  tt: NonNullable<Awaited<ReturnType<typeof napTongQuanHocTap>>["tiepTuc"]>;
  now: Date;
}) {
  const { khoa, bai, href } = tt;
  const trangThai = trangThaiHienThi(khoa, now);
  const han = dongHan(khoa, now);
  return (
    <section
      aria-labelledby="tiep-tuc-hoc"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="tiep-tuc-hoc" className="text-base font-semibold text-foreground">
          Tiếp tục học
        </h2>
        <TrangThaiBadge sac={trangThai.sac}>{trangThai.nhan}</TrangThaiBadge>
      </div>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-ink sm:flex">
          <GraduationCap className="h-7 w-7" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-foreground">{khoa.tenKhoa}</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {bai
              ? `Bài đang học: ${bai.title} (${NHAN_LOAI_BAI[bai.kind] ?? bai.kind})`
              : "Bạn chưa bắt đầu bài nào trong khoá này."}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <TienDo phanTram={khoa.progressPercent} nhan={khoa.tenKhoa} className="max-w-sm" />
            <span className="shrink-0 text-xs font-medium text-muted-foreground">{khoa.progressPercent}%</span>
          </div>
          {han ? <p className={`mt-1.5 text-xs ${MUC_CHU[han.sac]}`}>{han.chu}</p> : null}
        </div>
        <Link
          href={href}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {nhanHanhDong(khoa)}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function ViecCanLam({ khoa, now }: { khoa: KhoaRut; now: Date }) {
  const han = dongHan(khoa, now);
  return (
    <li>
      <Link
        href={`/elearning/hoc/${khoa.enrollmentId}`}
        className="-mx-2 block rounded-lg px-2 py-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="block truncate text-sm font-medium text-foreground">{khoa.tenKhoa}</span>
        <span className="mt-0.5 flex items-center justify-between gap-2 text-xs">
          <span className={`min-w-0 truncate ${han ? MUC_CHU[han.sac] : "text-muted-foreground"}`}>{han?.chu}</span>
          <span className="shrink-0 text-muted-foreground">{khoa.progressPercent}%</span>
        </span>
      </Link>
    </li>
  );
}
