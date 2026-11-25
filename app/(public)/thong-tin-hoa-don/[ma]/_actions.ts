"use server";

import { headers } from "next/headers";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { xuLyGui, type KetQuaGuiCongKhai } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai";
import { phuThuocThat } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai-db";
import { PHIEN_BAN_DIEU_KHOAN } from "./_hang-so";

// Server Action công khai: phụ huynh gửi thông tin người mua. KHÔNG có actor / phiên đăng nhập — quyền của người gọi là CẦM ĐÚNG liên kết `<id>.<token>`.
// Mọi cổng (rate-limit → cơ sở → cờ → kiểm biểu mẫu → dịch vụ) nằm ở `xuLyGui`; tệp này chỉ lấy IP + đồng hồ rồi chuyển tiếp. Thông điệp trả về đã là tiếng Việt thường ngày,
// không có mã lỗi nội bộ. Không log token / giá trị ô.
export async function guiThongTinNguoiMuaAction(ma: string, input: unknown): Promise<KetQuaGuiCongKhai> {
  const ip = ipChoRateLimit(await headers());
  return xuLyGui({ ma, ip, raw: input, phienBanDieuKhoan: PHIEN_BAN_DIEU_KHOAN, now: new Date() }, phuThuocThat());
}
