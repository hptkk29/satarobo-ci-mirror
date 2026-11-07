// app/(portal)/portal/disc/lam-bai/page.tsx — «Làm bài» của SỔ GIA ĐÌNH: chọn người + ai trả lời → làm bài → kết quả.
//
// Chỉ PARENT, cờ `DISC_ENABLED` bật (tắt ⇒ 404). `userId` từ PHIÊN. `?nguoi=`/`?cach=` chỉ là GỢI Ý chọn sẵn và luôn được đối chiếu với sổ của chính người đăng nhập
// (mã lạ ⇒ bỏ qua). Quyền với thành viên + bộ đề được định tuyến lại Ở SERVER ở từng action — không tin giá trị trên URL.
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { DiscNav, TieuDeDisc } from "@/components/disc-portal/so/chung";
import { ManLamBai, type NguoiLamBaiVM } from "@/components/disc-portal/so/man-lam-bai";
import { TaoSo } from "@/components/disc-portal/so/tao-so";
import { cachLamKhaDung, tuoiTuNamSinh } from "@/lib/disc/so-gia-dinh/dinh-tuyen-bai";
import { dungLichSu, dungTheThanhVien } from "@/lib/disc/so-gia-dinh/man-hinh";
import { napMan, soHocVienCua } from "@/lib/disc/so-gia-dinh/nap-man";
import { ngayVN } from "@/lib/disc/so-gia-dinh/kieu";

import { yeuCauPhienDisc } from "../_lib/phien-disc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Làm bài DISC | Sata Robo", robots: { index: false } };

export default async function LamBaiDiscPage({ searchParams }: { searchParams: Promise<{ nguoi?: string; cach?: string }> }) {
  const { userId } = await yeuCauPhienDisc();
  const sp = await searchParams;
  const bayGio = new Date();
  const nap = await napMan(userId, bayGio);

  if (!nap) {
    const [session, soHv] = await Promise.all([auth(), soHocVienCua(userId)]);
    return (
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-5">
        <TaoSo tenGoiY={(session?.user?.name ?? "").trim().slice(0, 30)} soHocVien={soHv} />
      </div>
    );
  }
  const { so, dv } = nap;
  if (so.thanhVien.length === 0) redirect("/portal/disc?muc=thanh-vien");

  const { the } = dungTheThanhVien(dv);
  const namNay = Number(ngayVN(bayGio).slice(0, 4));
  const nhap = new Map<string, { TU_LAM: boolean; GOC_NHIN: boolean }>();
  // Bản nháp theo cách làm: `dangNhap` của sổ chỉ phân biệt theo người; hỏi lại cả hai cách để nút nói đúng.
  for (const t of so.thanhVien) nhap.set(t.id, { TU_LAM: dv.dangNhap.has(t.id), GOC_NHIN: dv.dangNhap.has(t.id) });

  const nguoi: NguoiLamBaiVM[] = so.thanhVien.map((tv, i) => {
    const k = cachLamKhaDung({ vaiTro: tv.vaiTro, lop: tv.lop, tuoi: tuoiTuNamSinh(tv.namSinh, namNay) });
    const t = the[i]!;
    return {
      id: tv.id,
      ten: tv.ten,
      chu: t.chu,
      phu: t.phu,
      nhanTrangThai: t.nhanTrangThai,
      chinh: t.chinh,
      tuLam: k.tuLam.duoc ? { duoc: true, boDe: k.tuLam.boDe } : { duoc: false, lyDo: k.tuLam.lyDo },
      gocNhin: k.gocNhin.duoc ? { duoc: true, boDe: k.gocNhin.boDe } : { duoc: false, lyDo: k.gocNhin.lyDo },
      coNhap: nhap.get(tv.id) ?? { TU_LAM: false, GOC_NHIN: false },
      lichSu: dungLichSu(so.bai.filter((b) => b.thanhVienId === tv.id)),
    };
  });

  const chonId = nguoi.find((n) => n.id === sp.nguoi)?.id ?? null;
  const chonCach = sp.cach === "TU_LAM" || sp.cach === "GOC_NHIN" ? sp.cach : null;
  const chuSo = so.thanhVien.find((t) => t.id === so.chuSoId);

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
      <DiscNav dang="lam-bai" />
      <TieuDeDisc kicker={`${so.ten} · ${so.thanhVien.length} thành viên`} tieuDe="Làm bài DISC" phu="Chọn người được làm bài và ai trả lời. Hệ thống tự chọn bộ câu hỏi theo tuổi; mỗi lần làm được lưu riêng." />
      <ManLamBai nguoi={nguoi} chonId={chonId} chonCach={chonCach} coPin={so.coPin} tenChuSo={chuSo?.ten ?? "Bạn"} />
    </div>
  );
}
