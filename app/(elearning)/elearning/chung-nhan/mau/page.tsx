import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { GhiChu, Khoi, QuayLai, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../../_components/ui/trang";
import { LIEN_KET_CHU, NUT_PHU } from "../../_components/ui/dieu-khien";
import { TRUONG_TU_DIEN, danhGiaAnhHuong } from "@/lib/elearning/chung-nhan-mau";

/**
 * P8/QtMauCN — MẪU CHỨNG NHẬN: phần KHÔNG phụ thuộc quyết định nghiệp vụ (D-45).
 *
 * Có: mô tả khuôn HIỆN HÀNH, xem thử PDF bằng dữ liệu mẫu (chính `CertificatePdf` đang dùng — không khuôn thứ hai), bảng chữ hệ thống tự điền (kèm thời điểm đọc),
 * và đánh giá ẢNH HƯỞNG tới chứng nhận đã cấp bằng số liệu thật. KHÔNG có (cố ý): thay phôi, đặt vị trí chữ, mẫu riêng từng miền — cần quyết định của Owner
 * (bảng quyết định ở `CHUNG-NHAN-MAU-QUYET-DINH.md`); các nút đó KHÔNG được vẽ khi chưa có backend phía sau. Không đổi quy tắc mã chứng nhận.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Mẫu chứng nhận | Sata Robo", robots: { index: false, follow: false } };

const NHAN = { "chup-luc-cap": "Ảnh chụp lúc cấp", "doc-song": "Đọc lại mỗi lần dựng PDF", "tinh-luc-in": "Tính lúc dựng PDF" } as const;

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
        <PageHeader title="Mẫu chứng nhận" />
        <NoPermission permission="elearning:progress:view-all" what="mẫu chứng nhận" askWho="phòng Đào tạo hoặc Nhân sự" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }

  const now = new Date();
  const db = scopedDb(actor);
  const [conHieuLuc, hetHan, thuHoi] = await Promise.all([
    db.trnCertificate.count({ where: { status: "VALID", OR: [{ validUntil: null }, { validUntil: { gt: now } }] } }),
    db.trnCertificate.count({ where: { status: { not: "REVOKED" }, validUntil: { lte: now } } }),
    db.trnCertificate.count({ where: { status: "REVOKED" } }),
  ]);
  const anhHuong = danhGiaAnhHuong({ conHieuLuc, hetHan, thuHoi });

  return (
    <TrangQuanTri rong="vua">
      <QuayLai href="/elearning/chung-nhan">Chứng nhận</QuayLai>
      <PageHeader
        title="Mẫu giấy chứng nhận"
        subtitle="Khuôn đang dùng để dựng bản PDF chứng nhận. Trang này chỉ xem — thay phôi / đặt vị trí chữ chờ Owner quyết định."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label="Mẫu nhân viên" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-medium text-foreground">Nhân viên · khoá nội bộ</h2>
            <span className="text-xs text-state-success-ink">Đang dùng</span>
          </div>
          <p className="text-sm text-muted-foreground">
            A4 ngang · viền cam · chữ NotoSans · tên người nhận, khoá, hiệu lực, mã chứng nhận và mã QR xác minh. Dùng chung khuôn với chứng chỉ học viên offline.
          </p>
          <a href="/api/elearning/chung-nhan/mau-xem" target="_blank" rel="noreferrer" className={NUT_PHU}>
            Xem mẫu PDF
          </a>
        </section>
        <section aria-label="Mẫu học viên online" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-medium text-foreground">Học viên · khoá online</h2>
            <span className="text-xs text-muted-foreground">Chưa có</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Chứng nhận online đã được cấp ở bảng riêng của miền Online (`OnlCertificate`) nhưng CHƯA có bản PDF. Mẫu riêng cho học viên online cần quyết định (xem bảng quyết định).
          </p>
        </section>
      </div>

      <Khoi tieuDe="Chữ hệ thống tự điền" sat>
        <PhanTrangBang cuonNgang tenDonVi="chữ" soDongMacDinh={20}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className={THEAD_BANG}>
                <th scope="col" className={TH_BANG}>Chữ</th>
                <th scope="col" className={TH_BANG}>Lấy từ</th>
                <th scope="col" className={TH_BANG}>Đọc lúc</th>
                <th scope="col" className={TH_BANG}>Nhân viên</th>
                <th scope="col" className={TH_BANG}>Học viên online</th>
              </tr>
            </thead>
            <tbody>
              {TRUONG_TU_DIEN.map((t) => (
                <tr key={t.truong} className={`${TR_BANG} align-top`}>
                  <td className={TD_BANG}>{t.chu}</td>
                  <td className={`${TD_BANG} text-muted-foreground`}>{t.layTu}</td>
                  <td className={`${TD_BANG} whitespace-nowrap`}>{NHAN[t.thoiDiem]}</td>
                  <td className={TD_BANG}>{t.nhanVien ? "✓" : "—"}</td>
                  <td className={`${TD_BANG} text-muted-foreground`}>{t.hocVienOnline === "chua-co-pdf" ? "chưa có PDF" : t.hocVienOnline ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </Khoi>

      <Khoi tieuDe="Ảnh hưởng nếu đổi khuôn" moTa={`Tác động tới ${anhHuong.soAnhHuong} chứng nhận đã cấp trong phạm vi của bạn (${conHieuLuc} còn hiệu lực · ${hetHan} hết hạn · ${thuHoi} đã thu hồi).`}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {anhHuong.canhBao.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Khoi>

      <GhiChu sac="info">
        Đang chờ Owner quyết định: dùng chung công cụ tạo PDF hay tách · mẫu riêng từng miền · quy tắc phiên bản (ghi phiên bản lên chứng nhận lúc cấp) · phôi/logo/sticker · chữ ký ·
        mã chứng nhận cũ/mới. Bảng quyết định: <code>docs/elearning/thiet-ke-lai-2611/implementation/CHUNG-NHAN-MAU-QUYET-DINH.md</code>. Quy tắc mã chứng nhận hiện hành được giữ nguyên.
      </GhiChu>
    </TrangQuanTri>
  );
}
