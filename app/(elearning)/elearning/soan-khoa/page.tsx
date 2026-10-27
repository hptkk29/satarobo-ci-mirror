import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import type { SacThai } from "@/lib/elearning/dashboard-pure";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { Khoi, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri, KhoiRong } from "../_components/ui/trang";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";

/**
 * EL-08 — DANH SÁCH KHOÁ để soạn.
 *
 * ⚠️ Trang này TỪNG KHÔNG TỒN TẠI, trong khi `chuong-trinh/page.tsx` có một link
 * trỏ thẳng `/elearning/soan-khoa` — tức một **404**. Trớ trêu là link chết đó nằm
 * ngay dưới dòng bình luận "Trang không có lối vào thì chỉ người viết nó biết đường
 * tới".
 *
 * Chỉ có `soan-khoa/[courseId]/page.tsx`, nên người soạn phải biết sẵn `courseId`
 * mới vào được màn dựng dàn bài của một khoá.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Soạn khoá | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_TT: Record<string, string> = {
  DRAFT: "Nháp",
  PENDING_REVIEW: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  PUBLISHED: "Đang phát hành",
  ARCHIVED: "Đã lưu trữ",
};

const SAC_TT: Record<string, SacThai> = {
  DRAFT: "muted",
  PENDING_REVIEW: "warning",
  APPROVED: "info",
  PUBLISHED: "success",
  ARCHIVED: "muted",
};

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:content:author")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Soạn khoá" />
        <NoPermission permission="elearning:content:author" what="màn soạn khoá" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const cacKhoa = await db.trnCourse.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      program: { select: { code: true } },
      _count: { select: { modules: true } },
    },
    // Nháp lên trước: đó là thứ người soạn đang làm dở.
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Soạn khoá"
        subtitle={
          <>
            Chọn một khoá để dựng dàn bài, gắn đề thi và khung chấm. Khoá mới tạo ở{" "}
            <Link href="/elearning/chuong-trinh" className={LIEN_KET_CHU}>
              màn chương trình
            </Link>
            .
          </>
        }
      />

      <Khoi tieuDe={`Khoá trong phạm vi của bạn (${cacKhoa.length})`} sat>
        {cacKhoa.length === 0 ? (
          <KhoiRong
              title="Chưa có khoá nào trong phạm vi của bạn"
              description="Khoá được tạo từ một chương trình đào tạo. Mở màn chương trình, chọn “Tạo khoá”."
              action={
                <Link href="/elearning/chuong-trinh" className={LIEN_KET_CHU}>
                  Tới màn chương trình
                </Link>
              }
            />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="khoá" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Khoá</th>
                  <th scope="col" className={TH_BANG}>Mã</th>
                  <th scope="col" className={TH_BANG}>Chương trình</th>
                  <th scope="col" className={TH_BANG}>Trạng thái</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Chương</th>
                </tr>
              </thead>
              <tbody>
                {cacKhoa.map((k) => (
                  <tr key={k.id} className={TR_BANG}>
                    <td className={TD_BANG}>
                      <Link
                        href={`/elearning/soan-khoa/${k.id}`}
                        className="font-medium text-primary-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {k.title}
                      </Link>
                    </td>
                    <td className={`${TD_BANG} whitespace-nowrap font-mono text-xs`}>{k.code}</td>
                    <td className={`${TD_BANG} whitespace-nowrap font-mono text-xs text-muted-foreground`}>
                      {k.program ? k.program.code : "—"}
                    </td>
                    <td className={`${TD_BANG} whitespace-nowrap`}>
                      <TrangThaiBadge sac={SAC_TT[k.status] ?? "muted"}>{NHAN_TT[k.status] ?? k.status}</TrangThaiBadge>
                    </td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{k._count.modules}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>
    </TrangQuanTri>
  );
}
