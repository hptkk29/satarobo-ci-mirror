import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napHangCho } from "@/lib/elearning/exam-grading-queue";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, Khoi, KhoiRong, QuayLai, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU, NUT_NHO } from "../_components/ui/dieu-khien";

/**
 * EL-14e — HÀNG CHỜ CHẤM TAY.
 *
 * ⚠️ Màn này là LỐI RA của trạng thái `PENDING_GRADE`. Không có nó thì mọi lượt thi
 * có câu tự luận treo vĩnh viễn: điểm mãi `null`, bài không bao giờ xong, và người
 * học đứng nguyên tại một bài nghĩa vụ có hạn chót cứng cho tới lúc bị khoá vì quá
 * hạn — không làm gì sai và không có đường nào tự thoát.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chấm bài | Sata Robo",
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
  if (!can(actor, "elearning:exam:grade")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Chấm bài" />
        <NoPermission permission="elearning:exam:grade" what="hàng chờ chấm bài thi" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const { dong: hangCho, conNua } = await napHangCho(scopedDb(actor), {
    bayGio: new Date(),
  });

  return (
    <TrangQuanTri rong="vua">
      <div>
        <nav aria-label="Liên quan" className="flex flex-wrap gap-x-4">
          <QuayLai href="/elearning/de-thi">Đề thi</QuayLai>
          {/* Nối chéo hai hàng chờ: cùng NGƯỜI chấm, khác nhịp và khác hình dạng nên
              tách màn — nhưng người chấm phải đi lại được giữa hai bên. */}
          <Link href="/elearning/cham-bai-tap" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
            Chấm bài tập
          </Link>
        </nav>
        <PageHeader
          className="mb-0 mt-1"
          title="Chấm bài"
          subtitle="Bài đã nộp còn câu tự luận, đang chờ người đọc. Người chờ lâu nhất xếp trước."
        />
      </div>

      {conNua ? (
        // Im lặng cắt danh sách là để người chấm đọc hết trang rồi tin là hết việc.
        <GhiChu sac="warning">
          Còn bài chờ chấm ngoài danh sách này — chấm bớt rồi tải lại trang để thấy
          tiếp.
        </GhiChu>
      ) : null}

      <Khoi tieuDe={`Bài đang chờ chấm (${hangCho.length})`} sat>
        {hangCho.length === 0 ? (
          <KhoiRong
            title="Không có bài nào đang chờ chấm"
            description="Lượt thi có câu tự luận sẽ vào hàng chờ này sau khi người học nộp bài."
          />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="bài" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Người học</th>
                  <th scope="col" className={TH_BANG}>Đề</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Lượt</th>
                  <th scope="col" className={TH_BANG}>Chờ</th>
                  <th scope="col" className={TH_BANG}><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {hangCho.map((d) => (
                  <tr key={d.attemptId} className={TR_BANG}>
                    <td className={`${TD_BANG} font-medium`}>{d.tenNguoiHoc}</td>
                    <td className={TD_BANG}>{d.tenDe}</td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{d.attemptNo}</td>
                    <td className={`${TD_BANG} whitespace-nowrap`}>
                      {/* Chờ quá lâu thì phải NHÌN THẤY được, không nằm lẫn trong danh sách: đây là hạn chót của một
                          người khác, không phải của người chấm. Chữ luôn có — màu chỉ bổ sung. */}
                      <TrangThaiBadge sac={(d.soNgayCho ?? 0) >= 3 ? "danger" : "muted"}>
                        {d.soNgayCho == null
                          ? "chưa rõ mốc nộp"
                          : d.soNgayCho === 0
                            ? "nộp hôm nay"
                            : `đã chờ ${d.soNgayCho} ngày`}
                      </TrangThaiBadge>
                    </td>
                    <td className={`${TD_BANG} text-right`}>
                      <Link href={`/elearning/cham-bai/${d.attemptId}`} className={NUT_NHO}>
                        Chấm bài này
                      </Link>
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
