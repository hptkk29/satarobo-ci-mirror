/**
 * lib/nguon/xuat-lead-day-du-tep.ts — dựng TỆP EXCEL từ kết quả `docLeadDayDu`. THUẦN (không DB, không phiên): route cần phiên đăng nhập nên test không gọi thẳng được, hàm này thì đọc lại được tệp thật.
 *
 * Cột SĐT / mã phải là Text (`chuoi`): Excel nuốt số 0 đầu của «0907123456» và biến mã dài thành số khoa học — hỏng đúng những cột dùng để đối chiếu.
 */
import type ExcelJS from "exceljs";
import { dungWorkbook, type CotXuat } from "@/lib/cham-cong/xuat-bang";
import type { KetQuaXuatLeadDayDu } from "./xuat-lead-day-du";

export function dungTepLeadDayDu(kq: KetQuaXuatLeadDayDu, watermark: string): ExcelJS.Workbook {
  const cot: CotXuat<(string | number)[]>[] = kq.cotLead.map((nhan, i) => ({
    nhan,
    lay: (r) => r[i],
    chuoi: kq.cotChuoi.includes(i),
    rong: nhan.length > 22 ? Math.min(40, nhan.length + 2) : undefined,
  }));
  return dungWorkbook({
    tieuDe: `TOÀN BỘ LEAD — ${kq.tong} lead`,
    tenSheet: "Du lieu",
    cot,
    dong: kq.dongLead,
    watermark,
    bangPhu: kq.bangPhu,
    ghiChu: [
      "Mỗi dòng là MỘT lead (đã xoá mềm thì không có). Sheet «Con» · «Tin hieu nguon» · «Lich su trang thai» nối với sheet này bằng cột «Mã lead».",
      "Cột «NGUỒN hiện hành» là nguồn nghiệp vụ dùng để tính hoa hồng; «Đường vào» chỉ là kênh kỹ thuật lead đi vào (nhap-khach-hang, Import Excel…).",
      "Tệp lấy TOÀN BỘ lead trong phạm vi bạn được xem — không theo bộ lọc đang đặt trên màn.",
      ...(kq.daChePii ? ["Bạn KHÔNG có quyền xem thông tin liên hệ lead: tên, SĐT, email, ghi chú đã bị che; ngày sinh, link Facebook, IP và nhật ký chăm sóc được giấu hẳn."] : []),
    ],
  });
}
