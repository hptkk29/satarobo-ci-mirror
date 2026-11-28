import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napTongQuanDaoTao } from "@/lib/elearning/dao-tao-overview";
import { NoPermission } from "@/components/admin/ui/states";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { LIEN_KET_CHU, NUT_CHINH, NUT_PHU } from "../_components/ui/dieu-khien";
import { dongCanXuLy, ngayDayDu, thongKeTongQuan } from "@/lib/elearning/tong-quan-dao-tao-view";
import { TrangQuanTri } from "../_components/ui/trang";

/**
 * TỔNG QUAN (QtTongQuan) — "việc gì đang chờ tôi xử lý" của người vận hành đào tạo.
 *
 * Theo thiết kế: đầu trang (ngày · phạm vi) + hành động chính, dải số liệu, danh sách "Cần xử lý" mỗi dòng có nút. KHÔNG vẽ (chưa có nguồn / thuộc P9):
 * biểu đồ "hoàn thành đúng hạn theo tuần", các ô khoá online · học viên · đơn mua, "đúng hạn theo cơ sở". Xem DECISIONS D-27.
 *
 * Mọi con số là `count` thật qua `scopedDb` (xem `lib/elearning/dao-tao-overview.ts`); mỗi khối CHỈ hiện và CHỈ truy vấn khi
 * người xem có đúng quyền của khối đó. Không số liệu giả: khối nào không có dữ liệu thì hiện 0 thật.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tổng quan Đào tạo | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

type Dong = { nhan: string; so: number; href: string; canhBao?: string; gap?: boolean };

function DongViec({ d }: { d: Dong }) {
  return (
    <li>
      <Link
        href={d.href}
        className="flex min-h-14 items-center gap-4 px-4 py-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span
          className={`w-12 shrink-0 text-right text-2xl font-bold tabular-nums ${
            d.gap && d.so > 0 ? "text-state-danger-ink" : "text-foreground"
          }`}
        >
          {d.so}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{d.nhan}</span>
          {d.canhBao ? <span className="block text-xs text-state-danger-ink">{d.canhBao}</span> : null}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function Khoi({ tieuDe, dong }: { tieuDe: string; dong: Dong[] }) {
  if (dong.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">{tieuDe}</h2>
      <ul className="divide-y divide-border">
        {dong.map((d) => (
          <DongViec key={d.href + d.nhan} d={d} />
        ))}
      </ul>
    </section>
  );
}

export default async function TongQuanDaoTaoPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Tổng quan" />
        <p className="text-sm">Đăng nhập rồi mở lại trang này.</p>
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  const cham = can(actor, "elearning:exam:grade");
  const giao = can(actor, "elearning:assignment:create");
  const soan = can(actor, "elearning:content:author");
  const baoCao = can(actor, "elearning:progress:view-all");

  if (!cham && !giao && !soan) {
    // Trang từ chối vẫn là MỘT trang hoàn chỉnh: có `<main>` (đích của "Bỏ qua điều hướng") và đúng một `<h1>`. Trước đây chỉ
    // bọc `<div>` nên người đọc màn hình không có mốc nào, và liên kết bỏ qua điều hướng trỏ vào chỗ trống.
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Tổng quan" />
        <NoPermission
          permission="elearning:content:author · elearning:exam:grade · elearning:assignment:create"
          what="tổng quan Đào tạo"
          askWho="phòng Đào tạo"
        />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const tq = await napTongQuanDaoTao(scopedDb(actor), { cham, giao, soan, baoCao }, new Date());

  const dangVanHanh: Dong[] = [
    // "Lượt giao đang mở" đã ở dải số liệu phía trên — không lặp lại.
    ...(tq.tienDo ? [{ nhan: "Lượt học đang diễn ra", so: tq.tienDo.luotDangHoc, href: "/elearning/bao-cao" }] : []),
    ...(tq.soan
      ? [
          { nhan: "Khoá đã xuất bản", so: tq.soan.khoaDaXuatBan, href: "/elearning/soan-khoa" },
          { nhan: "Khoá đang soạn (nháp)", so: tq.soan.khoaNhap, href: "/elearning/soan-khoa" },
        ]
      : []),
  ];
  const stats = thongKeTongQuan(tq);
  const viec = dongCanXuLy(tq);
  const phamVi = actor.isHoLevel ? "toàn hệ thống" : "phạm vi cơ sở của bạn";

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Tổng quan"
        subtitle={`${ngayDayDu(new Date())} · ${phamVi}`}
        actions={
          giao ? (
            <Link href="/elearning/giao-bai" className={NUT_CHINH}>
              Giao khoá nội bộ
            </Link>
          ) : undefined
        }
      />

      {stats.length > 0 && (
        <dl aria-label="Số liệu chính" className="grid grid-cols-2 border-y border-border lg:grid-cols-4">
          {stats.map((t) => (
            <div key={t.nhan} className="flex flex-col gap-1 border-border px-4 py-4 lg:border-l lg:first:border-l-0 max-lg:even:border-l max-lg:[&:nth-child(n+3)]:border-t">
              <dt className="text-sm text-muted-foreground">{t.nhan}</dt>
              <dd className={`text-[32px] font-medium leading-9 tabular-nums ${t.sac === "danger" ? "text-state-danger-ink" : t.sac === "warning" ? "text-state-warning-ink" : "text-foreground"}`}>{t.so}</dd>
              {t.phu ? <dd className="text-sm text-muted-foreground">{t.phu}</dd> : null}
            </div>
          ))}
        </dl>
      )}

      <section aria-labelledby="can-xu-ly" className="space-y-1">
        <h2 id="can-xu-ly" className="text-lg font-medium text-foreground">Cần xử lý</h2>
        {viec.length === 0 ? (
          <p className="border-t border-border py-4 text-sm text-muted-foreground">Không có việc nào đang chờ bạn xử lý.</p>
        ) : (
          <ul className="border-t border-border">
            {viec.map((v) => (
              <li key={v.href + v.tieuDe} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{v.tieuDe}</span>
                  {v.phu ? <span className="block text-sm text-muted-foreground">{v.phu}</span> : null}
                </span>
                <Link href={v.href} className={v.noiBat ? NUT_CHINH : NUT_PHU}>
                  {v.nut}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Khoi tieuDe="Đang vận hành" dong={dangVanHanh} />
    </TrangQuanTri>
  );
}
