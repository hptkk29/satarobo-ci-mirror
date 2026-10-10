// app/(admin)/admin/nguon-hoa-hong/ky/page.tsx — tab KỲ (PR9, 06 §5.4): màn chủ của kế toán — Tính · rà soát · KHOÁ · xuất bảng chi · đánh dấu đã chi.
//
// Mở ra ở KỲ ĐANG CHỌN (tháng × cơ sở) với "Việc còn dang dở": hàng chờ CHẶN khoá + đầu vào trôi, theo đúng định nghĩa của cổng server (`ky-service`, 04 §12.1).
// Cờ `hoaHong.engineBat` TẮT ⇒ 404 (`vaoTab`). Quyền vào trang: `PAGE_GATES["/nguon-hoa-hong/ky"]` (xem hoặc quản lý kỳ); quyền THAO TÁC là `commission_periods:manage`
// — ĐÚNG key mà Server Action kiểm (luật 12): người chỉ xem thấy số và lý do, không thấy nút.
//
// ⚠️ Cách ly cơ sở: kỳ, số, hàng chờ đi qua `scopedDb(actor)` (lib/hoa-hong/ky-doc). Chip cơ sở dựng từ TẦM NHÌN scope của model CommissionPeriod, không từ `can(action, {centerId})`
// (key seed GLOBAL nên `can()` đúng với mọi cơ sở — ca `[NHH-FE-09]`).
// ⚠️ Mọi con số, mọi nút đều đọc ra từ MỘT nguồn: số từ `tongHopTheoKy`, nút từ `hanhDongCuaKy` (gọi chính `kiemChuyenTrangThaiKy`), pill tab từ `docSoHangChoTheoTab` (luật 12b).
import Link from "next/link";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";

