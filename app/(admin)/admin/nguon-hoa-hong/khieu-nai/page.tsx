// app/(admin)/admin/nguon-hoa-hong/khieu-nai/page.tsx — tab "Khiếu nại & lịch sử" (PR11, 06 §5.5).
//
// Bốn tab con trên URL `?con=`: Khiếu nại (mặc định) · Đổi nguồn · Lịch sử chính sách · Nhật ký. MỖI TAB CON GÁC RIÊNG bằng key của nó (`tab-con-khieu-nai.ts`); tab cha chỉ là vỏ.
// Cờ `hoaHong.engineBat` TẮT ⇒ 404 (`vaoTab`). Quyền vào tab cha = `PAGE_GATES["/nguon-hoa-hong/khieu-nai"]`.
//
// ── Khiếu nại ────────────────────────────────────────────────────────────────────────────────────────────────
// Mở ra ở KHIẾU NẠI ĐANG MỞ (luận đề "Hàng chờ trước sổ") cho người DUYỆT; người chỉ GỬI khiếu nại mở ra ở "Tất cả" (kết quả của khiếu nại đã quyết mới là thứ họ cần đọc). Bộ lọc nằm
// TRÊN URL: `tt` (trạng thái) · `cua=toi` · `coSo` · `trang` · `mo` (khiếu nại đang mở trong Sheet). Phạm vi người xem do MỘT hàm quyết (`phamViKhieuNai`): của mình ở mọi cơ sở, ∪ cơ sở người
// duyệt quản. Chip cơ sở CHỈ có với người duyệt — người chỉ gửi khiếu nại đọc theo `raisedByUserId`, một chip cơ sở với họ là nút lọc không có nghĩa (06 §5.3).
//
// ── Ba tab con chỉ đọc ───────────────────────────────────────────────────────────────────────────────────────
// `AuditLog` theo kênh + phạm vi cơ sở (`nhat-ky-doc.ts`). Không có nút nào.
import Link from "next/link";

