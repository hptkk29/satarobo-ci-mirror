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
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { PageHeader } from "@/components/admin/ui/page-header";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { napCoSoLocHoaDon, napHangChoHoaDon, thangCuaHoaDonTrongTamNhin } from "@/lib/finance/hoa-don/hang-cho";
import { cacThangChon, chonCoSoLamViec, docBoLoc, locUrlTu, thangVN } from "@/lib/finance/hoa-don/loc-hang-cho";
import { khoHoaDonDaCauHinh } from "@/lib/finance/hoa-don/kho-tep";
import { phamViKeToan } from "@/lib/finance/hoa-don/quyen";
import { gopTuKhoa } from "@/lib/finance/hoa-don/lan-thu";
import { oSoDienSan } from "@/lib/finance/hoa-don/o-so-hoa-don";
import { goiYSoChoLanThu, type GoiYBanDau } from "@/lib/finance/hoa-don/goi-y-so-db";
import { chonNgan, demTheoNgan, docHuongSapXep, sapXepTrongNgan } from "@/lib/finance/hoa-don/ngan-hang-cho";
import { BanChungTu } from "./_components/ban-chung-tu";

export const metadata = { title: "Hoá đơn điện tử | Admin" };
export const dynamic = "force-dynamic";

export default async function HoaDonPage({
  searchParams,
}: {
  searchParams: Promise<{ ngan?: string; chon?: string; hoaDon?: string; coSo?: string; thang?: string; sapXep?: string }>;
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
  const tuHoaDon = sp.hoaDon && !sp.chon ? await thangCuaHoaDonTrongTamNhin(actor, sp.hoaDon) : null;
  const thangTuHoaDon = sp.thang ? null : (tuHoaDon?.thang ?? null);
  // Hoá đơn luôn làm trong MỘT cơ sở (23/10/2026): không có chế độ "Tất cả cơ sở". Một cơ sở ⇒ tự chọn;
  // nhiều cơ sở (kế toán Hội sở / kiêm nhiều cơ sở) ⇒ CHƯA CHỌN thì không nạp danh sách gì.
  const cacCoSo = await napCoSoLocHoaDon(actor);
  const boLocTho = docBoLoc(
    { coSo: sp.coSo ?? tuHoaDon?.coSoId, thang: sp.thang ?? thangTuHoaDon },
    { phamViKeToan: phamViKeToan(actor), now },
  );
  const coSoLamViec = chonCoSoLamViec(boLocTho.coSo, cacCoSo);
  const boLoc = { ...boLocTho, coSo: coSoLamViec };
  const chuaChonCoSo = coSoLamViec === null;
  const huongSapXep = docHuongSapXep(sp.sapXep);
  // Q2 — dòng đang chọn là dòng GỘP (`?chon=gop:…`) ⇒ hàng chờ dựng với đúng tập gộp đó.
  const { dong, thieuCoSo, khoOk } = chuaChonCoSo
    ? { dong: [], thieuCoSo: 0, khoOk: khoHoaDonDaCauHinh() }
    : await napHangChoHoaDon(actor, { canViewPii, boLoc, gop: sp.chon ? gopTuKhoa(sp.chon) : [] });

  // `?hoaDon=<id>` — đường dẫn trong thông báo "email hoá đơn không tới được" (GĐ 8): thông báo không
  // biết khoá lần thu, chỉ biết hoá đơn. `?chon=` (khoá lần thu) vẫn thắng khi có cả hai.
  const dangChon = sp.chon
    ? (dong.find((d) => d.key === sp.chon) ?? null)
    : sp.hoaDon
      ? (dong.find((d) => d.hoaDon?.id === sp.hoaDon) ?? null)
      : null;
  const ngan = chonNgan({ tuUrl: sp.ngan, dongDangChon: dangChon });
  const dongTrongNgan = sapXepTrongNgan(ngan, dong, huongSapXep);
  // Quyền dùng KÝ HIỆU NGOÀI cấu hình (ngoại lệ) — màn chỉ vẽ khối ngoại lệ cho người có quyền (server kiểm lại lúc lưu).
  const coQuyenNgoaiLeKyHieu = await checkPermission("payments:ky-hieu-ngoai-le");

  // PR3 — gợi ý số cho lần thu ĐANG MỞ (đúng dòng mà ngăn xử lý hiển thị: dòng chọn, không thì dòng đầu của ngăn).
  const dongMo = dangChon ?? dongTrongNgan[0] ?? null;
  let goiYBanDau: GoiYBanDau | null = null;
  if (dongMo && !dongMo.hoaDonNhap && dongMo.coSoId && dongMo.hanhDong.taiLen.bat) {
    const ds = oSoDienSan({ nhap: null, ngayThu: dongMo.ngayThu, coSoId: dongMo.coSoId, cauHinhCoSo: dongMo.cauHinhCoSo });
    if (ds.kyHieu && ds.ngayPhatHanh) {
      goiYBanDau = {
        dongKey: dongMo.key,
        ket: await goiYSoChoLanThu({ actor, centerId: dongMo.coSoId, centerCode: dongMo.coSo.ma ?? "", kyHieu: ds.kyHieu, ngay: ds.ngayPhatHanh }),
      };
    }
  }

  return (
    <div>
      <PageHeader
        title="Hoá đơn điện tử"
        subtitle="Mỗi dòng là một lần thu tiền: tải phiếu thu, làm hoá đơn ở MISA, rồi tải tệp hoá đơn lên đây."
        actions={
          <Link href="/payments/hoa-don/cau-hinh" className="text-sm font-medium text-primary hover:underline">
            Cấu hình ký hiệu hoá đơn
          </Link>
        }
      />
      <BanChungTu
        coQuyenNgoaiLeKyHieu={coQuyenNgoaiLeKyHieu}
        ngan={ngan}
        dem={demTheoNgan(dong)}
        dongTrongNgan={dongTrongNgan}
        goiYBanDau={goiYBanDau}
        dangChon={dangChon}
        chonKhongThay={Boolean(sp.chon ?? sp.hoaDon) && !dangChon}
        chuaChonCoSo={chuaChonCoSo}
        thieuCoSo={thieuCoSo}
        khoOk={khoOk}
        loc={{
          url: { ...locUrlTu(boLoc, thangMacDinh), sapXep: huongSapXep === "cu-nhat" ? "cu-nhat" : null },
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
