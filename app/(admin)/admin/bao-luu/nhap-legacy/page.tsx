// app/(admin)/admin/bao-luu/nhap-legacy/page.tsx — NHẬP CA BẢO LƯU CŨ (LEGACY) vào quy chế SR.QD.236 (K14).
//
// Quyền `bao-luu:approve` (Quản lý cơ sở / Admin). Danh sách ứng viên đọc qua `scopedDb` ⇒ chỉ ca trong tầm nhìn cơ sở. CHẶN khi chưa khai
// `pause.effectiveDate` — hạn của ca LEGACY tính từ ngày đó (BR-28), nên không có ngày thì không có gì để nhập; màn nói thẳng chỗ phải khai thay vì vẽ form
// rồi từ chối (luật 12). Server action kiểm lại mọi thứ; trang này không phải cổng.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState } from "@/components/admin/ui/states";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { getSetting } from "@/lib/settings/service";
import { docUngVienLegacy } from "@/lib/bao-luu/legacy-nhap-db";
import { ngayThat } from "@/lib/bao-luu/legacy-nhap";
import { vnYmd } from "@/lib/time/vn";
import { BangNhapLegacy, type DongUngVien } from "./_components/bang-nhap-legacy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nhập ca bảo lưu cũ | Admin Sata Robo" };

export default async function NhapLegacyPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fbao-luu%2Fnhap-legacy");
  if (!(await checkPermission("bao-luu:approve"))) redirect("/bao-luu?error=unauthorized");

  const Khung = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-auto w-full max-w-[1180px]">
      <Link href="/bao-luu" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Danh sách hồ sơ bảo lưu
      </Link>
      <PageHeader
        title="Nhập ca bảo lưu cũ"
        subtitle="Đưa các ca bảo lưu theo thoả thuận cũ vào Quy chế SR.QD.236: bổ sung đơn đã ký + ngày bắt đầu thực tế. Xem trước rồi mới ghi; cả lượt ghi trong một giao dịch."
      />
      {children}
    </div>
  );

  const hieuLuc = await getSetting("pause.effectiveDate");
  if (!hieuLuc || !ngayThat(hieuLuc)) {
    return (
      <Khung>
        <EmptyState
          title="Chưa khai Ngày hiệu lực quy chế bảo lưu."
          description="Hạn của ca LEGACY = ngày hiệu lực quy chế + thời hạn bảo lưu tối đa (BR-28). Quản trị tối cao khai ngày ở Cấu hình vận hành → tab Học viên → 'Ngày hiệu lực quy chế bảo lưu', rồi quay lại đây."
        />
      </Khung>
    );
  }

  const now = new Date();
  const actor = await resolveActor(session.user.id);
  const u = await docUngVienLegacy(scopedDb(actor), now);
  const ngayGoiY = (d: Date | null) => (d ? vnYmd(d) : "");

  const dong: DongUngVien[] = [
    ...u.A.map((x): DongUngVien => ({
      khoa: `A:${x.reserveId}`, nhom: "A", studentId: x.studentId, tenHocVien: x.tenHocVien, maHocVien: x.maHocVien,
      enrollmentId: x.enrollmentId, reserveId: x.reserveId, ten: x.enrollmentId ? "Dòng cũ đã gắn ghi danh" : "Dòng cũ cả-học-viên — chọn ghi danh",
      ngayGoiY: ngayGoiY(x.batDauGhiNhan), nguonNgay: "Ngày ghi nhận của dòng cũ", ghiDanhChon: x.ghiDanhChon,
    })),
    ...u.B.map((x): DongUngVien => ({
      khoa: `B:${x.enrollmentId}`, nhom: "B", studentId: x.studentId, tenHocVien: x.tenHocVien, maHocVien: null,
      enrollmentId: x.enrollmentId, reserveId: null, ten: x.ten, ngayGoiY: ngayGoiY(x.moc),
      nguonNgay: x.mocLa === "NHAT_KY" ? "Lần cuối chuyển sang Tạm dừng (nhật ký)" : "Cập nhật gần nhất của ghi danh (kém tin)", ghiDanhChon: [],
    })),
    ...u.C.map((x): DongUngVien => ({
      khoa: `C:${x.enrollmentId}`, nhom: "C", studentId: x.studentId, tenHocVien: x.tenHocVien, maHocVien: null,
      enrollmentId: x.enrollmentId, reserveId: null, ten: x.ten, ngayGoiY: ngayGoiY(x.moc),
      nguonNgay: "Buổi đầu tiên trong 4 buổi vắng liên tiếp", ghiDanhChon: [],
    })),
  ];

  return (
    <Khung>
      <BangNhapLegacy dong={dong} hieuLuc={hieuLuc} homNay={vnYmd(now)} catNgang={u.catNgang} />
    </Khung>
  );
}
