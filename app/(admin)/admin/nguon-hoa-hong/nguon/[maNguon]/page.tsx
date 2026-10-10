// app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/page.tsx — CHI TIẾT MỘT NGUỒN (SPEC nguồn động §4 mục 4; 06 §5.1): trang đầy đủ (không Sheet), BẢY mục chia bằng tiêu đề +
// đường kẻ — KHÔNG thẻ lồng thẻ, KHÔNG biểu đồ:
//   Thông tin · Attribution · Đối tượng liên quan · Chính sách áp dụng · Tracking · Thống kê · Lịch sử.
//
// Trang chỉ LẤY dữ liệu (một lượt đọc song song — `docTrangChiTietNguon`, mỗi mục cô lập lỗi) rồi đưa props thuần cho các mục ở `components/admin/nguon-hoa-hong/chi-tiet-nguon/`.
// Không có Server Action ở đây: trang CHỈ ĐỌC. Liên kết «Sửa nguồn» và nút «Đổi trạng thái» chỉ vẽ khi người xem có ĐÚNG khoá mà `suaNguonAction` / `doiTrangThaiNguonAction` kiểm
// (`sources:manage`) — cờ module đã bật (`vaoTab("nguon")` 404 khi tắt). Biểu mẫu sửa nằm ở `nguon/[maNguon]/sua`; nút trạng thái là client component tự mang action của nó
// (cùng `NutDoiTrangThai` với bảng danh sách ⇒ cùng luật «đích mặc định không ngừng được → Vì sao cố định?»).
//
// Cách ly: mọi con số đếm lead qua `scopedDb` (QLCS CS1 không đếm lead CS2); tiền qua `phamViNguoiXem`; mã lạ ⇒ 404.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { BTN_OUTLINE } from "@/components/admin/nguon-hoa-hong/classes";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { MucDoiTuong } from "@/components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-doi-tuong";
import { MucChinhSach } from "@/components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-chinh-sach";
import { MucLichSu } from "@/components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-lich-su";
import { MucAttribution, MucThongTin } from "@/components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-thong-tin";
import { MucThongKe, MucTracking } from "@/components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-tracking-thong-ke";
import { hrefSuaNguon, nguonChoNutTrangThai, quyetDinhTaoChinhSach } from "@/components/admin/nguon-hoa-hong/chi-tiet-nguon/lien-ket-nguon";
import { NutDoiTrangThai } from "@/components/admin/nguon-hoa-hong/doi-trang-thai-nguon";
import { Separator } from "@/components/ui/separator";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docCoQuyenSuaTran } from "@/lib/hoa-hong/quyen-sua-tran";
import { docCanChupLaiCuaToi } from "@/lib/nguon/chup-lai-chu-nguon-doc";
import { duPhamViChupLai } from "@/lib/nguon/chup-lai-chu-nguon-luat";
import { MA_NGUON_KHONG_RO } from "@/lib/nguon/danh-muc-ghi-dau-vao";
import { docMaDichMacDinh } from "@/lib/nguon/doc-form-nguon";
import { TRAN_LICH_SU_NGUON, docTrangChiTietNguon } from "@/lib/nguon/doc-trang-chi-tiet";
import { coQuyenKichHoatChinhSach } from "@/lib/nguon/quyen-kich-hoat";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { giaiMaTrenUrl, hrefVoi, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { vaoTab } from "../../_lib/vao-tab";

export const metadata = { title: "Chi tiết nguồn | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Nhật ký: mặc định vài dòng mới nhất; `?lichSu=tat-ca` mở tới trần của hàm đọc. */
const LICH_SU_MAC_DINH = 10;

type Sp = { lichSu?: string | string[] };

export default async function ChiTietNguonPage({ params, searchParams }: { params: Promise<{ maNguon: string }>; searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("nguon");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/nguon"])) {
    return <ThieuQuyen tab="nguon" scope={scope} soHangCho={{}} />;
  }
  const [{ maNguon }, sp] = await Promise.all([params, searchParams]);
  // `%` đơn lẻ trên URL: decodeURIComponent trần ném URIError ⇒ trang lỗi 500 + một lỗi giả trong Sentry. Mã hỏng = mã lạ = 404.
  const ma = giaiMaTrenUrl(maNguon);
  if (ma === null) notFound();
  const now = new Date();
  const xemTatCa = motGiaTri(sp.lichSu) === "tat-ca";

  // MỘT cổng cho mọi thứ GHI trên trang (liên kết Sửa + nút Đổi trạng thái): cùng khoá mà các action kiểm ở đầu hàm.
  const coTheGhi = scope.has("sources:manage");
  const coTheChupLai = coTheGhi && scope.has("commission_policies:activate") && duPhamViChupLai(actor);
  const [trang, soHangCho, dichMacDinh, coQuyenKichHoat, chupLai, coQuyenSuaTran] = await Promise.all([
    docTrangChiTietNguon(actor, ma, { now, lichSuToiDa: xemTatCa ? TRAN_LICH_SU_NGUON : LICH_SU_MAC_DINH }),
    docSoHangChoTheoTab(actor, scope),
    // Mã đích mặc định chỉ để nút trạng thái nói «Vì sao cố định?»: người không có quyền ghi không thấy nút ⇒ không đọc.
    coTheGhi ? docMaDichMacDinh() : Promise.resolve<string[]>([]),
    // Nút trạng thái nói thật với nguồn đang dính tiền: cần biết người xem có `commission_policies:activate` không.
    // `.catch(() => false)`: hai câu hỏi QUYỀN này chạy `auth()` + `resolveActor` + tra grant; lỗi thoáng qua mà không bọc thì cả trang văng ra error.tsx,
    // trong khi mọi mục khác đã được cô lập lỗi. Fail-closed: lỗi ⇒ coi như KHÔNG có quyền (ẩn nút / liên kết), không bao giờ mở thêm.
    coTheGhi ? coQuyenKichHoatChinhSach().catch(() => false) : Promise.resolve(false),
    // «Chụp lại chủ nguồn cho lead cũ» (W3): CHỈ đọc/vẽ khi người xem có ĐỦ HAI khoá mà `chupLaiChuNguonAction` kiểm (thiếu một thì bấm cũng bị từ chối — lời hứa suông). Cùng lượt song song (không thêm
    // `await`); mục lỗi không kéo cả trang.
    coTheChupLai ? docCanChupLaiCuaToi(ma).catch(() => null) : Promise.resolve(null),
    // Liên kết «Nâng trần» của mục Chính sách: chỉ người có `settings:edit` (cùng hàm với trình soạn chính sách).
    docCoQuyenSuaTran().catch(() => false),
  ]);
  if (!trang) notFound();

  const nguon = trang.nguon.ok ? trang.nguon.du : null;
  const tenNguon = nguon?.name ?? (trang.chiTiet.ok ? trang.chiTiet.du.nguon.name : ma);
  const soNguon = trang.chiTiet.ok ? trang.chiTiet.du.nguon.documentNo : null;
  const goc = `/nguon-hoa-hong/nguon/${encodeURIComponent(ma)}`;
  const nutTrangThai = nguonChoNutTrangThai(trang.nguon);
  const chupLaiView =
    chupLai && chupLai.chu && (chupLai.tong > 0 || chupLai.giuChuCu > 0 || chupLai.khongChupDuoc !== null)
      ? {
          nguonId: chupLai.nguon.id,
          tenNguon: chupLai.nguon.name,
          chu: { employeeId: chupLai.chu.employeeId, ten: chupLai.chu.ten, maNv: chupLai.chu.maNv },
          tong: chupLai.tong,
          theoLyDo: chupLai.theoLyDo,
          giuChuCu: chupLai.giuChuCu,
          khongChupDuoc: chupLai.khongChupDuoc,
        }
      : null;

  const lienKetChinhSach = quyetDinhTaoChinhSach({
    tabChinhSachMoDuoc: scope.tabMoDuoc("chinh-sach"),
    coQuyenSoan: scope.has("commission_policies:manage"),
    trangThai: nguon?.status ?? null,
    laKhongRo: ma === MA_NGUON_KHONG_RO,
    code: ma,
  });

  return (
    <KhungModule
      tab="nguon"
      scope={scope}
      soHangCho={soHangCho}
      tieuDe={tenNguon}
      phuDe={soNguon !== null ? `Nguồn mặc định số ${soNguon}` : "Nguồn do hệ thống hoặc quản trị thêm"}
      actions={
        coTheGhi ? (
          <>
            <Link href={hrefSuaNguon(ma)} className={BTN_OUTLINE}>
              <Pencil aria-hidden className="h-4 w-4" />
              Sửa nguồn
            </Link>
            {nutTrangThai && <NutDoiTrangThai nguon={nutTrangThai} dichMacDinh={dichMacDinh} coQuyenKichHoat={coQuyenKichHoat} nowIso={now.toISOString()} className="h-9 px-4 font-semibold" />}
          </>
        ) : undefined
      }
    >
      <Link href="/nguon-hoa-hong/nguon?xem=tat-ca" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:underline">
        <ChevronLeft aria-hidden className="h-4 w-4" />
        Tất cả nguồn
      </Link>

      <div className="rounded-xl border border-border bg-card px-4 py-5 sm:px-6">
        <MucThongTin nguon={trang.nguon} tenDonVi={trang.tenDonVi} now={now} />
        <Separator />
        <MucAttribution nguon={trang.nguon} cuaSoMacDinh={trang.chiTiet.ok ? trang.chiTiet.du.cuaSoGhiCongNgay : null} />
        <Separator />
        <MucDoiTuong nguon={trang.nguon} nguoiGioiThieu={trang.nguoiGioiThieu} chiTiet={trang.chiTiet} chupLai={chupLaiView} />
        <Separator />
        <MucChinhSach chinhSach={trang.chinhSach} hoaHong={trang.hoaHong} engineBat={scope.co.engine} coQuyenSuaTran={coQuyenSuaTran} lienKet={lienKetChinhSach} />
        <Separator />
        <MucTracking
          chiTiet={trang.chiTiet}
          linkPageMapping={
            <Link href="/nguon-hoa-hong/nguon?xem=page-mapping" className="font-semibold text-foreground underline underline-offset-2 hover:no-underline">
              Xem bảng Page → nguồn
            </Link>
          }
        />
        <Separator />
        <MucThongKe chiTiet={trang.chiTiet} />
        <Separator />
        <MucLichSu
          lichSu={trang.lichSu}
          dangXemTatCa={xemTatCa}
          hrefXemTatCa={`${hrefVoi(goc, { lichSu: "tat-ca" })}#muc-lich-su`}
          hrefThuGon={`${goc}#muc-lich-su`}
        />
      </div>
    </KhungModule>
  );
}
