// app/(portal)/portal/disc/page.tsx — «Khám phá DISC» của gia đình: SỔ GIA ĐÌNH (docs/disc-tich-hop/18).
//
// Một route, nhiều mục chọn bằng `?muc=`: gia-dinh (mặc định) · ca-nhan · the-cap · ke-hoach · thanh-vien · da-nhan.
// Không tạo route con cho từng tab để mọi mục đi chung MỘT lối vào ở menu (lưới `v2-nav-day-du`); trạng thái nằm trong URL nên F5 / chia sẻ link giữ nguyên.
// Chỉ PARENT, cờ `DISC_ENABLED` bật (tắt ⇒ 404). `userId` từ PHIÊN; `searchParams` chỉ là LỰA CHỌN HIỂN THỊ (mã thành viên đã được đối chiếu với sổ của chính người đăng nhập).
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { auth } from "@/lib/auth";
import { PageHero } from "@/components/portal/page-header";
import { QuyenDuLieuDisc } from "@/components/disc-portal/quyen-du-lieu-disc";
import { DanhSachLuotDisc, GhiChuXuHuong, LichSuDisc, TongQuanGiaDinh } from "@/components/disc-portal/tong-quan-disc";
import { DiscNav } from "@/components/disc-portal/so/chung";
import { ManCaNhan } from "@/components/disc-portal/so/man-ca-nhan";
import { ManGiaDinh } from "@/components/disc-portal/so/man-gia-dinh";
import { ManKeHoach } from "@/components/disc-portal/so/man-ke-hoach";
import { ManTheCap } from "@/components/disc-portal/so/man-the-cap";
import { ManThanhVien } from "@/components/disc-portal/so/man-thanh-vien";
import { TaoSo } from "@/components/disc-portal/so/tao-so";
import { docPhanTichMoiNhat, docHoatDongDaKiem, docKeHoachDangChay, type KeHoachDaLuu } from "@/lib/disc/so-gia-dinh/doc";
import { hoSoCaNha } from "@/lib/disc/so-gia-dinh/ho-so-dang-dung";
import { dungManCaNhan, dungManGiaDinh, dungManTheCap, dungManThanhVien } from "@/lib/disc/so-gia-dinh/man-hinh";
import { dungManKeHoach, type TabKeHoach } from "@/lib/disc/so-gia-dinh/man-hinh-ke-hoach";
import { hocVienChuaNoi, napMan, soHocVienCua } from "@/lib/disc/so-gia-dinh/nap-man";
import { ngayVN } from "@/lib/disc/so-gia-dinh/kieu";
import { MOI_KY, type KyKeHoach } from "@/lib/disc/so-gia-dinh/ke-hoach";
import { laTreEm } from "@/lib/disc/so-gia-dinh/vai";
import { SO_THANH_VIEN_TOI_DA_SO } from "@/lib/disc/so-gia-dinh/validators";
import { docDanhSachLuot, docLichSuGiaDinh } from "@/lib/disc/portal-doc";

import { yeuCauPhienDisc } from "./_lib/phien-disc";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Khám phá DISC | Sata Robo",
  robots: { index: false },
};

type SP = { muc?: string; nguoi?: string; ban?: string; a?: string; b?: string; ky?: string; ngay?: string; tuan?: string; plan?: string; trang?: string };

const mot = (v: string | undefined) => (typeof v === "string" && v.length <= 64 ? v : undefined);
const so = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 400 ? n : null;
};

