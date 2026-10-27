import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { napHangChoTap } from "@/lib/elearning/task-grading-queue";
import { SLA_GRADE_DAYS } from "@/lib/elearning/metrics/constants";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, Khoi, KhoiRong, QuayLai, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { NUT_NHO } from "../_components/ui/dieu-khien";

/**
 * EL-15c — HÀNG CHỜ CHẤM BÀI TẬP.
 *
 * ⚠️ Xếp theo HẠN CHẤM, không theo lúc nộp: hai lượt nộp cùng ngày có hạn khác nhau
 * nếu vắt qua cuối tuần, và thứ người chấm cần biết là "cái nào sắp vỡ SLA".
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chấm bài tập | Sata Robo",
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
        <PageHeader title="Chấm bài tập" />
        <NoPermission permission="elearning:exam:grade" what="hàng chờ chấm bài" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const { dong, conNua } = await napHangChoTap(scopedDb(actor), {
    bayGio: new Date(),
  });

  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/cham-bai">Chấm bài thi</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title="Chấm bài tập"
          subtitle={
            <>
              Hạn chấm là <strong>{SLA_GRADE_DAYS} ngày làm việc</strong> kể từ lúc người
              học nộp. Quá hạn thì hệ thống tự nới hạn của họ — bài nào sắp vỡ hạn xếp
              lên trước.
            </>
          }
        />
      </div>

      {conNua ? (
        <GhiChu sac="warning">
          Còn bài chờ chấm ngoài danh sách này — chấm bớt rồi tải lại trang.
        </GhiChu>
      ) : null}

      <Khoi tieuDe={`Bài đang chờ chấm (${dong.length})`} sat>
        {dong.length === 0 ? (
          <KhoiRong
            title="Không có bài tập nào đang chờ chấm"
            description="Khi người học nộp bài tập, bài sẽ xuất hiện ở đây theo hạn chấm."
          />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="bài" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Người học</th>
                  <th scope="col" className={TH_BANG}>Bài</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Lượt</th>
                  <th scope="col" className={TH_BANG}>Hạn chấm</th>
                  <th scope="col" className={TH_BANG}><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {dong.map((d) => (
                  <tr key={d.submissionId} className={TR_BANG}>
                    <td className={`${TD_BANG} font-medium`}>{d.tenNguoiHoc}</td>
                    <td className={TD_BANG}>{d.tenBai}</td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{d.attemptNo}</td>
                    <td className={`${TD_BANG} whitespace-nowrap`}>
                      {/* Quá hạn phải NHÌN THẤY được: đây là hạn của một người khác, và nó đang trôi vì mình chưa đọc.
                          Chữ luôn có — màu chỉ bổ sung. */}
                      {d.quaHanNgayLam > 0 ? (
                        <TrangThaiBadge sac="danger">{`quá hạn ${d.quaHanNgayLam} ngày làm việc`}</TrangThaiBadge>
                      ) : (
                        <span className="text-muted-foreground">
                          {d.dueGradeAt ? `hạn ${d.dueGradeAt.toLocaleDateString("vi-VN")}` : "chưa rõ hạn"}
                        </span>
                      )}
                    </td>
                    <td className={`${TD_BANG} text-right`}>
                      <Link href={`/elearning/cham-bai-tap/${d.submissionId}`} className={NUT_NHO}>
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
