import Link from "next/link";
import { Ic, IC } from "@/components/portal/hv-icon";
import { dinhDangSoCoin } from "@/lib/portal/hv-dieu-huong";
import { HvDauTrang } from "@/components/portal/hv-ui";
import { mucBaiTapBaiThiDangHien } from "@/lib/portal/muc-tam-an";

// Màn "Thêm" của điện thoại — artifact M-HV-Them: các mục không nằm trên thanh tab + nút về chế độ ba mẹ.
// (Thanh trên, thanh tab dưới là của vỏ `HvShell`; trên màn rộng menu bên đã có đủ mục nên trang này hiếm khi được mở.)
export function HvThemTrang({ ten, khoa, coin, danhGia, tinMoi }: { ten: string; khoa: string | null; coin: number | null; danhGia: number; tinMoi: number }) {
  const muc = [
    { href: "/portal/hoc-sinh/san-pham", ten: "Sản phẩm & tính cách", phu: "Ảnh robot em làm ở lớp", ic: IC.sanpham, so: 0 },
    { href: "/portal/hoc-sinh/danh-gia-gv", ten: "Đánh giá thầy cô", phu: danhGia > 0 ? "Đợt đánh giá đang mở · bí mật" : "Chưa có đợt nào đang mở", ic: IC.danhgia, so: danhGia },
    { href: "/portal/hoc-sinh/thong-bao", ten: "Tin mới cho em", phu: mucBaiTapBaiThiDangHien() ? "Điểm bài tập, huy hiệu, lịch học" : "Nhận xét, huy hiệu, lịch học", ic: IC.thongbao, so: tinMoi },
    // «SataCoin» tạm ẩn (04/11/2026): coin === null ⇒ chỉ còn «Huy hiệu» (route «Hành trình» vẫn mở cho huy hiệu).
    coin === null
      ? { href: "/portal/hoc-sinh/hanh-trinh", ten: "Huy hiệu", phu: "Bản đồ chặng và huy hiệu của em", ic: IC.hanhtrinh, so: 0 }
      : { href: "/portal/hoc-sinh/hanh-trinh", ten: "SataCoin & huy hiệu", phu: `${dinhDangSoCoin(coin)} coin`, ic: IC.coinDong, so: 0 },
  ];
  return (
    <>
      <HvDauTrang tieuDe="Thêm" className="min-[900px]:flex hidden" />
      <nav aria-label="Các mục khác" className="flex flex-col rounded-[20px] border border-border bg-card p-1.5">
        {muc.map((m) => (
          <Link key={m.href} href={m.href} className="flex min-h-[60px] items-center gap-3.5 rounded-[14px] px-3 text-foreground no-underline">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-[var(--sr-purple-text)]">
              <Ic d={m.ic} size={20} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <b className="text-[15px]">{m.ten}</b>
              <span className="text-xs text-muted-foreground">{m.phu}</span>
            </span>
            {m.so > 0 && (
              <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[var(--sr-orange)] px-[7px] text-xs font-bold text-[var(--sr-on-orange)]">{m.so}</span>
            )}
            <span aria-hidden="true" className="text-lg text-muted-foreground">›</span>
          </Link>
        ))}
      </nav>
      <Link
        href="/portal/hoc-sinh/thoat"
        className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-[15px] font-bold text-foreground no-underline"
      >
        <Ic d={IC.khoa} size={16} />
        Về chế độ ba mẹ
      </Link>
      <div className="text-center text-[13px] leading-[19px] text-muted-foreground">
        Em đang dùng trên tài khoản của ba mẹ ({ten}{khoa ? ` · ${khoa}` : ""}). Học xong nhớ nhờ ba mẹ thoát nhé.
      </div>
    </>
  );
}