import { checkPermission } from "@/lib/auth/check-permission";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { ScopeBar } from "@/components/admin/nguon-hoa-hong/scope-bar";
import { TrangThaiKyPill } from "@/components/admin/nguon-hoa-hong/trang-thai-ky-pill";
import { EmptyState } from "@/components/admin/ui/states";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ngayDMYTuMoc, ngayGioVN } from "@/lib/hoa-hong/dinh-dang";
import { laXuatLuongBat } from "@/lib/hoa-hong/feature";
import { congThang, TRANG_THAI_KY } from "@/lib/hoa-hong/ky-hoa-hong";
import { docDanhSachKy, docKyCutover, docManHinhKy } from "@/lib/hoa-hong/ky-doc";
import {
  cauChanKhoa,
  docThangTuUrl,
  gomChan,
  hanhDongCuaKy,
  kyTrongPhamViTinh,
  nhanThangKy,
  thangKeTiep,
  thangMacDinhCuaMan,
  thangTruoc,
  thangVN,
  type MucChan,
} from "@/lib/hoa-hong/ky-man-hinh";
import { loaiChungCuaCacMa, MA_DOI_DUOC_SANG_KY_SAU, type LoaiHangChoSo } from "@/lib/hoa-hong/hang-cho-so-nhom";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { TAB_HREF } from "@/lib/nguon-hoa-hong/tab";
import { docTrang, hrefVoi, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { getSetting } from "@/lib/settings/service";

import { vaoTab } from "../_lib/vao-tab";
import { BangKy } from "./_components/bang-ky";
import { ChonThang } from "./_components/chon-thang";
import { DaiSo } from "./_components/dai-so";
import { HanhDongKy, type DuLieuHanhDong } from "./_components/hanh-dong-ky";
import { ViecDangDo } from "./_components/viec-dang-do";

export const metadata = { title: "Kỳ | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/nguon-hoa-hong/ky";

type Sp = { coSo?: string | string[]; thang?: string | string[]; trangthai?: string | string[]; trang?: string | string[] };

const NHAN_LO = { PAYROLL: "Bảng lương (nội bộ)", EXTERNAL_SETTLEMENT: "Quyết toán người ngoài" } as const;

function DaiInfo({ children }: { children: React.ReactNode }) {
  return (
    <div role="note" className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-state-info-soft px-3 py-2.5 text-sm text-state-info-ink">
      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export default async function KyPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("ky");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/ky"])) {
    return <ThieuQuyen tab="ky" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;
  const now = new Date();

  const [kyCutover, soHangCho, tran, xuatLuongBat, coTheMoSoCu] = await Promise.all([
    docKyCutover(),
    docSoHangChoTheoTab(actor, scope),
    // Trần ĐỌC TỪ SETTING — không hằng cứng 9% trong UI. Đọc hỏng ⇒ ẩn dòng, không đoán.
    getSetting("crm.commissionMaxTotalRate").catch(() => null),
    // Cờ xuất bảng chi — đọc hỏng ⇒ coi là TẮT (không vẽ nút xuất khi không chắc).
    laXuatLuongBat().catch(() => false),
    // `/crm/commission` (sổ cũ) gác `payments:manage` rồi đá về dashboard: liên kết sang đó chỉ vẽ cho người mở được (như `DaiSoCu` của tab Sổ). Vai vào tab Kỳ qua
    // `commission:view-center` (HR, QLCS, Giám đốc) không có khoá này.
    checkPermission("payments:manage"),
  ]);

  const coSoThay = scope.coSoCua("CommissionPeriod");
  const coSoChon = scope.chonCoSo(motGiaTri(sp.coSo), "CommissionPeriod");
  const trangThai = TRANG_THAI_KY.find((t) => t === motGiaTri(sp.trangthai)) ?? null;

  // ── Chưa có mốc cutover: chưa có kỳ nào của hoa hồng mới ─────────────────────────────────────────
  if (kyCutover === null) {
    return (
      <KhungModule
        tab="ky"
        scope={scope}
        soHangCho={soHangCho}
        scopeBar={<ScopeBar basePath={BASE} coSo={coSoThay} dangChon={coSoChon?.id ?? null} tran={tran} />}
      >
        <EmptyState
          title="Hoa hồng theo kỳ mới chưa bắt đầu"
          description="Chưa đặt mốc chuyển sang hoa hồng mới nên chưa có kỳ nào để tính. Mốc chỉ đặt được bằng thao tác chuyển đổi có kiểm soát của quản trị hệ thống; đến lúc đó hoa hồng vẫn chốt ở sổ cũ."
          action={
            coTheMoSoCu ? (
              <Link href="/crm/commission" className="text-sm font-medium text-primary-ink hover:underline">
                Mở sổ cũ (/crm/commission)
              </Link>
            ) : undefined
          }
        />
      </KhungModule>
    );
  }

  // ── Tháng đang chọn: URL → mặc định (tháng hiện tại, không sớm hơn mốc) → kẹp trong khoảng đi được ──────────
  const nay = thangVN(now);
  const tranTren = kyCutover > nay ? kyCutover : nay;
  const tranDuoi = congThang(kyCutover, -1);
  const macDinh = thangMacDinhCuaMan({ now, kyCutover });
  const thangRaw = docThangTuUrl(motGiaTri(sp.thang), macDinh);
  const thang = thangRaw > tranTren ? tranTren : thangRaw < tranDuoi ? tranDuoi : thangRaw;
  const trang = docTrang(sp.trang);
  const coSoId = coSoChon?.id ?? null;

  const [man, ds] = await Promise.all([
    coSoChon ? docManHinhKy(actor, { thang, centerId: coSoChon.id, kyCutover }) : Promise.resolve(null),
    docDanhSachKy(actor, { trangThai, trang }),
  ]);
  // Trang quá biên (bộ lọc co lại, bookmark cũ): về trang hợp lệ thay vì vẽ bảng rỗng kèm "Hiển thị 51–50 / 50".
  if (ds.tong > 0 && ds.trang !== trang) {
    redirect(hrefVoi(BASE, { coSo: coSoId, thang, trangthai: trangThai, trang: ds.trang }));
  }

  const ky = man?.ky ?? null;
  const truocMoc = !kyTrongPhamViTinh(thang, kyCutover);
  const mucChan: MucChan[] = gomChan(man?.chanTheoMa ?? {});
  const href = (t: string) => hrefVoi(BASE, { coSo: coSoId, thang: t, trangthai: trangThai });
  const hrefTruoc = thang > tranDuoi ? href(thangTruoc(thang)) : null;
  const hrefTiep = thang < tranTren ? href(thangKeTiep(thang)) : null;

  const quyetDinh = hanhDongCuaKy({
    trangThai: ky?.status ?? null,
    truocMoc,
    coQuyenQuanLy: scope.has("commission_periods:manage"),
    soChan: man?.soLieu.soChan ?? 0,
    lastCalculatedAt: ky?.lastCalculatedAt ?? null,
    dauVaoMoiNhat: man?.dauVaoMoiNhat ?? null,
    cauChan: cauChanKhoa(mucChan) || null,
    ngayTinhCuoi: ky?.lastCalculatedAt ? ngayDMYTuMoc(ky.lastCalculatedAt) : null,
    xuatLuongBat,
    chuaXuat: man?.chuaXuat ?? { noiBo: 0, ngoai: 0 },
    soLoChoChi: man?.loChoChi.length ?? 0,
  });

  const troi =
    ky !== null && (ky.status === "CALCULATED" || ky.status === "REVIEWING") && man?.dauVaoMoiNhat != null && ky.lastCalculatedAt != null && man.dauVaoMoiNhat.getTime() > ky.lastCalculatedAt.getTime()
      ? { ngayTinh: ngayDMYTuMoc(ky.lastCalculatedAt) }
      : null;

  const hanhDong: DuLieuHanhDong | null =
    man && coSoChon
      ? {
          thang,
          thangNhan: nhanThangKy(thang),
          centerId: coSoChon.id,
          coSoNhan: coSoChon.code,
          kyId: ky?.id ?? null,
          trangThai: ky?.status ?? null,
          chinh: quyetDinh.chinh,
          phu: quyetDinh.phu,
          khongVe: quyetDinh.khongVe,
          soLieu: {
            coSoTinh: man.soLieu.coSoTinh,
            hoaHong: man.soLieu.hoaHong,
            dieuChinh: man.soLieu.dieuChinh,
            soNguoi: man.soLieu.soNguoi,
            lastCalculatedAt: ky?.lastCalculatedAt?.toISOString() ?? null,
          },
          soChan: man.soLieu.soChan,
          kyGhiTiepNhan: man.kyGhiTiep ? nhanThangKy(man.kyGhiTiep) : null,
          phamViXuat: man.phamViXuat.map((p) => ({ coSo: p.coSo, trangThai: p.status, soDongNoiBo: p.soDongNoiBo, tienNoiBo: p.tienNoiBo, soDongNgoai: p.soDongNgoai, tienNgoai: p.tienNgoai })),
          soKyChuaKhoa: man.soKyChuaKhoa,
          loChoChi: man.loChoChi.map((l) => ({ id: l.id, kind: l.kind, soDong: l.soDong, tongTien: l.tongTien, taoLuc: ngayGioVN(l.taoLuc) })),
        }
      : null;

  // Link sang hàng chờ của tab Sổ: tab Sổ lọc theo LOẠI (`?nhom=`, `docLoaiHangCho`) — KHÔNG phải `?van-de=` của tab Nguồn. Mã lẫn nhiều loại ⇒ không lọc (mở cả hàng chờ).
  // `ky` CHỈ cho hàng chờ CHẶN (chúng mang `blockingPeriodId` = kỳ đang chọn): tab Sổ lọc đúng tập mà số "Chặn" ở đây đếm. Hàng chờ treo KHÔNG chặn kỳ nào ⇒ không truyền `ky` (lọc theo kỳ sẽ ra 0).
  const hrefSoChung = (p: { loai?: LoaiHangChoSo | null; ky?: string | null }) =>
    scope.tabMoDuoc("so") ? hrefVoi(TAB_HREF.so, { coSo: coSoId, nhom: p.loai ?? null, ky: p.ky ?? null }) : null;
  // "Dời sang kỳ sau": nút nằm ở dòng hàng chờ của tab Sổ (cần commission:view-center để thấy dòng) và action gác `commission_periods:manage` — chỉ gợi ý khi người xem có CẢ HAI.
  const soDoiDuoc = MA_DOI_DUOC_SANG_KY_SAU.reduce((t, m) => t + (man?.chanTheoMa[m] ?? 0), 0);
  const hrefDoi = soDoiDuoc > 0 && scope.has("commission_periods:manage") && scope.has("commission:view-center") ? hrefSoChung({ loai: "CHO_CHINH_SACH", ky: thang }) : null;
  const mocKy: [string, Date | null][] = ky
    ? [
        ["Tính", ky.lastCalculatedAt],
        ["Rà soát", ky.reviewStartedAt],
        ["Khoá", ky.lockedAt],
        ["Xuất", ky.exportedAt],
        ["Chi", ky.paidAt],
      ]
    : [];
  const moc = mocKy.flatMap(([n, d]) => (d ? [`${n} ${ngayGioVN(d)}`] : [])).join(" · ");

  return (
    <KhungModule
      tab="ky"
      scope={scope}
      soHangCho={soHangCho}
      scopeBar={<ScopeBar basePath={BASE} coSo={coSoThay} dangChon={coSoId} giu={{ thang, trangthai: trangThai }} tran={tran} />}
    >
      {thang <= kyCutover && (
        <DaiInfo>
          Hoa hồng đến hết <b>{nhanThangKy(congThang(kyCutover, -1))}</b> vẫn chốt ở sổ cũ
          {coTheMoSoCu && (
            <>
              {" "}
              —{" "}
              <Link href="/crm/commission" className="font-medium underline">
                xem tại /crm/commission
              </Link>
            </>
          )}
          . Từ <b>{nhanThangKy(kyCutover)}</b> tính ở đây.
        </DaiInfo>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <ChonThang thangNhan={nhanThangKy(thang)} hrefTruoc={hrefTruoc} hrefTiep={hrefTiep} />
        {coSoChon && (truocMoc ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">Sổ cũ</span> : <TrangThaiKyPill status={ky?.status ?? null} />)}
        {moc && <p className="text-xs text-muted-foreground">{moc}</p>}
      </div>

      {coSoChon === null ? (
        <div className="mb-4">
          <EmptyState title="Chưa thấy cơ sở nào" description="Tài khoản này chưa được gán cơ sở nào có kỳ hoa hồng. Nhờ quản trị hệ thống gán vai tại một cơ sở." />
        </div>
      ) : truocMoc ? (
        <div className="mb-4">
          <EmptyState
            title={`Kỳ ${nhanThangKy(thang)} thuộc sổ cũ`}
            description={`Hoa hồng của tháng này chốt ở sổ cũ nên không có số liệu kỳ mới ở đây.${coTheMoSoCu ? " Đường mở sổ cũ nằm ở dải thông tin phía trên." : ""}`}
          />
        </div>
      ) : ky === null || man === null ? (
        <>
          <EmptyState
            title={`Kỳ ${nhanThangKy(thang)} của ${coSoChon.code} chưa được mở`}
            description="Kỳ mở ra khi có khoản thu đầu tiên của tháng được quét, hoặc khi bấm Tính. Chưa có số nào để hiện — hệ thống không điền số 0 thay cho “chưa tính”."
          />
          {hanhDong && (
            <div className="mt-4">
              <HanhDongKy d={hanhDong} />
            </div>
          )}
        </>
      ) : (
        <>
          <DaiSo coSoTinh={man.soLieu.coSoTinh} hoaHong={man.soLieu.hoaHong} dieuChinh={man.soLieu.dieuChinh} soNguoi={man.soLieu.soNguoi} chuaTinh={ky.status === "OPEN"} />
          <ViecDangDo
            d={{
              trangThai: ky.status,
              mucChan,
              troi,
              hrefSo: (m) => hrefSoChung({ loai: loaiChungCuaCacMa(m.ma), ky: thang }),
              loChoChi: man.loChoChi.map((l) => ({ nhan: NHAN_LO[l.kind], soDong: l.soDong, tongTien: l.tongTien, taoLuc: ngayGioVN(l.taoLuc) })),
              treo: man.treo,
              hrefSoTreo: hrefSoChung({ loai: "CHUA_PHAN_GIAI_NGUOI_HUONG" }),
              nguon: soHangCho.nguon !== undefined ? { so: soHangCho.nguon, lienKet: scope.tabMoDuoc("nguon") ? { href: TAB_HREF.nguon, nhan: "Mở tab Nguồn" } : null } : null,
              doiDuoc: hrefDoi ? { so: soDoiDuoc, href: hrefDoi } : null,
              chinhSach: soHangCho["chinh-sach"] !== undefined ? { so: soHangCho["chinh-sach"], lienKet: scope.tabMoDuoc("chinh-sach") ? { href: TAB_HREF["chinh-sach"], nhan: "Mở tab Chính sách" } : null } : null,
            }}
          />
          {hanhDong && <HanhDongKy d={hanhDong} />}
        </>
      )}

      <BangKy ds={ds} basePath={BASE} kyCutover={kyCutover} thangDangChon={thang} coSoDangChon={coSoId} trangThai={trangThai} />
    </KhungModule>
  );
}
