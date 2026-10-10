/**
 * lib/nguon/bo-sung-sale-db.ts — «BỔ SUNG SALE PHỤ TRÁCH PHỤ HUYNH» chọn theo NHÂN SỰ (ô tìm của giao diện là ô tìm nhân sự — `ReferrerPicker` loại NHAN_SU trả `employeeId`).
 *
 * Việc DUY NHẤT của tệp này: đổi `employeeId` → `User.id` rồi giao cho `boSungSalePhuHuynh` (`doi-nguon-lead.ts`) — nơi có MỌI cổng (cơ sở · quyền · lý do · TU_CLAIM · D13 · first-claim · audit).
 * Không có luật riêng, không đường ghi thứ hai.
 *
 * Nhân sự chưa có tài khoản đăng nhập: không thể là «Sale phụ trách» (hoa hồng trả theo `User`). KHÔNG trả câu riêng cho ca này TRƯỚC các cổng — nếu trả, người xem lead mà không có quyền
 * dò được «nhân sự này có tài khoản không» qua mã nhân sự. Thay vào đó đưa một id KHÔNG tồn tại xuống `boSungSalePhuHuynh`: nó chạy đủ cổng rồi mới nói
 * «Sale được chọn không còn làm việc hoặc không có hồ sơ nhân sự» — cùng câu với nhân sự đã nghỉ.
 */
import { db } from "@/lib/db";
import { boSungSalePhuHuynh, type KetQuaDoiNguonLead } from "./doi-nguon-lead";

/** Id cố ý không tồn tại — `User.id` là cuid nên không bao giờ chứa dấu cách. */
const KHONG_CO_TAI_KHOAN = "khong co tai khoan dang nhap";

export async function boSungSaleTheoNhanSu(p: Omit<Parameters<typeof boSungSalePhuHuynh>[0], "saleUserId"> & { saleEmployeeId: string }): Promise<KetQuaDoiNguonLead> {
  const { saleEmployeeId, ...conLai } = p;
  const u = await db.user.findFirst({ where: { employeeId: saleEmployeeId, deletedAt: null }, select: { id: true } });
  return boSungSalePhuHuynh({ ...conLai, saleUserId: u?.id ?? KHONG_CO_TAI_KHOAN });
}
