import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napPhieuCuaToi, type PhieuTrongDanhSach } from "@/lib/elearning/de-nghi-view";
import { cacQuyDeNghi, nhanQuy, nhanTrangThaiPhieu } from "@/lib/elearning/de-nghi-pure";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState } from "@/components/admin/ui/states";
import { DanhSachDuLieu, type CotDuLieu } from "../_components/ui/danh-sach-du-lieu";
import { ChamTrangThai } from "../_components/ui/trang-thai-nhom";
import { DeNghiForm } from "./_components/de-nghi-form";

/**
 * ĐỀ NGHỊ ĐÀO TẠO — người học gửi đề nghị và THEO DÕI các đề nghị CỦA MÌNH. Việc duyệt/lập chương trình ở màn quản trị.
 *
 * ⚠️ Mô hình hiện chỉ có "Chờ duyệt" / "Đã duyệt" (Q14 chưa chốt — BLOCKERS B-06): KHÔNG có nút rút/từ chối, không bước "đang
 * xem". Lối vào là liên kết theo ngữ cảnh (Khoá của tôi), KHÔNG phải mục điều hướng chính (DECISIONS D-05).
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Đề nghị đào tạo | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const ngay = (d: Date) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);

export default async function DeNghiPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">Đăng nhập rồi mở lại trang này.</main>;
  }
  const actor = await resolveActor(session.user.id);
  const ds = await napPhieuCuaToi(scopedDb(actor), session.user.id);

  const cot: CotDuLieu<PhieuTrongDanhSach>[] = [
    {
      id: "de-nghi",
      nhan: "Đề nghị",
      dienThoai: "tieu-de",
      hien: (p) => (
        <Link
          href={`/elearning/de-nghi/${encodeURIComponent(p.code)}`}
          className="block max-w-[26rem] truncate font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-[720px]:whitespace-normal"
        >
          {p.title}
        </Link>
      ),
    },
    { id: "ma", nhan: "Mã", hien: (p) => <span className="font-mono text-xs">{p.code}</span> },
    { id: "quy", nhan: "Quý", dienThoai: "thong-tin", hien: (p) => nhanQuy(p.proposedQuarter) },
    { id: "gui", nhan: "Ngày gửi", dienThoai: "thong-tin", hien: (p) => ngay(p.createdAt) },
    {
      id: "trang-thai",
      nhan: "Trạng thái",
      hien: (p) => <ChamTrangThai nhom={nhanTrangThaiPhieu(p.status).nhom} nhan={nhanTrangThaiPhieu(p.status).nhan} />,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title="Đề nghị đào tạo"
        subtitle="Bạn cần học thêm điều gì? Gửi đề nghị cho phòng Đào tạo. Bạn xem được trạng thái các đề nghị của mình ở dưới."
      />
      <DeNghiForm quy={cacQuyDeNghi(new Date())} />

      <section aria-labelledby="da-gui" className="space-y-3">
        <h2 id="da-gui" className="text-base font-semibold text-foreground">
          Đề nghị bạn đã gửi
        </h2>
        <DanhSachDuLieu
          hang={ds}
          khoa={(p) => p.id}
          cot={cot}
          nhomMau={(p) => nhanTrangThaiPhieu(p.status).nhom}
          nhanTrangThai={(p) => nhanTrangThaiPhieu(p.status).nhan}
          tenDonVi="đề nghị"
          nhanDanhSach="Đề nghị bạn đã gửi"
          trong={<EmptyState title="Bạn chưa gửi đề nghị nào" description="Điền form ở trên để gửi đề nghị đầu tiên." />}
        />
      </section>
    </main>
  );
}
