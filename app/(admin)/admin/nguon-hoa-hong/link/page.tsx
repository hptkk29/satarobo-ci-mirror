// app/(admin)/admin/nguon-hoa-hong/link/page.tsx — tab "Link / QR / Mã" (AFF-P1, docs/source-commission/12).
//
// Danh sách link / QR / mã giới thiệu đã phát (đối tác · campaign · website & đường dẫn · loại · trạng thái · lượt bấm) + phát mới · sao chép · QR · thu hồi · xoay mã.
// Bộ lọc nằm trên URL: `?trangthai=&campaign=&doitac=&trang=`; phân trang Ở TẦNG TRUY VẤN (25/trang), `?trang=` vượt biên bị kẹp rồi redirect về trang cuối.
//
// ── Quyền, cờ, PII ───────────────────────────────────────────────────────────────────────────────────────────
//  · Cổng tab: `PAGE_GATES` (`affiliates:view` hoặc `affiliate_links:manage`). Nút GHI (phát · sao chép · QR · thu hồi · xoay) vẽ bằng `scope.has("affiliate_links:manage")` ∧ cờ Affiliate — ĐÚNG hai
//    điều kiện mà các action ở `_actions.ts` kiểm ở đầu hàm (luật 12). Cờ đã gác ở `vaoTab` (cờ tắt ⇒ 404); action kiểm cờ lần nữa vì nó là endpoint POST độc lập.
//  · TOKEN đầy đủ chỉ rời tầng đọc khi `coTheGhi`: người chỉ xem nhận 4 ký tự đầu và không nhận địa chỉ `/r/…` hay `?aff=…` dựng sẵn (`docDanhSachLink` che từ gốc — payload RSC không mang bản thật).
//  · Không SĐT/email đối tác ở màn này.
//  · Ba câu truy vấn độc lập (hàng chờ của pill · danh sách · bộ lọc) và một câu tuỳ chọn «Phát link» chạy SONG SONG.
import Link from "next/link";
import { redirect } from "next/navigation";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { BangLink } from "@/components/admin/nguon-hoa-hong/link/bang-link";
import { BoLocLink } from "@/components/admin/nguon-hoa-hong/link/bo-loc-link";
import { NutPhatLink } from "@/components/admin/nguon-hoa-hong/link/phat-link-sheet";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { EmptyState } from "@/components/admin/ui/states";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { KICH_THUOC_TRANG_LINK, docDanhSachLink, docTuyChonLoc, docTuyChonPhatLink } from "@/lib/affiliate/doc-link";
import { LY_DO_THIEU_GOC, gocCongKhai } from "@/lib/affiliate/goc-cong-khai";
import { TRANG_THAI_LINK } from "@/lib/affiliate/ghi-link-dau-vao";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { docTrang, hrefVoi, kepTrang, motGiaTri } from "@/lib/nguon-hoa-hong/url";

import { vaoTab } from "../_lib/vao-tab";

