// Điểm danh BẮT BUỘC trước khi hoàn tất buổi trial + cảnh báo buổi đã qua giờ (chủ dự án chốt 04/11/2026).
//
// "Bắt buộc Sale phải điểm danh và hoàn thành buổi. Vắng nghĩa là PH không đến." Trước đây "Hoàn tất" không đọc điểm
// danh: bé chưa ai điểm danh vẫn bị đóng cùng case, và `ketCucKhiHoanTat` chỉ đếm bé CÓ MẶT nên một case toàn bé
// "chưa điểm danh" bị TỰ HUỶ như thể cả lớp vắng — vắng mà chưa ai xác nhận là vắng.
//
// THUẦN (không DB, không đồng hồ): mọi chỗ gọi hỏi ở đây; `now` là tham số BẮT BUỘC (luật 7 + 19).
import { vnDateAt } from "@/lib/time/vn";

/** Số bé của case chưa có bản ghi điểm danh nào (có mặt HAY vắng đều tính là đã điểm danh). */
export function soBeChuaDiemDanh(p: {
  beCuaCase: readonly { id: string }[];
  daDiemDanh: ReadonlySet<string>;
}): number {
  return p.beCuaCase.filter((b) => !p.daDiemDanh.has(b.id)).length;
}

/** Câu từ chối khi bấm "Hoàn tất" mà còn bé chưa điểm danh. MỘT câu cho server lẫn màn. */
export function loiHoanTatThieuDiemDanh(n: number): string {
  return `Còn ${n} học viên chưa điểm danh — điểm danh đủ (có mặt hoặc vắng) rồi mới hoàn tất buổi`;
}

export type CanhBaoCase =
  | {
      /** Qua giờ kết thúc mà còn bé chưa điểm danh. */
      loai: "CHUA_DIEM_DANH";
      soChuaDiemDanh: number;
    }
  | {
      /** Qua giờ kết thúc, bé đã điểm danh đủ nhưng case chưa bấm "Hoàn tất". */
      loai: "CHUA_HOAN_TAT";
      soChuaDiemDanh: 0;
    };

/**
 * Case có cần CẢNH BÁO không.
 *   · chỉ case còn `SCHEDULED` — case đã hoàn tất / đã huỷ không còn việc;
 *   · chỉ khi ĐÃ QUA giờ kết thúc (giờ VN của ngày case);
 *   · chỉ khi case còn bé — case trống đã có đường tự huỷ riêng (`LY_DO_HUY_CASE_TRONG_QUA_HAN`).
 *
 * `ngayYmd` = "YYYY-MM-DD" (ngày VN của case), `endTime` = "HH:MM".
 */
export function canhBaoCaseTrial(p: {
  trangThai: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  ngayYmd: string;
  endTime: string;
  soBe: number;
  soChuaDiemDanh: number;
  now: Date;
}): CanhBaoCase | null {
  if (p.trangThai !== "SCHEDULED" || p.soBe <= 0) return null;
  const ngay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.ngayYmd);
  const gio = /^(\d{1,2}):(\d{2})$/.exec(p.endTime);
  if (!ngay || !gio) return null;
  const ketThuc = vnDateAt(Number(ngay[1]), Number(ngay[2]) - 1, Number(ngay[3]), Number(gio[1]), Number(gio[2]));
  if (p.now.getTime() <= ketThuc.getTime()) return null;
  return p.soChuaDiemDanh > 0
    ? { loai: "CHUA_DIEM_DANH", soChuaDiemDanh: p.soChuaDiemDanh }
    : { loai: "CHUA_HOAN_TAT", soChuaDiemDanh: 0 };
}
