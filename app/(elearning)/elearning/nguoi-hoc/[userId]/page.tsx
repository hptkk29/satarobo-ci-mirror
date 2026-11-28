import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { TienDo } from "../../_components/ui/tien-do";
import { GhiChu, Khoi, KhoiRong, LuoiSoLieu, QuayLai, SoLieu, TD_BANG, TH_BANG, THEAD_BANG, TR_BANG, TrangQuanTri } from "../../_components/ui/trang";
import { LIEN_KET_CHU, NUT_PHU } from "../../_components/ui/dieu-khien";
import { tomTatMotNguoi, trangThaiLuot, type DongNguoiHoc, type TrangThaiLuotHoc } from "@/lib/elearning/nguoi-hoc";
import { nhacHocHomNay, traMotNguoiHoc } from "@/lib/elearning/nguoi-hoc-query";
import { soNgayTre } from "@/lib/elearning/report-compliance";
import { coSoCuaPhamVi, loaiQuyenBaoCao } from "@/lib/elearning/report-scope";
import type { SacThai } from "@/lib/elearning/dashboard-pure";
import { NhacMotNguoi } from "../_components/nhac-mot-nguoi";

/**
 * P7 — HỒ SƠ HỌC TẬP MỘT NGƯỜI (thiết kế 20/11: `QtNguoiHocChiTiet`). Cùng quyền và phạm vi với danh sách.
 * Người không có lượt học nào TRONG TẦM NHÌN ⇒ 404 — "không có" và "ở cơ sở khác" không được phân biệt (không lộ nhân viên cơ sở khác).
 * KHÔNG vẽ "Thời gian học tháng này" của thiết kế: chưa có định nghĩa được Đào tạo duyệt (`TrnLessonProgress` chỉ giữ số giây TÍCH LUỸ theo bài,
 * không tách theo tháng) — xem DECISIONS D-41. "Tiến độ" từng khoá là % hoàn thành của lượt (không phải chuỗi chấm theo bài: lượt học không giữ số bài).
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Hồ sơ học tập | Sata Robo", robots: { index: false, follow: false } };

const SAC: Record<TrangThaiLuotHoc, SacThai> = {
  DAT_DUNG_HAN: "success",
  DAT_TRE: "warning",
  TUONG_DUONG: "info",
  DANG_HOC: "warning",
  CHUA_BAT_DAU: "muted",
  DANG_TRE: "danger",
  TAM_DUNG: "muted",
  THU_HOI: "muted",
};
const dinhDang = (d: Date, kieu: "ngay" | "ngay-thang" | "gio") =>
  new Intl.DateTimeFormat("vi-VN", kieu === "gio" ? { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" } : kieu === "ngay" ? { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" } : { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(d);

/** Chữ ở cột "Kết quả" — đúng kiểu thiết kế: "Trễ 5 ngày" · "Đang học" · "11/12 · đạt". */
function chuKetQua(d: DongNguoiHoc, tt: TrangThaiLuotHoc, now: Date): string {
  switch (tt) {
    case "DANG_TRE":
      return `Trễ ${soNgayTre(d, now) ?? 0} ngày`;
    case "DAT_DUNG_HAN":
      return d.completedAt ? `${dinhDang(d.completedAt, "ngay-thang")} · đạt` : "Đạt";
    case "DAT_TRE":
      return d.completedAt ? `${dinhDang(d.completedAt, "ngay-thang")} · đạt (trễ)` : "Đạt (trễ)";
    case "TUONG_DUONG":
      return "Công nhận tương đương";
    case "DANG_HOC":
      return "Đang học";
    case "CHUA_BAT_DAU":
      return "Chưa bắt đầu";
    case "TAM_DUNG":
      return "Tạm dừng đồng hồ";
    case "THU_HOI":
      return "Đã thu hồi";
  }
}

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  const loai = loaiQuyenBaoCao(actor);
  if (!loai) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Hồ sơ học tập" />
        <NoPermission permission="elearning:progress:view-all · elearning:progress:view-team" what="hồ sơ học tập" askWho="phòng Đào tạo hoặc Nhân sự" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }
  const coSo = coSoCuaPhamVi(loai, actor);
  const r = await traMotNguoiHoc(scopedDb(actor), coSo, userId);
  if (!r) notFound();
  const now = new Date();
  const t = tomTatMotNguoi(r.dong, now);
  const daNhac = (await nhacHocHomNay([userId], now)).get(userId);
  const meta = [
    t.ma,
    t.vaiTro,
    t.coSo,
    r.hoSo.vaoLam ? `vào làm ${dinhDang(r.hoSo.vaoLam, "ngay")}` : null,
    r.hoSo.quanLy ? `quản lý trực tiếp ${r.hoSo.quanLy}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const conHieuLuc = r.chungNhan.filter((c) => c.status === "VALID").length;

  return (
    <TrangQuanTri rong="vua">
      <QuayLai href="/elearning/nguoi-hoc">Người học</QuayLai>
      <PageHeader
        title={t.ten}
        subtitle={meta}
        actions={
          <>
            {can(actor, "elearning:assignment:create") ? (
              <Link href={`/elearning/giao-bai?nguoi=${encodeURIComponent(userId)}`} className={NUT_PHU}>
                Giao khoá
              </Link>
            ) : null}
            <NhacMotNguoi userId={userId} daNhacLuc={daNhac ? dinhDang(daNhac, "gio") : null} />
          </>
        }
      />

      <LuoiSoLieu cot={3}>
        <SoLieu nhan="Bắt buộc đã đạt" so={t.batBuoc === 0 ? "—" : `${t.batBuocDat} / ${t.batBuoc}`} />
        <SoLieu nhan="Đang trễ" so={t.dangTre} sac={t.dangTre > 0 ? "danger" : "muted"} ghiChu={t.treNhat ? t.treNhat.khoa : undefined} />
        <SoLieu nhan="Cờ video đang mở" so={r.hoSo.coVideoMo} sac={r.hoSo.coVideoMo > 0 ? "warning" : "muted"} />
      </LuoiSoLieu>

      <Khoi tieuDe="Các khoá được giao">
        <PhanTrangBang cuonNgang tenDonVi="lượt" soDongMacDinh={20}>
          <table className="w-full border-collapse">
            <thead className={THEAD_BANG}>
              <tr>
                <th className={TH_BANG}>Khoá</th>
                <th className={TH_BANG}>Lượt giao</th>
                <th className={TH_BANG}>Tiến độ</th>
                <th className={TH_BANG}>Hạn</th>
                <th className={TH_BANG}>Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {r.dong.map((d) => {
                const tt = trangThaiLuot(d, now);
                return (
                  <tr key={d.enrollmentId} className={TR_BANG}>
                    <td className={TD_BANG}>
                      {d.courseTitle}
                      {d.isMandatory ? <span className="ml-1.5 text-xs text-muted-foreground">bắt buộc</span> : null}
                    </td>
                    <td className={TD_BANG}>{d.assignmentTitle ?? "—"}</td>
                    <td className={`${TD_BANG} min-w-32`}>
                      <TienDo phanTram={d.progressPercent} nhan={`${d.courseTitle}: ${d.progressPercent}%`} />
                    </td>
                    <td className={TD_BANG}>{d.dueAtOriginal ? dinhDang(d.dueAtOriginal, "ngay-thang") : "—"}</td>
                    <td className={TD_BANG}>
                      <TrangThaiBadge sac={SAC[tt]}>{chuKetQua(d, tt, now)}</TrangThaiBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      </Khoi>

      <Khoi tieuDe="Chứng nhận">
        {r.chungNhan.length === 0 ? (
          <KhoiRong title="Chưa có chứng nhận" />
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="chứng nhận" soDongMacDinh={10}>
            <table className="w-full border-collapse">
              <thead className={THEAD_BANG}>
                <tr>
                  <th className={TH_BANG}>Khoá</th>
                  <th className={TH_BANG}>Số hiệu</th>
                  <th className={TH_BANG}>Hiệu lực</th>
                </tr>
              </thead>
              <tbody>
                {r.chungNhan.map((c) => (
                  <tr key={c.id} className={TR_BANG}>
                    <td className={TD_BANG}>{c.khoa}</td>
                    <td className={TD_BANG}>
                      {c.certCode}
                      <span className="ml-1.5 text-xs text-muted-foreground">{c.validUntil ? `đến ${dinhDang(c.validUntil, "ngay")}` : "không hết hạn"}</span>
                    </td>
                    <td className={TD_BANG}>
                      <TrangThaiBadge sac={c.status === "VALID" ? "success" : "muted"}>{c.status === "VALID" ? "Còn hiệu lực" : c.status === "REVOKED" ? "Đã thu hồi" : "Hết hạn"}</TrangThaiBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{conHieuLuc} chứng nhận còn hiệu lực.</p>
      </Khoi>

      <GhiChu sac="info">Chưa hiển thị &ldquo;thời gian học trong tháng&rdquo; của thiết kế: chỉ số này cần định nghĩa riêng và chưa được Đào tạo duyệt.</GhiChu>
    </TrangQuanTri>
  );
}
