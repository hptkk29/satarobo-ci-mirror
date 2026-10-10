// app/(admin)/admin/bao-luu/[id]/page.tsx — CHI TIẾT một hồ sơ bảo lưu + duyệt/từ chối/huỷ.
//
// Quyền: `bao-luu:view` + hồ sơ trong tầm nhìn cơ sở (`scopedDb`; ngoài tầm nhìn ⇒ 404, không lộ sự tồn tại).
// "Nút nào hiện" tính Ở ĐÂY và đi xuống client bằng cờ — và là cùng luật mà Server Action tự kiểm lại:
//   · Duyệt/Từ chối = `bao-luu:approve` VÀ không phải người lập (maker–checker). Người lập thấy câu giải thích thay vì
//     một nút chắc chắn bị từ chối (luật 12).
//   · Huỷ = hồ sơ chưa bắt đầu (PENDING/APPROVED) VÀ (`bao-luu:approve` HOẶC chính người lập có `bao-luu:create`).
//   · Đã ACTIVE trở đi: phục học thuộc Phiên 6 — màn này chỉ hiển thị.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, FileText } from "lucide-react";
import { PageHeader } from "@/components/admin/ui/page-header";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { scopedDb } from "@/lib/db-scope";
import { ngayVN } from "@/lib/format/date";
import { NHAN_LY_DO, chanTuDuyet } from "@/lib/bao-luu/hoso";
import { NHAN_LOAI, NHAN_SU_KIEN, NHAN_TRANG_THAI, TONE_TRANG_THAI } from "@/lib/bao-luu/nhan";
import { vnYmd } from "@/lib/time/vn";
import { HanhDongHoSo } from "../_components/hanh-dong-ho-so";
import { ThaoTacVongDoi } from "../_components/thao-tac-vong-doi";
import { ThaoTacPhucHoc } from "../_components/thao-tac-phuc-hoc";
import { tienHoanTuCap } from "@/lib/bao-luu/anh-chup";
import { docChinhSach } from "@/lib/bao-luu/ngu-canh-db";
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hồ sơ bảo lưu | Admin Sata Robo" };

