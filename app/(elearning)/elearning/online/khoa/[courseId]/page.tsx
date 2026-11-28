import Link from "next/link";
import { notFound } from "next/navigation";
import { Rocket } from "lucide-react";
import { EmptyState } from "@/components/admin/ui/states";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { QuayLai, Khoi, TrangQuanTri } from "../../../_components/ui/trang";
import { TabNav, type TabKhaiBao } from "../../../_components/ui/tab-nav";
import { TrangThaiBadge } from "../../../_components/ui/trang-thai-badge";
import { TienDo } from "../../../_components/ui/tien-do";
import { NUT_CHINH, NUT_PHU, O_CHON_GOC, O_NHAP_GOC, NHAN_O } from "../../../_components/ui/dieu-khien";
import { can } from "@/lib/auth/can";
import { tabDangMo } from "@/lib/elearning/tab-url";
import { docBaoCaoCuaKhoa, docCaiDatBan, docCauHoiKhoa, docCay, docChiTietKhoa, docChungNhanKhoa, docDanhMuc, docMauChungNhanKhoa, docDeThiKhoa, docHangChoCham, docHocVienKhoa, docKhoaDeChon, docLichSuBan, docNoiDungPublicCuaKhoa } from "@/lib/elearning-online/doc";
import { NHAN_BAN, NHAN_CHINH_SACH, NHAN_LOAI_BAI, NHAN_QUYEN, dinhDangNgay, dinhDangTien, nhanConLai, nhanThoiHan, urlQuanTri } from "@/lib/elearning-online/hien-thi";
import { vaoTrangOnline } from "../../_lib/vao";
import { FormKhoa } from "../../_components/form-khoa";
import { BanSoanNoiDung } from "../../_components/ban-soan-noi-dung";
import { CaiDatHocTapForm } from "../../_components/cai-dat-hoc-tap-form";
import { DoiTrangThaiBan } from "../../_components/doi-trang-thai-ban";
import { TienQuyetForm } from "../../_components/tien-quyet-form";
import { CapQuyenMienPhi, HanhDongHocVien } from "../../_components/hanh-dong-hoc-vien";
import { KiemTraThi } from "../../_components/kiem-tra-thi";
import { ChungNhanKhoa, HangChoCham } from "../../_components/cham-bai-va-chung-nhan";
import { ChungNhanKhoaThe } from "../../_components/chung-nhan-khoa-the";
import { MauChungNhanKhoa } from "../../_components/mau-chung-nhan-khoa";

/**
 * QoKhoaTT — CHI TIẾT MỘT KHOÁ ONLINE (tab: Tổng quan · Chương & bài · Quản lý học viên · Giá & khuyến mãi · Cài đặt học tập · Phiên bản và lịch sử).
 * Quản lý học viên nằm TRONG khoá (không có màn "người mua" toàn cục). Mỗi tab tự hỏi quyền riêng; ẩn nút chỉ là tiện — Server Action mới là cổng.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Chi tiết khoá online | Sata Robo", robots: { index: false, follow: false } };

type SP = Record<string, string | string[] | undefined>;
const mot = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const MA_TAB = ["tong-quan", "noi-dung-public", "chuong-bai", "kiem-tra", "cham-bai", "hoc-vien", "chung-nhan", "bao-cao", "gia", "cai-dat", "phien-ban"] as const;
/** Tab của người CHỈ-ĐỌC (QoMkt): chỉ phần công khai + giá + báo cáo tổng hợp. Không chương/bài trả phí, không đề, không học viên, không cài đặt, không lịch sử bản. */
const TAB_CHI_DOC: readonly string[] = ["tong-quan", "noi-dung-public", "gia", "bao-cao"];

