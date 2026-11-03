// Chứng từ NGÂN HÀNG cần kế toán bổ sung (P7-E, 06/11/2026) — nằm trong màn Hoá đơn điện tử, TÁCH khỏi hàng đợi hoá đơn.
//
// Vì sao tách: hàng chờ hoá đơn LOẠI khoản nguồn nhập lịch sử (`nguonGiaoDich` LICH_SU) — mà đó đúng là ca cần màn này nhất. Danh sách ở đây
// đọc thẳng bảng `ChungTuNganHang` (kế toán đánh dấu thủ công), KHÔNG dùng bộ lọc hàng chờ hoá đơn. Không phát hành / huỷ / thay hoá đơn và
// không xác nhận khoản thu ở đây. Cùng luật chọn cơ sở với bàn chứng từ: MỘT cơ sở làm việc.
// S5b: ô chọn cơ sở là của thanh phạm vi (layout) — trang này chỉ đọc `?coSo=`. O-1 (tab nào) CHƯA chốt: tạm là trang phụ của tab Hoá đơn.
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { EmptyState } from "@/components/admin/ui/states";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { napCoSoLocHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import { chonCoSoLamViec, docBoLoc } from "@/lib/finance/hoa-don/loc-hang-cho";
import { phamViKeToan } from "@/lib/finance/hoa-don/quyen";
import { khoHoaDonDaCauHinh } from "@/lib/finance/hoa-don/kho-tep";
import { TRANG_THAI_CHUNG_TU, type TrangThaiChungTu } from "@/lib/finance/hoa-don/chung-tu-ngan-hang";
import { docDanhSachChungTu } from "@/lib/finance/hoa-don/chung-tu-ngan-hang-db";
import { TieuDeMuc } from "../_components/tieu-de-muc";
import { BangChungTuNganHang } from "./_components/bang-chung-tu-ngan-hang";

export const metadata = { title: "Chứng từ ngân hàng | Admin" };
export const dynamic = "force-dynamic";

export default async function ChungTuNganHangPage({ searchParams }: { searchParams: Promise<{ coSo?: string; trangThai?: string }> }) {
  // Cờ TẮT = màn không tồn tại. Đặt TRƯỚC `auth()` để không dò được địa chỉ có thật.
  if (!(await laHoaDonBat())) notFound();
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fpayments%2Fhoa-don%2Fchung-tu-ngan-hang");
  if (!(await checkAnyPermission(PAGE_GATES["/payments/hoa-don/chung-tu-ngan-hang"]))) redirect("/dashboard?error=unauthorized");

  const [sp, actor, xemPii] = await Promise.all([searchParams, resolveActor(session.user.id), checkPermission("orders:view-pii")]);
  const cacCoSo = await napCoSoLocHoaDon(actor);
  // `?coSo=` chỉ nhận cơ sở trong phạm vi KẾ TOÁN của người xem (cùng `docBoLoc` với bàn chứng từ).
  const boLoc = docBoLoc({ coSo: sp.coSo, thang: null }, { phamViKeToan: phamViKeToan(actor), now: new Date() });
  const coSoId = chonCoSoLamViec(boLoc.coSo, cacCoSo);
  const coSo = cacCoSo.find((c) => c.id === coSoId) ?? null;
  const trangThai = (TRANG_THAI_CHUNG_TU as readonly string[]).includes(sp.trangThai ?? "") ? (sp.trangThai as TrangThaiChungTu) : null;
  const dong = coSo ? await docDanhSachChungTu(actor, { coSoId: coSo.id, xemPii }) : [];

  return (
    <div>
      <TieuDeMuc
        tieuDe="Chứng từ ngân hàng"
        moTa="Kế toán đánh dấu khoản thu cần sao kê / ủy nhiệm chi, tải tệp lên sau khi khoản đã tạo, rồi kiểm tra. Không xác nhận khoản thu, không đụng hoá đơn."
      />
      {coSo ? (
        <BangChungTuNganHang key={coSo.id} coSoId={coSo.id} tenCoSo={`${coSo.ma} · ${coSo.ten}`} dong={dong} locTrangThai={trangThai} khoOk={khoHoaDonDaCauHinh()} />
      ) : (
        <EmptyState
          title={cacCoSo.length > 0 ? "Chọn cơ sở để bắt đầu" : "Bạn chưa được giao cơ sở nào để làm hoá đơn"}
          description={
            cacCoSo.length > 0
              ? "Chứng từ được theo dõi theo từng cơ sở. Chọn cơ sở ở thanh phạm vi phía trên."
              : "Liên hệ quản trị để được cấp quyền kế toán tại cơ sở."
          }
        />
      )}
    </div>
  );
}
