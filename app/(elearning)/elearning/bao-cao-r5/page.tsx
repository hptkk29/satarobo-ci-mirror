import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { napR5 } from "@/lib/elearning/report-r45-query";
import { nhanLoaiCau } from "@/lib/elearning/nhan-loai-cau";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TienDoDam } from "../_components/ui/tien-do";
import { GhiChu, Khoi, KhoiRong, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU, NUT_PHU } from "../_components/ui/dieu-khien";

/**
 * EL-17 + P8 — BÁO CÁO R5 "Kết quả thi" (thiết kế `QtKetQuaThi`): kết quả kiểm tra + PHÂN TÍCH CÂU HỎI.
 *
 * Nửa sau mới là phần đáng tiền: một câu hỏi mà 90% người làm sai không chứng minh
 * học viên kém — nhiều khả năng câu ấy mơ hồ, hoặc nội dung dạy chưa phủ. Không đo
 * thì đề thi cứ thế được dùng lại năm này qua năm khác.
 *
 * Số liệu KHÔNG đổi (cùng `napR5`, cùng ngưỡng ≤30% / 100%, cùng ngưỡng 5 lượt); chỉ đổi cách trình bày: thanh dầm 10 lỗ cho M6, điểm TB kèm tối đa, cột Dạng,
 * chấm màu ở "Vì sao" (chữ luôn có — màu chỉ bổ sung). Miền: chỉ lượt thi NỘI BỘ (`TrnExamAttempt`); đề của khoá online do miền Online báo cáo riêng.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kết quả kiểm tra | Sata Robo",
  robots: { index: false, follow: false },
};

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

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
        <PageHeader title="Kết quả thi" />
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          className="mb-0 min-w-0 flex-1"
          title="Kết quả thi"
          subtitle={
            <>
              Tỉ lệ đạt tính trên lượt LẦN ĐẦU. Gộp mọi lần làm là đo &ldquo;cuối cùng có
              ai đạt không&rdquo; — một câu hỏi khác, và luôn cho ra con số đẹp hơn.
            </>
          }
        />
        <Link href="/elearning/kho-cau-hoi" className={NUT_PHU}>
          Ngân hàng câu hỏi
        </Link>
      </div>

      <Khoi tieuDe="Theo đề" sat>
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
                  <th scope="col" className={TH_BANG}>Đề</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Tổng lượt</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Lần đầu</th>
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
                    <td className={`${TD_BANG} whitespace-nowrap`}>
                      {/* Mẫu số 0 ⇒ gạch ngang, KHÔNG in 0%. */}
                      {t.tiLeDatLanDau == null || t.soLuotLanDau === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-2 tabular-nums" title={`${t.tiLeDatLanDau}% đạt lần đầu`}>
                          <TienDoDam
                            tong={10}
                            xong={Math.floor(t.tiLeDatLanDau / 10)}
                            dangHoc={t.tiLeDatLanDau % 10 > 0 ? Math.floor(t.tiLeDatLanDau / 10) : undefined}
                            nhan={`đạt lần đầu của ${t.tenDe}: ${t.tiLeDatLanDau}%`}
                          />
                          {t.soDatLanDau}/{t.soLuotLanDau}
                        </span>
                      )}
                    </td>
                    <td className={`${TD_BANG} text-right tabular-nums`}>
                      {t.diemTrungBinh == null ? "—" : t.diemToiDa > 0 ? `${fmt(t.diemTrungBinh)}/${t.diemToiDa}` : fmt(t.diemTrungBinh)}
                    </td>
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
                  <th scope="col" className={TH_BANG}>Dạng</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>Lượt</th>
                  <th scope="col" className={`${TH_BANG} text-right`}>% đúng</th>
                  <th scope="col" className={TH_BANG}>Vì sao</th>
                </tr>
              </thead>
              <tbody>
                {canRa.map((c) => {
                  const kho = (c.tiLeDung ?? 0) <= 30;
                  return (
                    <tr key={c.examQuestionId} className={`${TR_BANG} align-top`}>
                      <td className={TD_BANG}>{c.noiDung.slice(0, 120)}</td>
                      <td className={`${TD_BANG} whitespace-nowrap`}>{c.dang ? nhanLoaiCau(c.dang) : "—"}</td>
                      <td className={`${TD_BANG} text-right tabular-nums`}>{c.soLuot}</td>
                      <td className={`${TD_BANG} text-right tabular-nums`}>{c.tiLeDung}%</td>
                      <td className={`${TD_BANG} ${kho ? "text-state-danger-ink" : "text-state-warning-ink"}`}>
                        <span aria-hidden className="mr-1.5">●</span>
                        {kho ? "Quá khó" : "Quá dễ"}
                        <span className="block text-xs text-muted-foreground">{c.lyDo}</span>
                      </td>
                    </tr>
                  );
                })}
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
