import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { duocXuat, vaiCuaPhien } from "@/lib/export/quyen-xuat";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { TabNav } from "../_components/ui/tab-nav";
import { GhiChu, KhoiRong, TrangQuanTri } from "../_components/ui/trang";
import { LIEN_KET_CHU, NUT_PHU, O_CHON, O_NHAP, NHAN_O } from "../_components/ui/dieu-khien";
import { chuDangTre, chuVietTat, giaTriRiengBiet, gomTheoNguoi, locNguoiHoc } from "@/lib/elearning/nguoi-hoc";
import { demChungNhanHopLe, nhacHocHomNay, traNguoiHoc, TRAN_LUOT_HOC } from "@/lib/elearning/nguoi-hoc-query";
import { coSoCuaPhamVi, loaiQuyenBaoCao } from "@/lib/elearning/report-scope";
import { tabDangMo, type SearchParamsTho } from "@/lib/elearning/tab-url";
import { NguoiHocBang, type DongBang } from "./_components/nguoi-hoc-bang";

/**
 * P7 — NGƯỜI HỌC (nhân viên): tiến độ gom theo từng người (thiết kế 20/11: `QtNguoiHoc` = tab "Cần chú ý", `QtNguoiHocTatCa` = tab "Tất cả").
 * Quyền = quyền xem tiến độ của báo cáo R1: `view-all` (Đào tạo/Nhân sự — toàn hệ) hoặc `view-team` (quản lý cơ sở — chỉ cơ sở mình).
 * Nút: "Nhắc học" (chuông + Web Push qua cổng thông báo e-learning, tối đa 1 lần/người/ngày), "Giao khoá" (mở trình giao khoá với người đã chọn),
 * "Xuất Excel" (cổng xuất riêng `elearning-nguoi-hoc`). Mỗi nút chỉ vẽ khi người xem có quyền thật để dùng nó.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Người học | Sata Robo", robots: { index: false, follow: false } };

const CAC_TAB = ["can-chu-y", "tat-ca"] as const;
const tho = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParamsTho> }) {
  const sp = await searchParams;
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
        <PageHeader title="Người học" />
        <NoPermission permission="elearning:progress:view-all · elearning:progress:view-team" what="danh sách người học" askWho="phòng Đào tạo hoặc Nhân sự" />
        <Link href="/elearning" className={`${LIEN_KET_CHU} inline-flex min-h-8 items-center`}>
          Về trang tổng quan
        </Link>
      </TrangQuanTri>
    );
  }
  const tab = tabDangMo(sp, CAC_TAB, "can-chu-y") as (typeof CAC_TAB)[number];
  const q = tho(sp.q)?.trim() ?? "";
  const coSoLoc = tho(sp.coSo) ?? "";
  const vaiTroLoc = tho(sp.vaiTro) ?? "";

  const now = new Date();
  const { dong, biCat } = await traNguoiHoc(scopedDb(actor), coSoCuaPhamVi(loai, actor));
  const tatCa = gomTheoNguoi(dong, now);
  const canChuY = tatCa.filter((x) => x.canChuY);
  // Tab "Cần chú ý" đúng như thiết kế: không bộ lọc; tab "Tất cả" có tìm + cơ sở + vai trò.
  const ds = tab === "can-chu-y" ? canChuY : locNguoiHoc(tatCa, { q, coSo: coSoLoc || undefined, vaiTro: vaiTroLoc || undefined });
  const [demCn, daNhac, coXuat] = await Promise.all([
    demChungNhanHopLe(ds.map((x) => x.userId), coSoCuaPhamVi(loai, actor)),
    nhacHocHomNay(ds.map((x) => x.userId), now),
    can(actor, "elearning:report:export") ? duocXuat("elearning-nguoi-hoc", vaiCuaPhien(session.user)) : Promise.resolve(false),
  ]);
  const gio = (d: Date) => new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(d);
  const bang: DongBang[] = ds.map((x) => {
    const t = chuDangTre(x);
    const luc = daNhac.get(x.userId);
    return {
      userId: x.userId,
      ten: x.ten,
      viet: chuVietTat(x.ten),
      ma: x.ma,
      vaiTro: x.vaiTro,
      coSo: x.coSo,
      batBuoc: x.batBuoc,
      batBuocDat: x.batBuocDat,
      coDangHoc: x.batBuocDangHoc > 0,
      chuTre: t.chu,
      sacTre: t.sac,
      chungNhan: demCn.get(x.userId) ?? 0,
      daNhacLuc: luc ? gio(luc) : null,
    };
  });

  const giuLai = { q, coSo: coSoLoc, vaiTro: vaiTroLoc };
  const hrefXuat = `/api/elearning/nguoi-hoc?${new URLSearchParams({ ...(tab === "can-chu-y" ? { chu: "1" } : { q, coSo: coSoLoc, vaiTro: vaiTroLoc }) } as Record<string, string>).toString()}`;
  const coNhac = true; // đã qua `loaiQuyenBaoCao` ở trên; server action kiểm lại phạm vi từng người
  const coGiao = can(actor, "elearning:assignment:create");

  return (
    <TrangQuanTri rong="vua">
      <PageHeader
        title="Người học (nhân viên)"
        subtitle={loai === "TEAM" ? "Tiến độ học gom theo từng người — chỉ nhân sự cơ sở của bạn." : "Tiến độ học gom theo từng người."}
        actions={
          coXuat ? (
            <a href={hrefXuat} className={NUT_PHU}>
              Xuất Excel
            </a>
          ) : undefined
        }
      />

      <TabNav
        duongDan="/elearning/nguoi-hoc"
        nhanDanhSach="Người học"
        dangMo={tab}
        giuLai={giuLai}
        tab={[
          { id: "can-chu-y", nhan: "Cần chú ý", dem: canChuY.length },
          { id: "tat-ca", nhan: "Tất cả", dem: tatCa.length },
        ]}
      />

      {biCat ? (
        <GhiChu sac="warning">
          Chỉ đọc {TRAN_LUOT_HOC.toLocaleString("vi-VN")} lượt học mới nhất trong tầm nhìn — người chỉ có lượt học cũ hơn có thể chưa hiện.
        </GhiChu>
      ) : null}
      {tab === "can-chu-y" ? (
        <p className="text-sm text-muted-foreground">Cần chú ý = có ít nhất một khoá đang trễ (chưa hoàn thành mà hạn gốc đã qua).</p>
      ) : (
        <form method="get" action="/elearning/nguoi-hoc" role="search" aria-label="Lọc người học" className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <input type="hidden" name="tab" value="tat-ca" />
          <label className={NHAN_O}>
            Tìm người
            <input name="q" defaultValue={q} placeholder="Tên, mã nhân viên" className={O_NHAP} />
          </label>
          <label className={NHAN_O}>
            Cơ sở
            <select name="coSo" defaultValue={coSoLoc} className={O_CHON}>
              <option value="">Tất cả cơ sở</option>
              {giaTriRiengBiet(tatCa, "coSo").map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={NHAN_O}>
            Vai trò
            <select name="vaiTro" defaultValue={vaiTroLoc} className={O_CHON}>
              <option value="">Mọi vai trò</option>
              {giaTriRiengBiet(tatCa, "vaiTro").map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={NUT_PHU}>
            Lọc
          </button>
        </form>
      )}

      {bang.length === 0 ? (
        <KhoiRong
          title={tab === "can-chu-y" ? "Không ai đang trễ" : tatCa.length === 0 ? "Chưa có ai được giao khoá" : "Không có ai khớp bộ lọc"}
          description={tab === "can-chu-y" ? "Khi có người trễ hạn một khoá, họ sẽ hiện ở đây." : tatCa.length === 0 ? "Danh sách xuất hiện khi có lượt giao khoá cho nhân viên." : "Thử bỏ bộ lọc hoặc đổi từ khoá."}
        />
      ) : (
        <NguoiHocBang dong={bang} kieu={tab} coNhac={coNhac} coGiao={coGiao} />
      )}
    </TrangQuanTri>
  );
}