import { CHIP, CHIP_ACTIVE, CHIP_IDLE } from "@/components/admin/nguon-hoa-hong/classes";
import { HangChoRong } from "@/components/admin/nguon-hoa-hong/hang-cho-rong";
import { KhieuNaiSheet } from "@/components/admin/nguon-hoa-hong/khieu-nai-sheet";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { ScopeBar } from "@/components/admin/nguon-hoa-hong/scope-bar";
import { EmptyState, ErrorState, NoPermission } from "@/components/admin/ui/states";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docChiTietChoMan, docDanhSachChoMan } from "@/lib/hoa-hong/khieu-nai-man";
import type { ChiTietKhieuNai, KetQuaDanhSach, LocTrangThai } from "@/lib/hoa-hong/khieu-nai-doc";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { chonTabCon, HOI_AI_TAB_CON, KEY_TAB_CON, NHAN_TAB_CON, tabConUngVien, type TabCon } from "@/lib/nguon-hoa-hong/tab-con-khieu-nai";
import type { TabKey } from "@/lib/nguon-hoa-hong/tab";
import { docTrang, hrefVoi, kepTrang, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";

import { vaoTab } from "../_lib/vao-tab";
import { BangKhieuNai } from "./_components/bang-khieu-nai";
import { NhatKyPanel } from "./_components/nhat-ky-panel";
import { TabConNav } from "./_components/tab-con-nav";

export const metadata = { title: "Khiếu nại & lịch sử | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/nguon-hoa-hong/khieu-nai";
const KICH_THUOC = 25;

type Sp = { con?: string | string[]; tt?: string | string[]; cua?: string | string[]; coSo?: string | string[]; trang?: string | string[]; mo?: string | string[] };

const TT_URL: Record<string, LocTrangThai> = { "dang-mo": "DANG_MO", "da-quyet": "DA_QUYET", "tat-ca": "TAT_CA" };
const URL_TT: Record<LocTrangThai, string> = { DANG_MO: "dang-mo", DA_QUYET: "da-quyet", TAT_CA: "tat-ca" };
const NHAN_TT: Record<LocTrangThai, string> = { DANG_MO: "Đang mở", DA_QUYET: "Đã quyết", TAT_CA: "Tất cả" };

export default async function KhieuNaiPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("khieu-nai");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/khieu-nai"])) {
    return <ThieuQuyen tab="khieu-nai" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;
  const dauVao = { coQuyen: scope.any, coNguon: scope.co.nguon };
  const ungVien = tabConUngVien(dauVao);
  const con = chonTabCon(motGiaTri(sp.con), dauVao);
  const soHangCho = await docSoHangChoTheoTab(actor, scope);

  // Vào được tab cha (vd chỉ giữ `commission:view-center`) mà không mở được tab con nào: nói thẳng thiếu khoá nào, hỏi ai.
  if (con === null) {
    return (
      <KhungModule tab="khieu-nai" scope={scope} soHangCho={soHangCho}>
        <NoPermission permission={KEY_TAB_CON["khieu-nai"].join(" hoặc ")} what="khiếu nại hoa hồng" askWho={HOI_AI_TAB_CON["khieu-nai"]} />
      </KhungModule>
    );
  }

  const soCanXuLy = soHangCho["khieu-nai"] ?? null;
  // Chỉ MỘT tab con mở được (vd Sale/QLCS chỉ có "Khiếu nại") thì không vẽ công tắc: một ô duy nhất bật sẵn trông như chip lọc, bấm không đổi gì (luật 12).
  const dieuHuong = ungVien.length > 1 ? <TabConNav basePath={BASE} ungVien={ungVien} dangXem={con} soCanXuLy={soCanXuLy} /> : null;

  if (con !== "khieu-nai") {
    return (
      <KhungModule tab="khieu-nai" scope={scope} soHangCho={soHangCho} phuDe={`${NHAN_TAB_CON[con]} — chỉ đọc.`}>
        <div className="mb-4">{dieuHuong}</div>
        <NhatKyPanel actor={actor} kenh={con} base={BASE} giu={{ con }} trangTho={docTrang(sp.trang)} />
      </KhungModule>
    );
  }

  return <TabKhieuNai actor={actor} scope={scope} sp={sp} soHangCho={soHangCho} dieuHuong={dieuHuong} con={con} />;
}

async function TabKhieuNai({
  actor,
  scope,
  sp,
  soHangCho,
  dieuHuong,
  con,
}: {
  actor: Awaited<ReturnType<typeof vaoTab>>["actor"];
  scope: Awaited<ReturnType<typeof vaoTab>>["scope"];
  sp: Sp;
  soHangCho: Partial<Record<TabKey, number>>;
  dieuHuong: React.ReactNode;
  con: TabCon;
}) {
  const laNguoiDuyet = scope.has("commission_disputes:review");
  const laNguoiGui = scope.has("commission:view-self");
  const ttMacDinh: LocTrangThai = laNguoiDuyet ? "DANG_MO" : "TAT_CA";
  const tt = TT_URL[motGiaTri(sp.tt) ?? ""] ?? ttMacDinh;
  const chiCuaToi = laNguoiDuyet && laNguoiGui && motGiaTri(sp.cua) === "toi";
  const coSoChon = laNguoiDuyet ? scope.timCoSo(motGiaTri(sp.coSo), "CommissionTransaction") : null;
  const moId = motGiaTri(sp.mo);

  // Địa chỉ giữ NGUYÊN bộ lọc (trừ `mo` và `trang`) — đóng Sheet quay về đúng chỗ đang đứng.
  const giu = { con: con === "khieu-nai" ? null : con, tt: tt === ttMacDinh ? null : URL_TT[tt], cua: chiCuaToi ? "toi" : null, coSo: coSoChon?.id ?? null };
  const hrefLoc = (q: Record<string, string | null>) => hrefVoi(BASE, { ...giu, ...q });

  let ds: KetQuaDanhSach | null = null;
  let ct: ChiTietKhieuNai | null | undefined;
  let loiDoc = false;
  try {
    const now = new Date();
    const trangTho = docTrang(sp.trang);
    ds = await docDanhSachChoMan(actor, { trangThai: tt, centerId: coSoChon?.id, chiCuaToi, trang: trangTho, coTrang: KICH_THUOC }, now);
    ct = moId ? await docChiTietChoMan(actor, moId) : undefined;
  } catch (e) {
    console.error("[khieu-nai] đọc lỗi:", e);
    loiDoc = true;
  }

  const scopeBar = laNguoiDuyet ? (
    <ScopeBar basePath={BASE} coSo={scope.coSoCua("CommissionTransaction")} dangChon={coSoChon?.id ?? null} tatCaNhan="Mọi cơ sở" giu={{ con: giu.con, tt: giu.tt, cua: giu.cua }} />
  ) : undefined;

  const trang = ds ? kepTrang(docTrang(sp.trang), ds.tongSo, KICH_THUOC) : 1;

  return (
    <KhungModule tab="khieu-nai" scope={scope} soHangCho={soHangCho} scopeBar={scopeBar}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        {dieuHuong}
        <nav aria-label="Lọc theo trạng thái" className="flex flex-wrap items-center gap-2">
          {(Object.keys(NHAN_TT) as LocTrangThai[]).map((t) => (
            <Link key={t} href={hrefLoc({ tt: t === ttMacDinh ? null : URL_TT[t], trang: null })} aria-current={tt === t ? "page" : undefined} className={cn(CHIP, tt === t ? CHIP_ACTIVE : CHIP_IDLE)}>
              {NHAN_TT[t]}
              {t === "DANG_MO" && ds && <span className="tabular-nums">({soVN(ds.soDangMo)})</span>}
            </Link>
          ))}
          {laNguoiDuyet && laNguoiGui && (
            <Link href={hrefLoc({ cua: chiCuaToi ? null : "toi", trang: null })} aria-pressed={chiCuaToi} className={cn(CHIP, chiCuaToi ? CHIP_ACTIVE : CHIP_IDLE)}>
              Chỉ của tôi
            </Link>
          )}
        </nav>
      </div>

      {loiDoc || !ds ? (
        <ErrorState
          title="Không tải được khiếu nại"
          description="Có lỗi khi đọc khiếu nại từ máy chủ. Thử tải lại trang; nếu vẫn lỗi, báo bộ phận kỹ thuật."
          action={
            <Link href={hrefLoc({})} className="text-sm font-medium text-primary-ink underline focus-visible:ring-2 focus-visible:ring-ring">
              Tải lại
            </Link>
          }
        />
      ) : (
        <>
          {moId && ct === null && (
            <p role="status" className="mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Không mở được khiếu nại này: nó không tồn tại, hoặc không nằm trong phạm vi bạn được xem. Nếu bạn nghĩ mình phải thấy nó, hỏi HR Hội sở hoặc Quản trị hệ thống.
            </p>
          )}
          {ds.tongSo === 0 ? (
            tt === "DANG_MO" ? (
              <HangChoRong
                tieuDe={laNguoiDuyet ? "Không còn khiếu nại nào đang mở" : "Bạn chưa có khiếu nại nào đang mở"}
                moTa={
                  laNguoiDuyet
                    ? `${coSoChon ? `Trong ${coSoChon.label}, mọi` : "Mọi"} khiếu nại đã được nhận xử lý hoặc đã có kết quả.`
                    : "Khi thấy một dòng hoa hồng của mình sai, mở dòng đó ở Sổ hoa hồng và chọn khiếu nại."
                }
                hrefTiep={hrefLoc({ tt: "tat-ca", trang: null })}
                nhanTiep="Xem tất cả khiếu nại"
              />
            ) : (
              <EmptyState
                title="Chưa có khiếu nại nào"
                description={
                  laNguoiDuyet
                    ? `${coSoChon ? `${coSoChon.label} chưa` : "Chưa"} có khiếu nại nào${tt === "DA_QUYET" ? " đã quyết" : ""}${chiCuaToi ? " do bạn gửi" : ""}.`
                    : "Bạn chưa gửi khiếu nại nào. Khi thấy một dòng hoa hồng của mình sai, mở dòng đó ở Sổ hoa hồng và chọn khiếu nại."
                }
                action={
                  laNguoiDuyet ? undefined : (
                    <Link href="/nguon-hoa-hong/so" className="text-sm font-medium text-primary-ink underline focus-visible:ring-2 focus-visible:ring-ring">
                      Mở Sổ hoa hồng
                    </Link>
                  )
                }
              />
            )
          ) : (
            <>
              <BangKhieuNai dong={ds.dong} hrefMo={(id) => hrefLoc({ mo: id, trang: trang === 1 ? null : String(trang) })} hienNguoiKhieuNai={laNguoiDuyet} />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {soVN(ds.tongSo)} khiếu nại · {tt === "DANG_MO" ? "cũ nhất lên đầu" : "mới nhất lên đầu"}
                </span>
                <DieuHuongTrangLink trang={trang} soTrang={Math.max(1, Math.ceil(ds.tongSo / KICH_THUOC))} hrefCua={(t) => hrefLoc({ trang: t === 1 ? null : String(t) })} />
              </div>
            </>
          )}
          {ct && <KhieuNaiSheet ct={ct} dongHref={hrefLoc({ trang: trang === 1 ? null : String(trang) })} />}
        </>
      )}
    </KhungModule>
  );
}
