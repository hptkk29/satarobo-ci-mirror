// lib/hoa-hong/quyen-sua-tran.ts — NGƯỜI XEM CÓ SỬA ĐƯỢC Ô «TRẦN TỔNG HOA HỒNG» KHÔNG (phía máy chủ). Server-only: kéo `auth()`.
//
// Cổng LƯU của ô là `settings:edit` (action của màn Cấu hình vận hành). Trình soạn chính sách vẽ liên kết «Mở Cấu hình vận hành để nâng trần» CHỈ cho người có khoá này — vẽ cho người khác là
// mời họ bấm vào một màn không sửa được ô (luật 12). Khoá nằm ở `loi-ra-vuot-tran.ts` (thuần, client đọc được); ở đây chỉ là câu hỏi quyền. Không thêm khoá này vào `MODULE_KEYS`
// của khung module: nó không phải quyền của module, và danh sách đó có lưới riêng.
import "server-only";

import { checkPermission } from "@/lib/auth/check-permission";

import { QUYEN_SUA_TRAN } from "./loi-ra-vuot-tran";

export async function docCoQuyenSuaTran(): Promise<boolean> {
  return checkPermission(QUYEN_SUA_TRAN);
}
