import "server-only";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { docCauHinhNguoiMua, laHubNguoiMuaBatChoCoSo } from "./feature";
import { MAU_ID_YEU_CAU } from "./yeu-cau-nguoi-mua-token";
import { guiThongTinPhuHuynh, moBangToken } from "./yeu-cau-nguoi-mua-db";
import type { PhuThuoc } from "./yeu-cau-nguoi-mua-cong-khai";

// lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai-db.ts — NỐI `PhuThuoc` của đường công khai với hệ thật: rate-limit, Postgres, cờ, dịch vụ ghi. Không chứa luật (luật ở
// `yeu-cau-nguoi-mua-cong-khai.ts`); không đọc đồng hồ (tầng trang / action truyền `now`).

/**
 * Cơ sở của yêu cầu theo id. KHÔNG có tác dụng phụ: đây là lý do cờ kiểm được TRƯỚC `moBangToken` (hàm đó tăng `soLanMo` / bộ đếm sai — «cờ TẮT ⇒ không ghi gì»
 * đòi biết cơ sở mà chưa chạm vào yêu cầu). Id sai hình dạng ⇒ `null` mà không chạm DB.
 */
export async function docCoSoCuaYeuCau(id: string): Promise<string | null> {
  if (typeof id !== "string" || !MAU_ID_YEU_CAU.test(id)) return null;
  const r = await db.hoaDonYeuCauNguoiMua.findUnique({ where: { id }, select: { centerId: true } });
  return r?.centerId ?? null;
}

export function phuThuocThat(): PhuThuoc {
  return {
    choPhep: async (khoa, toiDa, cuaSoMs) => (await rateLimit({ key: khoa, max: toiDa, windowMs: cuaSoMs })).success,
    docCoSo: docCoSoCuaYeuCau,
    hubBat: laHubNguoiMuaBatChoCoSo,
    docCauHinh: docCauHinhNguoiMua,
    mo: moBangToken,
    gui: guiThongTinPhuHuynh,
    // Chỉ TÊN loại lỗi (xem đầu `yeu-cau-nguoi-mua-cong-khai.ts`): thông điệp lỗi Prisma có thể chứa giá trị đang ghi.
    ghiLoi: (tenLoi) => console.error(`[hoa-don-nguoi-mua] đường công khai gặp lỗi: ${tenLoi}`),
  };
}