export const metadata = { title: "Link / QR / Mã | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/nguon-hoa-hong/link";

type Sp = { trangthai?: string | string[]; campaign?: string | string[]; doitac?: string | string[]; trang?: string | string[] };

export default async function LinkPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("link");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/link"])) {
    return <ThieuQuyen tab="link" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;
  const trang = docTrang(sp.trang);
  // Bộ lọc đọc từ URL rồi CHUẨN HOÁ qua bảng (không nhận chuỗi thô vào truy vấn).
  const trangThai = TRANG_THAI_LINK.find((t) => t === motGiaTri(sp.trangthai)) ?? null;
  const campaignMa = motGiaTri(sp.campaign)?.slice(0, 40) ?? null;
  const doiTacMa = motGiaTri(sp.doitac)?.slice(0, 40) ?? null;
  // Quyền GHI = đúng hai điều kiện của Server Action: khoá `affiliate_links:manage` ∧ cờ Affiliate.
  const coTheGhi = scope.has("affiliate_links:manage") && scope.co.affiliate;
  // Gốc link ngắn `/r` + QR: do CẤU HÌNH của môi trường này quyết (không cứng một tên miền). null = chưa cấu hình ⇒ dòng nhắc bên dưới, không ẩn lặng lẽ.
  const gocLinkNgan = gocCongKhai(process.env);

  const [soHangCho, ds, tuyChonLoc, tuyChonPhat] = await Promise.all([
    docSoHangChoTheoTab(actor, scope),
    docDanhSachLink({ trang, kichThuoc: KICH_THUOC_TRANG_LINK, trangThai, campaignMa, doiTacMa, coTheXemDayDu: coTheGhi, gocLinkNgan, now: new Date() }),
    docTuyChonLoc(),
    // Quản trị (đã qua cổng `affiliate_links:manage`): mọi đối tác, cả trang tiền tố — khác cổng đối tác tự phục vụ (chỉ hồ sơ của mình, chỉ trang «đúng»).
    coTheGhi ? docTuyChonPhatLink(new Date(), { partyIds: null, chiTrangChinhXac: false }) : Promise.resolve(null),
  ]);
  const trangHopLe = kepTrang(trang, ds.tong, ds.kichThuoc);
  if (ds.tong > 0 && trangHopLe !== trang) redirect(hrefVoi(BASE, { trangthai: trangThai, campaign: campaignMa, doitac: doiTacMa, trang: trangHopLe }));
  const coLoc = trangThai !== null || campaignMa !== null || doiTacMa !== null;
  const tongToanBo = TRANG_THAI_LINK.reduce((s, t) => s + ds.theoTrangThai[t], 0);

  return (
    <KhungModule tab="link" scope={scope} soHangCho={soHangCho} actions={coTheGhi && tuyChonPhat ? <NutPhatLink tuyChon={tuyChonPhat} doiTacMaMacDinh={doiTacMa} /> : undefined}>
      {tongToanBo > 0 && <BoLocLink basePath={BASE} trangThai={trangThai} campaignMa={campaignMa} doiTacMa={doiTacMa} theoTrangThai={ds.theoTrangThai} tuyChon={tuyChonLoc} />}
      {ds.tong === 0 ? (
        coLoc ? (
          <EmptyState
            title="Không có link nào khớp bộ lọc"
            description={
              coTheGhi && doiTacMa !== null && trangThai === null && campaignMa === null
                ? "Đối tác này chưa có link nào. Bấm «Phát link» (đối tác được chọn sẵn) để tạo — hoặc bỏ bộ lọc để xem mọi link."
                : "Bỏ bớt bộ lọc hoặc chọn campaign / đối tác khác."
            }
            action={
              <Link href={BASE} className="rounded text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                Bỏ mọi bộ lọc
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Chưa có link nào"
            description={
              coTheGhi
                ? "Bấm «Phát link» để tạo link, QR hoặc mã giới thiệu cho một đối tác trong một campaign. Cần có đối tác đang hoạt động đã tham gia campaign đang chạy, và website đã gắn vào campaign đó."
                : "Chưa có link nào được phát. Nhờ người có quyền quản lý link giới thiệu phát giúp."
            }
          />
        )
      ) : (
        <>
          <BangLink dong={ds.dong} coTheGhi={coTheGhi} />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Hiển thị{" "}
              <b className="tabular-nums text-foreground">
                {soVN((ds.trang - 1) * ds.kichThuoc + 1)}–{soVN(Math.min(ds.tong, ds.trang * ds.kichThuoc))}
              </b>{" "}
              / {soVN(ds.tong)} link
            </p>
            <DieuHuongTrangLink
              trang={ds.trang}
              soTrang={Math.max(1, Math.ceil(ds.tong / ds.kichThuoc))}
              hrefCua={(t) => hrefVoi(BASE, { trangthai: trangThai, campaign: campaignMa, doitac: doiTacMa, trang: t })}
            />
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Mỗi link mang một mã ngẫu nhiên, không chứa tên hay số điện thoại. Thu hồi hoặc xoay mã có hiệu lực ngay; link đã thu hồi không bật lại được.
        {!coTheGhi && " Bạn chỉ có quyền xem: mã link hiển thị rút gọn."}
      </p>
      {gocLinkNgan === null && (
        <p role="status" data-thieu-goc-link-ngan className="mt-2 text-xs text-state-warning-ink">
          {LY_DO_THIEU_GOC}
        </p>
      )}
    </KhungModule>
  );
}
