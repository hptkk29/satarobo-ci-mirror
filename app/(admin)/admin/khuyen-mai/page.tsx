// app/(admin)/admin/khuyen-mai/page.tsx — CHÍNH SÁCH KHUYẾN MÃI (26/09/2026).
//
// Thiết kế lại module Voucher theo lời chủ dự án: "chính sách mới thì BLĐ up lên là nhận luôn và
// gửi về cho Sale tra cứu, sau này sẽ add voucher vào quy trình thanh toán". Đơn vị của màn này
// là VĂN BẢN (SR.QD.xxx) do Ban lãnh đạo ban hành; mã voucher là con của văn bản.
//
// QUYỀN: vào màn = `promotions:view` (Sale, QLCS, kế toán, marketing, BLĐ). Nút "Ban hành" chỉ
// vẽ khi có `promotions:manage` — đúng quyền mà Server Action tự kiểm lại (luật 12).
//
// Trạng thái từng dòng hỏi MỘT hàm `trangThaiTai()` (`lib/khuyen-mai/hieu-luc.ts`) — cùng câu
// trả lời với màn Tra cứu của Sale và đường chọn mã khi tạo đơn.
//
// ═══ HỢP ĐỒNG THIẾT KẾ (impeccable, 26/09/2026) ═══════════════════════════════════════
// THESIS: văn bản là đơn vị — mỗi dòng trả lời "chính sách nào, ưu đãi gì, còn hiệu lực
//   không" trong một lần nhìn; KHÔNG dựng "voucher" thành danh mục mã rời không có văn bản.
// OWN-WORLD: thế giới admin có sẵn (DESIGN.md): tím #610B8A cho hành động chính, thang trạng
//   thái ngữ nghĩa riêng (xanh = đang áp dụng, lam = sắp, xám = hết hạn, đỏ = thu hồi), bảng
//   dày — mỗi dòng là MỘT văn bản xếp 2–4 dòng chữ (ngoại lệ ghi ở DESIGN.md §2), chip bộ lọc
//   mang số, CSS transition duy nhất.
// STORY: Sale gõ tên/mã ⇒ thấy ngay ưu đãi + mã voucher + còn bao nhiêu ngày ⇒ mở văn bản đọc
//   điều kiện; BLĐ ban hành ⇒ Sale nhận thông báo; thu hồi ⇒ dải đỏ trên văn bản.
// FIRST VIEWPORT: tiêu đề + nút "Ban hành chính sách" (chỉ BLĐ) · ô tìm + 5 chip trạng thái
//   cùng một hàng · bảng: mã văn bản + nhãn trạng thái | chương trình, ưu đãi, mã | hiệu lực |
//   áp dụng.
// FORM: bảng danh sách chuẩn (chủ dự án chọn lối thoát "canon" 26/09) — seed 1f6af1a7.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
//   the verdict, and DESIGN.md.
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/admin/ui/page-header";
import { auth } from "@/lib/auth";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { docDanhSachChinhSach } from "@/lib/khuyen-mai/chinh-sach";
import { trangThaiTai } from "@/lib/khuyen-mai/hieu-luc";
import { boDau } from "@/lib/ui/bo-dau";
import { BangChinhSach, type DongChinhSach } from "./_components/bang-chinh-sach";
import { khoangVi, nhacThoiGian } from "./_components/dinh-dang";

export const dynamic = "force-dynamic";
export const metadata = { title: "Khuyến mãi | Admin Sata Robo" };

export default async function KhuyenMaiPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fkhuyen-mai");
  if (!(await checkAnyPermission([...PAGE_GATES["/khuyen-mai"]]))) redirect("/dashboard?error=unauthorized");

  const [coQuanLy, ds] = await Promise.all([checkPermission("promotions:manage"), docDanhSachChinhSach()]);
  const homNay = ngayVN(new Date());

  const dong: DongChinhSach[] = ds.map((c) => {
    const tt = trangThaiTai(c, homNay);
    const phamVi = c.toanHeThong ? "Toàn hệ thống" : c.coSo.map((x) => x.ma).join(", ") || "Cơ sở đã ngừng";
    const khoa = c.moiKhoa ? "Mọi khoá" : c.khoaHoc.map((k) => k.ten).join(", ") || "Khoá đã gỡ";
    const maDangBat = c.vouchers.filter((v) => v.dangBat).map((v) => v.ma);
    return {
      id: c.id,
      maVanBan: c.maVanBan,
      ten: c.ten,
      uuDai: c.noiDungUuDai.split(/\r?\n/)[0] ?? "",
      trangThai: tt,
      hieuLuc: khoangVi(c.tuNgay, c.daTungHieuLuc ? c.ketThuc : c.denNgay),
      nhac: nhacThoiGian(tt, c.tuNgay, c.ketThuc, homNay),
      phamVi,
      khoa,
      soMa: maDangBat.length,
      maDauTien: maDangBat.slice(0, 2),
      tim: boDau(`${c.maVanBan} ${c.ten} ${c.noiDungUuDai} ${c.vouchers.map((v) => v.ma).join(" ")} ${phamVi} ${khoa}`),
    };
  });

  return (
    <div>
      <PageHeader
        title="Khuyến mãi"
        subtitle="Văn bản khuyến mãi Ban lãnh đạo đã ban hành — tra ưu đãi, điều kiện và mã voucher trước khi hứa với khách."
        actions={
          coQuanLy ? (
            <Link
              href="/khuyen-mai/moi"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Ban hành chính sách
            </Link>
          ) : undefined
        }
      />
      <BangChinhSach dong={dong} coQuanLy={coQuanLy} />
    </div>
  );
}
