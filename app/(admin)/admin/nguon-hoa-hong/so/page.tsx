// app/(admin)/admin/nguon-hoa-hong/so/page.tsx — tab "Sổ hoa hồng" (06 §5.3): mở ra ở HÀNG CHỜ TRƯỚC SỔ, "Tất cả" là sổ table-first.
//
// Cờ `hoaHong.engineBat` TẮT ⇒ 404 (`vaoTab`). Quyền gác bằng `PAGE_GATES["/nguon-hoa-hong/so"]` — một nguồn với mục sidebar/ModuleNav.
//
// ── Hai tầng người xem ─────────────────────────────────────────────────────────────────────────────────────
//   · `commission:view-center` (Kế toán, QLCS, BLĐ…): có hàng chờ + sổ trong tầm nhìn cơ sở + chip cơ sở. Mở ở "Cần xử lý".
//   · chỉ `commission:view-self` (Sale…): KHÔNG có hàng chờ (bảng công việc của người rà soát — mang tiền của vai chưa có người nhận), mở thẳng sổ CỦA MÌNH.
//     Hàm đọc (`docSoHoaHong`) ép phạm vi ở máy chủ; trang này chỉ không VẼ những gì người xem không có (luật 12).
//
// Bộ lọc nằm TRÊN URL: `?xem=tat-ca` · `?nhom=` · `?coSo=` · `?thang= &vai= &nguoi= &nguon= &loai= &tt=` · `?trang=`; phân trang Ở TẦNG TRUY VẤN.
// Số hàng chờ: pill tab, công tắc "Cần xử lý (N)" và chip loại cùng đi qua `docHangChoSo` (`demHangChoSo` chỉ khi không đọc dòng) (luật 12b) — không đếm lại ở đây.
import Link from "next/link";
import { redirect } from "next/navigation";

