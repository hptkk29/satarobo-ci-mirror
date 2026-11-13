// Thân CHUNG của hai trang có danh sách lần thu: "Hoá đơn" (/payments/hoa-don) và "Cảnh báo & sai sót"
// (/payments/hoa-don/canh-bao) — S5b. Trước đây là thân của `page.tsx`; tách ra để hai trang không chép nhau một
// logic nhạy cảm (chọn cơ sở an toàn, tầm nhìn theo phạm vi kế toán). Hai trang giữ NGUYÊN phần gác cổng
// (cờ → đăng nhập → PAGE_GATES → redirect) — layout KHÔNG thay được cổng của trang (CLAUDE.md luật 5).
//
// Mỗi dòng là MỘT LẦN THU (gom bằng `gomLanThu`), đi qua: tải phiếu thu chờ → làm hoá đơn ở MISA → tải tệp lên →
// xác nhận (docs/ke-toan-hoa-don/PLAN.md §4 + §10). Hai khu vực chia nhau các ngăn (`NGAN_THEO_KHU_VUC`); NẠP thì
// nạp đủ cho cả hai (số đếm hai bên dùng chung một lượt nạp).
//
// ⚠️ Chọn dòng bằng `?chon=<khoá lần thu>` — khoá BẤT BIẾN qua mọi ngăn (dòng đổi ngăn khi tải tệp lên, không đổi
// khoá), nên ngăn xử lý giữ đúng dòng sau `router.refresh()`.
// ⚠️ Mọi quyết định "dòng vào ngăn nào, nút nào sáng, che gì" nằm ở `lib/finance/hoa-don/*` (thuần, có test).
// ⚠️ Bộ lọc `?coSo=` + `?thang=` lọc ở CÂU TRA (`loc-hang-cho.ts`); `?coSo=` chỉ nhận cơ sở trong phạm vi KẾ TOÁN.
// ⚠️ URL CŨ vẫn chạy: `?ngan=lech|don-huy|can-dieu-chinh` ở /payments/hoa-don (và ngược lại) được chuyển sang khu vực
// đúng, giữ MỌI tham số; `?hoaDon=` (thông báo "email không tới") được chuẩn hoá thêm cơ sở/tháng để thanh phạm vi
// nói cùng một cơ sở với bảng. `redirect()` — khi trang đã bắt đầu stream, Next đổi thành chuyển hướng phía client.
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { napCoSoLocHoaDon, napHangChoHoaDon, thangCuaHoaDonTrongTamNhin } from "@/lib/finance/hoa-don/hang-cho";
import { chonCoSoLamViec, docBoLoc, locUrlTu, thangVN } from "@/lib/finance/hoa-don/loc-hang-cho";
import { khoHoaDonDaCauHinh } from "@/lib/finance/hoa-don/kho-tep";
import { phamViKeToan } from "@/lib/finance/hoa-don/quyen";
import { gopTuKhoa } from "@/lib/finance/hoa-don/lan-thu";
import { oSoDienSan } from "@/lib/finance/hoa-don/o-so-hoa-don";
import { goiYSoChoLanThu, type GoiYBanDau } from "@/lib/finance/hoa-don/goi-y-so-db";
import { demTheoNgan, docHuongSapXep, laNgan, sapXepTrongNgan } from "@/lib/finance/hoa-don/ngan-hang-cho";
import { BanChungTu } from "./ban-chung-tu";
import { TieuDeMuc } from "./tieu-de-muc";
import { TRANG_PHU, chonNganTheoKhuVuc, chuyenKhuVuc, hrefTrangPhu, khuVucCuaNgan, type KhuVucDanhSach } from "./dieu-huong-hoa-don";

export type ThamSoTrang = { ngan?: string; chon?: string; hoaDon?: string; coSo?: string; thang?: string; sapXep?: string };

const MO_TA: Record<KhuVucDanhSach, string> = {
  "hoa-don": "Mỗi dòng là một lần thu tiền: tải phiếu thu, làm hoá đơn ở MISA, rồi tải tệp hoá đơn lên đây.",
  "canh-bao": "Những lần thu cần xem lại: lệch số tiền hoặc nghi trùng, hoá đơn đã xuất nhưng tiền đã đổi, và khoản thu nằm trên đơn đã huỷ.",
};

export async function TrangBanChungTu({
  sp,
  userId,
  khuVuc,
}: {
  sp: ThamSoTrang;
  userId: string;
  khuVuc: KhuVucDanhSach;
}) {
  // URL cũ `?ngan=lech|don-huy|can-dieu-chinh` ở tab Hoá đơn (và ngược lại): ngăn ghi THẲNG trên URL đủ để quyết khu vực nào đúng,
  // nên chuyển hướng TRƯỚC khi nạp bất cứ thứ gì — rẻ, và sớm nhất có thể (trang có `loading.tsx`: càng muộn càng dễ thành
  // chuyển hướng phía client). Ngăn suy từ `?chon=` thì chỉ biết sau khi nạp dòng — xem `lacSang` bên dưới.
  if (laNgan(sp.ngan) && khuVucCuaNgan(sp.ngan) !== khuVuc) redirect(chuyenKhuVuc(sp, khuVucCuaNgan(sp.ngan)));
  const [actor, canViewPii] = await Promise.all([resolveActor(userId), checkPermission("orders:view-pii")]);
  const now = new Date();
  const thangMacDinh = thangVN(now);
  // `?hoaDon=` (đường dẫn trong thông báo) không mang tháng: mở theo tháng của CHÍNH hoá đơn đó, không
  // thì hoá đơn tháng trước "không còn trong danh sách". Chỉ tốn thêm một câu ở đúng đường này.
  const tuHoaDon = sp.hoaDon && !sp.chon ? await thangCuaHoaDonTrongTamNhin(actor, sp.hoaDon) : null;
  // Chuẩn hoá một lần: URL mang đủ cơ sở (+ tháng) của hoá đơn ⇒ thanh phạm vi (đọc URL) và bảng (đọc server) khớp nhau.
  if (sp.hoaDon && !sp.chon && !sp.coSo && tuHoaDon) {
    redirect(chuyenKhuVuc(sp, khuVuc, { coSo: tuHoaDon.coSoId, thang: sp.thang ? null : tuHoaDon.thang }));
  }
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
  // Ngăn nằm ở khu vực KHÁC (URL cũ, hoặc dòng chọn thuộc tab kia) ⇒ chuyển sang đó, giữ mọi tham số.
  const { ngan, lacSang } = chonNganTheoKhuVuc({ tuUrl: sp.ngan, dongDangChon: dangChon, khuVuc });
  if (lacSang) redirect(chuyenKhuVuc(sp, lacSang, { ngan }));
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

  const url = { ...locUrlTu(boLoc, thangMacDinh), sapXep: huongSapXep === "cu-nhat" ? ("cu-nhat" as const) : null };

  return (
    <div>
      <TieuDeMuc
        moTa={MO_TA[khuVuc]}
        hanhDong={
          khuVuc === "hoa-don" ? (
            <Link href={hrefTrangPhu(url)} className="text-sm font-medium text-primary hover:underline">
              {TRANG_PHU.chungTu.nhan}
            </Link>
          ) : undefined
        }
      />
      <BanChungTu
        khuVuc={khuVuc}
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
          url,
          coSo: boLoc.coSo,
          thang: boLoc.thang,
          thangMacDinh,
          cacCoSo,
        }}
      />
    </div>
  );
}
