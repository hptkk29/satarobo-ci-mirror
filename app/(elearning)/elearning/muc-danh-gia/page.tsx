import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { isElearningEvalLinkEnabled } from "@/lib/flags";
import { cauMucGan, mucGanHienHanh } from "@/lib/elearning/eval-link";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, KhoiRong, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU, NUT_NHO } from "../_components/ui/dieu-khien";
import { napNhanSuChon } from "@/lib/elearning/nhan-su-chon";
import { EvalLinkForm } from "./_components/eval-link-form";

/**
 * EL-21 + P8 — MỨC GẮN ĐÁNH GIÁ theo chương trình (QĐ-CDA-06b), dạng master-detail (thiết kế `QtMucDanhGia`): bảng chương trình bên trái, bảng "Đổi mức gắn"
 * bên phải, chọn bằng `?id=`.
 *
 * ⚠️ Màn này tồn tại vì chủ dự án chốt HAI vế: giai đoạn đầu chỉ báo cáo, và "sau này
 * admin sẽ setup mức đánh giá để xét lương". Vế thứ hai là TÍNH NĂNG PHẢI XÂY, không
 * phải một hằng số trong mã — nếu để nó là hằng số thì ngày BGĐ quyết bật, việc ấy
 * thành một lần sửa mã và một lần deploy, chứ không phải một quyết định có người ký.
 *
 * Nghiệp vụ KHÔNG đổi: cùng cờ, cùng quyền `program:manage`, cùng `datMucGanDanhGiaAction` (sáu điều kiện + lý do ≥ 10 ký tự + nhật ký), đọc qua `scopedDb`.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Mức gắn đánh giá | Sata Robo",
  robots: { index: false, follow: false },
};

const trongSo = (ch: { weightOnTime: number | null; weightExamScore: number | null }) => `${ch.weightOnTime ?? 0} / ${ch.weightExamScore ?? 0}`;

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
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

  const sp = await searchParams;
  const idChon = Array.isArray(sp.id) ? sp.id[0] : sp.id;
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

  // Chương trình đang chọn: chỉ nhận id nằm TRONG danh sách đã đọc qua `scopedDb` (id lạ / của cơ sở khác ⇒ không dựng form).
  const chonDuoc = idChon ? (ct.find((c) => c.id === idChon) ?? null) : null;
  const chChon = chonDuoc ? (cauHinh.get(chonDuoc.id) ?? null) : null;

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
          <KhoiRong title="Chưa có chương trình nào để cấu hình" description="Lập chương trình ở màn Chương trình trước." />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section aria-label="Chương trình và mức gắn" className="min-w-0">
            <PhanTrangBang cuonNgang tenDonVi="chương trình" soDongMacDinh={20}>
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className={THEAD_BANG}>
                    <th scope="col" className={TH_BANG}>Chương trình</th>
                    <th scope="col" className={TH_BANG}>Chế độ</th>
                    <th scope="col" className={TH_BANG}>Trọng số</th>
                    <th scope="col" className={TH_BANG}><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody>
                  {ct.map((c) => {
                    const ch = cauHinh.get(c.id) ?? null;
                    const muc = mucGanHienHanh(ch, now);
                    const chon = c.id === chonDuoc?.id;
                    return (
                      <tr key={c.id} className={`${TR_BANG} ${chon ? "bg-card" : ""}`} aria-current={chon ? "true" : undefined}>
                        <td className={TD_BANG}>
                          <span className="block text-foreground">{c.title}</span>
                          <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                        </td>
                        <td className={`${TD_BANG} whitespace-nowrap`}>
                          <TrangThaiBadge sac={muc === "LINKED" ? "warning" : "muted"}>{muc === "LINKED" ? "Có liên kết" : "Chỉ báo cáo"}</TrangThaiBadge>
                        </td>
                        <td className={`${TD_BANG} whitespace-nowrap tabular-nums`}>{muc === "LINKED" && ch ? trongSo(ch) : "—"}</td>
                        <td className={`${TD_BANG} text-right`}>
                          <Link href={`/elearning/muc-danh-gia?id=${encodeURIComponent(c.id)}`} aria-label={`Đổi mức gắn của ${c.title}`} className={NUT_NHO}>
                            Đổi
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </PhanTrangBang>
          </section>

          <section aria-label="Đổi mức gắn" className="min-w-0 space-y-3">
            {chonDuoc ? (
              <>
                <h2 className="text-lg font-medium text-foreground">Đổi mức gắn · {chonDuoc.title}</h2>
                <p className="text-sm text-muted-foreground">{cauMucGan(mucGanHienHanh(chChon, now), chChon)}</p>
                <EvalLinkForm
                  key={chonDuoc.id}
                  programId={chonDuoc.id}
                  tenChuongTrinh={chonDuoc.title}
                  nhanSu={nhanSu.ds}
                  nhanSuDaCat={nhanSu.daCat}
                  moSan
                  hrefDong="/elearning/muc-danh-gia"
                  hienTai={
                    chChon
                      ? {
                          mode: String(chChon.mode),
                          criteria: chChon.criteria.map(String),
                          weightOnTime: chChon.weightOnTime,
                          weightExamScore: chChon.weightExamScore,
                          decisionDocCode: chChon.decisionDocCode,
                        }
                      : null
                  }
                />
              </>
            ) : (
              <KhoiRong
                title={idChon ? "Không tìm thấy chương trình này" : "Chọn một chương trình"}
                description={
                  idChon
                    ? "Chương trình không tồn tại hoặc không thuộc phạm vi của bạn. Chọn lại ở bảng bên trái."
                    : "Bấm Đổi ở một dòng bên trái để xem và đổi mức gắn của chương trình đó."
                }
              />
            )}
          </section>
        </div>
      )}
    </TrangQuanTri>
  );
}
