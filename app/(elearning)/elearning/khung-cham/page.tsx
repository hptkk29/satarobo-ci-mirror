import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, Khoi, QuayLai, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri, KhoiRong } from "../_components/ui/trang";
import { NewRubricForm } from "./_components/new-rubric-form";

/**
 * EL-15b — DANH SÁCH KHUNG CHẤM.
 *
 * ⚠️ Khung KHÔNG tự tới người học. Nó tới qua một bài dạng `TASK`, và đường nối là
 * `TrnLesson.rubricId`. Màn này nói rõ bước tiếp — dựng xong một khung rồi không
 * biết làm gì với nó là bỏ dở giữa chừng, đúng bài học của màn đề thi.
 *
 * ⚠️ Loại bài `TASK` CHƯA MỞ ở PR này: đường nộp và đường chấm chưa có. Nói thẳng
 * điều đó ra thay vì để người soạn dựng khung xong rồi đi tìm chỗ gắn.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Khung chấm | Sata Robo",
  robots: { index: false, follow: false },
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
        <PageHeader title="Khung chấm" />
        <NoPermission permission="elearning:content:author" what="khung chấm" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const cacKhung = await db.trnRubric.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      totalPoints: true,
      passPoints: true,
      _count: { select: { criteria: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/chuong-trinh">Chương trình</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title="Khung chấm"
          subtitle="Thước đo cho bài tập chấm tay: các tiêu chí, mỗi tiêu chí vài mức, mỗi mức một số điểm."
        />
      </div>
      {/* Nói rõ BƯỚC TIẾP. Dựng xong một khung rồi không biết làm gì với nó là
          bỏ dở giữa chừng — đúng bài học của màn đề thi. */}
      <GhiChu sac="info">
        Khung chỉ tới người học qua một bài dạng <strong>Bài tập</strong>: kích hoạt
        khung xong, mở bài đó ở màn soạn khoá rồi gắn khung vào.
      </GhiChu>

      <NewRubricForm />

      <Khoi tieuDe={`Các khung (${cacKhung.length})`} sat>
        {cacKhung.length === 0 ? (
          <KhoiRong title="Chưa có khung nào" description="Tạo khung ở khối trên, rồi thêm tiêu chí và các mức điểm." />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="khung" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Khung</th>
                  <th scope="col" className={TH_BANG}>Mã</th>
                  <th scope="col" className={TH_BANG}>Trạng thái</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Tiêu chí</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Điểm đạt</th>
                </tr>
              </thead>
              <tbody>
                {cacKhung.map((k) => (
                  <tr key={k.id} className={TR_BANG}>
                    <td className={TD_BANG}>
                      <Link
                        href={`/elearning/khung-cham/${k.id}`}
                        className="font-medium text-primary-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {k.title}
                      </Link>
                    </td>
                    <td className={`${TD_BANG} whitespace-nowrap font-mono text-xs`}>{k.code}</td>
                    <td className={`${TD_BANG} whitespace-nowrap`}>
                      <TrangThaiBadge sac={k.status === "ACTIVE" ? "success" : "muted"}>
                        {k.status === "ACTIVE" ? "Đã kích hoạt" : k.status === "ARCHIVED" ? "Đã lưu trữ" : "Nháp"}
                      </TrangThaiBadge>
                    </td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{k._count.criteria}</td>
                    <td className={`${TD_BANG} whitespace-nowrap text-right tabular-nums`}>
                      {k.passPoints}/{k.totalPoints}
                    </td>
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
