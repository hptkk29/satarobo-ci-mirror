import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { Khoi, QuayLai, TrangQuanTri } from "../../_components/ui/trang";
import { ExamBuilder } from "../_components/exam-builder";
import { UnlockPanel } from "../_components/unlock-panel";

/**
 * EL-14c — DỰNG BỘ CÂU CHO MỘT ĐỀ.
 *
 * ⚠️ Đề đọc QUA `scopedDb` — chính lượt đọc đó là cổng cách ly. Đọc bằng `db` trần
 * rồi tự so `centerId` là dựng bản kiểm phạm vi thứ hai, và bản thứ hai sẽ lệch.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dựng đề thi | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
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
        <PageHeader title="Dựng đề thi" />
        <NoPermission permission="elearning:content:author" what="màn dựng đề" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const { examId } = await params;

  const de = await db.trnExam.findFirst({
    where: { id: examId, deletedAt: null },
    select: {
      id: true,
      title: true,
      isActive: true,
      passScore: true,
      maxScore: true,
      durationMin: true,
      maxAttempts: true,
      questions: {
        select: {
          id: true,
          points: true,
          question: { select: { stem: true, type: true } },
        },
        orderBy: { orderIndex: "asc" },
      },
    },
  });
  if (!de) {
    return (
      <TrangQuanTri rong="hep">
        <QuayLai href="/elearning/de-thi">Danh sách đề</QuayLai>
        <PageHeader title="Dựng đề thi" />
        <EmptyState
          title="Không tìm thấy đề"
          description="Đề không tồn tại, hoặc thuộc cơ sở khác."
        />
      </TrangQuanTri>
    );
  }

  // ⚠️ Cần `questionId`, KHÔNG phải `TrnExamQuestion.id`. Hai id này khác nhau, và
  // so nhầm chúng thì bộ lọc luôn cho qua — cả kho hiện ra như thể chưa câu nào
  // được dùng, và người soạn thêm trùng rồi mới nhận lỗi từ khoá duy nhất.
  const dungTrongDe = new Set(
    (
      await db.trnExamQuestion.findMany({
        where: { examId: de.id },
        select: { questionId: true },
      })
    ).map((x) => x.questionId),
  );

  // Kho câu CÒN LẠI, lọc Ở SERVER: gửi cả kho xuống rồi lọc ở client là gửi kèm đề
  // bài của những câu không liên quan gì tới đề này.
  const khoCon = (
    await db.trnQuestion.findMany({
      where: { deletedAt: null },
      select: { id: true, stem: true, type: true, defaultPoints: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    })
  ).filter((q) => !dungTrongDe.has(q.id));

  // ── Ai đã hết lượt (để mở khoá) ───────────────────────────────────────────
  // Chỉ có nghĩa với đề ĐÃ kích hoạt; đề nháp thì chưa ai thi.
  const hetLuot: { userId: string; ten: string; soLuot: number; datChua: boolean }[] = [];
  if (de.isActive) {
    const luot = await db.trnExamAttempt.groupBy({
      by: ["userId"],
      where: { examId: de.id },
      _count: { _all: true },
    });
    const soMoKhoa = await db.trnExamUnlock.groupBy({
      by: ["userId"],
      where: { examId: de.id },
      _count: { _all: true },
    });
    const moKhoaCua = new Map(soMoKhoa.map((x) => [x.userId, x._count._all]));

    const canMo = luot.filter(
      (x) => x._count._all >= de.maxAttempts + (moKhoaCua.get(x.userId) ?? 0),
    );
    if (canMo.length > 0) {
      const [nguoi, daDat] = await Promise.all([
        db.user.findMany({
          where: { id: { in: canMo.map((x) => x.userId) } },
          select: { id: true, name: true, email: true },
        }),
        db.trnExamAttempt.findMany({
          where: { examId: de.id, userId: { in: canMo.map((x) => x.userId) }, passed: true },
          select: { userId: true },
        }),
      ]);
      const tenCua = new Map(nguoi.map((u) => [u.id, u.name ?? u.email ?? u.id]));
      const dat = new Set(daDat.map((x) => x.userId));
      for (const x of canMo) {
        hetLuot.push({
          userId: x.userId,
          ten: tenCua.get(x.userId) ?? x.userId,
          soLuot: x._count._all,
          datChua: dat.has(x.userId),
        });
      }
    }
  }

  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/de-thi">Danh sách đề</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title={de.title}
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-2">
              {de.durationMin} phút ·
              <TrangThaiBadge sac={de.isActive ? "success" : "muted"}>
                {de.isActive ? "Đã kích hoạt" : "Nháp"}
              </TrangThaiBadge>
            </span>
          }
        />
      </div>

      <ExamBuilder
        examId={de.id}
        isActive={de.isActive}
        passScore={de.passScore}
        maxScore={de.maxScore}
        title={de.title}
        durationMin={de.durationMin}
        maxAttempts={de.maxAttempts}
        cacCau={de.questions.map((q) => ({
          examQuestionId: q.id,
          stem: q.question.stem,
          type: q.question.type,
          points: q.points,
        }))}
        khoCon={khoCon}
        duocKichHoat={can(actor, "elearning:content:publish")}
      />

      {/* Mở khoá là quyền RIÊNG (`elearning:exam:unlock`), không phải quyền soạn —
          nên khối này gác cửa riêng. */}
      {de.isActive && can(actor, "elearning:exam:unlock") ? (
        <Khoi tieuDe="Mở thêm lượt thi">
          <UnlockPanel
            examId={de.id}
            hetLuot={hetLuot}
            tranLuot={de.maxAttempts}
          />
        </Khoi>
      ) : null}
    </TrangQuanTri>
  );
}
