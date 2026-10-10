import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { ProgramPanel } from "./_components/program-panel";

/**
 * EL-08 — CHƯƠNG TRÌNH ĐÀO TẠO + PHIẾU NHU CẦU.
 *
 * Trang này là bước ĐẦU của cổng nghiệm thu GĐ1: Đào tạo vào đây lập chương
 * trình, rồi từ chương trình mới tạo được khoá. Không có khoá mồ côi — chương
 * trình là nơi giữ sáu nhóm thẻ phân loại và mối nối với phiếu nhu cầu (§8.1).
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chương trình đào tạo | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_TINH_CHAT: Record<string, string> = {
  MANDATORY: "Bắt buộc",
  MANDATORY_COMPLIANCE: "Bắt buộc (tuân thủ)",
  RECOMMENDED: "Khuyến nghị",
  OPTIONAL: "Tự chọn",
};

const NHAN_TRANG_THAI: Record<string, string> = {
  DRAFT: "Nháp",
  PENDING_APPROVAL: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  RUNNING: "Đang chạy",
  DONE: "Đã xong",
  EVALUATED: "Đã đánh giá",
  CANCELLED: "Đã huỷ",
};

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const actor = await resolveActor(session.user.id);
  const db = scopedDb(actor);

  // Ai cũng ĐỀ NGHỊ được đào tạo; chỉ người có `program:manage` mới lập chương
  // trình và duyệt phiếu. Hai quyền khác nhau, hai khối khác nhau trên màn hình.
  const quanLy = can(actor, "elearning:program:manage");

  const [chuongTrinh, phieu] = await Promise.all([
    quanLy
      ? db.trnProgram.findMany({
          where: { deletedAt: null },
          select: {
            id: true,
            code: true,
            title: true,
            natureTag: true,
            status: true,
            needsReview: true,
            _count: { select: { courses: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
    db.trnTrainingNeed.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        proposedQuarter: true,
        targetGroupText: true,
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Chương trình đào tạo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phiếu nhu cầu → chương trình → khoá học. Khoá luôn thuộc một chương trình.
        </p>
      </div>

      <ProgramPanel
        quanLy={quanLy}
        phieuDaDuyet={phieu
          .filter((p: { status: string }) => p.status === "APPROVED")
          .map((p: { id: string; code: string; title: string }) => ({
            id: p.id,
            nhan: `${p.code} — ${p.title}`,
          }))}
        chuongTrinh={chuongTrinh.map(
          (c: { id: string; code: string; title: string }) => ({
            id: c.id,
            nhan: `${c.code} — ${c.title}`,
          }),
        )}
      />

      {quanLy && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">
            Chương trình ({chuongTrinh.length})
          </h2>
          {chuongTrinh.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có chương trình nào. Lập một chương trình ở khối trên trước.
            </p>
          ) : (
            <PhanTrangBang cuonNgang tenDonVi="chương trình" soDongMacDinh={20}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-2 py-1 font-medium">Mã</th>
                    <th className="px-2 py-1 font-medium">Tên</th>
                    <th className="px-2 py-1 font-medium">Tính chất</th>
                    <th className="px-2 py-1 font-medium">Trạng thái</th>
                    <th className="px-2 py-1 font-medium">Khoá</th>
                  </tr>
                </thead>
                <tbody>
                  {chuongTrinh.map(
                    (c: {
                      id: string;
                      code: string;
                      title: string;
                      natureTag: string;
                      status: string;
                      needsReview: boolean;
                      _count: { courses: number };
                    }) => (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="px-2 py-1 font-mono text-xs">{c.code}</td>
                        <td className="px-2 py-1">
                          {c.title}
                          {c.needsReview && (
                            // Văn bản nguồn lên phiên bản mới ⇒ khoá tự chuyển
                            // "Cần rà lại". Không hiện ra thì cờ đó vô nghĩa.
                            <span className="ml-2 rounded bg-state-warning-soft px-1.5 py-0.5 text-xs">
                              Cần rà lại
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {NHAN_TINH_CHAT[c.natureTag] ?? c.natureTag}
                        </td>
                        <td className="px-2 py-1">
                          {NHAN_TRANG_THAI[c.status] ?? c.status}
                        </td>
                        <td className="px-2 py-1">{c._count.courses}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </PhanTrangBang>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Phiếu nhu cầu ({phieu.length})</h2>
        {phieu.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có phiếu nhu cầu nào.</p>
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="phiếu" soDongMacDinh={20}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-1 font-medium">Mã</th>
                  <th className="px-2 py-1 font-medium">Nhu cầu</th>
                  <th className="px-2 py-1 font-medium">Đối tượng</th>
                  <th className="px-2 py-1 font-medium">Quý</th>
                  <th className="px-2 py-1 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {phieu.map(
                  (p: {
                    id: string;
                    code: string;
                    title: string;
                    status: string;
                    proposedQuarter: string;
                    targetGroupText: string;
                  }) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-2 py-1 font-mono text-xs">{p.code}</td>
                      <td className="px-2 py-1">{p.title}</td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {p.targetGroupText}
                      </td>
                      <td className="px-2 py-1">{p.proposedQuarter}</td>
                      <td className="px-2 py-1">
                        {p.status === "APPROVED" ? "Đã duyệt" : "Mới"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>

      {/* Lối vào cho hai màn soạn. Trang không có lối vào thì chỉ người viết nó
          biết đường tới — khu e-learning không có thanh điều hướng chung, nên mỗi
          màn mới phải được một màn cũ dẫn tới. */}
      <p className="text-xs text-muted-foreground">
        Soạn nội dung khoá ở{" "}
        <Link href="/elearning/soan-khoa" className="underline">
          màn soạn khoá
        </Link>
        , câu hỏi cho đề thi ở{" "}
        <Link href="/elearning/kho-cau-hoi" className="underline">
          kho câu hỏi
        </Link>
        , đề thi ở{" "}
        <Link href="/elearning/de-thi" className="underline">
          màn đề thi
        </Link>
        , và khung chấm bài tập ở{" "}
        <Link href="/elearning/khung-cham" className="underline">
          màn khung chấm
        </Link>
        .
      </p>
    </div>
  );
}
