import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napTongQuanDaoTao } from "@/lib/elearning/dao-tao-overview";
import { NoPermission } from "@/components/admin/ui/states";
import { PageHeader } from "@/components/admin/ui/page-header";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";
import { TrangQuanTri } from "../_components/ui/trang";

/**
 * TỔNG QUAN ĐÀO TẠO — "việc gì đang chờ tôi xử lý" của người vận hành đào tạo.
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
        <PageHeader title="Tổng quan Đào tạo" />
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
        <PageHeader title="Tổng quan Đào tạo" />
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

  const canXuLy: Dong[] = [
    ...(tq.cham
      ? [
          {
            nhan: "Bài tập chờ chấm",
            so: tq.cham.taoChoCham,
            href: "/elearning/cham-bai-tap",
            gap: tq.cham.taoQuaHanCham > 0,
            canhBao: tq.cham.taoQuaHanCham > 0 ? `${tq.cham.taoQuaHanCham} bài đã quá hạn chấm` : undefined,
          },
          { nhan: "Bài thi chờ chấm tay", so: tq.cham.thiChoCham, href: "/elearning/cham-bai" },
        ]
      : []),
    ...(tq.tienDo
      ? [{ nhan: "Lượt học quá hạn", so: tq.tienDo.luotQuaHan, href: "/elearning/bao-cao", gap: true }]
      : []),
  ];
  const dangVanHanh: Dong[] = [
    ...(tq.giao ? [{ nhan: "Lượt giao đang mở", so: tq.giao.luotGiaoDangMo, href: "/elearning/giao-bai" }] : []),
    ...(tq.tienDo ? [{ nhan: "Lượt học đang diễn ra", so: tq.tienDo.luotDangHoc, href: "/elearning/bao-cao" }] : []),
    ...(tq.soan
      ? [
          { nhan: "Khoá đã xuất bản", so: tq.soan.khoaDaXuatBan, href: "/elearning/soan-khoa" },
          { nhan: "Khoá đang soạn (nháp)", so: tq.soan.khoaNhap, href: "/elearning/soan-khoa" },
        ]
      : []),
  ];
  const khongViec = canXuLy.length > 0 && canXuLy.every((d) => d.so === 0);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        title="Tổng quan Đào tạo"
        subtitle={
          khongViec
            ? "Không có bài nào đang chờ chấm hoặc quá hạn."
            : "Việc đang chờ bạn xử lý và tình hình vận hành. Số liệu chỉ gồm phạm vi bạn được xem."
        }
      />
      <Khoi tieuDe="Cần xử lý" dong={canXuLy} />
      <Khoi tieuDe="Đang vận hành" dong={dangVanHanh} />
    </main>
  );
}
