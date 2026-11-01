import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { TRAN_HANG_CHO } from "@/lib/elearning/exam-grading-queue";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, Khoi, LIEN_KET_THE, MuiTen, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri, KhoiRong } from "../_components/ui/trang";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";
import { NewExamForm } from "./_components/new-exam-form";

/**
 * EL-14c — DANH SÁCH ĐỀ THI.
 *
 * ⚠️ Đề KHÔNG tự tới người học. Nó tới qua một bài dạng `QUIZ`, và đường nối là
 * `TrnLesson.examId` — đặt ở màn soạn bài. Màn này nói rõ bước tiếp, vì dựng xong
 * một đề rồi không biết làm gì với nó là bỏ dở giữa chừng.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Đề thi | Sata Robo",
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
        <PageHeader title="Đề thi" />
        <NoPermission permission="elearning:content:author" what="đề thi" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  // Đếm bài đang chờ chấm để lối vào hàng chờ KHÔNG trông như một liên kết chết.
  // Người chấm không mở một màn "có thể trống"; họ mở một màn có N người đang đợi.
  // Đếm CHẶN ở đúng trần của hàng chờ: đếm không giới hạn rồi hiện "247 bài" trong
  // khi hàng chờ chỉ liệt kê 200 là hai con số lệch nhau mà không ai giải thích được.
  const demChoCham = can(actor, "elearning:exam:grade")
    ? await db.trnExamAttempt.count({
        where: { status: "PENDING_GRADE" },
        take: TRAN_HANG_CHO + 1,
      })
    : 0;
  const demTran = demChoCham > TRAN_HANG_CHO;
  const [cacDe, cacKhoa] = await Promise.all([
    db.trnExam.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        title: true,
        isActive: true,
        passScore: true,
        maxScore: true,
        durationMin: true,
        _count: { select: { questions: true, attempts: true } },
      },
      orderBy: [{ isActive: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    db.trnCourse.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      take: 200,
    }),
  ]);

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Đề thi"
        subtitle={
          <>
            Dựng đề từ{" "}
            <Link href="/elearning/kho-cau-hoi" className={LIEN_KET_CHU}>
              kho câu hỏi
            </Link>
            .
          </>
        }
      />
      {/* Nói rõ ĐƯỜNG ĐI, vì đề chỉ tới được người học qua một bài dạng
          "Bài kiểm tra" — dựng xong đề mà không biết bước tiếp là bỏ dở giữa chừng. */}
      <GhiChu sac="info">
        Đề chỉ tới người học qua một bài dạng <strong>Bài kiểm tra</strong>: kích
        hoạt đề xong, mở bài đó ở màn soạn khoá rồi gắn đề vào.
      </GhiChu>

      {/* Lối vào HÀNG CHỜ CHẤM. Đặt ở đây vì cả ba vai có `elearning:exam:grade` đều có
          `elearning:content:author`; ngày nào tách ra thì phải tìm cho nó lối vào khác. */}
      {can(actor, "elearning:exam:grade") ? (
        <Link href="/elearning/cham-bai" className={LIEN_KET_THE}>
          <span>
            {demChoCham > 0
              ? `Chấm bài — ${demTran ? `hơn ${TRAN_HANG_CHO}` : demChoCham} bài đang chờ`
              : "Chấm bài — không có bài nào chờ"}
            <span className="block text-xs font-normal text-muted-foreground">Mở hàng chờ chấm bài thi tự luận</span>
          </span>
          <MuiTen />
        </Link>
      ) : null}

      <NewExamForm cacKhoa={cacKhoa} />

      <Khoi tieuDe={`Các đề (${cacDe.length})`} sat>
        {cacDe.length === 0 ? (
          <KhoiRong
              title="Chưa có đề nào"
              description="Tạo đề ở khối trên, rồi thêm câu hỏi từ kho câu hỏi."
            />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="đề" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Đề</th>
                  <th scope="col" className={TH_BANG}>Trạng thái</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Câu</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Thời lượng</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Điểm đạt</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Lượt thi</th>
                </tr>
              </thead>
              <tbody>
                {cacDe.map((d) => (
                  <tr key={d.id} className={TR_BANG}>
                    <td className={TD_BANG}>
                      <Link
                        href={`/elearning/de-thi/${d.id}`}
                        className="font-medium text-primary-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {d.title}
                      </Link>
                    </td>
                    <td className={`${TD_BANG} whitespace-nowrap`}>
                      <TrangThaiBadge sac={d.isActive ? "success" : "muted"}>
                        {d.isActive ? "Đã kích hoạt" : "Nháp"}
                      </TrangThaiBadge>
                    </td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{d._count.questions}</td>
                    <td className={`${TD_BANG} whitespace-nowrap text-right tabular-nums`}>{d.durationMin} phút</td>
                    <td className={`${TD_BANG} whitespace-nowrap text-right tabular-nums`}>
                      {d.passScore}
                      {d.isActive ? `/${d.maxScore}` : ""}
                    </td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{d._count.attempts}</td>
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
