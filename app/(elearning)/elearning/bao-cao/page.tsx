import Link from "next/link";
import {
  napBangChiSo,
  kyThangNay,
} from "@/lib/elearning/metrics/grading-queue-query";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import {
  GhiChu,
  Khoi,
  KhoiRong,
  LuoiSoLieu,
  SoLieu,
  TD_BANG,
  TH_BANG,
  THEAD_BANG,
  TR_BANG,
  TrangQuanTri,
} from "../_components/ui/trang";
import { LIEN_KET_CHU, NUT_PHU } from "../_components/ui/dieu-khien";
import { traDongBaoCao } from "@/lib/elearning/report-query";
import {
  coSoCuaPhamVi,
  docLuotGiaoTrongTamNhin,
  loaiQuyenBaoCao,
} from "@/lib/elearning/report-scope";
import {
  nhanNhom,
  phanNhom,
  soNgayTre,
  tongHopTuanThu,
  R1_COLUMNS,
} from "@/lib/elearning/report-compliance";

/**
 * EL-06 — BÁO CÁO R1: TUÂN THỦ HẠN CHÓT (BA §14.1).
 *
 * ⚠️ Trang này là đích của thông báo "có lượt học quá hạn". Thông báo trỏ vào một
 * trang không tồn tại thì cảnh báo thành ngõ cụt — người nhận bấm vào, thấy 404,
 * và lần sau họ không bấm nữa.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Báo cáo tuân thủ | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ luot?: string }>;
}) {
  const { luot } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);

  // Xem báo cáo tổng và XUẤT file là hai quyền khác nhau — xuất là mang dữ liệu
  // nhân sự ra khỏi hệ thống.
  // F-01: Đào tạo/Nhân sự (view-all) xem toàn hệ; Quản lý cơ sở (view-team) xem đội của cơ sở mình.
  const loai = loaiQuyenBaoCao(actor);
  if (!loai) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Báo cáo tuân thủ hạn chót" />
        <NoPermission
          permission="elearning:progress:view-all · elearning:progress:view-team"
          what="báo cáo tuân thủ"
          askWho="phòng Đào tạo hoặc Nhân sự"
        />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const coSo = coSoCuaPhamVi(loai, actor);
  const cacLuot = await docLuotGiaoTrongTamNhin(db, loai, coSo);

  // Đường view-all giữ nguyên (id thô vẫn đi qua `traDongBaoCao` đã scope). Đường view-team CHỈ nhận id nằm trong danh sách
  // đã tính từ lượt học trong tầm nhìn — id lạ rơi về lượt đầu, không bao giờ tin thẳng thanh địa chỉ.
  const chon =
    loai === "ALL"
      ? (luot ?? cacLuot[0]?.id ?? null)
      : luot && cacLuot.some((l) => l.id === luot)
        ? luot
        : (cacLuot[0]?.id ?? null);
  const ds = chon ? await traDongBaoCao(db, chon, coSo) : [];
  const tong = tongHopTuanThu(ds);
  const now = new Date();
  // ⚠️ Chỉ số hàng đợi chấm nằm ở ĐÂY, không ở một trang riêng: nó là DẤU HIỆU SỚM
  // của quá tải phòng Đào tạo (QĐ-CDA-15) và phải được nhìn HÀNG THÁNG. Một trang
  // riêng là một trang không ai mở, và tín hiệu xuất hiện trước khi hệ thống có vẻ
  // hỏng thì chờ người kêu là đã muộn một quý.
  // Hàng đợi chấm là KPI của phòng Đào tạo (QĐ-CDA-15) — không phải của quản lý cơ sở.
  const chiSo =
    loai === "ALL"
      ? await napBangChiSo(db, { ky: kyThangNay(now), bayGio: now })
      : null;
  const duocXuat = can(actor, "elearning:report:export");

  return (
    <TrangQuanTri>
      <PageHeader
        title={loai === "TEAM" ? "Báo cáo đội — tuân thủ hạn chót" : "Báo cáo tuân thủ hạn chót"}
        subtitle={
          loai === "TEAM"
            ? "Tiến độ học của người thuộc cơ sở bạn quản lý."
            : "Ai đã học đúng hạn, ai trễ, ai chưa học — theo từng lượt giao."
        }
        actions={
          <>
            {/* Lối vào R2. Trang nào không có lối vào thì chỉ người viết nó biết đường
                tới — và một báo cáo giám sát không ai mở là một báo cáo không tồn tại.
                Chỉ hiện cho người có quyền: R2 chứa dữ liệu hành vi từng cá nhân. */}
            {can(actor, "elearning:video-analytics:view") ? (
              <Link href="/elearning/bao-cao/video" className={NUT_PHU}>
                Chi tiết xem video và cờ nghi ngờ →
              </Link>
            ) : null}
            {duocXuat && chon && (
              <a href={`/api/elearning/bao-cao-r1?assignmentId=${chon}`} className={NUT_PHU}>
                Xuất Excel
              </a>
            )}
          </>
        }
      />

      {loai === "TEAM" ? (
        // Số liệu bên dưới tính trên người thuộc cơ sở của bạn — một lượt giao nhiều cơ sở sẽ có tổng toàn hệ lớn hơn.
        <GhiChu sac="info">Chỉ gồm người thuộc cơ sở bạn quản lý.</GhiChu>
      ) : null}

      {/* ── Chỉ số hàng đợi chấm tay (M9 · M10) ─────────────────────────── */}
      {chiSo ? (
        <Khoi
          tieuDe="Hàng đợi chấm tay"
          moTa={
            <>
              Cam kết: có điểm trong <strong>{chiSo.slaNgayLam} ngày làm việc</strong> kể từ lúc
              người học nộp. Quá hạn thì hệ thống tự nới hạn của họ — nên con số ở đây là việc
              của người chấm, không phải của người học.
            </>
          }
        >
          <div className="space-y-4">
            <LuoiSoLieu cot={3}>
              <SoLieu nhan="Đang chờ chấm" so={chiSo.m10.dangCho} />
              <SoLieu
                nhan="Quá hạn chấm"
                so={chiSo.m10.quaHan}
                sac={chiSo.m10.quaHan > 0 ? "danger" : "muted"}
                ghiChu={
                  chiSo.m10.quaHan > 0
                    ? `trung vị ${chiSo.m10.trungViQuaHan} ngày · lâu nhất ${chiSo.m10.tuoiLonNhat} ngày làm việc`
                    : undefined
                }
              />
              <SoLieu
                nhan="Chấm đúng hạn tháng này"
                /* Chưa có bài nào thì nói "chưa có", KHÔNG hiện 0% — một phòng chưa
                   nhận bài mà bảng báo 0% tuân thủ là lời buộc tội sai. */
                so={chiSo.m9.tiLe == null ? "—" : `${Math.round(chiSo.m9.tiLe * 100)}%`}
                sac={chiSo.m9.canhBao ? "danger" : "muted"}
                ghiChu={
                  chiSo.m9.tiLe == null
                    ? "chưa chấm bài nào trong tháng"
                    : `${chiSo.m9.dungHan}/${chiSo.m9.tong} bài`
                }
              />
            </LuoiSoLieu>

            {chiSo.m10.canhBao || chiSo.m9.canhBao ? (
              // ⚠️ Nói thẳng đây là dấu hiệu QUÁ TẢI, không phải lỗi thao tác. Người đọc
              // cần biết việc phải làm là chia lại việc, không phải bấm nhanh hơn.
              <GhiChu sac="warning">
                Hàng đợi chấm đang vỡ cam kết. Đây là một trong hai dấu hiệu sớm của quá tải
                ở phòng Đào tạo — cân nhắc chia lại người chấm, đừng chỉ giục.
              </GhiChu>
            ) : null}

            {chiSo.m10.dangCho > 0 ? (
              <Link href="/elearning/cham-bai-tap" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
                Mở hàng đợi chấm bài tập →
              </Link>
            ) : null}
          </div>
        </Khoi>
      ) : null}

      {cacLuot.length === 0 ? (
        <EmptyState
          title="Chưa có lượt giao nào đang chạy"
          description="Khi phòng Đào tạo giao khoá cho người học, báo cáo tuân thủ của lượt giao đó sẽ hiện ở đây."
        />
      ) : (
        <>
          <nav aria-label="Chọn lượt giao" className="flex flex-wrap gap-2">
            {cacLuot.map((l: { id: string; title: string }) => (
              <Link
                key={l.id}
                href={`/elearning/bao-cao?luot=${l.id}`}
                aria-current={l.id === chon ? "true" : undefined}
                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  l.id === chon
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {l.title}
              </Link>
            ))}
          </nav>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <O nhan="Đã giao" so={tong.daGiao} />
            <O nhan="Đúng hạn" so={tong.dungHan} />
            <O nhan="Trễ" so={tong.tre} sac={tong.tre > 0 ? "danger" : undefined} />
            <O nhan="Đang học" so={tong.dangHoc} />
            <O nhan="Chưa học" so={tong.chuaHoc} />
            <O
              nhan="Tỉ lệ đúng hạn"
              // ⚠️ Mẫu số 0 thì hiện "chưa đo được", KHÔNG hiện 0%. "0% tuân thủ"
              // đọc thành thảm hoạ, còn sự thật là chưa có ai để đo.
              chu={
                tong.tyLeDungHan === null
                  ? "chưa đo được"
                  : `${tong.tyLeDungHan}%`
              }
            />
          </dl>

          {(tong.thuHoi > 0 || tong.tamDung > 0 || tong.tuongDuong > 0) && (
            <p className="text-sm text-muted-foreground">
              Ngoài mẫu số: {tong.thuHoi} đã thu hồi · {tong.tamDung} tạm dừng
              đồng hồ
              {tong.tuongDuong > 0 &&
                ` · ${tong.tuongDuong} công nhận tương đương`}
              . Họ không nằm trong phép đo hạn chót của kỳ này nên không tính
              vào tỉ lệ
              {tong.tuongDuong > 0 &&
                " — riêng nhóm công nhận tương đương VẪN được tính là đã được đào tạo"}
              .
            </p>
          )}

          <Khoi tieuDe={`Danh sách ${ds.length} người`} sat>
            {ds.length === 0 ? (
              <KhoiRong title="Lượt giao này chưa có người học nào trong phạm vi của bạn" />
            ) : (
              <PhanTrangBang cuonNgang tenDonVi="người" soDongMacDinh={20}>
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className={THEAD_BANG}>
                      {R1_COLUMNS.map((c) => (
                        <th key={c} scope="col" className={TH_BANG}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ds.map((d) => {
                      const tre = soNgayTre(d, now);
                      const nhom = phanNhom(d);
                      return (
                        <tr key={d.userId} className={TR_BANG}>
                          <td className={`${TD_BANG} whitespace-nowrap font-medium`}>{d.fullName}</td>
                          <td className={`${TD_BANG} whitespace-nowrap text-muted-foreground`}>
                            {d.employeeCode}
                          </td>
                          <td className={`${TD_BANG} text-muted-foreground`}>
                            {d.departmentName ?? ""}
                          </td>
                          <td className={`${TD_BANG} text-muted-foreground`}>
                            {d.managerName ?? ""}
                          </td>
                          <td className={`${TD_BANG} whitespace-nowrap`}>
                            <TrangThaiBadge
                              sac={
                                nhom === "DUNG_HAN"
                                  ? "success"
                                  : nhom === "TRE"
                                    ? "danger"
                                    : "muted"
                              }
                            >
                              {nhanNhom(nhom)}
                            </TrangThaiBadge>
                          </td>
                          <td className={`${TD_BANG} text-right tabular-nums`}>{d.progressPercent}</td>
                          <td className={`${TD_BANG} whitespace-nowrap text-muted-foreground`}>
                            {d.dueAtOriginal?.toLocaleDateString("vi-VN") ?? ""}
                          </td>
                          <td className={`${TD_BANG} whitespace-nowrap text-muted-foreground`}>
                            {d.completedAt?.toLocaleDateString("vi-VN") ?? ""}
                          </td>
                          <td className={`${TD_BANG} whitespace-nowrap tabular-nums`}>{tre ?? ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </PhanTrangBang>
            )}
          </Khoi>
        </>
      )}
    </TrangQuanTri>
  );
}

function O(props: { nhan: string; so?: number; chu?: string; sac?: "danger" }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
      <dt className="truncate text-xs font-medium text-muted-foreground">{props.nhan}</dt>
      <dd
        className={`mt-1 truncate text-xl font-bold tabular-nums ${
          props.sac === "danger" ? "text-state-danger-ink" : "text-foreground"
        }`}
      >
        {props.chu ?? props.so}
      </dd>
    </div>
  );
}
