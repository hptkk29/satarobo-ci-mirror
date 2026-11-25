import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cauTrangThai, trangThaiHienThi } from "@/lib/elearning/certificate";
import { RevokeButton } from "./_components/revoke-button";
import { IssueButton } from "./_components/issue-button";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { Khoi, KhoiRong, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU, NUT_NHO } from "../_components/ui/dieu-khien";

/**
 * EL-16 — DANH SÁCH CHỨNG NHẬN đã cấp, và nơi thu hồi.
 *
 * ⚠️ Trang này là CỬA của một cổng vừa mở: `thuHoiChungNhanAction` đòi quyền
 * `elearning:certificate:revoke`, và không có màn nào gọi thì cái quyền ấy chỉ là
 * một dòng trong bảng phân quyền. Năm action mồ côi của EL-09 đã dạy đúng bài này.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chứng nhận đào tạo | Sata Robo",
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

  // Xem danh sách đi bằng khoá xem tiến độ toàn hệ; THU HỒI đi bằng khoá riêng.
  // Hai việc khác nhau: phòng Đào tạo cần thấy ai đã có chứng nhận gì, nhưng vô
  // hiệu một chứng từ là quyết định của Nhân sự Hội sở.
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Chứng nhận đã cấp" />
        <NoPermission permission="elearning:progress:view-all" what="danh sách chứng nhận" askWho="phòng Đào tạo hoặc Nhân sự" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const duocThuHoi = can(actor, "elearning:certificate:revoke");
  const duocCap = can(actor, "elearning:certificate:issue");
  const db = scopedDb(actor);
  const now = new Date();

  const ds = await db.trnCertificate.findMany({
    select: {
      id: true,
      certCode: true,
      snapFullName: true,
      snapEmployeeCode: true,
      issuedAt: true,
      validUntil: true,
      revokedAt: true,
      revokeReason: true,
      status: true,
      courseId: true,
    },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });

  const tenKhoa = new Map(
    (
      await db.trnCourse.findMany({
        where: { id: { in: [...new Set(ds.map((c) => c.courseId))] } },
        select: { id: true, title: true },
      })
    ).map((k) => [k.id, k.title]),
  );

  // ⚠️ Lượt ĐÃ HOÀN THÀNH mà CHƯA có chứng nhận — chỗ bấm của nút cấp tay.
  //
  // Không liệt kê thì nút cấp tay không có nơi nào để bấm, và khoá quyền
  // `certificate:issue` lại thành một dòng chết. Nhóm này KHÔNG rỗng trên thực tế:
  // mọi lượt hoàn thành TRƯỚC khi EL-16 lên chạy đều rơi vào đây — sự kiện của
  // chúng đã chạy xong từ lâu và `verifiedAt` còn NULL.
  const chuaCap = duocCap
    ? await db.trnEnrollment.findMany({
        where: {
          status: { in: ["COMPLETED", "COMPLETED_LATE"] },
          revokedAt: null,
          certificate: { is: null },
        },
        select: {
          id: true,
          userId: true,
          courseId: true,
          completedAt: true,
          verifiedAt: true,
        },
        orderBy: { completedAt: "desc" },
        take: 50,
      })
    : [];

  const tenNguoi = new Map(
    chuaCap.length === 0
      ? []
      : (
          await db.user.findMany({
            where: { id: { in: [...new Set(chuaCap.map((e) => e.userId))] } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name ?? "(không rõ tên)"] as const),
  );

  const tenKhoaChuaCap = new Map(
    chuaCap.length === 0
      ? []
      : (
          await db.trnCourse.findMany({
            where: { id: { in: [...new Set(chuaCap.map((e) => e.courseId))] } },
            select: { id: true, title: true },
          })
        ).map((k) => [k.id, k.title] as const),
  );

  const ngay = (d: Date) => d.toLocaleDateString("vi-VN");

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Chứng nhận đã cấp"
        subtitle={
          /* Nói ra rằng chứng nhận cấp TỰ ĐỘNG — nếu không, người vận hành sẽ đi tìm
             nút "cấp chứng nhận" không tồn tại và tưởng hệ thống thiếu chức năng. */
          <>
            Chứng nhận được cấp tự động khi một lượt học hoàn thành có kiểm chứng.
            Trạng thái dưới đây suy từ hạn hiệu lực, không đọc từ cột đã lưu.
          </>
        }
      />

      {chuaCap.length > 0 ? (
        <Khoi
          tieuDe={`${chuaCap.length} lượt đã hoàn thành nhưng chưa có chứng nhận`}
          moTa="Thường là lượt hoàn thành trước khi khâu cấp tự động lên chạy. Cấp tay vẫn đi qua đủ điều kiện và vẫn tự suy hạn hiệu lực."
          className="border-state-warning/40"
        >
          <ul className="divide-y divide-border">
            {chuaCap.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{tenNguoi.get(e.userId)}</span>
                  {" · "}
                  {tenKhoaChuaCap.get(e.courseId) ?? "(khoá đã gỡ)"}
                  {e.completedAt ? ` · xong ${ngay(e.completedAt)}` : ""}
                  {e.verifiedAt == null ? (
                    <span className="mt-0.5 block text-sm text-state-warning-ink">
                      (lượt cũ, chưa có mốc kiểm chứng — cấp tay sẽ đóng dấu theo ngày
                      hoàn thành)
                    </span>
                  ) : null}
                </div>
                <IssueButton
                  enrollmentId={e.id}
                  tenNguoi={tenNguoi.get(e.userId) ?? "người này"}
                />
              </li>
            ))}
          </ul>
        </Khoi>
      ) : null}

      <Khoi tieuDe={`Chứng nhận (${ds.length})`} sat>
        {ds.length === 0 ? (
          <KhoiRong
            title="Chưa có chứng nhận nào được cấp"
            description="Chứng nhận tự cấp khi một lượt học hoàn thành có kiểm chứng."
          />
        ) : (
          /* Danh sách này dài dần theo từng năm và không bao giờ ngắn lại — chứng
             nhận không bị xoá, chỉ hết hiệu lực hoặc bị thu hồi. */
          <PhanTrangBang cuonNgang tenDonVi="chứng nhận" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Số hiệu</th>
                  <th scope="col" className={TH_BANG}>Người được cấp</th>
                  <th scope="col" className={TH_BANG}>Khoá</th>
                  <th scope="col" className={TH_BANG}>Ngày cấp</th>
                  <th scope="col" className={TH_BANG}>Hiệu lực</th>
                  <th scope="col" className={TH_BANG}><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {ds.map((c) => {
                  const tt = trangThaiHienThi(c, now);
                  return (
                    <tr key={c.id} className={`${TR_BANG} align-top`}>
                      <td className={`${TD_BANG} whitespace-nowrap font-mono text-xs`}>{c.certCode}</td>
                      <td className={TD_BANG}>
                        <span className="font-medium">{c.snapFullName}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {c.snapEmployeeCode}
                        </span>
                      </td>
                      <td className={TD_BANG}>{tenKhoa.get(c.courseId) ?? "(khoá đã gỡ)"}</td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>{ngay(c.issuedAt)}</td>
                      <td className={TD_BANG}>
                        <TrangThaiBadge sac={tt === "VALID" ? "success" : tt === "EXPIRED" ? "warning" : "danger"}>
                          {tt === "VALID" ? "Còn hiệu lực" : tt === "EXPIRED" ? "Hết hiệu lực" : "Đã thu hồi"}
                        </TrangThaiBadge>
                        <span className="mt-1 block text-sm text-muted-foreground">{cauTrangThai(tt, c)}</span>
                        {c.revokeReason ? (
                          <span className="mt-0.5 block text-sm text-muted-foreground">
                            Lý do: {c.revokeReason}
                          </span>
                        ) : null}
                      </td>
                      <td className={`${TD_BANG} text-right`}>
                        <div className="flex flex-wrap items-start justify-end gap-2">
                          <a
                            href={`/api/elearning/chung-nhan?id=${c.id}`}
                            target="_blank"
                            rel="noopener"
                            className={NUT_NHO}
                          >
                            PDF
                          </a>
                          {duocThuHoi && tt !== "REVOKED" ? (
                            <RevokeButton certificateId={c.id} certCode={c.certCode} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>
    </TrangQuanTri>
  );
}