import { HangChoRong } from "@/components/admin/nguon-hoa-hong/hang-cho-rong";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { QueueToggle } from "@/components/admin/nguon-hoa-hong/queue-toggle";
import { ScopeBar } from "@/components/admin/nguon-hoa-hong/scope-bar";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { TienDong } from "@/components/admin/nguon-hoa-hong/vi-sao-noi-dung";
import { EmptyState } from "@/components/admin/ui/states";
import type { Actor } from "@/lib/auth/actor";
import { PermissionError } from "@/lib/auth/can";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import type { BoLocSo } from "@/lib/hoa-hong/doc-so";
import { docLuaChonBoLocSo, docMocSoMoi, docTrangSo } from "@/lib/hoa-hong/doc-so-giao-dien";
import { demHangChoSo, docHangChoSoCuaToi, KICH_THUOC_HANG_CHO_SO } from "@/lib/hoa-hong/hang-cho-so-doc";
import { NHAN_LOAI, docLoaiHangCho } from "@/lib/hoa-hong/hang-cho-so-nhom";
import type { QuyenLienKet } from "@/lib/hoa-hong/hang-cho-so";
import { KEY_TAO_KHIEU_NAI } from "@/lib/hoa-hong/khieu-nai-ma";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import type { NguonHoaHongScope } from "@/lib/nguon-hoa-hong/scope";
import { docTrang, hrefVoi, kepTrang, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";
import { getSetting } from "@/lib/settings/service";
import { vaoTab } from "../_lib/vao-tab";
import { BangSo } from "./_components/bang-so";
import { nutKhieuNaiDong } from "./_components/nut-khieu-nai-dong";
import { BoLocSoForm, ChipNhomHangCho, type GiaTriBoLoc } from "./_components/bo-loc";
import { DaiSoCu } from "./_components/dai-so-cu";
import { HangChoSoBang } from "./_components/hang-cho-so-bang";
import { LocKy } from "./_components/loc-ky";

export const metadata = { title: "Sổ hoa hồng | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/nguon-hoa-hong/so";
/** Key mà `doiHangChoSangKySauAction` (tab Kỳ) kiểm — nút "Dời sang kỳ sau" ở dòng hàng chờ vẽ bằng ĐÚNG key này (luật 12). */
const KEY_QUAN_LY_KY = "commission_periods:manage";
const TRANG_THAI_CHI = ["PENDING", "APPROVED", "EXPORTED", "PAID"] as const;
const KY_HOP_LE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Mã/ id do người dùng gõ trên URL: chỉ nhận hình dạng của một mã (không tin, không đoán). */
const MA_HOP_LE = /^[A-Za-z0-9_.:-]{1,64}$/;
const mot = (raw: string | string[] | undefined, re: RegExp): string | null => {
  const v = motGiaTri(raw);
  return v !== null && re.test(v) ? v : null;
};

type Sp = Partial<Record<"coSo" | "xem" | "nhom" | "ky" | "thang" | "vai" | "nguoi" | "nguon" | "loai" | "tt" | "trang", string | string[]>>;

export default async function SoPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("so");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/so"])) {
    return <ThieuQuyen tab="so" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;
  try {
    return await veSo(actor, scope, sp);
  } catch (e) {
    // Cổng của TRANG (`scope`, qua `checkPermission`) và cổng của HÀM ĐỌC (`actor`, `can()` v2) đến từ hai nơi; khi cờ RBAC v2 TẮT (local/dev) tài khoản có vai cũ nhưng
    // chưa có `UserOrgRole` qua cổng đầu mà bị cổng sau từ chối. Nói đúng "không có quyền" (fail-closed), không để rơi vào màn "máy chủ báo lỗi".
    if (e instanceof PermissionError) return <ThieuQuyen tab="so" scope={scope} soHangCho={{}} />;
    throw e;
  }
}

async function veSo(actor: Actor, scope: NguonHoaHongScope, sp: Sp) {
  const coHangCho = scope.has("commission:view-center");
  const xem: "can-xu-ly" | "tat-ca" = coHangCho && motGiaTri(sp.xem) !== "tat-ca" ? "can-xu-ly" : "tat-ca";
  const coSoChon = coHangCho ? scope.timCoSo(motGiaTri(sp.coSo), "CommissionTransaction") : null;
  const coSoId = coSoChon?.id ?? null;
  const phamVi = coSoChon ? coSoChon.label : coHangCho ? "phạm vi của bạn" : "sổ của bạn";
  const trang = docTrang(sp.trang);

  const gia: GiaTriBoLoc = {
    thang: mot(sp.thang, KY_HOP_LE) ?? "",
    vai: mot(sp.vai, MA_HOP_LE) ?? "",
    nguoi: coHangCho ? (mot(sp.nguoi, MA_HOP_LE) ?? "") : "",
    nguon: mot(sp.nguon, MA_HOP_LE) ?? "",
    loai: mot(sp.loai, MA_HOP_LE) ?? "",
    tt: TRANG_THAI_CHI.find((t) => t === motGiaTri(sp.tt)) ?? "",
  };
  const coLoc = Object.values(gia).some((v) => v !== "");
  // `?nhom=` giữ tên cũ trên URL (link đã đưa ra không gãy); giá trị là một LOẠI hàng chờ (`LoaiHangChoSo`).
  const nhom = docLoaiHangCho(motGiaTri(sp.nhom));
  // `?ky=` (chỉ ở chế độ hàng chờ): chỉ hàng chờ đang CHẶN khoá kỳ đó — đến từ link "Xem ở tab Sổ" của tab Kỳ. Đi vào `docHangChoSo` nên danh sách và MỌI con số trên trang cùng một phạm vi.
  const ky = coHangCho ? mot(sp.ky, KY_HOP_LE) : null;

  // Trần (chỉ để hiện ở ScopeBar, đọc từ setting — không hằng 9% trong UI) · mốc cutover · quyền mở sổ cũ: một lượt.
  const [tran, moc, coTheMoSoCu] = await Promise.all([
    getSetting("crm.commissionMaxTotalRate").catch(() => null),
    docMocSoMoi().catch(() => null),
    checkPermission("payments:manage"),
  ]);

  const giuLoc = { thang: gia.thang, vai: gia.vai, nguoi: gia.nguoi, nguon: gia.nguon, loai: gia.loai, tt: gia.tt };
  // Người chỉ xem phần của mình (Sale…) không có chip cơ sở để chọn: một thanh chỉ mang con số trần là một khung rỗng. Không vẽ.
  const scopeBar = !coHangCho ? undefined : (
    <ScopeBar
      basePath={BASE}
      coSo={coHangCho ? scope.coSoCua("CommissionTransaction") : undefined}
      dangChon={coSoId}
      tatCaNhan="Tất cả cơ sở"
      giu={xem === "tat-ca" ? { xem: "tat-ca", ...giuLoc } : { nhom, ky }}
      tran={tran}
    />
  );

  // ── "Cần xử lý" — HÀNG CHỜ TRƯỚC SỔ ────────────────────────────────────────────────────────────────
  if (xem === "can-xu-ly") {
    const [soHangCho, donOk, leadOk, nguoiPhuTrachOk] = await Promise.all([
      docSoHangChoTheoTab(actor, scope),
      checkPermission("orders:view"),
      checkAnyPermission(["leads:view-all", "leads:view-own"]),
      checkPermission("commission-assignee:manage"),
    ]);
    // Mỗi link chỉ vẽ khi người xem MỞ ĐƯỢC trang đích — đúng cổng của trang đó (luật 12).
    // `nguon`: đúng cổng của trang chi tiết nguồn — tab Nguồn mở được (cờ + quyền xem) ∧ vai này có `sources:view`.
    const quyen: QuyenLienKet = { don: donOk, lead: leadOk, chinhSach: scope.has("commission_policies:view"), nguoiPhuTrach: nguoiPhuTrachOk, nguon: scope.tabMoDuoc("nguon") };
    const ds = await docHangChoSoCuaToi(actor, { ...(coSoId ? { centerId: coSoId } : {}), ...(nhom ? { loai: nhom } : {}), ...(ky ? { ky } : {}), trang, coTrang: KICH_THUOC_HANG_CHO_SO, quyen });
    const trangHopLe = kepTrang(trang, ds.tongSo, ds.coTrang);
    if (ds.tongSo > 0 && trangHopLe !== trang) redirect(hrefVoi(BASE, { coSo: coSoId, nhom, ky, trang: trangHopLe }));

    return (
      <KhungModule tab="so" scope={scope} soHangCho={soHangCho} scopeBar={scopeBar}>
        <DaiSoCu moc={moc} coTheMoSoCu={coTheMoSoCu} />
        {ky && <LocKy ky={ky} coSo={coSoChon ? coSoChon.label : null} hrefBo={hrefVoi(BASE, { coSo: coSoId, nhom })} />}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
          <QueueToggle basePath={BASE} dangXem="can-xu-ly" soCanXuLy={ds.canXuLy} giu={{ coSo: coSoId }} />
          <ChipNhomHangCho basePath={BASE} giu={{ coSo: coSoId, ky }} dangChon={nhom} theoNhom={ds.demTheoLoai} tong={ds.canXuLy} />
        </div>
        {/* Chỉ khi KHÔNG lọc nhóm: số này đếm cả phạm vi, đặt trên một nhóm đã lọc (nhất là nhóm rỗng) đọc như đang nói về nhóm đó. */}
        {ds.canXuLy > 0 && !nhom && !ky && (
          <p className="mb-3 text-sm text-muted-foreground">
            <b className="tabular-nums text-foreground">{soVN(ds.dem.CHAN_KHOA_KY)}</b> việc chặn khoá kỳ · <b className="tabular-nums text-foreground">{soVN(ds.canXuLy - ds.dem.CHAN_KHOA_KY)}</b> việc không chặn khoá.
          </p>
        )}
        {ds.tongSo === 0 ? (
          nhom ? (
            // Lọc theo MỘT nhóm mà rỗng: các nhóm khác có thể còn việc ⇒ KHÔNG nói "mọi thứ đã đủ căn cứ".
            <HangChoRong
              tieuDe={`Không có việc nào “${NHAN_LOAI[nhom]}”`}
              moTa={`Ở ${phamVi}, không khoản thu nào đang vướng nhóm này.`}
              hrefTiep={hrefVoi(BASE, { coSo: coSoId })}
              nhanTiep="Bỏ lọc nhóm"
            />
          ) : (
            <HangChoRong
              tieuDe={ky ? `Không còn hàng chờ nào chặn khoá kỳ ${kyHienThi(ky)}` : "Không còn việc nào cần xử lý trước sổ"}
              moTa={ky ? `Ở ${phamVi}, không hàng chờ nào còn chặn khoá kỳ này.` : `Mọi khoản thu ở ${phamVi} đều đã đủ căn cứ để ghi sổ.`}
              hrefTiep={ky ? hrefVoi(BASE, { coSo: coSoId }) : hrefVoi(BASE, { coSo: coSoId, xem: "tat-ca" })}
              nhanTiep={ky ? "Bỏ lọc kỳ" : "Xem sổ hoa hồng"}
            />
          )
        ) : (
          <HangChoSoBang dong={ds.dong} tong={ds.tongSo} trang={ds.trang} kichThuoc={ds.coTrang} hrefTrang={(t) => hrefVoi(BASE, { coSo: coSoId, nhom, ky, trang: t })} coTheDoiKy={scope.has(KEY_QUAN_LY_KY)} />
        )}
      </KhungModule>
    );
  }

  // ── "Tất cả" — SỔ ──────────────────────────────────────────────────────────────────────────────────
  const boLoc: BoLocSo = {
    ...(gia.thang ? { thang: gia.thang } : {}),
    ...(coSoId ? { centerId: coSoId } : {}),
    ...(gia.nguoi ? { nguoiHuong: gia.nguoi } : {}),
    ...(gia.vai ? { roleCode: gia.vai } : {}),
    ...(gia.nguon ? { nhomNguon: gia.nguon } : {}),
    ...(gia.loai ? { loaiGiaoDich: gia.loai } : {}),
    ...(gia.tt ? { trangThaiChi: gia.tt as (typeof TRANG_THAI_CHI)[number] } : {}),
    trang,
    coTrang: 50,
  };
  const [soHangCho, so, lua, dem] = await Promise.all([
    docSoHangChoTheoTab(actor, scope),
    docTrangSo(actor, boLoc),
    docLuaChonBoLocSo(actor),
    coHangCho ? demHangChoSo(actor, coSoId) : Promise.resolve(null),
  ]);
  const giuTatCa = { coSo: coSoId, xem: "tat-ca", ...giuLoc };
  const trangHopLe = kepTrang(trang, so.tongSo, so.coTrang);
  if (so.tongSo > 0 && trangHopLe !== trang) redirect(hrefVoi(BASE, { ...giuTatCa, trang: trangHopLe }));

  return (
    <KhungModule tab="so" scope={scope} soHangCho={soHangCho} scopeBar={scopeBar}>
      <DaiSoCu moc={moc} coTheMoSoCu={coTheMoSoCu} />
      {coHangCho && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <QueueToggle basePath={BASE} dangXem="tat-ca" soCanXuLy={dem?.canXuLy ?? null} giu={{ coSo: coSoId }} />
        </div>
      )}
      <BoLocSoForm basePath={BASE} giu={{ coSo: coSoId, xem: "tat-ca" }} lua={lua} gia={gia} coLoc={coLoc} />
      {so.tongSo === 0 ? (
        coLoc ? (
          <EmptyState
            title="Không có dòng nào khớp bộ lọc"
            description="Thử nới bộ lọc: chọn “Mọi kỳ” hoặc bỏ bớt điều kiện."
            action={
              <Link href={hrefVoi(BASE, { coSo: coSoId, xem: "tat-ca" })} className="text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                Bỏ lọc
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={coHangCho ? "Sổ hoa hồng chưa có dòng nào" : "Bạn chưa có dòng hoa hồng nào"}
            description={
              coHangCho
                ? `Ở ${phamVi}, chưa khoản thu nào được tính vào sổ. Dòng xuất hiện sau khi kế toán xác nhận khoản thu và kỳ được tính.`
                : "Dòng chỉ xuất hiện sau khi kế toán xác nhận một khoản thu có phần của bạn."
            }
          />
        )
      ) : (
        <>
          <p className="mb-3 flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
            <span>{coLoc ? "Tổng hoa hồng đang lọc" : coSoChon ? `Tổng hoa hồng · ${coSoChon.label}` : "Tổng hoa hồng"}</span>
            <span className="text-xl font-semibold text-foreground">
              <TienDong soTien={so.tongTien} />
            </span>
            <span>
              · <span className="tabular-nums">{soVN(so.tongSo)}</span> dòng
            </span>
          </p>
          <BangSo
            dong={so.dong}
            tong={so.tongSo}
            trang={so.trang}
            kichThuoc={so.coTrang}
            hrefTrang={(t) => hrefVoi(BASE, { ...giuTatCa, trang: t })}
            // Khiếu nại CHỈ cho dòng CỦA MÌNH (server `laDongCuaToi` cũng chỉ nhận dòng ấy): cùng key với Server Action (`KEY_TAO_KHIEU_NAI`) ∧ người hưởng là chính người xem.
            // QLCS / Kế toán xem dòng người khác ⇒ nút không vẽ (luật 12 — nút vẽ ra ⇔ action chạy được).
            hanhDong={(d) => nutKhieuNaiDong(d, actor.userId, scope.has(KEY_TAO_KHIEU_NAI))}
          />
        </>
      )}
    </KhungModule>
  );
}