export default async function Page({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams: Promise<SP> }) {
  const v = await vaoTrangOnline("onl:course:view", "Khoá online");
  if ("chan" in v) return v.chan;
  const { courseId } = await params;
  const sp = await searchParams;
  const khoa = await docChiTietKhoa(courseId);
  if (!khoa) notFound();

  const quanLy = can(v.actor, "onl:course:manage");
  const phatHanh = can(v.actor, "onl:course:release");
  const xemHocVien = can(v.actor, "onl:student:view");
  // Ngân hàng câu hỏi chứa ĐÁP ÁN ⇒ chỉ người soạn đề; hàng chờ chấm ⇒ người chấm; chứng nhận ⇒ người cấp hoặc xem học viên.
  const soanDe = can(v.actor, "onl:assessment:manage");
  const chamBai = can(v.actor, "onl:assessment:grade");
  const capCN = can(v.actor, "onl:certificate:issue");
  const xemCN = capCN || xemHocVien;
  const xemBaoCao = can(v.actor, "onl:report:view");
  // QoMkt: người chỉ có xem khoá/báo cáo (không soạn, không chấm, không học viên, không chứng nhận, không phát hành) ⇒ chế độ CHỈ-ĐỌC. Suy từ QUYỀN, không từ tên vai.
  const chiDoc = !quanLy && !phatHanh && !soanDe && !chamBai && !xemHocVien && !capCN;
  const xemDiem = soanDe || chamBai;
  const banChay = khoa.versions.find((x) => x.status === "PUBLISHED") ?? null;
  const banNhap = khoa.versions.find((x) => x.status === "DRAFT") ?? null;
  const ban = NHAN_BAN[khoa.saleStatus] ?? { nhan: khoa.saleStatus, sac: "muted" as const };

  const tabHienCo = MA_TAB.filter((t) => (chiDoc ? TAB_CHI_DOC.includes(t as string) : t !== "noi-dung-public") && (t !== "hoc-vien" || xemHocVien) && (t !== "kiem-tra" || soanDe) && (t !== "cham-bai" || chamBai) && (t !== "chung-nhan" || xemCN) && (t !== "bao-cao" || xemBaoCao));
  // QoHocVienTT (trạng thái không quyền): gõ thẳng tab bị ẩn thì NÓI RÕ là không có quyền, không lặng lẽ rơi về Tổng quan.
  const tabXin = mot(sp.tab);
  const biChan = !!tabXin && (MA_TAB as readonly string[]).includes(tabXin) && !(tabHienCo as readonly string[]).includes(tabXin);
  const tab = tabDangMo(sp, tabHienCo, "tong-quan");
  const dsTab: TabKhaiBao[] = chiDoc
    ? [
        { id: "tong-quan", nhan: "Tổng quan" },
        { id: "noi-dung-public", nhan: "Nội dung public" },
        { id: "gia", nhan: "Giá & khuyến mãi" },
        ...(xemBaoCao ? [{ id: "bao-cao", nhan: "Báo cáo" }] : []),
      ]
    : [
    { id: "tong-quan", nhan: "Tổng quan" },
    { id: "chuong-bai", nhan: "Chương & bài" },
    ...(soanDe ? [{ id: "kiem-tra", nhan: "Kiểm tra & thi" }] : []),
    ...(chamBai ? [{ id: "cham-bai", nhan: "Chấm bài" }] : []),
    ...(xemHocVien ? [{ id: "hoc-vien", nhan: "Quản lý học viên" }] : []),
    ...(xemCN ? [{ id: "chung-nhan", nhan: "Chứng nhận" }] : []),
    ...(xemBaoCao ? [{ id: "bao-cao", nhan: "Báo cáo" }] : []),
    { id: "gia", nhan: "Giá & khuyến mãi" },
    { id: "cai-dat", nhan: "Cài đặt học tập" },
    { id: "phien-ban", nhan: "Phiên bản và lịch sử" },
  ];
  const duongDan = `/elearning/online/khoa/${courseId}`;

  return (
    <TrangQuanTri rong="rong">
      <QuayLai href="/elearning/online">Khoá online</QuayLai>
      <PageHeader
        title={khoa.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">{khoa.code}</span>
            <TrangThaiBadge sac={ban.sac}>{ban.nhan}</TrangThaiBadge>
            {banChay ? <TrangThaiBadge sac="info">Bản {banChay.number} đang chạy</TrangThaiBadge> : <TrangThaiBadge sac="muted">Chưa phát hành</TrangThaiBadge>}
            <span>{nhanThoiHan(khoa.validityMonths)} · {dinhDangTien(khoa.salePrice)}</span>
            {chiDoc ? <TrangThaiBadge sac="info">Chỉ đọc</TrangThaiBadge> : null}
            {chiDoc ? <span className="text-muted-foreground">Không sửa, không xem điểm, không cấp quyền</span> : null}
          </span>
        }
        actions={
          phatHanh && banNhap ? (
            <Link href={`${duongDan}/phat-hanh`} className={NUT_CHINH}>
              <Rocket className="h-4 w-4" aria-hidden />
              Phát hành bản mới
            </Link>
          ) : null
        }
      />
      <TabNav duongDan={duongDan} tab={dsTab} dangMo={tab} nhanDanhSach="Các phần của khoá" />

      {biChan ? (
        <div role="alert" className="mt-6 rounded-xl border border-border bg-card p-8 text-center">
          <h2 className="text-base font-semibold">Bạn không có quyền xem phần này</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Danh sách học viên, điểm và quyền học chỉ dành cho Đào tạo và Quản trị.</p>
          <div className="mt-4 flex justify-center"><Link href={duongDan} className={NUT_PHU}>Về tổng quan</Link></div>
        </div>
      ) : null}
      {!biChan && tab === "tong-quan" ? <TabTongQuan khoa={khoa} quanLy={quanLy} /> : null}
      {!biChan && tab === "noi-dung-public" && chiDoc ? <TabNoiDungPublic courseId={courseId} /> : null}
      {!biChan && tab === "chuong-bai" ? <TabChuongBai courseId={courseId} banChayId={banChay?.id ?? null} banNhapId={banNhap?.id ?? null} soBanChay={banChay?.number ?? 0} duocSua={quanLy} coDe={soanDe} /> : null}
      {!biChan && tab === "kiem-tra" && soanDe ? <TabKiemTra courseId={courseId} /> : null}
      {!biChan && tab === "cham-bai" && chamBai ? <TabChamBai courseId={courseId} /> : null}
      {!biChan && tab === "bao-cao" && xemBaoCao ? <TabBaoCao courseId={courseId} xemDiem={xemDiem} /> : null}
      {!biChan && tab === "chung-nhan" && xemCN ? <TabChungNhan courseId={courseId} duocCap={capCN} duocSuaMau={quanLy} sp={sp} /> : null}
      {!biChan && tab === "hoc-vien" && xemHocVien ? (
        <TabHocVien courseId={courseId} tenKhoa={khoa.name} thangHan={khoa.validityMonths} sp={sp} tronDoi={khoa.validityMonths === null} choPhepGiaHan={khoa.renewalEnabled} xemPii={can(v.actor, "onl:student:pii")} duocCap={can(v.actor, "onl:student:grant")} duocThuHoi={can(v.actor, "onl:student:revoke")} duocCapChungNhan={capCN} />
      ) : null}
      {!biChan && tab === "gia" ? <TabGia khoa={khoa} quanLy={quanLy} /> : null}
      {!biChan && tab === "cai-dat" ? <TabCaiDat banNhapId={banNhap?.id ?? null} banChayId={banChay?.id ?? null} duocSua={quanLy} tenKhoa={khoa.name} /> : null}
      {!biChan && tab === "phien-ban" ? <TabPhienBan courseId={courseId} /> : null}
    </TrangQuanTri>
  );
}

