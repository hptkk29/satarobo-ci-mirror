// components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-lich-su.tsx — MỤC 7 «Lịch sử» của trang chi tiết nguồn: nhật ký tạo/sửa/kích hoạt/ngừng + gán Page, mới nhất trước.
//
// Chỉ ĐỌC (AuditTimeline không có nút nào). Có GIỚI HẠN: mặc định vài dòng mới nhất, một liên kết mở tới trần 200. Chạm trần thì nói thật «có thể còn cũ hơn» — không giả vờ đã đủ.
import Link from "next/link";
import type { MucLichSuNguon } from "@/lib/nguon/doc-chi-tiet-nguon";
import type { KetQuaMuc } from "@/lib/nguon/doc-trang-chi-tiet";
import { TRAN_LICH_SU_NGUON } from "@/lib/nguon/doc-trang-chi-tiet";
import { AuditTimeline } from "../audit-timeline";
import { MucChiTiet, MucKhongDoc, MucRong } from "./khung-muc";
import { dungMucThoiGian } from "./nhan-chi-tiet";

export function MucLichSu({
  lichSu,
  dangXemTatCa,
  hrefXemTatCa,
  hrefThuGon,
}: {
  lichSu: KetQuaMuc<{ muc: MucLichSuNguon[]; biCat: boolean }>;
  dangXemTatCa: boolean;
  hrefXemTatCa: string;
  hrefThuGon: string;
}) {
  return (
    <MucChiTiet id="lich-su" tieuDe="Lịch sử" ghiChu="Ai đổi gì, lúc nào, vì sao. Chỉ đọc — nhật ký không sửa, không xoá được.">
      {!lichSu.ok ? (
        <MucKhongDoc loai={lichSu.loai} />
      ) : lichSu.du.muc.length === 0 ? (
        <MucRong>Chưa có thay đổi nào được ghi lại cho nguồn này.</MucRong>
      ) : (
        <>
          <AuditTimeline muc={lichSu.du.muc.map(dungMucThoiGian)} />
          <p className="mt-3 text-xs text-muted-foreground" data-lich-su-chan>
            {lichSu.du.biCat && !dangXemTatCa && (
              <>
                Đang hiển thị {lichSu.du.muc.length} thay đổi mới nhất.{" "}
                <Link href={hrefXemTatCa} className="font-semibold text-foreground underline underline-offset-2 hover:no-underline">
                  Xem tối đa {TRAN_LICH_SU_NGUON} thay đổi
                </Link>
              </>
            )}
            {lichSu.du.biCat && dangXemTatCa && (
              <>Đang hiển thị {lichSu.du.muc.length} thay đổi mới nhất; có thể còn những thay đổi cũ hơn chưa hiện ở đây.</>
            )}
            {!lichSu.du.biCat && <>Hiển thị đủ {lichSu.du.muc.length} thay đổi.</>}
            {dangXemTatCa && (
              <>
                {" "}
                <Link href={hrefThuGon} className="font-semibold text-foreground underline underline-offset-2 hover:no-underline">
                  Thu gọn
                </Link>
              </>
            )}
          </p>
        </>
      )}
    </MucChiTiet>
  );
}
