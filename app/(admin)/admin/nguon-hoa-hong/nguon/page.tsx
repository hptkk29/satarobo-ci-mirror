// app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx — tab NGUỒN: hàng chờ (mở Sheet "Gán nguồn"), tất cả nguồn, Page mapping (sửa tại chỗ).
//
// Mở ra ở HÀNG CHỜ NGUỒN, không phải danh sách đầy đủ (luận đề 06 §2.2). Ba chế độ trên URL: `?xem=` mặc định
// "Cần xử lý" (lead chưa đủ căn cứ nguồn), `?xem=tat-ca` là danh mục nguồn, `?xem=page-mapping` là bảng Page → nguồn (sửa tại chỗ,
// cần `sources:manage`). Bộ lọc nằm trên URL: `?coSo=`, `?van-de=`, `?trangthai=`, `?trang=`; phân trang Ở TẦNG TRUY VẤN
// (hàng chục nghìn lead).
//
// ⚠️ Cách ly cơ sở: mọi con số và dòng đi qua `scopedDb(actor).lead` (lib/nguon/doc-hang-cho, doc-danh-muc) — bảng
// attribution không có cột cơ sở (ngoại lệ có chủ đích luật Nền #3). Chip cơ sở dựng từ TẦM NHÌN scope của model
// Lead (`scope.coSoCua("Lead")`), không từ `can(action, {centerId})` — ca `[NHH-FE-09]`.
// ⚠️ Số "Cần xử lý (N)", pill tab và route gốc cùng một hàm đếm (luật 12b).
import Link from "next/link";
import { redirect } from "next/navigation";
import type { LeadSourceType } from "@prisma/client";
import { Plus } from "lucide-react";
import { HangChoRong } from "@/components/admin/nguon-hoa-hong/hang-cho-rong";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { QueueToggle, docCheDoXem } from "@/components/admin/nguon-hoa-hong/queue-toggle";
import { ScopeBar } from "@/components/admin/nguon-hoa-hong/scope-bar";
import { BTN_PRIMARY, CHIP, CHIP_ACTIVE, CHIP_IDLE } from "@/components/admin/nguon-hoa-hong/classes";
import { LOAI_NGUON_BO_LOC, NHAN_LOAI_NGUON } from "@/components/admin/nguon-hoa-hong/nhan-danh-muc";
import { EmptyState } from "@/components/admin/ui/states";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { canViewLeadPii, checkAnyPermission } from "@/lib/auth/check-permission";
import { BangPageMapping } from "@/components/admin/nguon-hoa-hong/bang-page-mapping";
import { demPageChuaMap, docBangPageMapping } from "@/lib/nguon/bang-nguon-theo-page";
import { docDanhMucNguon } from "@/lib/nguon/doc-danh-muc";
import { docMaDichMacDinh } from "@/lib/nguon/doc-form-nguon";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import { DANH_SACH_TRANG_THAI_NGUON, nhanTrangThaiNguon } from "@/lib/nguon/nhan-hien-thi";
import { coQuyenKichHoatChinhSach } from "@/lib/nguon/quyen-kich-hoat";
import {
  LY_DO_HANG_CHO,
  NHAN_LY_DO,
  demHangChoNguon,
  demHangChoTheoLyDo,
  docHangChoNguon,
  type LyDoHangCho,
} from "@/lib/nguon/doc-hang-cho";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { docTrang, hrefVoi, kepTrang, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";
import { vaoTab } from "../_lib/vao-tab";
import { BangNguon } from "./_components/bang-nguon";
import { BoLocVanDe } from "./_components/bo-loc-van-de";
import { HangChoBang } from "./_components/hang-cho-bang";

export const metadata = { title: "Nguồn lead | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/nguon-hoa-hong/nguon";

type Sp = { coSo?: string | string[]; xem?: string | string[]; "van-de"?: string | string[]; trangthai?: string | string[]; loai?: string | string[]; trang?: string | string[] };

// Chip lọc trạng thái: dựng từ BẢNG GỐC (lib/nguon/nhan-hien-thi.ts) — thêm trạng thái ở schema là lỗi biên dịch ở đó, không phải một chip lặng lẽ thiếu ở đây.
const TRANG_THAI = DANH_SACH_TRANG_THAI_NGUON.map((gia) => ({ gia, nhan: nhanTrangThaiNguon(gia) }));

export default async function NguonPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("nguon");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/nguon"])) {
    return <ThieuQuyen tab="nguon" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;

  const coSoChon = scope.timCoSo(motGiaTri(sp.coSo), "Lead");
  const coSoId = coSoChon?.id ?? null;
  const xem = docCheDoXem(motGiaTri(sp.xem));
  const vanDeRaw = motGiaTri(sp["van-de"]);
  const lyDo: LyDoHangCho | null = LY_DO_HANG_CHO.find((l) => l === vanDeRaw) ?? null;
  const trangThai = TRANG_THAI.find((t) => t.gia === motGiaTri(sp.trangthai))?.gia ?? null;
  const loai: LeadSourceType | null = LOAI_NGUON_BO_LOC.find((l) => l === motGiaTri(sp.loai)) ?? null;
  const trang = docTrang(sp.trang);
  const now = new Date();
  const phamVi = coSoChon ? coSoChon.label : "phạm vi của bạn";

  const giuToanTab = { coSo: coSoId, xem: xem === "tat-ca" ? "tat-ca" : null, "van-de": lyDo };

  // Pill tab (toàn tầm nhìn) · số trên công tắc (theo cơ sở đang chọn) · quyền PII — cùng một lượt, không nối đuôi.
  // `coTheMoLead`: `sources:view` KHÔNG kéo theo `leads:view-*` (Kế toán HO, Giám đốc) và `/leads/[id]` đá người thiếu
  // quyền về /dashboard — nên dòng chỉ là vùng bấm khi họ thật sự mở được. Hai key = đúng cổng của trang đó (W11).
  const [soHangCho, canXuLy, canViewPii, coTheMoLead, soPageChuaMap] = await Promise.all([
    docSoHangChoTheoTab(actor, scope),
    demHangChoNguon(actor, coSoId),
    canViewLeadPii(),
    checkAnyPermission(["leads:view-all", "leads:view-own"]),
    demPageChuaMap(actor),
  ]);

  const scopeBar = (
    <ScopeBar
      basePath={BASE}
      coSo={scope.coSoCua("Lead")}
      dangChon={coSoId}
      tatCaNhan="Tất cả cơ sở"
      giu={{ xem: giuToanTab.xem, "van-de": lyDo, trangthai: trangThai, loai }}
    />
  );

  // ── Chế độ "Page mapping" — bảng Page → nguồn, sửa tại chỗ ───────────────────────────────────────
  // Không có ScopeBar: Page đã được cắt theo cơ sở của người xem ở tầng truy vấn (`pageTrongTamNhin` — LÀM TAY, vì
  // `FacebookPageMapping` ∈ SCOPE_EXEMPT nên `scopedDb` KHÔNG lọc nó), và một chip cơ sở không lọc gì ở đây sẽ là lời hứa suông.
  // Nhưng cơ sở đang chọn ở các chế độ kia vẫn phải SỐNG SÓT qua chế độ này: `giu` truyền `coSo` để bấm quay lại không bị đẩy về
  // "Tất cả cơ sở". Quyền sửa = `sources:manage` (đúng khoá mà `luuPageMappingAction` kiểm ở đầu hàm).
  if (xem === "page-mapping") {
    // Người không có `sources:manage` không sửa được bảng ⇒ không cần biết quyền kích hoạt (một truy vấn quyền ít hơn).
    const coTheSua = scope.has("sources:manage");
    const [bang, coQuyenKichHoat] = await Promise.all([docBangPageMapping(actor, new Date()), coTheSua ? coQuyenKichHoatChinhSach() : Promise.resolve(false)]);
    return (
      <KhungModule tab="nguon" scope={scope} soHangCho={soHangCho}>
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <QueueToggle basePath={BASE} dangXem="page-mapping" soCanXuLy={canXuLy} soPageChuaMap={soPageChuaMap} giu={{ coSo: coSoId }} />
        </div>
        <BangPageMapping dong={bang.dong} nhom={bang.nhom} dinhTienTheoMa={bang.dinhTienTheoMa} coTheSua={coTheSua} coQuyenKichHoat={coQuyenKichHoat} runtimeBat={bang.runtimeBat} />
      </KhungModule>
    );
  }

  // ── Chế độ "Tất cả" — danh mục nguồn ───────────────────────────────────────────────────────────
  if (xem === "tat-ca") {
    // Quyền GHI danh mục = `sources:manage` ∧ module bật — ĐÚNG hai điều kiện mà `taoNguonAction` / `suaNguonAction` / `doiTrangThaiNguonAction` kiểm ở đầu hàm (luật 12: nút chỉ vẽ khi máy chủ sẽ nhận).
    const coTheSua = scope.has("sources:manage");
    const [danhMuc, nguonBat, dichMacDinh, coQuyenKichHoat] = await Promise.all([
      docDanhMucNguon(actor, { now, trangThai, loai, coSoId }),
      laQuanLyNguonBat(),
      docMaDichMacDinh(),
      // Cùng một lượt (không nối đuôi — luật đo độ sâu tuần tự): chỉ hỏi khi người xem có thể thấy nút ghi.
      coTheSua ? coQuyenKichHoatChinhSach() : Promise.resolve(false),
    ]);
    const coTheGhi = coTheSua && nguonBat;
    const locKhongDoi = Boolean(trangThai || loai);
    return (
      <KhungModule
        tab="nguon"
        scope={scope}
        soHangCho={soHangCho}
        scopeBar={scopeBar}
        actions={
          coTheGhi ? (
            <Link href="/nguon-hoa-hong/nguon/tao" className={BTN_PRIMARY}>
              <Plus aria-hidden className="h-4 w-4" />
              Tạo nguồn
            </Link>
          ) : undefined
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <QueueToggle basePath={BASE} dangXem="tat-ca" soCanXuLy={canXuLy} soPageChuaMap={soPageChuaMap} giu={{ coSo: coSoId }} />
        <nav aria-label="Lọc theo trạng thái nguồn" className="flex w-full items-center gap-2 overflow-x-auto pb-1 md:w-auto md:flex-wrap md:overflow-visible md:pb-0 [&>a]:shrink-0 [&>a]:whitespace-nowrap">
          <Link
            href={hrefVoi(BASE, { coSo: coSoId, xem: "tat-ca", loai })}
            aria-current={trangThai === null ? "page" : undefined}
            className={cn(CHIP, trangThai === null ? CHIP_ACTIVE : CHIP_IDLE)}
          >
            Mọi trạng thái
          </Link>
          {TRANG_THAI.map((t) => (
            <Link
              key={t.gia}
              href={hrefVoi(BASE, { coSo: coSoId, xem: "tat-ca", trangthai: t.gia, loai })}
              aria-current={trangThai === t.gia ? "page" : undefined}
              className={cn(CHIP, trangThai === t.gia ? CHIP_ACTIVE : CHIP_IDLE)}
            >
              {t.nhan}
            </Link>
          ))}
        </nav>
        <nav aria-label="Lọc theo nhóm nguồn" className="flex w-full items-center gap-2 overflow-x-auto pb-1 md:w-auto md:flex-wrap md:overflow-visible md:pb-0 [&>a]:shrink-0 [&>a]:whitespace-nowrap">
          <Link
            href={hrefVoi(BASE, { coSo: coSoId, xem: "tat-ca", trangthai: trangThai })}
            aria-current={loai === null ? "page" : undefined}
            className={cn(CHIP, loai === null ? CHIP_ACTIVE : CHIP_IDLE)}
          >
            Mọi nhóm
          </Link>
          {LOAI_NGUON_BO_LOC.map((l) => (
            <Link
              key={l}
              href={hrefVoi(BASE, { coSo: coSoId, xem: "tat-ca", trangthai: trangThai, loai: l })}
              aria-current={loai === l ? "page" : undefined}
              className={cn(CHIP, loai === l ? CHIP_ACTIVE : CHIP_IDLE)}
            >
              {NHAN_LOAI_NGUON[l]}
            </Link>
          ))}
        </nav>
        </div>
        {danhMuc.dong.length === 0 ? (
          locKhongDoi ? (
            <EmptyState
              title="Không có nguồn nào khớp bộ lọc"
              description="Bỏ bộ lọc trạng thái hoặc nhóm nguồn để xem toàn bộ danh mục."
              action={
                <Link href={hrefVoi(BASE, { coSo: coSoId, xem: "tat-ca" })} className="text-sm font-medium text-primary-ink hover:underline">
                  Bỏ mọi bộ lọc
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="Danh mục nguồn đang trống"
              description={coTheGhi ? "Chưa có nguồn nào. Tạo nguồn đầu tiên để người nhập có gì để chọn." : "Chưa có nguồn nào. Nhờ quản trị viên có quyền quản lý nguồn tạo giúp."}
              action={
                coTheGhi ? (
                  <Link href="/nguon-hoa-hong/nguon/tao" className={BTN_PRIMARY}>
                    <Plus aria-hidden className="h-4 w-4" />
                    Tạo nguồn
                  </Link>
                ) : undefined
              }
            />
          )
        ) : (
          <BangNguon dong={danhMuc.dong} cuaSoMacDinhNgay={danhMuc.cuaSoGhiCongNgay} coTheGhi={coTheGhi} coQuyenKichHoat={coQuyenKichHoat} dichMacDinh={dichMacDinh} nowIso={now.toISOString()} />
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Cửa sổ ghi công mặc định: <b className="tabular-nums text-foreground">{danhMuc.cuaSoGhiCongNgay} ngày</b> kể từ lúc lead
          vào; nguồn nào có cửa sổ riêng thì theo cửa sổ riêng (xem chi tiết nguồn). Số lead đếm ở {coSoChon ? coSoChon.label : "các cơ sở bạn được xem"}.
        </p>
      </KhungModule>
    );
  }

  // ── Chế độ mặc định "Cần xử lý" — hàng chờ nguồn ───────────────────────────────────────────────
  const [ds, theoLyDo] = await Promise.all([
    docHangChoNguon(actor, { coSoId, lyDo, trang, now, canViewPii }),
    demHangChoTheoLyDo(actor, coSoId),
  ]);

  // Hàng chờ co lại khi người ta xử lý nó: F5/bookmark ở trang cuối rơi quá biên là chuyện thật. Về trang cuối thay vì
  // vẽ bảng rỗng kèm "Hiển thị 2.451–30 / 30". Tổng 0 thì nhánh rỗng lo, không redirect.
  const trangHopLe = kepTrang(trang, ds.tong, ds.kichThuoc);
  if (ds.tong > 0 && trangHopLe !== trang) {
    redirect(hrefVoi(BASE, { coSo: coSoId, "van-de": lyDo, trang: trangHopLe }));
  }

  return (
    <KhungModule tab="nguon" scope={scope} soHangCho={soHangCho} scopeBar={scopeBar}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <QueueToggle basePath={BASE} dangXem="can-xu-ly" soCanXuLy={canXuLy} soPageChuaMap={soPageChuaMap} giu={{ coSo: coSoId }} />
        <BoLocVanDe basePath={BASE} giu={{ coSo: coSoId }} dangChon={lyDo} theoLyDo={theoLyDo} />
      </div>
      {ds.tong === 0 ? (
        lyDo ? (
          // Lọc theo MỘT lý do mà rỗng: các lý do khác có thể còn việc ⇒ KHÔNG nói "mọi lead đều đủ căn cứ".
          <HangChoRong
            tieuDe={`Không có lead nào “${NHAN_LY_DO[lyDo]}”`}
            moTa={`Ở ${phamVi}, không lead nào đang vướng vấn đề này.`}
            hrefTiep={hrefVoi(BASE, { coSo: coSoId })}
            nhanTiep="Bỏ lọc vấn đề"
          />
        ) : (
          <HangChoRong
            tieuDe="Không còn lead nào cần xử lý nguồn"
            moTa={`Mọi lead ở ${phamVi} đều đã đủ căn cứ nguồn.`}
            hrefTiep={hrefVoi(BASE, { coSo: coSoId, xem: "tat-ca" })}
            nhanTiep="Xem tất cả nguồn"
          />
        )
      ) : (
        <HangChoBang
          dong={ds.dong}
          tong={ds.tong}
          trang={ds.trang}
          kichThuoc={ds.kichThuoc}
          hrefTrang={(t) => hrefVoi(BASE, { coSo: coSoId, "van-de": lyDo, trang: t })}
          coTheMoLead={coTheMoLead}
        />
      )}
    </KhungModule>
  );
}