type KhoaCT = NonNullable<Awaited<ReturnType<typeof docChiTietKhoa>>>;

const khoaSua = (khoa: KhoaCT) => ({
  id: khoa.id, code: khoa.code, slug: khoa.slug, name: khoa.name, shortDescription: khoa.shortDescription, fullDescription: khoa.fullDescription, categoryId: khoa.categoryId,
  level: khoa.level, gradeFrom: khoa.gradeFrom, gradeTo: khoa.gradeTo, listPrice: khoa.listPrice, salePrice: khoa.salePrice, validityMonths: khoa.validityMonths,
  renewalEnabled: khoa.renewalEnabled, renewalPrice: khoa.renewalPrice, seoTitle: khoa.seoTitle, seoDescription: khoa.seoDescription,
});

async function TabTongQuan({ khoa, quanLy }: { khoa: KhoaCT; quanLy: boolean }) {
  const [khoaKhac, dm] = quanLy ? await Promise.all([docKhoaDeChon(khoa.id), docDanhMuc()]) : [[], []];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-6">
      <Khoi tieuDe="Giới thiệu">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Dong t="Danh mục" v={khoa.category?.name ?? "Chưa phân loại"} />
          <Dong t="Lớp" v={khoa.gradeFrom ? `${khoa.gradeFrom}${khoa.gradeTo ? `–${khoa.gradeTo}` : ""}` : "—"} />
          <Dong t="Đường dẫn công khai" v={`/${khoa.slug}`} />
          <Dong t="Khoá tiên quyết" v={khoa.prerequisite ? `${khoa.prerequisite.name} (${khoa.prerequisiteMode === "REQUIRED" ? "bắt buộc" : "khuyến nghị"})` : "Không"} />
        </dl>
        <p className="mt-4 whitespace-pre-line text-sm text-[color:var(--el-text2)]">{khoa.shortDescription ?? "Chưa có mô tả ngắn."}</p>
      </Khoi>
      {quanLy ? (
        <Khoi tieuDe="Sửa thông tin khoá">
          <FormKhoa cheDo="sua" phan="thong-tin" danhMuc={dm.map((d) => ({ id: d.id, name: d.name, parentId: d.parentId }))} khoa={khoaSua(khoa)} />
        </Khoi>
      ) : null}
      </div>
      <div className="flex flex-col gap-6">
        <Khoi tieuDe="Bán hàng">
          <DoiTrangThaiBan courseId={khoa.id} hienTai={khoa.saleStatus} moBanLuc={khoa.saleOpensAt ? khoa.saleOpensAt.toISOString() : null} daPhatHanh={!!khoa.publishedVersionId} duocSua={quanLy} />
          {!quanLy ? <p className="text-sm text-muted-foreground">Bạn chỉ có quyền xem khoá này.</p> : null}
        </Khoi>
        {quanLy ? (
          <Khoi tieuDe="Điều kiện tham gia">
            <TienQuyetForm courseId={khoa.id} mode={khoa.prerequisiteMode} khoaTienQuyetId={khoa.prerequisiteCourseId} khoaKhac={khoaKhac} />
          </Khoi>
        ) : null}
      </div>
    </div>
  );
}

