import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import {
  CHU_THICH_CHI_PHI,
  chiPhiMoiLuot,
  tiLeAnhChup,
} from "@/lib/elearning/metrics/snapshot";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { GhiChu, Khoi, KhoiRong, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";

/**
 * EL-20 — BÁO CÁO R7: hiệu quả chương trình (Kirkpatrick).
 *
 * ⚠️ Ở quy mô 15 người, Kirkpatrick L3 và L4 **vĩnh viễn** không có ý nghĩa thống kê
 * — không phải "chờ đủ dữ liệu". Vì vậy trang này KHÔNG có một phép so sánh nhóm nào,
 * và mọi ngôn ngữ dạng "nhóm đã học vs chưa học" bị một bước kiểm tĩnh quét và chặn
 * (`quetCumTuCam`, TS-37).
 *
 * Thay bằng ĐỌC TỪNG CA: mỗi ca một dòng, có tên, quản lý trực tiếp viết nhận xét.
 * Một phép so sánh nhóm ở n = 15 tạo ra một con số nghe như bằng chứng mà không phải
 * bằng chứng — và nó sẽ được dùng để quyết định về con người.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Hiệu quả đào tạo | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_MUC: Record<string, string> = {
  L1: "L1 — phản hồi của người học",
  L2: "L2 — kết quả kiểm tra",
  L3: "L3 — quản lý trực tiếp nhận xét",
  L4: "L4 — chỉ số vận hành",
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
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Hiệu quả đào tạo" />
        <NoPermission permission="elearning:progress:view-all" what="báo cáo hiệu quả đào tạo" askWho="phòng Đào tạo hoặc Nhân sự" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);

  const anhChup = await db.trnMetricSnapshot.findMany({
    orderBy: [{ periodEnd: "desc" }, { metricKey: "asc" }],
    select: {
      id: true,
      metricKey: true,
      periodStart: true,
      periodEnd: true,
      dimensionKey: true,
      numerator: true,
      denominator: true,
      groupN: true,
      suppressed: true,
    },
    take: 200,
  });

  const danhGia = await db.trnEvaluationResult.findMany({
    select: {
      id: true,
      programId: true,
      level: true,
      subjectUserId: true,
      score: true,
      recordedAt: true,
    },
    orderBy: { recordedAt: "desc" },
    take: 200,
  });

  const tenNguoi = new Map(
    danhGia.length === 0
      ? []
      : (
          await db.user.findMany({
            where: { id: { in: [...new Set(danhGia.map((d) => d.subjectUserId))] } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name ?? "(không rõ tên)"] as const),
  );

  const soLuotXong = await db.trnEnrollment.count({
    where: { verifiedAt: { not: null } },
  });

  // Ngân sách khai tay chưa có đường nhập ⇒ `null`. KHÔNG bịa số 0.
  const nganSach: number | null = null;
  const chiPhi = chiPhiMoiLuot({ nganSach, soLuotHoanThanh: soLuotXong });

  const ngay = (d: Date) => d.toLocaleDateString("vi-VN");

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Hiệu quả đào tạo"
        subtitle={
          <>
            Đọc TỪNG CA. Mỗi dòng là một con người cụ thể, có tên.{" "}
            <Link href="/elearning/bao-cao-r4" className={LIEN_KET_CHU}>
              Xem theo phòng ban
            </Link>
          </>
        }
      />

      <GhiChu sac="warning">
        {/* Nói ra giới hạn NGAY ĐẦU trang, không giấu ở chân trang. Người đọc sẽ ra
            quyết định dựa trên những con số dưới đây. */}
        <strong>Vì sao trang này chỉ liệt kê từng ca:</strong> ở quy mô 15 người,
        mức L3 và L4 của Kirkpatrick <strong>vĩnh viễn</strong> không đủ cỡ mẫu để nói
        điều gì có ý nghĩa — không phải chờ thêm dữ liệu. Một phép so sánh ở cỡ này tạo
        ra một con số nghe như bằng chứng mà không phải bằng chứng. Mỗi dòng dưới đây
        là một con người cụ thể, đọc từng dòng.
      </GhiChu>

      <Khoi tieuDe="Chi phí trên mỗi lượt hoàn thành">
        <p className="text-2xl font-bold text-foreground">
          {/* ⚠️ Chưa khai ngân sách ⇒ MỘT DÒNG CHỮ, không phải số 0. "0đ/người" bị
              đọc thành "đào tạo không tốn gì", và đó là câu sẽ được trích trong một
              cuộc họp về ngân sách. */}
          {chiPhi == null ? (
            <span className="text-sm font-normal text-muted-foreground">
              Chưa khai ngân sách — không tính được chi phí/lượt.
            </span>
          ) : (
            `${chiPhi.toLocaleString("vi-VN")}đ`
          )}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Mẫu số: {soLuotXong} lượt hoàn thành có kiểm chứng.
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
          {CHU_THICH_CHI_PHI.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Khoi>

      <Khoi
        tieuDe="Ảnh chụp chỉ số theo kỳ"
        moTa="Ảnh chụp là BẤT BIẾN: số liệu quá khứ đổi cũng không viết lại bản đã chụp. Nhóm dưới 5 người bị chặn công bố tách riêng — cờ đặt ở tầng dữ liệu."
        sat
      >
        {anhChup.length === 0 ? (
          <KhoiRong
            title="Chưa có ảnh chụp"
            /* Ảnh chụp là chỉ số TOÀN CÔNG TY (không thuộc cơ sở nào, `centerId` NULL) nên lượt đọc qua scopedDb của
               người cấp cơ sở luôn rỗng. Nói thẳng điều đó, đừng để họ đọc "chưa có ảnh chụp" và chờ cron đêm vô ích. */
            description={
              actor.isHoLevel
                ? "Chưa có ảnh chụp nào. Việc chốt chạy trong cron đêm."
                : "Ảnh chụp chỉ số là số liệu toàn công ty nên chỉ cấp Hội sở xem được; tài khoản cơ sở xem các bảng theo cơ sở ở phần dưới."
            }
          />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="dòng" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Kỳ</th>
                  <th scope="col" className={TH_BANG}>Chỉ số</th>
                  <th scope="col" className={TH_BANG}>Nhóm</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Cỡ nhóm</th>
                  <th scope="col" className={TH_BANG}>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {anhChup.map((a) => (
                  <tr key={a.id} className={TR_BANG}>
                    <td className={`${TD_BANG} whitespace-nowrap`}>
                      {ngay(a.periodStart)} – {ngay(a.periodEnd)}
                    </td>
                    <td className={`${TD_BANG} font-medium`}>{a.metricKey}</td>
                    <td className={`${TD_BANG} text-muted-foreground`}>{a.dimensionKey}</td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{a.groupN}</td>
                    <td className={`${TD_BANG} tabular-nums`}>
                      {a.suppressed ? (
                        // Chặn công bố, và NÓI RA là bị chặn — một ô trống không lời
                        // giải thích đọc thành "hệ thống hỏng".
                        <span className="text-sm text-muted-foreground">
                          Không công bố (nhóm dưới 5 người)
                        </span>
                      ) : (
                        <span className="whitespace-nowrap">
                          {a.numerator}/{a.denominator}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {tiLeAnhChup(a) == null ? "—" : `${tiLeAnhChup(a)}%`}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>

      <Khoi tieuDe="Đánh giá theo từng ca" sat>
        {danhGia.length === 0 ? (
          <KhoiRong
            title="Chưa có phiếu đánh giá nào được ghi"
            description="Phiếu đánh giá của quản lý trực tiếp (mức L3) và chỉ số vận hành (L4) sẽ hiện ở đây từng dòng một."
          />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="phiếu" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Lúc</th>
                  <th scope="col" className={TH_BANG}>Mức</th>
                  <th scope="col" className={TH_BANG}>Người</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Điểm</th>
                </tr>
              </thead>
              <tbody>
                {danhGia.map((d) => (
                  <tr key={d.id} className={TR_BANG}>
                    <td className={`${TD_BANG} whitespace-nowrap`}>{ngay(d.recordedAt)}</td>
                    <td className={TD_BANG}>
                      {NHAN_MUC[String(d.level)] ?? String(d.level)}
                    </td>
                    <td className={`${TD_BANG} font-medium`}>
                      {tenNguoi.get(d.subjectUserId) ?? "(không rõ)"}
                    </td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>
                      {d.score == null ? "—" : String(d.score)}
                    </td>
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
