// app/(admin)/admin/nguon-hoa-hong/chinh-sach/page.tsx — tab "Chính sách" (PR8, 06 §5.2).
//
// Mở ra ở HÀNG CHỜ CHÍNH SÁCH (luận đề "Hàng chờ trước sổ"), không phải danh sách đầy đủ. Ba chế độ trên URL `?xem=`:
// mặc định "Cần xử lý" · `tat-ca` (bảng đầy đủ, lọc trên URL) · `ma-tran` (vai × nguồn, chỉ đọc). Cờ `hoaHong.engineBat` TẮT ⇒ 404
// (`vaoTab`). Quyền gác bằng `PAGE_GATES["/nguon-hoa-hong/chinh-sach"]`.
//
// ⚠️ Cách ly cơ sở: mọi đọc chính sách/văn bản đi qua `scopedDb(actor)` (lib/hoa-hong/chinh-sach-doc). Chip cơ sở dựng từ TẦM NHÌN
// của người xem trên chính sách (không từ `can(action, {centerId})`) và LỌC THẬT bảng/ma trận (luật 12).
// ⚠️ Số "Cần xử lý (N)", pill tab và route gốc cùng một hàm đếm (`docHangChoChinhSach`) — luật 12b.
import Link from "next/link";
import { Plus } from "lucide-react";

