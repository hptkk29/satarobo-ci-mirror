import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { TRAN_HANG_CHO } from "@/lib/elearning/exam-grading-queue";
import { dongPhuDe, tomTatDe } from "@/lib/elearning/de-thi-hien";
import { docTatCaDeThiOnline } from "@/lib/elearning-online/doc";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, Khoi, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri, KhoiRong } from "../_components/ui/trang";
import { LIEN_KET_CHU, NUT_NHO, NUT_PHU } from "../_components/ui/dieu-khien";
import { NewExamForm } from "./_components/new-exam-form";

/** Ô thao tác dính mép phải: bảng cuộn ngang ở khổ hẹp mà nút Mở/Dựng đề vẫn nhìn thấy. */
const O_THAO_TAC = "sticky right-0 bg-card shadow-[-10px_0_8px_-8px_rgba(0,0,0,0.14)]";

/**
 * EL-14c + P8 — DANH SÁCH ĐỀ THI (thiết kế `QtDeThi`): bảng "Tạo đề mới" mở sẵn, bảng "Các đề" có dòng phụ (câu · dạng · câu chấm tay), cột "Gắn vào", nút "Chấm bài thi · N chờ".
 *
 * ⚠️ Đề KHÔNG tự tới người học. Nó tới qua một bài dạng `QUIZ`, và đường nối là
 * `TrnLesson.examId` — đặt ở màn soạn bài. Màn này nói rõ bước tiếp, vì dựng xong
 * một đề rồi không biết làm gì với nó là bỏ dở giữa chừng.
 *
 * ⚠️ MIỀN DỮ LIỆU: hai bảng TÁCH BẠCH. "Các đề" = `TrnExam` (nội bộ) — chỉ khoá nội bộ vào ô "Thuộc khoá". "Đề của khoá online" = `OnlAssessment` (miền Online, quyền
 * `onl:course:view` riêng), CHỈ ĐỌC và dẫn sang màn khoá online; KHÔNG có đường tạo/sửa đề online ở đây và khoá online không bao giờ xuất hiện trong ô "Thuộc khoá".
 * (Thiết kế vẽ hai loại chung một bảng — cố ý tách để không trộn dữ liệu/quyền hai miền.)
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
  const xemDeOnline = can(actor, "onl:course:view");
  const [cacDe, cacKhoa, deOnline] = await Promise.all([
    db.trnExam.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        title: true,
        courseId: true,
        isActive: true,
        passScore: true,
        maxScore: true,
        durationMin: true,
        maxAttempts: true,
        _count: { select: { attempts: true } },
        // Loại từng câu trong đề — để đếm số dạng và số câu chấm tay (không nạp nội dung câu).
        questions: { select: { question: { select: { type: true } } } },
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
    xemDeOnline ? docTatCaDeThiOnline() : Promise.resolve(null),
  ]);
  const tenKhoa = new Map(cacKhoa.map((k) => [k.id, k.title] as const));

  return (
    <TrangQuanTri rong="vua">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          className="mb-0 min-w-0 flex-1"
          title="Đề thi"
          subtitle={
            <>
              Dựng đề từ{" "}
              <Link href="/elearning/kho-cau-hoi" className={LIEN_KET_CHU}>
                ngân hàng câu hỏi
              </Link>
              . Đề chỉ tới người học qua một bài dạng bài kiểm tra.
            </>
          }
        />
        {/* Lối vào HÀNG CHỜ CHẤM. Đặt ở đây vì cả ba vai có `elearning:exam:grade` đều có
            `elearning:content:author`; ngày nào tách ra thì phải tìm cho nó lối vào khác. */}
        {can(actor, "elearning:exam:grade") ? (
          <Link href="/elearning/cham-bai" className={NUT_PHU}>
            {demChoCham > 0 ? `Chấm bài thi · ${demTran ? `hơn ${TRAN_HANG_CHO}` : demChoCham} chờ` : "Chấm bài thi · không có bài chờ"}
          </Link>
        ) : null}
      </div>

      {/* Nói rõ ĐƯỜNG ĐI, vì đề chỉ tới được người học qua một bài dạng
          "Bài kiểm tra" — dựng xong đề mà không biết bước tiếp là bỏ dở giữa chừng. */}
      <GhiChu sac="info">
        Đề chỉ tới người học qua một bài dạng <strong>Bài kiểm tra</strong>: kích
        hoạt đề xong, mở bài đó ở màn soạn khoá rồi gắn đề vào.
      </GhiChu>

      <NewExamForm cacKhoa={cacKhoa} moSan />

      <Khoi id="cac-de-noi-bo" tieuDe={`Các đề (${cacDe.length})`} sat>
        {cacDe.length === 0 ? (
          <KhoiRong title="Chưa có đề nào" description="Tạo đề ở khối trên, rồi thêm câu hỏi từ kho câu hỏi." />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="đề" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Đề</th>
                  <th scope="col" className={TH_BANG}>Gắn vào</th>
                  <th scope="col" className={TH_BANG}>Trạng thái</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Thời lượng</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Điểm đạt</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Lượt</th>
                  <th scope="col" className={`${TH_BANG} ${O_THAO_TAC}`}><span className="sr-only">Thao tác</span></th>
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
                      <span className="block text-xs text-muted-foreground">{dongPhuDe(tomTatDe(d.questions.map((q) => q.question.type)))}</span>
                    </td>
                    <td className={TD_BANG}>
                      <span className="block text-foreground">Khoá nội bộ</span>
                      <span className="block text-xs text-muted-foreground">{d.courseId ? (tenKhoa.get(d.courseId) ?? "(khoá không còn)") : "Chưa gắn khoá"}</span>
                    </td>
                    <td className={`${TD_BANG} whitespace-nowrap`}>
                      <TrangThaiBadge sac={d.isActive ? "success" : "muted"}>{d.isActive ? "Đã kích hoạt" : "Nháp"}</TrangThaiBadge>
                    </td>
                    <td className={`${TD_BANG} whitespace-nowrap text-right tabular-nums`}>{d.durationMin} phút</td>
                    <td className={`${TD_BANG} whitespace-nowrap text-right tabular-nums`}>
                      {d.passScore}
                      {d.isActive ? `/${d.maxScore}` : ""}
                    </td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{d._count.attempts}</td>
                    <td className={`${TD_BANG} text-right ${O_THAO_TAC}`}>
                      <Link href={`/elearning/de-thi/${d.id}`} aria-label={`${d.isActive ? "Mở" : "Dựng"} đề ${d.title}`} className={d.isActive ? NUT_NHO : NUT_PHU}>
                        {d.isActive ? "Mở" : "Dựng đề"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>

      {deOnline ? (
        <Khoi
          id="de-khoa-online"
          tieuDe={`Đề của khoá online (${deOnline.tong})`}
          moTa="Miền Online tách riêng: chỉ xem ở đây, dựng và sửa đề ở màn của từng khoá online."
          sat
        >
          {deOnline.dong.length === 0 ? (
            <KhoiRong title="Chưa có đề kiểm tra nào ở khoá online" description="Đề của khoá online được dựng ở màn khoá online." />
          ) : (
            <PhanTrangBang cuonNgang tenDonVi="đề" soDongMacDinh={20}>
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className={THEAD_BANG}>
                    <th scope="col" className={TH_BANG}>Đề</th>
                    <th scope="col" className={TH_BANG}>Gắn vào</th>
                    <th scope="col" className={TH_BANG}>Trạng thái</th>
                    <th scope="col" className={`${TH_BANG} text-right`}>Thời lượng</th>
                    <th scope="col" className={`${TH_BANG} text-right`}>Điểm đạt</th>
                    <th scope="col" className={`${TH_BANG} text-right`}>Lượt</th>
                    <th scope="col" className={`${TH_BANG} ${O_THAO_TAC}`}><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody>
                  {deOnline.dong.map((d) => (
                    <tr key={d.id} className={TR_BANG}>
                      <td className={TD_BANG}>
                        <span className="font-medium text-foreground">{d.title}</span>
                        <span className="block text-xs text-muted-foreground">{d._count.questions} câu</span>
                      </td>
                      <td className={TD_BANG}>
                        <span className="block text-foreground">Khoá online</span>
                        <span className="block text-xs text-muted-foreground">{d.course.name}</span>
                      </td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>
                        <TrangThaiBadge sac={d.status === "ACTIVE" ? "success" : "muted"}>
                          {d.status === "ACTIVE" ? "Đã kích hoạt" : d.status === "ARCHIVED" ? "Đã lưu trữ" : "Nháp"}
                        </TrangThaiBadge>
                      </td>
                      <td className={`${TD_BANG} whitespace-nowrap text-right tabular-nums`}>{d.timeLimitMin ? `${d.timeLimitMin} phút` : "Không giới hạn"}</td>
                      <td className={`${TD_BANG} whitespace-nowrap text-right tabular-nums`}>{d.passPercent}%</td>
                      <td className={`${TD_BANG} text-right tabular-nums`}>{d._count.attempts}</td>
                      <td className={`${TD_BANG} text-right ${O_THAO_TAC}`}>
                        <Link href={`/elearning/online/khoa/${d.courseId}`} aria-label={`Mở khoá online ${d.course.name}`} className={NUT_NHO}>
                          Mở
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          )}
        </Khoi>
      ) : null}
    </TrangQuanTri>
  );
}
