import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { isElearningEvalLinkEnabled } from "@/lib/flags";
import { cauMucGan, mucGanHienHanh } from "@/lib/elearning/eval-link";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, KhoiRong, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";
import { napNhanSuChon } from "@/lib/elearning/nhan-su-chon";
import { EvalLinkForm } from "./_components/eval-link-form";

/**
 * EL-21 — MỨC GẮN ĐÁNH GIÁ theo chương trình (QĐ-CDA-06b).
 *
 * ⚠️ Màn này tồn tại vì chủ dự án chốt HAI vế: giai đoạn đầu chỉ báo cáo, và "sau này
 * admin sẽ setup mức đánh giá để xét lương". Vế thứ hai là TÍNH NĂNG PHẢI XÂY, không
 * phải một hằng số trong mã — nếu để nó là hằng số thì ngày BGĐ quyết bật, việc ấy
 * thành một lần sửa mã và một lần deploy, chứ không phải một quyết định có người ký.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Mức gắn đánh giá | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  // Cờ riêng (đặc tả EL-21): OFF ⇒ như thể màn không tồn tại, kể cả với người có quyền.
  if (!isElearningEvalLinkEnabled()) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:program:manage")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Mức gắn đánh giá" />
        <NoPermission permission="elearning:program:manage" what="cấu hình mức gắn đánh giá" askWho="phòng Đào tạo" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const now = new Date();

  const ct = await db.trnProgram.findMany({
    select: { id: true, title: true, code: true },
    orderBy: { title: "asc" },
    take: 200,
  });

  // Danh sách chọn người Nhân sự đồng phê duyệt: nạp MỘT lần cho cả trang (không theo từng chương trình), qua `scopedDb`.
  const nhanSu = await napNhanSuChon(db);

  const cauHinh = new Map(
    ct.length === 0
      ? []
      : (
          await db.trnEvalLinkConfig.findMany({
            where: { programId: { in: ct.map((c) => c.id) } },
            select: {
              programId: true,
              mode: true,
              effectiveFrom: true,
              criteria: true,
              weightOnTime: true,
              weightExamScore: true,
              decisionDocCode: true,
              hrApprovedByUserId: true,
            },
          })
        ).map((c) => [c.programId, c] as const),
  );

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Mức gắn đánh giá"
        subtitle={
          <>
            Kết quả học có ảnh hưởng tới đánh giá tháng hay không, theo từng chương
            trình. Mặc định là <strong>CHỈ BÁO CÁO</strong>.{" "}
            <Link href="/elearning/chuong-trinh" className={LIEN_KET_CHU}>
              Xem chương trình
            </Link>
          </>
        }
      />

      <GhiChu sac="info">
        {/* Nói rõ "chỉ báo cáo" KHÔNG có nghĩa là im lặng — nếu không, người vận hành
            tưởng bật chế độ này là tắt luôn nhắc nhở. */}
        <p>
          <strong>CHỈ BÁO CÁO nghĩa là:</strong> quá hạn <em>vẫn</em> gửi thông báo cho
          người học, quản lý trực tiếp và Đào tạo, và <em>vẫn</em> vào báo cáo tuân
          thủ — chỉ là không leo thang kỷ luật và không ảnh hưởng đánh giá tháng.
        </p>
        <p className="mt-1">
          <strong>Bật liên kết cần đủ sáu thứ:</strong> số hiệu quyết định sửa
          SR.QD.231 · ngày hiệu lực của quyết định · ngày bắt đầu áp dụng · ít nhất
          một tiêu chí · tổng trọng số bằng 100 · và chữ ký đồng phê duyệt của Nhân sự.
        </p>
      </GhiChu>

      {ct.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <KhoiRong
            title="Chưa có chương trình nào để cấu hình"
            description="Lập chương trình ở màn Chương trình trước."
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {ct.map((c) => {
            const ch = cauHinh.get(c.id) ?? null;
            const muc = mucGanHienHanh(ch, now);
            return (
              <li key={c.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {c.title}
                    <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                      {c.code}
                    </span>
                  </span>
                  <TrangThaiBadge sac={muc === "LINKED" ? "warning" : "muted"}>
                    {muc === "LINKED" ? "Có liên kết" : "Chỉ báo cáo"}
                  </TrangThaiBadge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {cauMucGan(muc, ch)}
                </p>
                <div className="mt-3">
                  <EvalLinkForm
                    programId={c.id}
                    tenChuongTrinh={c.title}
                    nhanSu={nhanSu.ds}
                    nhanSuDaCat={nhanSu.daCat}
                    hienTai={
                      ch
                        ? {
                            mode: String(ch.mode),
                            criteria: ch.criteria.map(String),
                            weightOnTime: ch.weightOnTime,
                            weightExamScore: ch.weightExamScore,
                            decisionDocCode: ch.decisionDocCode,
                          }
                        : null
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </TrangQuanTri>
  );
}
