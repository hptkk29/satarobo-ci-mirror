import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PHAM_VI_CHUA_KHOP_DUOC } from "@/lib/elearning/requirement-match";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, Khoi, KhoiRong, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";
import { NHAN_PHAM_VI } from "../_components/nhan";
import { RequirementForm } from "./_components/requirement-form";
import { CloseButton } from "./_components/close-button";

/**
 * EL-17 — YÊU CẦU ĐÀO TẠO: khai, xem, đóng.
 *
 * ⚠️ Đây là CỬA của `elearning:requirement:manage` — khoá quyền có từ EL-02 mà trước
 * PR này không mã nào gọi. Hệ quả đo được: mẫu số của toàn bộ North Star Metric chỉ
 * khai được bằng seed hoặc SQL tay, tức trên thực tế là không khai được.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Yêu cầu đào tạo | Sata Robo",
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
  const duocSua = can(actor, "elearning:requirement:manage");

  // Xem đi bằng khoá xem tiến độ toàn hệ; SỬA đi bằng khoá riêng. Trưởng phòng cần
  // thấy nghĩa vụ nào đang áp cho người của mình, nhưng ra một nghĩa vụ mới là việc
  // khác hẳn.
  if (!can(actor, "elearning:progress:view-all") && !duocSua) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Yêu cầu đào tạo" />
        <NoPermission
          permission="elearning:progress:view-all · elearning:requirement:manage"
          what="yêu cầu đào tạo"
          askWho="phòng Đào tạo hoặc Nhân sự"
        />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);

  const ds = await db.trnRequirement.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      courseId: true,
      scopeKind: true,
      departmentId: true,
      levelTag: true,
      orgUnitId: true,
      dueDays: true,
      validityMonths: true,
      effectiveFrom: true,
      effectiveTo: true,
      status: true,
    },
    orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }],
    take: 200,
  });

  const tenKhoa = new Map(
    ds.length === 0
      ? []
      : (
          await db.trnCourse.findMany({
            where: { id: { in: [...new Set(ds.map((y) => y.courseId))] } },
            select: { id: true, title: true },
          })
        ).map((k) => [k.id, k.title] as const),
  );

  const tenPhong = new Map(
    (
      await db.departmentDef.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      })
    ).map((d) => [d.id, d.name] as const),
  );

  const khoaChon = duocSua
    ? await db.trnCourse.findMany({
        where: { status: "PUBLISHED" },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take: 200,
      })
    : [];

  const donViChon = duocSua
    ? await db.orgUnit.findMany({
        select: { id: true, code: true, name: true, path: true },
        orderBy: { path: "asc" },
        take: 200,
      })
    : [];

  const phongChon = [...tenPhong].map(([id, name]) => ({ id, name }));

  const ngay = (d: Date | null) => (d ? d.toLocaleDateString("vi-VN") : "—");

  return (
    <TrangQuanTri>
      <PageHeader
        title="Yêu cầu đào tạo"
        subtitle={
          <>
            &ldquo;Ai phải đạt khoá nào&rdquo;. Đây là mẫu số của mọi báo cáo tuân thủ:
            người không dính yêu cầu nào thì không nằm trong mẫu số.{" "}
            <Link href="/elearning/ma-tran" className={LIEN_KET_CHU}>
              Xem ma trận đào tạo
            </Link>
          </>
        }
      />

      {duocSua ? (
        <RequirementForm
          khoa={khoaChon}
          phongBan={phongChon}
          donVi={donViChon.map((d) => ({ id: d.id, nhan: `${d.code} — ${d.name}` }))}
          phamViChuaDung={PHAM_VI_CHUA_KHOP_DUOC}
        />
      ) : null}

      <Khoi tieuDe={`Các yêu cầu (${ds.length})`} sat>
        {ds.length === 0 ? (
          <KhoiRong
            title="Chưa có yêu cầu nào"
            description="Chưa khai thì ma trận đào tạo trống và North Star Metric không có mẫu số."
          />
        ) : (
          /* Danh sách yêu cầu dài dần theo năm: đóng rồi vẫn ở lại, vì nó là một
             phần lịch sử tuân thủ. */
          <PhanTrangBang cuonNgang tenDonVi="yêu cầu" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Khoá</th>
                  <th scope="col" className={TH_BANG}>Áp cho</th>
                  <th scope="col" className={TH_BANG}>Hạn</th>
                  <th scope="col" className={TH_BANG}>Chu kỳ</th>
                  <th scope="col" className={TH_BANG}>Hiệu lực</th>
                  <th scope="col" className={TH_BANG}><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {ds.map((y) => {
                  const chua = PHAM_VI_CHUA_KHOP_DUOC[String(y.scopeKind)];
                  const dong = y.status !== "ACTIVE";
                  return (
                    <tr key={y.id} className={`${TR_BANG} align-top ${dong ? "opacity-70" : ""}`}>
                      <td className={`${TD_BANG} font-medium`}>{tenKhoa.get(y.courseId) ?? "(đã gỡ)"}</td>
                      <td className={TD_BANG}>
                        {NHAN_PHAM_VI[String(y.scopeKind)] ?? String(y.scopeKind)}
                        {y.departmentId
                          ? ` · ${tenPhong.get(y.departmentId) ?? y.departmentId}`
                          : ""}
                        {y.levelTag ? ` · ${String(y.levelTag)}` : ""}
                        {chua ? (
                          // ⚠️ Nói ngay tại dòng, không đợi người ta mở ma trận rồi
                          // thấy một hàng ô lạ. Một yêu cầu áp cho 0 người trông y hệt
                          // một yêu cầu chưa ai kịp làm.
                          <span className="mt-1 block text-sm font-medium text-state-warning-ink">
                            Áp cho 0 người — {chua}
                          </span>
                        ) : null}
                      </td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>{y.dueDays} ngày</td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>
                        {y.validityMonths ? `${y.validityMonths} tháng` : "vô hạn"}
                      </td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>
                        {ngay(y.effectiveFrom)} → {ngay(y.effectiveTo)}
                        {dong ? (
                          <span className="ml-2 align-middle">
                            <TrangThaiBadge sac="muted">Đã đóng</TrangThaiBadge>
                          </span>
                        ) : null}
                      </td>
                      <td className={`${TD_BANG} text-right`}>
                        {duocSua && !dong ? (
                          <CloseButton requirementId={y.id} />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>

      <GhiChu sac="info">
        {/* Nói vì sao đóng chứ không xoá — nếu không, người vận hành sẽ đi tìm nút
            xoá và tưởng hệ thống thiếu chức năng. */}
        Yêu cầu chỉ ĐÓNG được, không xoá: nó là một phần lịch sử tuân thủ, và xoá đi
        thì mọi báo cáo cũ đổi nghĩa hồi tố. Ngày kết thúc luôn đặt là hôm nay.
      </GhiChu>
    </TrangQuanTri>
  );
}
