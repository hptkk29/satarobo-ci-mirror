// app/(admin)/admin/nguon-hoa-hong/referral/page.tsx — tab REFERRAL (AFF-P1, docs/source-commission/12 §2.4–§2.6): mỗi lượt khách đến qua link/QR/mã giới thiệu đã được xử lý ra sao,
// và nhất là hàng đợi «Cần xem tay». Xử lý (duyệt · từ chối · tranh chấp · xin bằng chứng) làm ở TRANG CHI TIẾT; nút «Khai tay referral» ở đây (AFF-L3b) — cả hai chỉ vẽ khi người xem có `affiliate_referrals:manage`.
//
// Mở ra ở DANH SÁCH (bảng dày, phân trang phía server, lọc trạng thái trên URL). Mỗi dòng mở `referral/[id]`.
//   · xem: `affiliate_referrals:view-org` hoặc `:manage` (PAGE_GATES). Cờ `affiliate.enabled` ∧ `nguon.enabled` tắt ⇒ `vaoTab` 404 (đứng TRƯỚC câu hỏi quyền).
//   · Cách ly cơ sở: đọc qua `scopedDb(actor)` (xem `lib/affiliate/doc-referral.ts`). Người cấp cơ sở KHÔNG thấy referral chưa quy được cơ sở — màn nói điều đó bằng một dòng chú thích.
//   · PII: KHÔNG hiện tên/SĐT/email của khách. Cột «Phiếu khách» chỉ là liên kết sang màn khách sẵn có (màn đó tự gác quyền và cơ sở) hoặc, khi người xem không mở được, mã rút gọn.
import Link from "next/link";
import { redirect } from "next/navigation";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { CHIP, CHIP_ACTIVE, CHIP_IDLE } from "@/components/admin/nguon-hoa-hong/classes";
import { EmptyState } from "@/components/admin/ui/states";
import { KICH_THUOC_TRANG_REFERRAL, docDanhSachReferral } from "@/lib/affiliate/doc-referral";
import { NHAN_TRANG_THAI_REFERRAL, TRANG_THAI_REFERRAL, tongCacTrangThai } from "@/lib/affiliate/ghi-referral-dau-vao";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { docTrang, hrefVoi, kepTrang, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";
import { vaoTab } from "../_lib/vao-tab";
import { BangReferral } from "./_components/bang-referral";
import { KhaiTaySheet } from "@/components/admin/nguon-hoa-hong/referral/khai-tay-sheet";
import { docLuaChonKhaiTay } from "@/lib/affiliate/doc-xu-ly-referral";

export const metadata = { title: "Referral | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/nguon-hoa-hong/referral";

type Sp = { trangthai?: string | string[]; trang?: string | string[] };

export default async function ReferralPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("referral");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/referral"])) {
    return <ThieuQuyen tab="referral" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;
  // Bộ lọc nhận giá trị ĐÃ CHUẨN HOÁ qua bảng trạng thái — không nhận chuỗi URL thô vào truy vấn.
  const trangThai = TRANG_THAI_REFERRAL.find((t) => t === motGiaTri(sp.trangthai)) ?? null;
  const trang = docTrang(sp.trang);

  // Mở được phiếu khách ⇔ hai khoá của trang `/leads/[id]` (cùng cặp khoá mà tab Nguồn dùng). Quyền xem referral KHÔNG kéo theo quyền xem khách.
  const coTheMoLead = await checkAnyPermission(["leads:view-all", "leads:view-own"]);
  // Nút «Khai tay» và danh sách lựa chọn của nó CHỈ khi có `affiliate_referrals:manage` — đúng khoá `khaiTayReferralAction` kiểm.
  const coQuyenXuLy = scope.has("affiliate_referrals:manage");
  const [danhSach, soHangCho, luaChon] = await Promise.all([
    docDanhSachReferral(actor, { trang, kichThuoc: KICH_THUOC_TRANG_REFERRAL, trangThai, coTheMoLead }),
    docSoHangChoTheoTab(actor, scope),
    coQuyenXuLy ? docLuaChonKhaiTay() : Promise.resolve([]),
  ]);

  // Danh sách co lại khi lọc: F5 / bookmark ở trang cuối rơi quá biên là chuyện thật. Về trang cuối thay vì vẽ bảng rỗng kèm «Hiển thị 26–10 / 10».
  const trangHopLe = kepTrang(trang, danhSach.tong, danhSach.kichThuoc);
  if (danhSach.tong > 0 && trangHopLe !== trang) redirect(hrefVoi(BASE, { trangthai: trangThai, trang: trangHopLe }));

  const tatCa = tongCacTrangThai(danhSach.theoTrangThai);
  const giamTam = danhSach.phamVi === "GIOI_HAN";

  return (
    <KhungModule tab="referral" scope={scope} soHangCho={soHangCho} actions={coQuyenXuLy ? <KhaiTaySheet luaChon={luaChon} /> : undefined}>
      <p className="mb-4 text-sm text-muted-foreground">
        {coQuyenXuLy ? "Mở một lượt để duyệt, từ chối hoặc xin thêm bằng chứng. Lượt «Cần xem tay» là việc đang chờ bạn." : "Bạn xem được các lượt giới thiệu; xử lý lượt cần xem tay do người có quyền xử lý referral làm."}
      </p>

      <nav aria-label="Lọc theo trạng thái referral" className="mb-4 flex w-full items-center gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>a]:shrink-0 [&>a]:whitespace-nowrap">
        <Link href={BASE} aria-current={trangThai === null ? "page" : undefined} className={cn(CHIP, trangThai === null ? CHIP_ACTIVE : CHIP_IDLE)}>
          Tất cả ({tatCa})
        </Link>
        {TRANG_THAI_REFERRAL.map((t) => (
          <Link key={t} href={hrefVoi(BASE, { trangthai: t })} aria-current={trangThai === t ? "page" : undefined} className={cn(CHIP, trangThai === t ? CHIP_ACTIVE : CHIP_IDLE)}>
            {NHAN_TRANG_THAI_REFERRAL[t]} ({danhSach.theoTrangThai[t]})
          </Link>
        ))}
      </nav>

      {danhSach.dong.length === 0 ? (
        trangThai ? (
          <EmptyState
            title={`Không có lượt nào “${NHAN_TRANG_THAI_REFERRAL[trangThai]}”`}
            description={trangThai === "MANUAL_REVIEW" ? "Hiện không có lượt nào đang chờ xem tay." : "Bỏ bộ lọc trạng thái để xem toàn bộ các lượt."}
            action={
              <Link href={BASE} className="text-sm font-medium text-primary-ink hover:underline">
                Bỏ bộ lọc
              </Link>
            }
          />
        ) : (
          <EmptyState title="Chưa có lượt giới thiệu nào" description="Khi khách gửi biểu mẫu qua link, QR hoặc mã giới thiệu của đối tác, mỗi lượt sẽ hiện ở đây kèm kết quả xử lý." />
        )
      ) : (
        <BangReferral dong={danhSach.dong} tong={danhSach.tong} trang={danhSach.trang} kichThuoc={danhSach.kichThuoc} hrefTrang={(t) => hrefVoi(BASE, { trangthai: trangThai, trang: t })} />
      )}

      {giamTam && (
        <p className="mt-4 text-xs text-muted-foreground">
          Bạn đang xem các lượt thuộc cơ sở của mình. Lượt chưa quy được về cơ sở nào chỉ hiện ở cấp Hội sở, nên các con số ở đây có thể ít hơn tổng toàn hệ thống.
        </p>
      )}
    </KhungModule>
  );
}
