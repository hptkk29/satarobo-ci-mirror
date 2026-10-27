import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState } from "@/components/admin/ui/states";
import type { SacThai } from "@/lib/elearning/dashboard-pure";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { Khoi, LIEN_KET_THE, MuiTen, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri, KhoiRong } from "../_components/ui/trang";
import { napNhanSuChon } from "@/lib/elearning/nhan-su-chon";
import { dieuKienPhieuXem } from "@/lib/elearning/training-need";
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

// Màu chỉ BỔ SUNG cho chữ ("Đã duyệt"…), không thay thế.
const SAC_TRANG_THAI: Record<string, SacThai> = {
  DRAFT: "muted",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  RUNNING: "info",
  DONE: "success",
  EVALUATED: "success",
  CANCELLED: "muted",
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
  const db = scopedDb(actor);

  // Ai cũng ĐỀ NGHỊ được đào tạo; chỉ người có `program:manage` mới lập chương
  // trình và duyệt phiếu. Hai quyền khác nhau, hai khối khác nhau trên màn hình.
  const quanLy = can(actor, "elearning:program:manage");
  // Lối tắt sang các màn soạn chỉ vẽ cho người MỞ ĐƯỢC chúng — khớp thanh điều hướng.
  const duocSoan = can(actor, "elearning:content:author");

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
      // Người quản lý thấy mọi phiếu trong phạm vi; người chỉ ĐỀ NGHỊ chỉ thấy phiếu CỦA MÌNH (xem `dieuKienPhieuXem`).
      where: dieuKienPhieuXem({ quanLy, userId: session.user.id }),
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

  const nhanPhieu = (p: { code: string; title: string }) => `${p.code} — ${p.title}`;

  // Danh sách chọn "Người chịu trách nhiệm nội dung": CHỈ nạp cho người lập được chương trình (`program:manage`), đọc qua
  // `scopedDb` nên đã giới hạn theo cơ sở. Người chỉ gửi đề nghị đào tạo không bị truy vấn danh sách nhân sự.
  const nhanSu = quanLy ? await napNhanSuChon(db) : { ds: [], daCat: false };

  return (
    <TrangQuanTri>
      <PageHeader
        title="Chương trình đào tạo"
        subtitle="Phiếu nhu cầu → chương trình → khoá học. Khoá luôn thuộc một chương trình."
      />

      <Khoi tieuDe="Việc bạn có thể làm" moTa={quanLy ? "Đề nghị, lập chương trình, tạo khoá và duyệt phiếu." : "Bạn có thể gửi đề nghị đào tạo; phòng Đào tạo sẽ duyệt."}>
        <ProgramPanel
          quanLy={quanLy}
          nhanSu={nhanSu.ds}
          nhanSuDaCat={nhanSu.daCat}
          // Hai danh sách dưới chỉ phục vụ khối của người quản lý. Người đề nghị KHÔNG nhận chúng: props của component client đi
          // qua payload RSC nên nằm trong tab Network dù màn hình không vẽ.
          phieuDaDuyet={(quanLy ? phieu : [])
            .filter((p: { status: string }) => p.status === "APPROVED")
            .map((p: { id: string; code: string; title: string }) => ({
              id: p.id,
              nhan: nhanPhieu(p),
            }))}
          phieuChoDuyet={(quanLy ? phieu : [])
            .filter((p: { status: string }) => p.status !== "APPROVED")
            .map((p: { id: string; code: string; title: string }) => ({
              id: p.id,
              nhan: nhanPhieu(p),
            }))}
          chuongTrinh={chuongTrinh.map(
            (c: { id: string; code: string; title: string }) => ({
              id: c.id,
              nhan: nhanPhieu(c),
            }),
          )}
        />
      </Khoi>

      {quanLy && (
        <Khoi tieuDe={`Chương trình (${chuongTrinh.length})`} sat>
          {chuongTrinh.length === 0 ? (
            <KhoiRong
                title="Chưa có chương trình nào"
                description="Chọn “Lập chương trình” ở khối trên để tạo chương trình đầu tiên. Khoá học chỉ tạo được khi đã có chương trình."
              />
          ) : (
            <PhanTrangBang cuonNgang tenDonVi="chương trình" soDongMacDinh={20}>
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className={THEAD_BANG}>
                    <th scope="col" className={TH_BANG}>Mã</th>
                    <th scope="col" className={TH_BANG}>Tên</th>
                    <th scope="col" className={TH_BANG}>Tính chất</th>
                    <th scope="col" className={TH_BANG}>Trạng thái</th>
                    <th scope="col" className={`${TH_BANG} text-right`}>Khoá</th>
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
                      <tr key={c.id} className={TR_BANG}>
                        <td className={`${TD_BANG} whitespace-nowrap font-mono text-xs`}>{c.code}</td>
                        <td className={TD_BANG}>
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <span className="font-medium">{c.title}</span>
                            {c.needsReview && (
                              // Văn bản nguồn lên phiên bản mới ⇒ khoá tự chuyển
                              // "Cần rà lại". Không hiện ra thì cờ đó vô nghĩa.
                              <TrangThaiBadge sac="warning">Cần rà lại</TrangThaiBadge>
                            )}
                          </span>
                        </td>
                        <td className={`${TD_BANG} whitespace-nowrap`}>
                          {NHAN_TINH_CHAT[c.natureTag] ?? c.natureTag}
                        </td>
                        <td className={`${TD_BANG} whitespace-nowrap`}>
                          <TrangThaiBadge sac={SAC_TRANG_THAI[c.status] ?? "muted"}>
                            {NHAN_TRANG_THAI[c.status] ?? c.status}
                          </TrangThaiBadge>
                        </td>
                        <td className={`${TD_BANG} text-right tabular-nums`}>{c._count.courses}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </PhanTrangBang>
          )}
        </Khoi>
      )}

      <Khoi
        tieuDe={quanLy ? `Phiếu nhu cầu (${phieu.length})` : `Phiếu bạn đã gửi (${phieu.length})`}
        moTa={quanLy ? undefined : "Chỉ hiện các đề nghị do chính bạn gửi. Phòng Đào tạo sẽ duyệt và báo kết quả."}
        sat
      >
        {phieu.length === 0 ? (
          <KhoiRong
              title={quanLy ? "Chưa có phiếu nhu cầu nào" : "Bạn chưa gửi đề nghị nào"}
              description="Bất kỳ ai cũng gửi được đề nghị đào tạo bằng nút “Đề nghị đào tạo” ở khối trên."
            />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="phiếu" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Mã</th>
                  <th scope="col" className={TH_BANG}>Nhu cầu</th>
                  <th scope="col" className={TH_BANG}>Đối tượng</th>
                  <th scope="col" className={TH_BANG}>Quý</th>
                  <th scope="col" className={TH_BANG}>Trạng thái</th>
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
                    <tr key={p.id} className={TR_BANG}>
                      <td className={`${TD_BANG} whitespace-nowrap font-mono text-xs`}>{p.code}</td>
                      <td className={`${TD_BANG} font-medium`}>{p.title}</td>
                      <td className={`${TD_BANG} text-muted-foreground`}>{p.targetGroupText}</td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>{p.proposedQuarter}</td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>
                        {p.status === "APPROVED" ? (
                          <TrangThaiBadge sac="success">Đã duyệt</TrangThaiBadge>
                        ) : (
                          <TrangThaiBadge sac="muted">Mới</TrangThaiBadge>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>

      {/* Lối tắt cho các màn soạn — chỉ vẽ cho người có quyền soạn (thanh điều hướng cũng ẩn chúng với người khác). */}
      {duocSoan && (
        <nav aria-label="Các màn soạn liên quan">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Đi tới</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/elearning/soan-khoa" className={LIEN_KET_THE}>
              <span>Soạn khoá <span className="block text-xs font-normal text-muted-foreground">Chương, bài, xuất bản</span></span>
              <MuiTen />
            </Link>
            <Link href="/elearning/kho-cau-hoi" className={LIEN_KET_THE}>
              <span>Ngân hàng câu hỏi <span className="block text-xs font-normal text-muted-foreground">Câu hỏi cho đề thi</span></span>
              <MuiTen />
            </Link>
            <Link href="/elearning/de-thi" className={LIEN_KET_THE}>
              <span>Đề thi <span className="block text-xs font-normal text-muted-foreground">Dựng và mở khoá đề</span></span>
              <MuiTen />
            </Link>
            <Link href="/elearning/khung-cham" className={LIEN_KET_THE}>
              <span>Khung chấm <span className="block text-xs font-normal text-muted-foreground">Tiêu chí chấm bài tập</span></span>
              <MuiTen />
            </Link>
          </div>
        </nav>
      )}
    </TrangQuanTri>
  );
}