export default async function DiscPortalPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { userId } = await yeuCauPhienDisc();
  const sp = await searchParams;
  const muc = mot(sp.muc) ?? "gia-dinh";
  const bayGio = new Date();

  // Kết quả ĐÃ NHẬN từ trang DISC công khai (luồng cũ, theo SĐT) — hệ riêng, giữ nguyên.
  if (muc === "da-nhan") {
    const trang = await docDanhSachLuot(userId, { trang: Number(sp.trang) });
    const lichSu = trang.tong > 0 ? await docLichSuGiaDinh(userId) : [];
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <DiscNav dang="da-nhan" />
        <PageHero icon={Sparkles} overline="Khám phá DISC" title="Kết quả đã nhận từ trang DISC công khai" subtitle="Các lần làm bài bạn đã nhận vào tài khoản bằng mã nhận" />
        <GhiChuXuHuong />
        {trang.tong === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">Chưa có kết quả nào được nhận về tài khoản này. Kết quả làm trong sổ gia đình nằm ở các mục «Gia đình», «Cá nhân», «Thẻ cặp».</p>
        ) : (
          <>
            <TongQuanGiaDinh lichSu={lichSu} />
            <LichSuDisc lichSu={lichSu} />
            <DanhSachLuotDisc trang={trang} />
            <QuyenDuLieuDisc />
          </>
        )}
      </div>
    );
  }

  const nap = await napMan(userId, bayGio);
  if (!nap) {
    const [session, soHv] = await Promise.all([auth(), soHocVienCua(userId)]);
    return (
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-5">
        <TaoSo tenGoiY={(session?.user?.name ?? "").trim().slice(0, 30)} soHocVien={soHv} />
      </div>
    );
  }
  const { so: soGd, pt, dv } = nap;

  if (muc === "ca-nhan") {
    const hs = hoSoCaNha(soGd.thanhVien, soGd.bai);
    const coHoSo = soGd.thanhVien.filter((t) => hs.get(t.id));
    const macDinh = coHoSo.find((t) => t.id === soGd.chuSoId) ?? coHoSo[0];
    const id = coHoSo.find((t) => t.id === mot(sp.nguoi))?.id ?? macDinh?.id;
    const vm = id ? dungManCaNhan(dv, id) : null;
    if (!vm) return <TrangRong tieuDe="Chưa có báo cáo cá nhân" chu="Hãy để ít nhất một người làm bài, báo cáo sẽ hiện ở đây." dang="ca-nhan" />;
    const ban = sp.ban === "con" ? "con" : sp.ban === "bome" ? "bome" : "day-du";
    return <ManCaNhan vm={vm} nguoi={soGd.thanhVien.map((t) => ({ id: t.id, ten: t.ten, coHoSo: !!hs.get(t.id) }))} ban={ban} />;
  }

  if (muc === "the-cap") {
    return <ManTheCap vm={dungManTheCap(dv, mot(sp.a), mot(sp.b))} />;
  }

  if (muc === "thanh-vien") {
    const chua = await hocVienChuaNoi(userId, soGd.thanhVien.map((t) => t.studentId));
    return <ManThanhVien vm={dungManThanhVien(dv, soGd.ten, chua, soGd.coPin, laTreEm, SO_THANH_VIEN_TOI_DA_SO)} />;
  }

  if (muc === "ke-hoach") {
    const hs = hoSoCaNha(soGd.thanhVien, soGd.bai);
    const ds = [...hs.values()].filter((b) => b !== null);
    const kyHopLe = (v: string | undefined): v is KyKeHoach => (MOI_KY as readonly (string | undefined)[]).includes(v);
    const tab: TabKeHoach = mot(sp.ky) === "CHECKIN" ? "CHECKIN" : mot(sp.ky) === "HOAT_DONG" ? "HOAT_DONG" : kyHopLe(mot(sp.ky)) ? (mot(sp.ky) as KyKeHoach) : "NGAY_7";
    const [kh7, kh30, kh365, hoatDong, ptMoi] = await Promise.all([
      docKeHoachDangChay(soGd.id, "NGAY_7"),
      docKeHoachDangChay(soGd.id, "THANG_1"),
      docKeHoachDangChay(soGd.id, "NAM_1"),
      docHoatDongDaKiem(bayGio),
      docPhanTichMoiNhat(soGd.id),
    ]);
    const keHoach: Partial<Record<KyKeHoach, KeHoachDaLuu>> = {
      ...(kh7 ? { NGAY_7: kh7 } : {}),
      ...(kh30 ? { THANG_1: kh30 } : {}),
      ...(kh365 ? { NAM_1: kh365 } : {}),
    };
    const vm = dungManKeHoach({
      tab,
      ngayChon: so(sp.ngay),
      tuanChon: so(sp.tuan),
      kyCheckin: kyHopLe(mot(sp.plan)) ? (mot(sp.plan) as KyKeHoach) : null,
      soTuLam: ds.filter((b) => b.cachLam === "TU_LAM").length,
      soCoHoSo: ds.length,
      tongThanhVien: soGd.thanhVien.length,
      chup: pt?.chup ?? null,
      soBanMoiNhat: ptMoi?.soBan ?? null,
      keHoach,
      phanTichIdMoiNhat: ptMoi?.id ?? null,
      hoatDong,
      thanhVien: soGd.thanhVien.map((t) => ({ id: t.id, ten: t.ten })),
      homNay: ngayVN(bayGio),
    });
    return <ManKeHoach vm={vm} tenGiaDinh={soGd.ten} snapTen={dungManGiaDinh(dv).snapTen} />;
  }

  // Mặc định: tab «Gia đình»
  const vm = dungManGiaDinh(dv);
  const daNhan = await docDanhSachLuot(userId, { trang: 1 });
  return (
    <>
      <ManGiaDinh vm={vm} capNhat={nap.capNhatKeHoach && pt ? { chu: `Có kết quả mới (bản tính số ${pt.soBan}).` } : null} />
      {daNhan.tong > 0 ? (
        <div className="mx-auto mt-[22px] w-full max-w-[1160px] rounded-[14px] border border-border bg-card px-4 py-3 text-sm">
          Bạn có {daNhan.tong} kết quả đã nhận từ trang DISC công khai.{" "}
          <Link href="/portal/disc?muc=da-nhan" className="font-bold text-[var(--sr-purple-text)] underline">Xem các kết quả đã nhận</Link>
        </div>
      ) : null}
    </>
  );
}

function TrangRong({ tieuDe, chu, dang }: { tieuDe: string; chu: string; dang: "ca-nhan" }) {
  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
      <DiscNav dang={dang} />
      <section className="flex flex-col items-start gap-2.5 rounded-[20px] border-2 border-dashed border-border bg-card p-7">
        <b className="text-lg">{tieuDe}</b>
        <span className="text-sm leading-[21px] text-[var(--sr-ink-muted)]">{chu}</span>
        <Link href="/portal/disc/lam-bai" className="inline-flex h-11 items-center rounded-xl bg-[var(--sr-orange)] px-4 text-sm font-bold text-[var(--sr-on-orange)]">Làm bài</Link>
      </section>
    </div>
  );
}

