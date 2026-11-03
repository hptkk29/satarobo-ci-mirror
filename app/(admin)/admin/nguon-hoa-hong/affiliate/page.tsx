// app/(admin)/admin/nguon-hoa-hong/affiliate/page.tsx — tab AFFILIATE (AFF-P0b, docs/source-commission/12): ĐỐI TÁC · LOẠI · NHÃN.
//
// Một route, ba chế độ trên URL (`?xem=` mặc định là đối tác; `loai`; `nhan`) — xem `_components/chuyen-xem.tsx`. Bộ lọc đối tác cũng nằm trên URL: `?trangthai=&loai=&q=&trang=`; phân trang Ở TẦNG TRUY VẤN
// (25/trang), `?trang=` vượt biên bị kẹp rồi redirect về trang cuối.
//
// ── Quyền, cờ, cách ly ───────────────────────────────────────────────────────────────────────────────────────
//  · Cổng tab: `affiliates:view` (`PAGE_GATES`). Nút GHI (tạo · sửa · đổi trạng thái · loại · nhãn) vẽ bằng `scope.has("affiliates:manage")` — đúng khoá mà các action ở `_actions.ts` kiểm ở đầu hàm (luật 12).
//    Cờ `affiliate.enabled` đã gác ở `vaoTab` (cờ tắt ⇒ 404); action kiểm cờ lần nữa vì nó là endpoint POST độc lập.
//  · `Affiliate` là danh mục dùng chung — cách ly nằm ở cổng quyền. SỐ LEAD đếm qua `scopedDb(actor).lead` (cơ sở nào thấy lead cơ sở đó) — `phamViLead` cho bảng biết có cần chú thích «con số bị cắt».
//  · PII: SĐT/email/ghi chú chỉ người có `affiliates:manage` thấy bản thật; người chỉ xem nhận bản đã che TỪ TẦNG ĐỌC (`coTheXemLienHe`), và không tìm được theo SĐT/email.
//  · Pill hàng chờ của tab Affiliate trên ModuleNav chưa nối: `docSoHangChoTheoTab` (lib/nguon-hoa-hong/hang-cho.ts) cần gọi `demDoiTacChoDuyet()` cho người có `affiliates:manage` — không tự đếm lại ở đây (luật 12b).
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { DoiTacSheet } from "@/components/admin/nguon-hoa-hong/affiliate/doi-tac-sheet";
import { LoaiSheet, NhanSheet } from "@/components/admin/nguon-hoa-hong/affiliate/loai-nhan-sheet";
import { BTN_PRIMARY } from "@/components/admin/nguon-hoa-hong/classes";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { EmptyState } from "@/components/admin/ui/states";
import {
  KICH_THUOC_TRANG_AFFILIATE,
  demDoiTacChoDuyet,
  docCacLoaiChoLoc,
  docDanhSachDoiTac,
  docDanhSachLoai,
  docDanhSachNhan,
  docNguonChoLoai,
  docTuyChonDoiTac,
} from "@/lib/affiliate/doc-doi-tac";
import { docLinkDangDungTheoDoiTac } from "@/lib/affiliate/doc-link";
import { TRANG_THAI_DOI_TAC } from "@/lib/affiliate/ghi-doi-tac-dau-vao";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { docTrang, hrefVoi, kepTrang, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { vaoTab } from "../_lib/vao-tab";
import { BangDoiTac } from "./_components/bang-doi-tac";
import { BangLoai } from "./_components/bang-loai";
import { BangNhan } from "./_components/bang-nhan";
import { BoLocDoiTac } from "./_components/bo-loc-doi-tac";
import { ChuyenXem, docCheDoXemAffiliate } from "./_components/chuyen-xem";

export const metadata = { title: "Affiliate | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/nguon-hoa-hong/affiliate";

type Sp = { xem?: string | string[]; trangthai?: string | string[]; loai?: string | string[]; q?: string | string[]; trang?: string | string[]; dangung?: string | string[] };

export default async function AffiliatePage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("affiliate");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/affiliate"])) {
    return <ThieuQuyen tab="affiliate" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;
  const xem = docCheDoXemAffiliate(motGiaTri(sp.xem));
  const trang = docTrang(sp.trang);
  // Quyền GHI = `affiliates:manage` — ĐÚNG khoá mà mọi action ở `_actions.ts` kiểm (luật 12: nút chỉ vẽ khi máy chủ sẽ nhận). Cờ module đã bật (vaoTab 404 khi tắt).
  const coTheGhi = scope.has("affiliates:manage");
  // Nút «Link» của đối tác: URL cuối mang token ⇒ chỉ người có `affiliate_links:manage` (đúng khoá mà tab Link / QR / Mã dùng để vẽ nút phát link). Che ở tầng đọc.
  const coTheLink = scope.has("affiliate_links:manage");

  // ── Chế độ LOẠI ───────────────────────────────────────────────────────────────────────────────────
  if (xem === "loai") {
    // Mặc định ẨN loại đã ngừng (PROD không hiện dữ liệu đã đóng); `?dangung=1` hiện cả loại đã ngừng.
    const hienDaNgung = motGiaTri(sp.dangung) === "1";
    const [soHangCho, choDuyet, ds, nguon] = await Promise.all([
      docSoHangChoTheoTab(actor, scope),
      demDoiTacChoDuyet(),
      docDanhSachLoai({ trang, kichThuoc: KICH_THUOC_TRANG_AFFILIATE, hienDaNgung }),
      coTheGhi ? docNguonChoLoai() : Promise.resolve([]),
    ]);
    const trangHopLe = kepTrang(trang, ds.tong, ds.kichThuoc);
    if (ds.tong > 0 && trangHopLe !== trang) redirect(hrefVoi(BASE, { xem: "loai", trang: trangHopLe, dangung: hienDaNgung ? "1" : null }));
    return (
      <KhungModule
        tab="affiliate"
        scope={scope}
        soHangCho={soHangCho}
        actions={
          coTheGhi ? (
            <LoaiSheet nguon={nguon} triggerClassName={BTN_PRIMARY}>
              <Plus aria-hidden className="h-4 w-4" />
              Tạo loại
            </LoaiSheet>
          ) : undefined
        }
      >
        <div className="mb-4">
          <ChuyenXem basePath={BASE} dangXem="loai" soChoDuyet={choDuyet} />
        </div>
        {(ds.soDaNgung > 0 || hienDaNgung) && (
          <p className="mb-3 text-sm text-muted-foreground">
            {hienDaNgung ? (
              <Link href={hrefVoi(BASE, { xem: "loai" })} className="font-medium text-primary-ink hover:underline">
                Ẩn loại đã ngừng
              </Link>
            ) : (
              <Link href={hrefVoi(BASE, { xem: "loai", dangung: "1" })} className="font-medium text-primary-ink hover:underline">
                Hiện cả loại đã ngừng ({ds.soDaNgung})
              </Link>
            )}
          </p>
        )}
        {ds.tong === 0 ? (
          <EmptyState
            title={ds.soDaNgung > 0 ? "Không còn loại đối tác nào đang dùng" : "Chưa có loại đối tác nào"}
            description={
              coTheGhi
                ? "Loại quyết định đối tác mới cần duyệt hay không và nguồn mặc định của khách họ giới thiệu. Tạo loại đầu tiên (ví dụ Phụ huynh, Nhân viên, Trường học) — danh mục do bạn định nghĩa, không cần sửa mã."
                : "Chưa có loại nào. Nhờ người có quyền quản lý Affiliate tạo giúp."
            }
          />
        ) : (
          <BangLoai
            dong={ds.dong}
            tong={ds.tong}
            trang={ds.trang}
            kichThuoc={ds.kichThuoc}
            hrefTrang={(t) => hrefVoi(BASE, { xem: "loai", trang: t, dangung: hienDaNgung ? "1" : null })}
            coTheGhi={coTheGhi}
            nguon={nguon}
          />
        )}
      </KhungModule>
    );
  }

  // ── Chế độ NHÃN ───────────────────────────────────────────────────────────────────────────────────
  if (xem === "nhan") {
    const [soHangCho, choDuyet, ds] = await Promise.all([
      docSoHangChoTheoTab(actor, scope),
      demDoiTacChoDuyet(),
      docDanhSachNhan({ trang, kichThuoc: KICH_THUOC_TRANG_AFFILIATE }),
    ]);
    const trangHopLe = kepTrang(trang, ds.tong, ds.kichThuoc);
    if (ds.tong > 0 && trangHopLe !== trang) redirect(hrefVoi(BASE, { xem: "nhan", trang: trangHopLe }));
    return (
      <KhungModule
        tab="affiliate"
        scope={scope}
        soHangCho={soHangCho}
        actions={
          coTheGhi ? (
            <NhanSheet triggerClassName={BTN_PRIMARY}>
              <Plus aria-hidden className="h-4 w-4" />
              Tạo nhãn
            </NhanSheet>
          ) : undefined
        }
      >
        <div className="mb-4">
          <ChuyenXem basePath={BASE} dangXem="nhan" soChoDuyet={choDuyet} />
        </div>
        {ds.tong === 0 ? (
          <EmptyState
            title="Chưa có nhãn nào"
            description={
              coTheGhi
                ? "Nhãn gắn vào đối tác để phân nhóm (ví dụ Giáo viên, Sale, KOL); một đối tác có nhiều nhãn. Nhãn là tuỳ chọn — tạo khi cần."
                : "Chưa có nhãn nào. Nhờ người có quyền quản lý Affiliate tạo giúp."
            }
          />
        ) : (
          <BangNhan dong={ds.dong} tong={ds.tong} trang={ds.trang} kichThuoc={ds.kichThuoc} hrefTrang={(t) => hrefVoi(BASE, { xem: "nhan", trang: t })} coTheGhi={coTheGhi} />
        )}
      </KhungModule>
    );
  }

  // ── Chế độ ĐỐI TÁC (mặc định) ──────────────────────────────────────────────────────────────────────
  // Bộ lọc đọc từ URL rồi CHUẨN HOÁ qua bảng (không nhận chuỗi thô vào truy vấn).
  const trangThai = TRANG_THAI_DOI_TAC.find((t) => t === motGiaTri(sp.trangthai)) ?? null;
  const loaiMa = motGiaTri(sp.loai);
  const tuKhoa = motGiaTri(sp.q)?.slice(0, 60) ?? null;
  const [soHangCho, choDuyet, cacLoai, ds, tuyChon] = await Promise.all([
    docSoHangChoTheoTab(actor, scope),
    demDoiTacChoDuyet(),
    docCacLoaiChoLoc(),
    docDanhSachDoiTac(actor, { trang, kichThuoc: KICH_THUOC_TRANG_AFFILIATE, trangThai, loaiMa, tuKhoa, coTheXemLienHe: coTheGhi }),
    coTheGhi ? docTuyChonDoiTac(actor) : Promise.resolve(null),
  ]);
  const trangHopLe = kepTrang(trang, ds.tong, ds.kichThuoc);
  if (ds.tong > 0 && trangHopLe !== trang) redirect(hrefVoi(BASE, { trangthai: trangThai, loai: loaiMa, q: tuKhoa, trang: trangHopLe }));
  // Một câu cho cả trang (không N+1); không có quyền ⇒ Map rỗng và KHÔNG chạy truy vấn nào.
  const linkDangDung = Object.fromEntries(await docLinkDangDungTheoDoiTac(ds.dong.map((d) => d.id), { coTheXemDayDu: coTheLink, now: new Date() }));
  const coLoc = trangThai !== null || loaiMa !== null || tuKhoa !== null;
  const tongToanBo = TRANG_THAI_DOI_TAC.reduce((s, t) => s + ds.theoTrangThai[t], 0);

  return (
    <KhungModule
      tab="affiliate"
      scope={scope}
      soHangCho={soHangCho}
      actions={
        coTheGhi && tuyChon ? (
          <DoiTacSheet tuyChon={tuyChon} coTheTaoLink={coTheLink} triggerClassName={BTN_PRIMARY}>
            <Plus aria-hidden className="h-4 w-4" />
            Tạo đối tác
          </DoiTacSheet>
        ) : undefined
      }
    >
      <div className="mb-4">
        <ChuyenXem basePath={BASE} dangXem="doi-tac" soChoDuyet={choDuyet} />
      </div>
      {tongToanBo > 0 && (
        <BoLocDoiTac basePath={BASE} trangThai={trangThai} loaiMa={loaiMa} tuKhoa={tuKhoa} theoTrangThai={ds.theoTrangThai} cacLoai={cacLoai} coTheXemLienHe={coTheGhi} />
      )}
      {ds.tong === 0 ? (
        coLoc ? (
          <EmptyState
            title="Không có đối tác nào khớp bộ lọc"
            description="Bỏ bớt bộ lọc hoặc đổi từ khoá tìm kiếm."
            action={
              <Link href={BASE} className="rounded text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                Bỏ mọi bộ lọc
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Chưa có đối tác nào"
            description={
              coTheGhi
                ? "Đối tác là người hoặc tổ chức giới thiệu khách cho Sata Robo (phụ huynh, nhân viên, trường học, KOL…). Cần có ít nhất một loại đối tác trước khi tạo — xem mục Loại đối tác."
                : "Chưa có đối tác nào. Nhờ người có quyền quản lý Affiliate tạo giúp."
            }
          />
        )
      ) : (
        <BangDoiTac
          dong={ds.dong}
          tong={ds.tong}
          trang={ds.trang}
          kichThuoc={ds.kichThuoc}
          hrefTrang={(t) => hrefVoi(BASE, { trangthai: trangThai, loai: loaiMa, q: tuKhoa, trang: t })}
          phamViLead={ds.phamViLead}
          coTheGhi={coTheGhi}
          coTheLink={coTheLink}
          linkDangDung={linkDangDung}
          tuyChon={tuyChon}
        />
      )}
    </KhungModule>
  );
}