function Dong({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-2 text-sm sm:grid-cols-[11rem_1fr]">
      <dt className="text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

export default async function ChiTietBaoLuuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/bao-luu/${id}`)}`);
  if (!(await checkPermission(PAGE_GATES["/bao-luu"][0]!))) redirect("/dashboard?error=unauthorized");

  const [coQuyenDuyet, coQuyenLap, coQuyenGiaHan, coNgoaiLe, coQuyenHoan, actor] = await Promise.all([
    checkPermission("bao-luu:approve"),
    checkPermission("bao-luu:create"),
    checkPermission("bao-luu:extend"),
    checkPermission("bao-luu:exception"),
    checkPermission("bao-luu:refund-request"),
    resolveActor(session.user.id),
  ]);
  const sdb = scopedDb(actor);
  const hs = await sdb.studentReserve.findUnique({
    where: { id },
    select: {
      id: true, status: true, type: true, centerId: true, orgUnitId: true, studentId: true,
      snapTuitionNet: true, snapSoBuoiMua: true, snapSessionsRemaining: true, snapUnitPrice: true, snapSoBuoiSuyRa: true, snapStoppedAtLessonOrder: true,
      extendCount: true, extendRequest: true, lastContactAt: true, officialNoticeSentAt: true, officialNoticeChannel: true, responseDeadline: true,
      reason: true, reasonCode: true, reasonNote: true,
      startedAt: true, requestedAt: true, expectedEndAt: true, firstAbsentDate: true, approvedAt: true,
      standardEndDate: true, extendedEndDate: true, endedAt: true, endReason: true,
      createdByUserId: true, createdByName: true, approvedById: true, endedByName: true,
      applicationFileKey: true, evidenceFileKeys: true,
      student: { select: { name: true, studentCode: true } },
      enrollment: { select: { course: { select: { name: true } }, class: { select: { name: true } } } },
      events: { orderBy: { at: "asc" }, select: { id: true, kind: true, at: true, actorId: true, note: true } },
    },
  });
  if (!hs) notFound();

  const nguoi = [...new Set(hs.events.map((e) => e.actorId).filter((x): x is string => !!x))];
  const ten = new Map(
    (nguoi.length ? await sdb.user.findMany({ where: { id: { in: nguoi } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]),
  );

  const laNguoiLap = hs.createdByUserId === session.user.id;
  const chuaBatDau = hs.status === "PENDING" || hs.status === "APPROVED";
  const choDuyet = hs.status === "PENDING";
  const duocDuyet = choDuyet && coQuyenDuyet && chanTuDuyet(session.user.id, hs.createdByUserId) === null;
  const duocHuy = chuaBatDau && (coQuyenDuyet || (coQuyenLap && laNguoiLap));
  const ngayNghi = hs.firstAbsentDate ? vnYmd(hs.firstAbsentDate).split("-").reverse().join("/") : null;

  // ── Thao tác sau khi bắt đầu (Phiên 5): nút nào hiện = đúng điều kiện mà Server Action tự kiểm lại (luật 12) ──
  const dmy = (d: Date) => vnYmd(d).split("-").reverse().join("/");
  const dangBaoLuu = hs.status === "ACTIVE" || hs.status === "OVERDUE" || hs.status === "NOTICE_SENT";
  const deNghi = (hs.extendRequest ?? null) as { requestedById?: string; requestedByName?: string; newEndDate?: string; reason?: string } | null;
  const laNguoiDeNghi = !!deNghi && deNghi.requestedById === session.user.id;
  const coThaoTac = {
    lienHe: (coQuyenLap || coQuyenDuyet) && (dangBaoLuu || hs.status === "RESUME_PENDING"),
    thongBao: coQuyenDuyet && hs.status === "OVERDUE" && hs.type !== "CENTER",
    deNghiGiaHan: (coQuyenLap || coQuyenGiaHan) && dangBaoLuu && hs.type !== "CENTER" && !deNghi,
    duyetGiaHan: coQuyenGiaHan && !!deNghi && !laNguoiDeNghi,
    tuChoiGiaHan: !!deNghi && (coQuyenGiaHan || laNguoiDeNghi),
    khoiPhuc: coNgoaiLe && hs.status === "TERMINATED",
  };
  const coPhucHoc = {
    bao: (coQuyenLap || coQuyenDuyet) && dangBaoLuu,
    xep: coQuyenDuyet && (dangBaoLuu || hs.status === "RESUME_PENDING"),
    trungTam: coQuyenDuyet && hs.status === "RESUME_PENDING" && hs.type !== "CENTER",
    hoan: coQuyenHoan && hs.type === "CENTER" && (hs.status === "ACTIVE" || hs.status === "RESUME_PENDING"),
  };
  const uocHoan = tienHoanTuCap(hs);
  const coBatKyThaoTac = Object.values(coThaoTac).some(Boolean) || Object.values(coPhucHoc).some(Boolean);
  const cs = dangBaoLuu || hs.status === "TERMINATED" ? await docChinhSach(hs.orgUnitId) : null;
  const hanHienTai = hs.extendedEndDate ?? hs.standardEndDate;
  const homNay = vnYmd(new Date());
  const tranGiaHan = cs && hanHienTai ? vnYmd(hanToiDaBaoLuu(hanHienTai, cs.extendMaxMonths)) : null;
  const tranKhoiPhuc = cs ? vnYmd(hanToiDaBaoLuu(new Date(), cs.maxMonths)) : null;

  return (
    <div className="mx-auto w-full max-w-[920px]">
      <Link href="/bao-luu" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Danh sách hồ sơ bảo lưu
      </Link>
      <PageHeader
        title={`Bảo lưu — ${hs.student.name}`}
        subtitle={hs.enrollment ? `${hs.enrollment.course.name} — ${hs.enrollment.class.name}` : "Toàn bộ khoá đang học"}
        actions={<StatusPill tone={TONE_TRANG_THAI[hs.status]}>{NHAN_TRANG_THAI[hs.status]}</StatusPill>}
      />

      {choDuyet && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          {duocDuyet || duocHuy ? (
            <HanhDongHoSo
              reserveId={hs.id}
              duocDuyet={duocDuyet}
              duocTuChoi={duocDuyet}
              duocHuy={duocHuy}
              ngayNghiDauTien={ngayNghi}
            />
          ) : null}
          {coQuyenDuyet && laNguoiLap && (
            <p className="mt-2 text-sm text-muted-foreground">
              Bạn là người lập hồ sơ này nên <strong>không tự duyệt hoặc từ chối</strong> được — nhờ một Quản lý khác. Muốn rút hồ sơ thì bấm Huỷ hồ sơ.
            </p>
          )}
          {!coQuyenDuyet && !duocHuy && (
            <p className="text-sm text-muted-foreground">Hồ sơ đang chờ Quản lý cơ sở duyệt.</p>
          )}
        </div>
      )}
      {!choDuyet && duocHuy && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <HanhDongHoSo reserveId={hs.id} duocDuyet={false} duocTuChoi={false} duocHuy ngayNghiDauTien={null} />
        </div>
      )}

      {deNghi && (
        <div role="status" className="mb-4 rounded-xl border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          <strong>Có đề nghị gia hạn đang chờ duyệt</strong>
          {deNghi.requestedByName ? ` — ${deNghi.requestedByName}` : ""}
          {deNghi.newEndDate ? <>: đến <span className="tabular-nums">{dmy(new Date(deNghi.newEndDate))}</span></> : null}
          {deNghi.reason ? <span className="block">Lý do: {deNghi.reason}</span> : null}
          {coQuyenGiaHan && laNguoiDeNghi && <span className="mt-1 block">Bạn là người đề nghị nên không tự duyệt được — nhờ một Quản lý khác.</span>}
        </div>
      )}

      {coBatKyThaoTac && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ThaoTacVongDoi reserveId={hs.id} co={coThaoTac} homNay={homNay} tranGiaHan={tranGiaHan} tranKhoiPhuc={tranKhoiPhuc} />
            <ThaoTacPhucHoc reserveId={hs.id} co={coPhucHoc} uocHoan={uocHoan} />
          </div>
        </div>
      )}

      <section className="mb-4 rounded-xl border border-border bg-card px-5 py-3">
        <h2 className="mb-1 text-sm font-semibold">Thông tin hồ sơ</h2>
        <dl className="divide-y divide-border">
          <Dong nhan="Học viên">
            {hs.student.name}
            {hs.student.studentCode ? <span className="ml-2 text-muted-foreground">{hs.student.studentCode}</span> : null}
          </Dong>
          <Dong nhan="Loại hồ sơ">{NHAN_LOAI[hs.type]}</Dong>
          <Dong nhan="Lý do">
            {hs.reasonCode ? NHAN_LY_DO[hs.reasonCode] : "—"}
            {hs.reasonNote ? <span className="block text-muted-foreground">{hs.reasonNote}</span> : null}
          </Dong>
          <Dong nhan="Bắt đầu"><span className="tabular-nums">{ngayVN(hs.startedAt)}</span></Dong>
          <Dong nhan="Dự kiến quay lại"><span className="tabular-nums">{hs.expectedEndAt ? ngayVN(hs.expectedEndAt) : "Chưa khai"}</span></Dong>
          {ngayNghi && <Dong nhan="Buổi nghỉ đầu tiên"><span className="tabular-nums">{ngayNghi}</span></Dong>}
          {hs.standardEndDate && (
            <Dong nhan="Hạn tối đa">
              <span className="tabular-nums">{ngayVN(hs.extendedEndDate ?? hs.standardEndDate)}</span>
              {hs.extendCount > 0 ? <span className="ml-2 text-muted-foreground">(đã gia hạn {hs.extendCount} lần)</span> : null}
            </Dong>
          )}
          {hs.lastContactAt && <Dong nhan="Liên hệ gần nhất"><span className="tabular-nums">{ngayVN(hs.lastContactAt)}</span></Dong>}
          {hs.officialNoticeSentAt && (
            <Dong nhan="Thông báo chính thức">
              <span className="tabular-nums">{ngayVN(hs.officialNoticeSentAt)}</span>
              {hs.officialNoticeChannel ? ` · ${hs.officialNoticeChannel === "THU_TAY" ? "Thư / giao tay" : hs.officialNoticeChannel}` : ""}
              {hs.responseDeadline ? <span className="block text-muted-foreground">Hạn phản hồi: <span className="tabular-nums">{ngayVN(hs.responseDeadline)}</span> — hết hạn mà chưa phục học / gia hạn thì hồ sơ bị chấm dứt.</span> : null}
            </Dong>
          )}
          <Dong nhan="Người lập">{hs.createdByName}{hs.requestedAt ? <span className="ml-2 text-muted-foreground tabular-nums">{ngayVN(hs.requestedAt)}</span> : null}</Dong>
          {hs.endedAt && (
            <Dong nhan="Kết thúc">
              <span className="tabular-nums">{ngayVN(hs.endedAt)}</span>
              {hs.endedByName ? ` · ${hs.endedByName}` : ""}
              {hs.endReason ? <span className="block text-muted-foreground">{hs.endReason}</span> : null}
            </Dong>
          )}
          {!hs.endedAt && hs.endReason && <Dong nhan="Ghi chú">{hs.endReason}</Dong>}
        </dl>
      </section>

      {hs.snapSoBuoiMua !== null && (
        <section className="mb-4 rounded-xl border border-border bg-card px-5 py-3">
          <h2 className="mb-1 text-sm font-semibold">Quyền lợi tại lúc bắt đầu bảo lưu</h2>
          <dl className="divide-y divide-border">
            <Dong nhan="Số buổi còn lại">
              <span className="tabular-nums">{hs.snapSessionsRemaining ?? "—"}</span> / <span className="tabular-nums">{hs.snapSoBuoiMua}</span> buổi đã mua
              {hs.snapSoBuoiSuyRa ? <span className="ml-2 text-muted-foreground">(suy ra: đơn không khai số buổi mua nên lấy đủ khoá)</span> : null}
            </Dong>
            <Dong nhan="Đơn giá thực đóng">{hs.snapUnitPrice !== null ? <span className="tabular-nums">{hs.snapUnitPrice.toLocaleString("vi-VN")} đ / buổi</span> : "Chưa dựng được giá"}</Dong>
            {hs.snapStoppedAtLessonOrder !== null && <Dong nhan="Dừng ở bài"><span className="tabular-nums">{hs.snapStoppedAtLessonOrder}</span></Dong>}
          </dl>
        </section>
      )}

      <section className="mb-4 rounded-xl border border-border bg-card px-5 py-3">
        <h2 className="mb-2 text-sm font-semibold">Đơn &amp; minh chứng</h2>
        {hs.applicationFileKey || hs.evidenceFileKeys.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {hs.applicationFileKey && (
              <li>
                <a className="inline-flex items-center gap-2 text-primary-ink hover:underline" href={`/api/admin/bao-luu/tep/${hs.id}?loai=don`} target="_blank" rel="noopener noreferrer">
                  <FileText className="size-4" aria-hidden /> Đơn bảo lưu đã ký
                </a>
              </li>
            )}
            {hs.evidenceFileKeys.map((_, i) => (
              <li key={i}>
                <a className="inline-flex items-center gap-2 text-primary-ink hover:underline" href={`/api/admin/bao-luu/tep/${hs.id}?loai=minh-chung&i=${i}`} target="_blank" rel="noopener noreferrer">
                  <FileText className="size-4" aria-hidden /> Minh chứng {i + 1}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {hs.type === "LEGACY" ? "Hồ sơ cũ — không có đơn đính kèm." : "Hồ sơ chưa có đơn đính kèm."}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Tệp nằm ở kho riêng tư; liên kết mở ra chỉ sống 2 phút và mỗi lần mở đều được ghi nhật ký.</p>
      </section>

      <section className="rounded-xl border border-border bg-card px-5 py-3">
        <h2 className="mb-2 text-sm font-semibold">Lịch sử</h2>
        {hs.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Hồ sơ cũ — chưa có nhật ký sự kiện.</p>
        ) : (
          <ol className="space-y-3 border-l border-border pl-4">
            {hs.events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                <p className="font-medium">
                  {NHAN_SU_KIEN[e.kind]}
                  <span className="ml-2 font-normal text-muted-foreground tabular-nums">{ngayVN(e.at)}</span>
                </p>
                <p className="text-xs text-muted-foreground">{e.actorId ? (ten.get(e.actorId) ?? "Nhân sự khác") : "Hệ thống"}</p>
                {e.note && <p className="mt-0.5 text-muted-foreground">{e.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