const Dong = ({ t, v }: { t: string; v: string }) => (
  <div>
    <dt className="text-xs text-muted-foreground">{t}</dt>
    <dd className="font-medium">{v}</dd>
  </div>
);

async function TabChuongBai({ courseId, banChayId, banNhapId, soBanChay, duocSua, coDe }: { courseId: string; banChayId: string | null; banNhapId: string | null; soBanChay: number; duocSua: boolean; coDe: boolean }) {
  const id = banNhapId ?? banChayId;
  if (!id) return <EmptyState title="Khoá chưa có phiên bản nào" />;
  const [cay, de] = await Promise.all([docCay(id), coDe ? docDeThiKhoa(courseId) : Promise.resolve([])]);
  if (!cay) return <EmptyState title="Không đọc được phiên bản" />;
  return (
    <Khoi sat tieuDe="Chương & bài">
      <BanSoanNoiDung
        courseId={courseId}
        versionId={cay.id}
        soBan={cay.number}
        trangThaiBan={cay.status}
        soBanChay={soBanChay > 0 ? soBanChay : null}
        chuong={cay.chapters.map((c) => ({ id: c.id, stableId: c.stableId, title: c.title, hidden: c.hidden, lessons: c.lessons.map((b) => ({ ...b, contentJson: b.contentJson })) }))}
        duocSua={duocSua}
        canMoNhap={!banNhapId && !!banChayId && soBanChay > 0}
        deThi={de.map((d) => ({ id: d.id, title: d.title, kind: d.kind, status: d.status }))}
      />
    </Khoi>
  );
}

