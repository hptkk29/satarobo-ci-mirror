// Cấu hình ký hiệu / pháp nhân hoá đơn theo cơ sở (PR2, docs/ke-toan-hoa-don/NANG-CAP-2026-10.md) — nay là tab con
// "Pháp nhân & ký hiệu" của tab Cấu hình (S5b). URL giữ nguyên.
// Cùng luật chọn cơ sở với bàn chứng từ: MỘT cơ sở làm việc — một cơ sở thì tự chọn, nhiều cơ sở thì phải chọn trước.
// Ô chọn cơ sở là của thanh phạm vi (layout); trang chỉ đọc `?coSo=` và kiểm lại ở server (`chonCoSoLamViec`).
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { EmptyState } from "@/components/admin/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { laHoaDonBat, laHubChinhSachBat } from "@/lib/finance/hoa-don/feature";
import { napCoSoLocHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import { chonCoSoLamViec, thangVN } from "@/lib/finance/hoa-don/loc-hang-cho";
import { docCauHinhCoSo, docLichSuCauHinh, docPhapNhanCuaCayToChuc } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";
import { phapNhanPhatHanhChoCoSo, phapNhanTheoCayToChuc } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import { huongDan } from "@/lib/finance/hoa-don/huong-dan";
import { PageHelp } from "@/components/admin/ui/page-help";
import { cauHinhHoaDonChoMoiTruong } from "@/lib/finance/hoa-don/phap-nhan-theo-moi-truong";
import { laKeToanHoiSo } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { TieuDeMuc } from "../_components/tieu-de-muc";
import { ngayVN } from "../_components/phap-nhan-hien-thi";
import { CauHinhCoSo } from "./_components/cau-hinh-co-so";
import { KhuChinhSachHub } from "./_components/khu-chinh-sach-hub";
import { KhuKetNoiKy } from "./_components/khu-ket-noi-ky";
import { KhuKyChinhSach } from "./_components/khu-ky-chinh-sach";
import { KhuKyUsb } from "./_components/khu-ky-usb";
import { TongQuanThietLap } from "./_components/tong-quan-thiet-lap";

export const metadata = { title: "Cấu hình ký hiệu hoá đơn | Admin" };
export const dynamic = "force-dynamic";

export default async function CauHinhHoaDonPage({ searchParams }: { searchParams: Promise<{ coSo?: string }> }) {
  if (!(await laHoaDonBat())) notFound();
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fpayments%2Fhoa-don%2Fcau-hinh");
  if (!(await checkAnyPermission(PAGE_GATES["/payments/hoa-don/cau-hinh"]))) redirect("/dashboard?error=unauthorized");

  const [sp, actor] = await Promise.all([searchParams, resolveActor(session.user.id)]);
  const cacCoSo = await napCoSoLocHoaDon(actor);
  const coSoId = chonCoSoLamViec(sp.coSo ?? null, cacCoSo);
  const coSo = cacCoSo.find((c) => c.id === coSoId) ?? null;
  const dong = coSo ? await docCauHinhCoSo(actor, [coSo.id]) : [];
  const lichSu = await docLichSuCauHinh(dong.map((d) => d.id));
  // Chọn cơ sở ⇒ tự chọn pháp nhân theo CÂY TỔ CHỨC (khớp MST). Link sang Cây tổ chức chỉ hiện cho người mở được màn đó (luật 12).
  const theoCay = phapNhanTheoCayToChuc(coSo ? await docPhapNhanCuaCayToChuc(coSo.id) : null, cauHinhHoaDonChoMoiTruong().phapNhan);
  const coTheMoCay = await checkAnyPermission(PAGE_GATES["/to-chuc"]);
  // Invoice Hub S7 — khu Chính sách + Nhà cung cấp & ký (chỉ đọc). Cờ TẮT ⇒ trang y hệt trước (không nạp gì thêm).
  const hubBat = coSo ? await laHubChinhSachBat() : false;
  // 05/11/2026 — «Kết nối & ký» và «Chính sách ký» chỉ hiện pháp nhân CỦA CƠ SỞ ĐANG CHỌN. Pháp nhân đó là pháp nhân ĐANG PHÁT HÀNH (cấu hình ký hiệu của cơ sở hôm nay — chính thứ máy phát hành đọc);
  // chưa có cấu hình thì mới rơi về Cây tổ chức (khớp MST). Hai nguồn LỆCH nhau ⇒ vẫn theo cấu hình cơ sở và nói rõ ở «Tổng quan» (trước đây trang tự mâu thuẫn: đầu trang ghi Sata Robo, khu kết nối ghi STEM).
  // Cơ sở không có pháp nhân nào ⇒ KHÔNG đoán, KHÔNG hiện cả ba.
  const homNayVn = ngayVN(new Date());
  const pnCauHinh = coSo
    ? phapNhanPhatHanhChoCoSo({ cauHinh: dong.filter((d) => d.dangBat), centerId: coSo.id, ngay: homNayVn, danhSachPhapNhan: cauHinhHoaDonChoMoiTruong().phapNhan })
    : null;
  const phapNhanTheoCauHinh = pnCauHinh?.ok ? pnCauHinh.phapNhan : null;
  const phapNhanDangChon = phapNhanTheoCauHinh?.ma ?? (theoCay.loai === "KHOP" ? theoCay.ma : null);
  const canhBaoLech =
    phapNhanTheoCauHinh && theoCay.loai === "KHOP" && theoCay.ma !== phapNhanTheoCauHinh.ma
      ? `Cây tổ chức đang ghi ${theoCay.ten}, khác pháp nhân cơ sở đang phát hành — nhờ quản trị kiểm lại Cây tổ chức.`
      : null;

  return (
    <>
    {coSo ? (
      <>
        <Suspense fallback={<Skeleton className="mb-6 h-40 w-full rounded-xl" />}>
          <TongQuanThietLap
            actor={actor}
            tenCoSo={`${coSo.ma} · ${coSo.ten}`}
            coSoId={coSo.id}
            phapNhan={phapNhanTheoCauHinh}
            loiPhapNhan={pnCauHinh && !pnCauHinh.ok ? pnCauHinh.error : null}
            kyHieu={pnCauHinh?.ok ? pnCauHinh.kyHieu : null}
            canhBaoLech={canhBaoLech}
            hubBat={hubBat}
          />
        </Suspense>
        <PageHelp label="Hướng dẫn thiết lập từng bước">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <b>Pháp nhân & ký hiệu</b> — chọn công ty đứng tên hoá đơn của cơ sở này và ký hiệu theo từng khoảng ngày. Kế toán tự khai; đổi không làm thay hoá đơn đã lưu.
            </li>
            <li>
              <b>Kết nối nhà cung cấp</b> — khai tài khoản phần mềm hoá đơn (MISA hoặc VIN-HOADON) của pháp nhân đó và cách ký. Mỗi pháp nhân chọn nhà cung cấp riêng; chỉ Quản trị tối cao sửa.
            </li>
            <li>
              <b>Tạm dừng & hạn mức ký</b> — nút khẩn khi nghi sự cố, và hạn mức cho phần hệ thống được tự ký. Kế toán bấm «Phát hành» bằng tay không bị hạn mức giới hạn.
            </li>
            <li>
              <b>Chính sách hoá đơn</b> (nếu có) — ghi sẵn khoản thu nào lập hoá đơn thế nào. Chưa có thì cách lập hoá đơn hiện nay không đổi.
            </li>
          </ol>
          <p className="mt-3">Gặp từ khó (HSM, USB token, ký hiệu, AppID…): rê chuột hoặc bấm vào dấu «?» cạnh chữ đó để đọc giải thích ngắn.</p>
        </PageHelp>
      </>
    ) : null}
    <div id="phap-nhan-ky-hieu">
      <TieuDeMuc
        tieuDe="Bước 1 · Pháp nhân & ký hiệu"
        huongDan={huongDan("buoc-phap-nhan")}
        nhanHuongDan="Xem hướng dẫn Bước 1: pháp nhân và ký hiệu"
        moTa="Mỗi cơ sở khai pháp nhân phát hành và ký hiệu theo khoảng ngày. Màn Hoá đơn điện tử dùng cấu hình này để điền sẵn."
      />
      {coSo ? (
        <CauHinhCoSo
          key={coSo.id}
          centerId={coSo.id}
          tenCoSo={`${coSo.ma} · ${coSo.ten}`}
          dong={dong}
          lichSu={lichSu}
          theoCay={theoCay}
          coTheMoCay={coTheMoCay}
          phapNhan={cauHinhHoaDonChoMoiTruong().phapNhan.map((p) => ({ ma: p.ma, ten: p.ten, maSoThue: p.maSoThue, bat: p.bat }))}
          namHienTai={thangVN(new Date()).slice(0, 4)}
        />
      ) : (
        <EmptyState
          title={cacCoSo.length > 0 ? "Chọn cơ sở để bắt đầu" : "Bạn chưa được giao cơ sở nào để làm hoá đơn"}
          description={
            cacCoSo.length > 0
              ? "Cấu hình được khai theo từng cơ sở. Chọn cơ sở ở thanh phạm vi phía trên."
              : "Liên hệ quản trị để được cấp quyền kế toán tại cơ sở."
          }
        />
      )}
    </div>
    {coSo && phapNhanDangChon && laKeToanHoiSo(actor) ? (
      // «Kết nối & ký» (hub/13): dữ liệu cấp PHÁP NHÂN, nhưng màn chỉ hiện pháp nhân của cơ sở đang chọn. Chỉ kế toán Hội sở thấy.
      <div id="ket-noi-ky" className="mt-10">
        <TieuDeMuc
          tieuDe="Bước 2 · Kết nối nhà cung cấp"
          huongDan={huongDan("buoc-ket-noi")}
          nhanHuongDan="Xem hướng dẫn Bước 2: kết nối nhà cung cấp"
          moTa="Tài khoản phần mềm hoá đơn và cách ký của pháp nhân đang phát hành cho cơ sở này."
        />
        <Suspense
          fallback={
            <div aria-busy="true" aria-label="Đang tải kết nối nhà cung cấp" className="flex flex-col gap-3">
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          }
        >
          <KhuKetNoiKy actor={actor} phapNhanMa={phapNhanDangChon} />
        </Suspense>
      </div>
    ) : null}
    {/* «Chính sách ký» (BGĐ 04/11/2026): tạm dừng ký + hạn mức theo pháp nhân. Tự ẩn (null) khi người xem không là kế toán ở đâu. */}
    {coSo && phapNhanDangChon ? (
      <div id="chinh-sach-ky" className="mt-10">
        <TieuDeMuc
          tieuDe="Bước 3 · Tạm dừng & hạn mức ký"
          huongDan={huongDan("buoc-chinh-sach-ky")}
          nhanHuongDan="Xem hướng dẫn Bước 3: tạm dừng và hạn mức ký"
          moTa="Dừng ngay việc gửi hoá đơn mới khi có sự cố, và giới hạn phần hệ thống được tự ký."
        />
        <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
          <KhuKyChinhSach actor={actor} phapNhanMa={phapNhanDangChon} />
        </Suspense>
      </div>
    ) : coSo ? (
      <div id="chua-gan-phap-nhan" className="mt-10">
        <EmptyState
          title="Chưa xác định được pháp nhân của cơ sở này"
          description="Kết nối nhà cung cấp và hạn mức ký khai theo pháp nhân. Hãy làm Bước 1 (khai pháp nhân & ký hiệu) trước; hoặc gắn pháp nhân cho cơ sở ở màn Tổ chức."
        />
      </div>
    ) : null}
    {/* Khu tự ẩn (trả null, KHÔNG để lại khung rỗng) khi cờ `hoaDon.kyUsb` TẮT hoặc người xem không là kế toán ở đâu — trang y hệt trước. */}
    <Suspense fallback={null}>
      <KhuKyUsb actor={actor} />
    </Suspense>
    {coSo && hubBat ? (
      <div className="mt-10">
        <Suspense
          fallback={
            <div aria-busy="true" aria-label="Đang tải chính sách hoá đơn" className="flex flex-col gap-3">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-96 max-w-full" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          }
        >
          <KhuChinhSachHub actor={actor} coSo={coSo} dong={dong} homNay={ngayVN(new Date())} />
        </Suspense>
      </div>
    ) : null}
    </>
  );
}
