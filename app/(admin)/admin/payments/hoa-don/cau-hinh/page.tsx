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
import { phapNhanTheoCayToChuc } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import { cauHinhHoaDonChoMoiTruong } from "@/lib/finance/hoa-don/phap-nhan-theo-moi-truong";
import { TieuDeMuc } from "../_components/tieu-de-muc";
import { ngayVN } from "../_components/phap-nhan-hien-thi";
import { CauHinhCoSo } from "./_components/cau-hinh-co-so";
import { KhuChinhSachHub } from "./_components/khu-chinh-sach-hub";
import { DieuHuongTrongTrang } from "./_components/dieu-huong-trong-trang";

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

  return (
    <>
    {coSo && hubBat ? (
      <DieuHuongTrongTrang
        muc={[
          { id: "phap-nhan-ky-hieu", nhan: "Pháp nhân & ký hiệu" },
          { id: "cs-tieu-de", nhan: "Chính sách hoá đơn" },
          { id: "ncc-tieu-de", nhan: "Nhà cung cấp & ký" },
        ]}
      />
    ) : null}
    <div id="phap-nhan-ky-hieu">
      <TieuDeMuc
        tieuDe="Pháp nhân & ký hiệu"
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
