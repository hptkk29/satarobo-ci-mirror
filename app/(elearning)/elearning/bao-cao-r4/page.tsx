import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { napR4 } from "@/lib/elearning/report-r45-query";
import { tiLe, type DongR4 } from "@/lib/elearning/report-r4";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { GhiChu, Khoi, KhoiRong, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";

/**
 * EL-17 — BÁO CÁO R4: theo phòng ban / cơ sở.
 *
 * ⚠️ Nhóm dưới 5 người bị GỘP vào "Khối hỗ trợ", và đó không phải chuyện thẩm mỹ.
 * Đo prod 20/08/2026: ba phòng (`MARKETING`, `KE_TOAN`, `IT`) mỗi phòng ĐÚNG MỘT
 * người. Một dòng "phòng Marketing: 0% đúng hạn" là một câu về đích danh một con
 * người, in trên tài liệu gửi khắp công ty — nó đi vòng qua mọi lời hứa ẩn danh mà
 * hệ thống đưa ra ở chỗ khác.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Báo cáo theo phòng ban | Sata Robo",
  robots: { index: false, follow: false },
};

function Bang({ ten, ds }: { ten: string; ds: DongR4[] }) {
  return (
    <Khoi tieuDe={ten} sat>
      {ds.length === 0 ? (
        <KhoiRong title="Chưa có lượt học nào" description="Số liệu hiện khi có lượt giao và lượt học thuộc nhóm này." />
      ) : (
        <PhanTrangBang cuonNgang tenDonVi="nhóm" soDongMacDinh={20}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className={THEAD_BANG}>
                <th scope="col" className={TH_BANG}>Nhóm</th>
                <th scope="col" className={`${TH_BANG} text-right`}>Người</th>
                <th scope="col" className={`${TH_BANG} text-right`}>Lượt</th>
                <th scope="col" className={TH_BANG}>M2 đúng hạn</th>
                <th scope="col" className={TH_BANG}>M3 bỏ trắng</th>
                <th scope="col" className={TH_BANG}>M5 kịp nhịp</th>
              </tr>
            </thead>
            <tbody>
              {ds.map((d) => {
                const m2 = tiLe(d.m2DungHan, d.tong);
                const m3 = tiLe(d.m3BoTrang, d.tong);
                const m5 = tiLe(d.m5KipNhip, d.m5MauSo);
                return (
                  <tr key={d.nhanNhom} className={TR_BANG}>
                    <td className={`${TD_BANG} font-medium`}>{d.nhanNhom}</td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{d.soNguoi}</td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{d.tong}</td>
                    <td className={`${TD_BANG} whitespace-nowrap tabular-nums`}>
                      {d.m2DungHan}
                      {/* Ngưỡng §9.2.1: ≥85% tốt, <70% báo động. Tô theo ngưỡng
                          thật, không tô theo cảm giác. Chữ % luôn có — màu chỉ nhấn. */}
                      <span
                        className={
                          m2 != null && m2 < 70
                            ? "ml-1.5 text-xs font-semibold text-state-danger-ink"
                            : "ml-1.5 text-xs text-muted-foreground"
                        }
                      >
                        {m2 == null ? "—" : `${m2}%`}
                        {m2 != null && m2 < 70 ? " · báo động" : ""}
                      </span>
                    </td>
                    <td className={`${TD_BANG} whitespace-nowrap tabular-nums`}>
                      {d.m3BoTrang}
                      <span
                        className={
                          m3 != null && m3 > 20
                            ? "ml-1.5 text-xs font-semibold text-state-danger-ink"
                            : "ml-1.5 text-xs text-muted-foreground"
                        }
                      >
                        {m3 == null ? "—" : `${m3}%`}
                        {m3 != null && m3 > 20 ? " · báo động" : ""}
                      </span>
                    </td>
                    <td className={`${TD_BANG} tabular-nums`}>
                      {/* Mẫu số 0 ⇒ nói "chưa đo được", KHÔNG in 0%. */}
                      {d.m5MauSo === 0 ? (
                        <span className="text-sm text-muted-foreground">
                          chưa đo được (không ai đang học còn hạn)
                        </span>
                      ) : (
                        <span className="whitespace-nowrap">
                          {d.m5KipNhip}/{d.m5MauSo}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {m5}%
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      )}
    </Khoi>
  );
}

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
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Báo cáo theo phòng ban / cơ sở" />
        <NoPermission permission="elearning:progress:view-all" what="báo cáo theo phòng ban" askWho="phòng Đào tạo hoặc Nhân sự" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const r = await napR4(scopedDb(actor));

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Báo cáo theo phòng ban / cơ sở"
        subtitle={
          <>
            Đọc từ cột ẢNH CHỤP lúc giao bài, không đọc hồ sơ hiện tại — nên chuyển cơ
            sở hay đổi phòng ban không viết lại số liệu của các kỳ trước.{" "}
            <Link href="/elearning/ma-tran" className={LIEN_KET_CHU}>
              Xem ma trận đào tạo
            </Link>
          </>
        }
      />

      <GhiChu sac="info">
        {/* Nói thẳng M5 là xấp xỉ. Một con số chính xác giả còn tệ hơn một con số kèm
            chú thích — và người đọc sẽ ra quyết định dựa trên nó. */}
        <strong>M5 là số XẤP XỈ:</strong> đo bằng phần trăm tiến độ so với phần thời
        gian đã trôi tới hạn, không đo bằng giây nội dung đã phủ trong tuần như định
        nghĩa đầy đủ ở §9.2.2.
      </GhiChu>

      {r.soLuotChuaGanQuanLy > 0 || r.soLuotChuaGanPhongBan > 0 ? (
        <GhiChu sac="warning">
          {/* Đếm được, không lặng lẽ bỏ khỏi mẫu số — kế hoạch chốt đúng câu này. */}
          {r.soLuotChuaGanPhongBan > 0
            ? `${r.soLuotChuaGanPhongBan} lượt không có ảnh chụp phòng ban (gom vào dòng "Chưa gán phòng ban"). `
            : ""}
          {r.soLuotChuaGanQuanLy > 0
            ? `${r.soLuotChuaGanQuanLy} lượt không có quản lý trực tiếp — không ai nhận được báo cáo về những người này.`
            : ""}
        </GhiChu>
      ) : null}

      <Bang ten="Theo phòng ban" ds={r.theoPhongBan} />
      <Bang ten="Theo đơn vị / cơ sở" ds={r.theoDonVi} />

      <p className="text-sm text-muted-foreground">
        Nhóm dưới 5 người được gộp vào &ldquo;Khối hỗ trợ&rdquo;: ở quy mô hiện tại có
        ba phòng chỉ một người, và một dòng riêng cho họ là nêu đích danh một cá nhân
        trên tài liệu gửi khắp công ty. Người của nhóm nhỏ vẫn nằm trong tổng.
      </p>
    </TrangQuanTri>
  );
}
