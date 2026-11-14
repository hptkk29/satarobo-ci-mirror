"use client";
/**
 * Trang «Tủ sách gia đình» (07/11/2026): hộp «để lại thông tin» dùng chung + giao diện sinh từ artifact + logic view-model.
 * CSS nạp ở `app/(public)/tu-sach/page.tsx` (`pub-design/cong-thong-tin.css` + `pub-design/tu-sach.css`).
 */
import { useEffect } from "react";
import { CongThongTinProvider } from "@/components/public/cong-thong-tin/hop-de-lai-thong-tin";
import { TuSachView } from "./tu-sach-view";
import { useTuSachVm } from "./vm";

const CAU_HINH = {
  tieuDe: "Để lại thông tin để tải sách",
  moTa: "Đọc trực tuyến luôn miễn phí. Để lại thông tin một lần, ba mẹ tải được mọi cuốn trong tủ sách.",
  nut: "Lưu và tải về",
  okMoTa: "Từ giờ ba mẹ tải được mọi cuốn trong tủ sách.",
  okNut: "Tải sách",
} as const;

/** Phần tử có `data-to="#id"` cuộn mượt tới mục tương ứng (thiết kế dùng cho các nút «Mở tủ sách», «Cách đọc và tải sách»…). */
function useCuonTheoDataTo() {
  useEffect(() => {
    const bam = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-to]");
      const id = el?.getAttribute("data-to")?.replace(/^#/, "");
      if (!id) return;
      const dich = document.getElementById(id);
      if (!dich) return;
      e.preventDefault();
      dich.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    document.addEventListener("click", bam);
    return () => document.removeEventListener("click", bam);
  }, []);
}

function NoiDung() {
  const vm = useTuSachVm();
  useCuonTheoDataTo();
  return (
    <>
      <TuSachView vm={vm} />
      {vm.coToast && (
        <p className="ts-toast" role="status">
          {vm.toast}
        </p>
      )}
    </>
  );
}

export function TuSachTrang({ daMoKhoa }: { daMoKhoa: boolean }) {
  return (
    <CongThongTinProvider nguon="tu-sach" daMoKhoaBanDau={daMoKhoa} cauHinh={CAU_HINH}>
      <NoiDung />
    </CongThongTinProvider>
  );
}