async function TabHocVien({ courseId, tenKhoa, thangHan, sp, tronDoi, choPhepGiaHan, xemPii, duocCap, duocThuHoi, duocCapChungNhan }: { courseId: string; tenKhoa: string; thangHan: number | null; sp: SP; tronDoi: boolean; choPhepGiaHan: boolean; xemPii: boolean; duocCap: boolean; duocThuHoi: boolean; duocCapChungNhan: boolean }) {
  const q = mot(sp.q);
  const tt = mot(sp.tt) as "CON_HAN" | "SAP_HET_HAN" | "HET_HAN" | "THU_HOI" | "";
  const nguon = mot(sp.nguon) as "PURCHASE" | "FREE_GRANT" | "";
  const sapXep = mot(sp.sx) === "ten" ? ("TEN_PHU_HUYNH" as const) : ("VAO_MOI_NHAT" as const);
  const trang = Math.max(1, Number(mot(sp.trang)) || 1);
  const now = new Date();
  const kq = await docHocVienKhoa({ courseId, q: q || undefined, trangThai: tt || undefined, nguon: nguon || undefined, sapXep, trang, coTrang: 10 }, { now, xemPii });
  const tongTrang = Math.max(1, Math.ceil(kq.tongNhom / 10));
  const href = (t: number) => {
    const p = new URLSearchParams({ tab: "hoc-vien" });
    if (q) p.set("q", q);
    if (tt) p.set("tt", tt);
    if (nguon) p.set("nguon", nguon);
    if (sapXep === "TEN_PHU_HUYNH") p.set("sx", "ten");
    if (t > 1) p.set("trang", String(t));
    return `/elearning/online/khoa/${courseId}?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-[color:var(--el-text2)]">
        Con nằm dưới phụ huynh. Phụ huynh có con vào khoá gần nhất đứng đầu; trong nhóm, con vào mới nhất lên trên. “Vào khoá” tính từ lần cấp hoặc mở lại gần nhất. Quyền đã thu hồi chỉ hiện khi lọc “Đã thu hồi”.
      </p>
      {duocCap ? (
        <div>
          <CapQuyenMienPhi courseId={courseId} khoaTronDoi={tronDoi} />
        </div>
      ) : null}
      <form method="get" role="search" aria-label="Lọc học viên trong khoá" className="grid gap-3 sm:grid-cols-[1fr_180px_180px_220px_auto] sm:items-end">
        <input type="hidden" name="tab" value="hoc-vien" />
        <div>
          <label className={NHAN_O} htmlFor="hv-q">Tìm</label>
          <input id="hv-q" name="q" defaultValue={q} placeholder="Tên phụ huynh, học viên hoặc số điện thoại" className={`${O_NHAP_GOC} w-full`} />
        </div>
        <div>
          <label className={NHAN_O} htmlFor="hv-nguon">Nguồn</label>
          <select id="hv-nguon" name="nguon" defaultValue={nguon} className={`${O_CHON_GOC} w-full`}>
            <option value="">Mọi nguồn</option>
            <option value="PURCHASE">Mua khoá</option>
            <option value="FREE_GRANT">Cấp miễn phí</option>
          </select>
        </div>
        <div>
          <label className={NHAN_O} htmlFor="hv-tt">Trạng thái</label>
          <select id="hv-tt" name="tt" defaultValue={tt} className={`${O_CHON_GOC} w-full`}>
            <option value="">Mọi trạng thái</option>
            <option value="CON_HAN">Còn hạn</option>
            <option value="SAP_HET_HAN">Sắp hết hạn</option>
            <option value="HET_HAN">Hết hạn</option>
            <option value="THU_HOI">Đã thu hồi</option>
          </select>
        </div>
        <div>
          <label className={NHAN_O} htmlFor="hv-sx">Sắp xếp</label>
          <select id="hv-sx" name="sx" defaultValue={sapXep === "TEN_PHU_HUYNH" ? "ten" : "moi"} className={`${O_CHON_GOC} w-full`}>
            <option value="moi">Con vào khoá mới nhất</option>
            <option value="ten">Tên phụ huynh A–Z</option>
          </select>
        </div>
        <button type="submit" className={NUT_PHU}>Lọc</button>
      </form>

      <Khoi sat>
        {kq.nhom.length === 0 ? (
          <EmptyState title={q || tt || nguon ? "Chưa có học viên nào khớp" : "Khoá chưa có học viên"} description={q || tt || nguon ? "Thử bỏ bớt bộ lọc." : "Học viên xuất hiện khi phụ huynh mua khoá hoặc quản trị cấp quyền miễn phí."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">Học viên trong khoá, nhóm theo phụ huynh</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Phụ huynh</th>
                  <th scope="col" className="px-2 py-3 font-medium">Học viên</th>
                  <th scope="col" className="px-2 py-3 font-medium">Nguồn</th>
                  <th scope="col" className="px-2 py-3 font-medium">Hạn</th>
                  <th scope="col" className="px-2 py-3 font-medium">Trạng thái</th>
                  <th scope="col" className="px-2 py-3 font-medium">Tiến độ</th>
                  <th scope="col" className="px-2 py-3"><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              {kq.nhom.map((g) => (
                <tbody key={g.khoaNhom} className="border-b border-border last:border-0">
                  {g.hocVien.map((h, i) => {
                    const t = NHAN_QUYEN[h.trangThai];
                    return (
                      <tr key={h.entitlementId} className="align-top">
                        {i === 0 ? (
                          <th scope="rowgroup" rowSpan={g.hocVien.length} className="w-[210px] border-r border-border bg-muted/30 px-4 py-3 text-left font-normal">
                            {g.leadId ? (
                              <a href={urlQuanTri(`/leads/${g.leadId}`)} target="_blank" rel="noreferrer" className="font-medium text-primary-ink underline underline-offset-[3px]">{g.tenPhuHuynh ?? "Phụ huynh"}</a>
                            ) : (
                              <span className="font-medium">{g.tenPhuHuynh ?? "Chưa có thông tin phụ huynh"}</span>
                            )}
                            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{g.sdt ?? g.sdtChe ?? ""}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{g.hocVien.length} con trong khoá</p>
                          </th>
                        ) : null}
                        <td className="px-2 py-3">
                          <a href={urlQuanTri(`/students/${h.studentId}`)} target="_blank" rel="noreferrer" className="font-medium text-primary-ink underline underline-offset-[3px]">{h.tenHocVien}</a>
                          <p className="font-mono text-xs text-muted-foreground">{h.maHocVien ?? "Chưa có mã"}</p>
                        </td>
                        <td className="px-2 py-3">{h.nguonNhan}</td>
                        <td className="px-2 py-3">
                          <span className="font-medium">{h.hetHan ? dinhDangNgay(h.hetHan) : "Trọn đời"}</span>
                          <p className="text-xs text-muted-foreground">vào {dinhDangNgay(h.vaoLuc)}</p>
                        </td>
                        <td className="px-2 py-3">
                          <TrangThaiBadge sac={t.sac}>{t.nhan}</TrangThaiBadge>
                          <p className="mt-1 text-xs text-muted-foreground">{nhanConLai(h.trangThai, h.hetHan, now)}</p>
                        </td>
                        <td className="min-w-[140px] px-2 py-3">
                          {h.phanTram === null ? (
                            <span className="text-xs text-muted-foreground">Chưa phát hành</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <TienDo phanTram={h.phanTram} nhan={h.tenHocVien} className="w-20" />
                              <span className="text-xs tabular-nums">{h.daXong}/{h.tong}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-3 text-right">
                          <HanhDongHocVien
                            courseId={courseId}
                            studentId={h.studentId}
                            tenHocVien={h.tenHocVien}
                            trangThai={h.trangThai}
                            duocGiaHan={duocCap}
                            duocThuHoi={duocThuHoi}
                            duocCapChungNhan={duocCapChungNhan}
                            duocXemLichSu
                            khoaChoGiaHan={choPhepGiaHan}
                            tenKhoa={tenKhoa}
                            nguonNhan={h.nguonNhan}
                            hetHan={h.hetHan ? h.hetHan.toISOString() : null}
                            anchorDay={h.anchorDay}
                            thangHan={thangHan}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Khoi>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{kq.nhom.length} phụ huynh trên trang · tổng {kq.tongHocVien} học viên, {kq.tongNhom} phụ huynh</span>
        <nav aria-label="Phân trang" className="flex gap-2">
          {trang > 1 ? <Link className={NUT_PHU} href={href(trang - 1)}>Trước</Link> : null}
          <span className="self-center">{Math.min(trang, tongTrang)} / {tongTrang}</span>
          {trang < tongTrang ? <Link className={NUT_PHU} href={href(trang + 1)}>Sau</Link> : null}
        </nav>
      </div>
    </div>
  );
}

async function TabGia({ khoa, quanLy }: { khoa: KhoaCT; quanLy: boolean }) {
  if (!quanLy) {
    return (
      <Khoi tieuDe="Giá và thời hạn">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <Dong t="Giá niêm yết" v={dinhDangTien(khoa.listPrice)} />
          <Dong t="Giá bán" v={dinhDangTien(khoa.salePrice)} />
          <Dong t="Thời hạn" v={nhanThoiHan(khoa.validityMonths)} />
        </dl>
      </Khoi>
    );
  }
  const dm = await docDanhMuc();
  return (
    <div className="flex flex-col gap-6">
      <Khoi tieuDe="Giá và thời hạn">
        <FormKhoa
          cheDo="sua"
          phan="gia"
          danhMuc={dm.map((d) => ({ id: d.id, name: d.name, parentId: d.parentId }))}
          khoa={khoaSua(khoa)}
        />
      </Khoi>
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Khuyến mãi theo mã/chương trình do bộ phận bán hàng quản lý ở mô-đun khuyến mãi chung; đơn hàng chụp giá của khoá tại thời điểm mua.</p>
    </div>
  );
}

/** QoMkt — Nội dung public: mô tả + bài HỌC THỬ. Chưa có site công khai nên KHÔNG vẽ nút "Chép đường dẫn public"/"Chép link giới thiệu" (lời hứa suông); ảnh đại diện chưa có kho ảnh. */
async function TabNoiDungPublic({ courseId }: { courseId: string }) {
  const nd = await docNoiDungPublicCuaKhoa(courseId);
  if (!nd) return <EmptyState title="Không có nội dung" />;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Khoi tieuDe="Nội dung public">
        <p className="whitespace-pre-line text-sm">{nd.shortDescription ?? "Chưa có mô tả ngắn."}</p>
        <h3 className="mt-4 text-sm font-semibold">Bài xem miễn phí</h3>
        {!nd.daPhatHanh ? <p className="mt-1 text-sm text-muted-foreground">Khoá chưa phát hành — chưa có bài học thử công khai.</p> : nd.hocThu.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Khoá không có bài học thử.</p> : (
          <ul className="mt-1 list-disc pl-5 text-sm">{nd.hocThu.map((b) => <li key={b.stableId}>{b.title}</li>)}</ul>
        )}
      </Khoi>
      <Khoi tieuDe="Giới thiệu đầy đủ">
        <p className="whitespace-pre-line text-sm text-[color:var(--el-text2)]">{nd.fullDescription ?? "Chưa có giới thiệu đầy đủ."}</p>
      </Khoi>
      <p className="rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">Đường dẫn công khai: <span className="font-mono">/{nd.slug}</span> · chưa có site công khai để mở; ảnh đại diện chưa có kho ảnh.</p>
    </div>
  );
}

async function TabCaiDat({ banNhapId, banChayId, duocSua, tenKhoa }: { banNhapId: string | null; banChayId: string | null; duocSua: boolean; tenKhoa: string }) {
  const id = banNhapId ?? banChayId;
  if (!id) return <EmptyState title="Khoá chưa có phiên bản nào" />;
  const cd = await docCaiDatBan(id);
  if (!cd) return <EmptyState title="Cài đặt của phiên bản này không hợp lệ" description="Bản này sẽ đóng truy cập cho tới khi cài đặt được lưu lại đúng." />;
  return (
    <div className="flex flex-col gap-6">
      <Khoi sat tieuDe="Cài đặt học tập">
        <CaiDatHocTapForm versionId={id} caiDat={cd} duocSua={duocSua && !!banNhapId} />
      </Khoi>
      <ChungNhanKhoaThe tenKhoa={tenKhoa} />
    </div>
  );
}

async function TabPhienBan({ courseId }: { courseId: string }) {
  const ds = await docLichSuBan(courseId);
  const TT: Record<string, { nhan: string; sac: "success" | "warning" | "muted" }> = { PUBLISHED: { nhan: "Đang chạy", sac: "success" }, DRAFT: { nhan: "Nháp", sac: "warning" }, SUPERSEDED: { nhan: "Đã thay thế", sac: "muted" } };
  return (
    <Khoi sat tieuDe="Phiên bản và lịch sử">
      <ol className="divide-y divide-border">
        {ds.map((b) => {
          const t = TT[b.status]!;
          const tt = b.impactJson as { soHocVien?: number; soBiAnhHuong?: number; soPhaiHocLai?: number } | null;
          const cs = b.progressPolicy ? NHAN_CHINH_SACH[b.progressPolicy]?.nhan : null;
          return (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="w-16 font-semibold">Bản {b.number}</span>
              <TrangThaiBadge sac={t.sac}>{t.nhan}</TrangThaiBadge>
              <span className="text-muted-foreground">{b.publishedAt ? `phát hành ${dinhDangNgay(b.publishedAt)}` : `tạo ${dinhDangNgay(b.createdAt)}`}</span>
              {cs ? <span>· Chính sách: {cs}</span> : null}
              {tt ? <span className="text-muted-foreground">· {tt.soHocVien ?? 0} học viên, {tt.soPhaiHocLai ?? 0} phải học lại</span> : null}
            </li>
          );
        })}
      </ol>
    </Khoi>
  );
}

async function TabKiemTra({ courseId }: { courseId: string }) {
  const [cau, de] = await Promise.all([docCauHoiKhoa(courseId), docDeThiKhoa(courseId)]);
  return (
    <KiemTraThi
      courseId={courseId}
      duocSua
      cauHoi={cau.map((c) => ({ id: c.id, type: c.type, stem: c.stem, points: c.points, status: c.status }))}
      deThi={de.map((d) => ({ id: d.id, kind: d.kind as "QUIZ" | "ASSIGNMENT" | "FINAL_EXAM", title: d.title, passPercent: d.passPercent, timeLimitMin: d.timeLimitMin, maxAttempts: d.maxAttempts, shuffle: d.shuffle, status: d.status, soCau: d._count.questions, soLuot: d._count.attempts, cauIds: d.questions.map((q) => q.questionId) }))}
    />
  );
}

async function TabChamBai({ courseId }: { courseId: string }) {
  const hang = await docHangChoCham(courseId);
  return (
    <Khoi sat tieuDe="Bài tự luận chờ chấm">
      <HangChoCham luot={hang.map((h) => ({ id: h.id, soLuot: h.number, nopLuc: h.submittedAt ? h.submittedAt.toISOString() : null, tenHocVien: h.student.name, tenDe: h.assessment.title }))} />
    </Khoi>
  );
}

async function TabChungNhan({ courseId, duocCap, duocSuaMau, sp }: { courseId: string; duocCap: boolean; duocSuaMau: boolean; sp: SP }) {
  const [r, mau] = await Promise.all([docChungNhanKhoa(courseId, Math.max(1, Number(mot(sp.trang)) || 1)), docMauChungNhanKhoa(courseId)]);
  return (
    <>
    {duocSuaMau || mau.length > 0 ? (
      <Khoi sat tieuDe="Phôi chứng nhận">
        <MauChungNhanKhoa courseId={courseId} duocSua={duocSuaMau} mau={mau.map((m) => ({ id: m.id, version: m.version, status: m.status, widthPx: m.widthPx, heightPx: m.heightPx, fieldsJson: m.fieldsJson, soChungNhan: m._count.certificates, createdAt: m.createdAt.toISOString(), approvedAt: m.approvedAt?.toISOString() ?? null }))} />
      </Khoi>
    ) : null}
    <Khoi sat tieuDe="Chứng nhận hoàn thành khoá">
      <ChungNhanKhoa
        courseId={courseId}
        tong={r.tong}
        duocCap={duocCap}
        dong={r.dong.map((c) => ({ id: c.id, code: c.code, status: c.status, studentId: c.studentId, studentName: c.studentName, versionNumber: c.versionNumber, finalScore: c.finalScore, issuedAt: c.issuedAt.toISOString(), issuedByUserId: c.issuedByUserId, revokedReason: c.revokedReason }))}
      />
    </Khoi>
    </>
  );
}

async function TabBaoCao({ courseId, xemDiem }: { courseId: string; xemDiem: boolean }) {
  const r = await docBaoCaoCuaKhoa(courseId);
  if (!r) return <EmptyState title="Không có số liệu" />;
  const the = (nhan: string, giaTri: string | number, ghiChu?: string) => (
    <div key={nhan} className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{nhan}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{giaTri}</p>
      {ghiChu ? <p className="mt-1 text-xs text-muted-foreground">{ghiChu}</p> : null}
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-[color:var(--el-text2)]">Báo cáo tổng hợp — không có tên học viên, số điện thoại hay doanh thu. Số liệu đếm QUYỀN HỌC; tiền thuộc bộ phận bán hàng.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {the("Tổng quyền học", r.tongQuyen)}
        {the("Đang hiệu lực", r.theoTrangThai.CON_HAN + r.theoTrangThai.SAP_HET_HAN, `${r.theoTrangThai.SAP_HET_HAN} sắp hết hạn`)}
        {the("Hết hạn", r.theoTrangThai.HET_HAN)}
        {the("Đã thu hồi", r.theoTrangThai.THU_HOI)}
        {the("Đã hoàn thành khoá", r.daHoanThanh, "trên quyền đang hiệu lực")}
        {the("Tiến độ trung bình", r.tienDoTrungBinh === null ? "—" : `${r.tienDoTrungBinh}%`)}
        {the("Chứng nhận hiệu lực", r.chungNhan.hieuLuc, `${r.chungNhan.daThuHoi} đã thu hồi`)}
        {the("Nguồn", `${r.theoNguon.muaKhoa} mua · ${r.theoNguon.capMienPhi} cấp`)}
      </div>
      <Khoi tieuDe="Quyền học mới theo tháng">
        {r.quyenMoiTheoThang.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có quyền nào.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {r.quyenMoiTheoThang.map((m) => <li key={m.thang} className="flex justify-between"><span>{m.thang}</span><span className="tabular-nums">{m.so}</span></li>)}
          </ul>
        )}
      </Khoi>
      {xemDiem ? (
      <Khoi sat tieuDe="Đề kiểm tra và thi">
        {r.deThi.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">Chưa có lượt làm bài nào được chấm.</p> : (
          <table className="w-full text-sm">
            <caption className="sr-only">Kết quả theo đề</caption>
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th scope="col" className="px-4 py-2 font-medium">Đề</th><th scope="col" className="px-2 py-2 text-right font-medium">Lượt</th><th scope="col" className="px-2 py-2 text-right font-medium">Tỉ lệ đạt</th><th scope="col" className="px-4 py-2 text-right font-medium">Điểm TB</th></tr></thead>
            <tbody>
              {r.deThi.map((d) => (
                <tr key={d.tieuDe} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">{d.tieuDe} <span className="text-xs text-muted-foreground">({NHAN_LOAI_BAI[d.loai] ?? d.loai})</span></td>
                  <td className="px-2 py-2 text-right tabular-nums">{d.soLuot}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{d.tiLeDat === null ? "—" : `${d.tiLeDat}%`}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.diemTrungBinh === null ? "—" : `${d.diemTrungBinh}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Khoi>
      ) : (
        <p className="rounded-xl bg-muted px-4 py-3 text-sm text-[color:var(--el-text2)]">Điểm theo đề chỉ dành cho người soạn đề và người chấm — phần này được ẩn với tài khoản chỉ đọc.</p>
      )}
    </div>
  );
}
