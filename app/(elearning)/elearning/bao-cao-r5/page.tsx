import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { napR5 } from "@/lib/elearning/report-r45-query";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { GhiChu, Khoi, KhoiRong, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU } from "../_components/ui/dieu-khien";

/**
 * EL-17 — BÁO CÁO R5: kết quả kiểm tra + PHÂN TÍCH CÂU HỎI.
 *
 * Nửa sau mới là phần đáng tiền: một câu hỏi mà 90% người làm sai không chứng minh
 * học viên kém — nhiều khả năng câu ấy mơ hồ, hoặc nội dung dạy chưa phủ. Không đo
 * thì đề thi cứ thế được dùng lại năm này qua năm khác.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kết quả kiểm tra | Sata Robo",
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
  if (!can(actor, "elearning:progress:view-all")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Kết quả kiểm tra" />
        <NoPermission permission="elearning:progress:view-all" what="kết quả kiểm tra" askWho="phòng Đào tạo hoặc Nhân sự" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const r = await napR5(scopedDb(actor));
  const canRa = r.cauHoi.filter((c) => c.canRaLai === true);
  const chuaDu = r.cauHoi.filter((c) => c.canRaLai === null);

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Kết quả kiểm tra"
        subtitle={
          <>
            Tỉ lệ đạt tính trên lượt LẦN ĐẦU. Gộp mọi lần làm là đo &ldquo;cuối cùng có
            ai đạt không&rdquo; — một câu hỏi khác, và luôn cho ra con số đẹp hơn.{" "}
            <Link href="/elearning/kho-cau-hoi" className={LIEN_KET_CHU}>
              Mở ngân hàng câu hỏi
            </Link>
          </>
        }
      />

      <Khoi tieuDe="Theo đề thi" sat>
        {r.deThi.length === 0 ? (
          <KhoiRong
            title="Chưa có lượt thi nào được chấm xong"
            description="Khi có người làm bài kiểm tra và bài được chấm, kết quả theo đề sẽ hiện ở đây."
          />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="đề thi" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Đề thi</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Tổng lượt</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Lượt lần đầu</th>
                  <th scope="col" className={TH_BANG}>Đạt lần đầu (M6)</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Điểm TB</th>
                </tr>
              </thead>
              <tbody>
                {r.deThi.map((t) => (
                  <tr key={t.examId} className={TR_BANG}>
                    <td className={`${TD_BANG} font-medium`}>{t.tenDe}</td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{t.tongLuot}</td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{t.soLuotLanDau}</td>
                    <td className={`${TD_BANG} whitespace-nowrap tabular-nums`}>
                      {/* Mẫu số 0 ⇒ gạch ngang, KHÔNG in 0%. */}
                      {t.tiLeDatLanDau == null
                        ? "—"
                        : `${t.soDatLanDau}/${t.soLuotLanDau} · ${t.tiLeDatLanDau}%`}
                    </td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{t.diemTrungBinh ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>

      <Khoi
        tieuDe={`Câu hỏi cần rà lại (${canRa.length})`}
        moTa="Gắn cờ ở CẢ HAI đầu: quá khó (≤30% đúng) thì câu mơ hồ hoặc nội dung chưa phủ; quá dễ (100% đúng) thì câu không phân loại được ai, tức chiếm chỗ trong đề mà không đo gì."
        sat
      >
        {canRa.length === 0 ? (
          <KhoiRong title="Không có câu nào vượt ngưỡng" />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="câu hỏi" soDongMacDinh={20}>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={THEAD_BANG}>
                  <th scope="col" className={TH_BANG}>Câu hỏi</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Lượt</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>% đúng</th>
                  <th scope="col" className={TH_BANG}>Vì sao</th>
                </tr>
              </thead>
              <tbody>
                {canRa.map((c) => (
                  <tr key={c.examQuestionId} className={`${TR_BANG} align-top`}>
                    <td className={TD_BANG}>{c.noiDung.slice(0, 120)}</td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{c.soLuot}</td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>{c.tiLeDung}%</td>
                    <td className={`${TD_BANG} text-muted-foreground`}>{c.lyDo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </Khoi>

      {chuaDu.length > 0 ? (
        <GhiChu sac="warning">
          {/* ⚠️ "Chưa đủ dữ liệu" KHÁC "không có vấn đề". Gộp hai cái là để người
              soạn đề tin rằng những câu này đã được kiểm. */}
          {chuaDu.length} câu chưa đủ lượt làm để kết luận (cần ít nhất 5). Chúng
          KHÔNG phải là câu &ldquo;không có vấn đề&rdquo; — chỉ là chưa đo được.
        </GhiChu>
      ) : null}
    </TrangQuanTri>
  );
}
