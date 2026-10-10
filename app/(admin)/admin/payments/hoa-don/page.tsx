// Hoá đơn điện tử — "Bàn chứng từ" của kế toán (docs/ke-toan-hoa-don/PLAN.md §4 + §10).
//
// Mỗi dòng là MỘT LẦN THU (gom bằng `gomLanThu`), đi qua: tải phiếu thu chờ → làm hoá đơn ở MISA →
// tải tệp lên → xác nhận. Danh sách + ngăn xử lý đứng CẠNH nhau (≥ xl); dưới xl ngăn là Sheet.
//
// ⚠️ Chọn dòng bằng `?chon=<khoá lần thu>` — khoá BẤT BIẾN qua mọi ngăn (dòng đổi ngăn khi tải tệp
// lên, không đổi khoá), nên ngăn xử lý giữ đúng dòng sau `router.refresh()`.
// ⚠️ Mọi quyết định "dòng vào ngăn nào, nút nào sáng, che gì" nằm ở `lib/finance/hoa-don/*` (thuần,
// có test). Trang này chỉ gác cửa, nạp, chia ngăn.
// ⚠️ Bộ lọc `?coSo=` + `?thang=` (PLAN §10) lọc ở CÂU TRA (`loc-hang-cho.ts`): ngăn "Đã xuất" / "Không
// xuất" theo tháng (mặc định tháng hiện tại, giờ VN); ngăn việc tồn không lọc tháng. `?coSo=` chỉ nhận
// cơ sở trong phạm vi KẾ TOÁN của người xem.
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { PageHeader } from "@/components/admin/ui/page-header";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { napCoSoLocHoaDon, napHangChoHoaDon, thangCuaHoaDonTrongTamNhin } from "@/lib/finance/hoa-don/hang-cho";
import { cacThangChon, docBoLoc, locUrlTu, thangVN } from "@/lib/finance/hoa-don/loc-hang-cho";
import { phamViKeToan } from "@/lib/finance/hoa-don/quyen";
import { gopTuKhoa } from "@/lib/finance/hoa-don/lan-thu";
import { chonNgan, demTheoNgan, sapXepTrongNgan } from "@/lib/finance/hoa-don/ngan-hang-cho";
import { BanChungTu } from "./_components/ban-chung-tu";

export const metadata = { title: "Hoá đơn điện tử | Admin" };
export const dynamic = "force-dynamic";

export default async function HoaDonPage({
  searchParams,
}: {
  searchParams: Promise<{ ngan?: string; chon?: string; hoaDon?: string; coSo?: string; thang?: string }>;
}) {
  // Cờ TẮT = màn không tồn tại. Đặt TRƯỚC `auth()` để không dò được địa chỉ có thật.
  if (!(await laHoaDonBat())) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fpayments%2Fhoa-don");
  if (!(await checkAnyPermission(PAGE_GATES["/payments/hoa-don"]))) {
    redirect("/dashboard?error=unauthorized");
  }

  const [sp, actor, canViewPii] = await Promise.all([
    searchParams,
    resolveActor(session.user.id),
    checkPermission("orders:view-pii"),
  ]);
  const now = new Date();
  const thangMacDinh = thangVN(now);
  // `?hoaDon=` (đường dẫn trong thông báo) không mang tháng: mở theo tháng của CHÍNH hoá đơn đó, không
  // thì hoá đơn tháng trước "không còn trong danh sách". Chỉ tốn thêm một câu ở đúng đường này.
  const thangTuHoaDon =
    sp.hoaDon && !sp.thang && !sp.chon ? await thangCuaHoaDonTrongTamNhin(actor, sp.hoaDon) : null;
  const boLoc = docBoLoc(
    { coSo: sp.coSo, thang: sp.thang ?? thangTuHoaDon },
    { phamViKeToan: phamViKeToan(actor), now },
  );
  const [{ dong, thieuCoSo, khoOk }, cacCoSo] = await Promise.all([
    // Q2 — dòng đang chọn là dòng GỘP (`?chon=gop:…`) ⇒ hàng chờ dựng với đúng tập gộp đó.
    napHangChoHoaDon(actor, { canViewPii, boLoc, gop: sp.chon ? gopTuKhoa(sp.chon) : [] }),
    napCoSoLocHoaDon(actor),
  ]);

  // `?hoaDon=<id>` — đường dẫn trong thông báo "email hoá đơn không tới được" (GĐ 8): thông báo không
  // biết khoá lần thu, chỉ biết hoá đơn. `?chon=` (khoá lần thu) vẫn thắng khi có cả hai.
  const dangChon = sp.chon
    ? (dong.find((d) => d.key === sp.chon) ?? null)
    : sp.hoaDon
      ? (dong.find((d) => d.hoaDon?.id === sp.hoaDon) ?? null)
      : null;
  const ngan = chonNgan({ tuUrl: sp.ngan, dongDangChon: dangChon });

  return (
    <div>
      <PageHeader
        title="Hoá đơn điện tử"
        subtitle="Mỗi dòng là một lần thu tiền: tải phiếu thu, làm hoá đơn ở MISA, rồi tải tệp hoá đơn lên đây."
      />
      <BanChungTu
        ngan={ngan}
        dem={demTheoNgan(dong)}
        dongTrongNgan={sapXepTrongNgan(ngan, dong)}
        dangChon={dangChon}
        chonKhongThay={Boolean(sp.chon ?? sp.hoaDon) && !dangChon}
        thieuCoSo={thieuCoSo}
        khoOk={khoOk}
        loc={{
          url: locUrlTu(boLoc, thangMacDinh),
          coSo: boLoc.coSo,
          thang: boLoc.thang,
          thangMacDinh,
          cacCoSo,
          cacThang: cacThangChon(thangMacDinh, boLoc.thang),
        }}
      />
    </div>
  );
}