import { CHIP, CHIP_ACTIVE, CHIP_IDLE, BTN_PRIMARY } from "@/components/admin/nguon-hoa-hong/classes";
import { HangChoRong } from "@/components/admin/nguon-hoa-hong/hang-cho-rong";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { ScopeBar } from "@/components/admin/nguon-hoa-hong/scope-bar";
import { EmptyState } from "@/components/admin/ui/states";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { THU_TU_PHAM_VI_MAC_DINH } from "@/lib/hoa-hong/chon-quy-tac";
import { LOAI_GD_SOAN, NHAN_LOAI_GD, type LoaiGdSoan } from "@/lib/hoa-hong/chinh-sach-form";
import { coChinhSachDangApDung, docBangChinhSach, docBoLocChinhSach, docDuLieuMaTran, docHangChoChinhSach } from "@/lib/hoa-hong/chinh-sach-doc";
import { locChinhSach, TRANG_THAI_LOC, type TrangThaiLoc } from "@/lib/hoa-hong/chinh-sach-tom-tat";
import { dungMaTran } from "@/lib/hoa-hong/ma-tran-chinh-sach";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { docTrang, hrefVoi, kepTrang, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";

import { vaoTab } from "../_lib/vao-tab";
import { BangChinhSach } from "./_components/bang-chinh-sach";
import { BoLocVai } from "./_components/bo-loc-vai";
import { CheDoXemChinhSach, docCheDoChinhSach } from "./_components/che-do-xem";
import { HangChoChinhSachBang } from "./_components/hang-cho-bang";
import { MaTranBang } from "./_components/ma-tran-bang";

export const metadata = { title: "Chính sách | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/nguon-hoa-hong/chinh-sach";
const KICH_THUOC = 25;

type Sp = { coSo?: string | string[]; xem?: string | string[]; trangthai?: string | string[]; vai?: string | string[]; loai?: string | string[]; trang?: string | string[] };

const NHAN_TRANG_THAI: Record<TrangThaiLoc, string> = {
  "dang-ap-dung": "Đang áp dụng",
  "cho-hieu-luc": "Chờ hiệu lực",
  nhap: "Có bản nháp",
  "het-hieu-luc": "Hết hiệu lực",
};

function NutTao() {
  return (
    <Link href="/nguon-hoa-hong/chinh-sach/moi" className={BTN_PRIMARY}>
      <Plus aria-hidden className="h-4 w-4" />
      Tạo chính sách
    </Link>
  );
}

export default async function ChinhSachPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("chinh-sach");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/chinh-sach"])) {
    return <ThieuQuyen tab="chinh-sach" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;
  const now = new Date();
  const xem = docCheDoChinhSach(motGiaTri(sp.xem));
  const coTheSoan = scope.has("commission_policies:manage");

  const [soHangCho, boLoc, dangApDung] = await Promise.all([docSoHangChoTheoTab(actor, scope), docBoLocChinhSach(actor), coChinhSachDangApDung(actor, now)]);

  const coSoChon = boLoc.coSo.find((c) => c.id === motGiaTri(sp.coSo)) ?? null;
  const coSoId = coSoChon?.id ?? null;
  const trangThai = TRANG_THAI_LOC.find((t) => t === motGiaTri(sp.trangthai)) ?? null;
  const vaiChon = boLoc.vai.find((v) => v.code === motGiaTri(sp.vai))?.code ?? null;
  const loai: LoaiGdSoan = LOAI_GD_SOAN.find((l) => l === motGiaTri(sp.loai)) ?? "NEW";

  const giuChe = { coSo: coSoId };
  const xemParam = xem === "can-xu-ly" ? null : xem;
  // Chip cơ sở chỉ ở chế độ có dữ liệu theo cơ sở (Tất cả, Ma trận) — ở "Cần xử lý" một chip không đổi được gì là lời hứa suông.
  const scopeBar = (
    <ScopeBar
      basePath={BASE}
      coSo={xem === "can-xu-ly" ? undefined : boLoc.coSo}
      dangChon={coSoId}
      tatCaNhan="Toàn hệ thống"
      giu={{ xem: xemParam, trangthai: trangThai, vai: vaiChon, loai: xem === "ma-tran" && loai !== "NEW" ? loai : null }}
      tran={boLoc.tran}
    />
  );
  const actions = coTheSoan ? <NutTao /> : undefined;
  const khungProps = { tab: "chinh-sach" as const, scope, actions, scopeBar };

  const chuaCauHinh = !dangApDung && (
    <div role="status" className="mb-4 rounded-xl border border-state-warning-ink/30 bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
      <b>Chưa có chính sách nào đang hiệu lực</b> — hoa hồng kỳ này sẽ không sinh dòng nào.{" "}
      {coTheSoan ? <Link href="/nguon-hoa-hong/chinh-sach/moi" className="font-medium underline">Tạo chính sách đầu tiên</Link> : "Nhờ người có quyền soạn chính sách tạo."}
    </div>
  );

  // ── Ma trận ───────────────────────────────────────────────────────────────
  if (xem === "ma-tran") {
    const dl = await docDuLieuMaTran(actor, coSoId);
    const maTran = dungMaTran({ quyTac: dl.quyTac, nhomNguon: dl.nhomNguon, vai: dl.vai, loai, orgUnitPath: dl.orgUnitPath, rateDate: now, thuTuPhamVi: THU_TU_PHAM_VI_MAC_DINH, tran: dl.tran ?? 1 });
    return (
      <KhungModule {...khungProps} soHangCho={soHangCho}>
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <CheDoXemChinhSach basePath={BASE} dangXem="ma-tran" soCanXuLy={soHangCho["chinh-sach"] ?? null} giu={giuChe} />
          <nav aria-label="Loại giao dịch" className="flex flex-wrap items-center gap-2">
            {LOAI_GD_SOAN.map((l) => (
              <Link key={l} href={hrefVoi(BASE, { ...giuChe, xem: "ma-tran", loai: l === "NEW" ? null : l })} aria-current={loai === l ? "page" : undefined} className={cn(CHIP, loai === l ? CHIP_ACTIVE : CHIP_IDLE)}>
                {NHAN_LOAI_GD[l]}
              </Link>
            ))}
          </nav>
        </div>
        {chuaCauHinh}
        {dl.tran === null && (
          <p role="status" className="mb-3 text-sm text-state-warning-ink">
            Không đọc được trần hoa hồng từ cấu hình — dòng tổng chưa so với trần.
          </p>
        )}
        <MaTranBang maTran={maTran} nhomTheoMa={new Map(dl.nhomNguon.map((n) => [n.code, n.name]))} tranPhanTram={dl.tran === null ? null : maTran.tranPhanTram} />
        <p className="mt-3 text-xs text-muted-foreground">
          Mức hiệu lực hôm nay, {coSoChon ? `tính cho giao dịch tại ${coSoChon.label}` : "tính cho giao dịch ở mọi nơi (chính sách riêng của một cơ sở chỉ hiện khi chọn cơ sở đó)"}. Chưa gồm mức riêng theo từng người hoặc đối tác.
        </p>
      </KhungModule>
    );
  }

  // ── Tất cả ────────────────────────────────────────────────────────────────
  if (xem === "tat-ca") {
    const tatCa = await docBangChinhSach(actor, now);
    // Chip cơ sở LỌC THẬT: chính sách của Hội sở (áp mọi cơ sở) + của đúng cơ sở đó.
    const theoCoSo = coSoId ? tatCa.filter((d) => d.chuSoHuuCenterId === null || d.chuSoHuuCenterId === coSoId) : tatCa;
    const loc = locChinhSach(theoCoSo, { trangThai, vai: vaiChon });
    const trang = kepTrang(docTrang(sp.trang), loc.length, KICH_THUOC);
    const dong = loc.slice((trang - 1) * KICH_THUOC, trang * KICH_THUOC);
    const hrefLoc = (q: Record<string, string | null>) => hrefVoi(BASE, { ...giuChe, xem: "tat-ca", trangthai: trangThai, vai: vaiChon, ...q });
    const coLoc = trangThai !== null || vaiChon !== null;
    return (
      <KhungModule {...khungProps} soHangCho={soHangCho}>
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <CheDoXemChinhSach basePath={BASE} dangXem="tat-ca" soCanXuLy={soHangCho["chinh-sach"] ?? null} giu={giuChe} />
          <nav aria-label="Lọc theo trạng thái" className="flex flex-wrap items-center gap-2">
            <Link href={hrefLoc({ trangthai: null })} aria-current={trangThai === null ? "page" : undefined} className={cn(CHIP, trangThai === null ? CHIP_ACTIVE : CHIP_IDLE)}>
              Mọi trạng thái
            </Link>
            {TRANG_THAI_LOC.map((t) => (
              <Link key={t} href={hrefLoc({ trangthai: t })} aria-current={trangThai === t ? "page" : undefined} className={cn(CHIP, trangThai === t ? CHIP_ACTIVE : CHIP_IDLE)}>
                {NHAN_TRANG_THAI[t]}
              </Link>
            ))}
          </nav>
          <BoLocVai basePath={BASE} giu={{ ...giuChe, xem: "tat-ca", trangthai: trangThai }} vai={boLoc.vai} dangChon={vaiChon} />
        </div>
        {chuaCauHinh}
        {loc.length === 0 ? (
          tatCa.length === 0 ? (
            <EmptyState
              title="Chưa có chính sách nào"
              description="Hoa hồng chỉ được tính theo chính sách có văn bản và đã kích hoạt. Chưa có chính sách thì kỳ này không sinh dòng nào."
              action={coTheSoan ? <NutTao /> : undefined}
            />
          ) : (
            <EmptyState
              title="Không có chính sách nào khớp bộ lọc"
              description={coSoChon && !coLoc ? `Cơ sở ${coSoChon.label} chưa có chính sách riêng, và Hội sở chưa có chính sách nào.` : "Bỏ bớt bộ lọc để xem thêm."}
              action={
                <Link href={hrefVoi(BASE, { ...giuChe, xem: "tat-ca" })} className="text-sm font-medium text-primary-ink hover:underline">
                  Bỏ bộ lọc
                </Link>
              }
            />
          )
        ) : (
          <>
            <BangChinhSach dong={dong} now={now} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Hiển thị{" "}
                <b className="tabular-nums text-foreground">
                  {(trang - 1) * KICH_THUOC + 1}–{Math.min(loc.length, trang * KICH_THUOC)}
                </b>{" "}
                / {loc.length} chính sách
                {loc.some((d) => d.tiLe.some((t) => t.khongTinDuoc)) && <span> · “+” = còn rule kiểu khác chưa cộng vào tỉ lệ</span>}
              </p>
              <DieuHuongTrangLink trang={trang} soTrang={Math.max(1, Math.ceil(loc.length / KICH_THUOC))} hrefCua={(t) => hrefLoc({ trang: t === 1 ? null : String(t) })} />
            </div>
          </>
        )}
      </KhungModule>
    );
  }

  // ── Mặc định: Cần xử lý ───────────────────────────────────────────────────
  const viec = await docHangChoChinhSach(actor, now);
  return (
    <KhungModule {...khungProps} soHangCho={{ ...soHangCho, "chinh-sach": viec.length }}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <CheDoXemChinhSach basePath={BASE} dangXem="can-xu-ly" soCanXuLy={viec.length} giu={giuChe} />
      </div>
      {chuaCauHinh}
      {viec.length === 0 ? (
        <HangChoRong
          tieuDe="Không còn việc dang dở với chính sách"
          moTa="Mọi bản nháp đều đã có văn bản đủ ngày làm việc, không có chính sách nào sắp hiệu lực trong 7 ngày tới, và mọi vai đang bật đều đã có chính sách."
          hrefTiep={hrefVoi(BASE, { xem: "tat-ca" })}
          nhanTiep="Xem tất cả chính sách"
        />
      ) : (
        <HangChoChinhSachBang viec={viec} coTheSoan={coTheSoan} />
      )}
    </KhungModule>
  );
}
