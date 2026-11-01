import "server-only";

import { db } from "@/lib/db";

export type VaiNhanHoaHong = {
  /** Mã vai — thứ lưu vào chính sách. */
  ma: string;
  /** Tên tiếng Việt — thứ hiện lên màn. */
  ten: string;
};

/**
 * Vai đặc biệt KHÔNG có trong `RoleDef` nhưng chính sách cần tới.
 *
 * SR.QD.208 PL05: hoa hồng bán thiết bị áp cho "TẤT CẢ các nhân sự khi bán được thiết bị"
 * — không phải một vai nào cả. Ép nó thành một vai có thật là bịa ra một nhóm người mà
 * công văn không hề khoanh.
 */
const VAI_DAC_BIET: VaiNhanHoaHong[] = [
  { ma: "MOI_NHAN_SU", ten: "Mọi nhân sự (ai bán được cũng nhận)" },
];

/**
 * Vai có thật trong hệ thống, KÈM TÊN TIẾNG VIỆT.
 *
 * ⚠️ Chủ dự án 14/09/2026: "vai nhận phải ghi ra thành ngôn ngữ bình thường chứ không
 * dùng HO_SALE_ADMIN… vai nhận thì lấy toàn bộ role có trong hệ thống đưa vào để chọn."
 * Nên hàm này lấy TOÀN BỘ `RoleDef`, không lọc — chính sách hoa hồng có thể trỏ tới bất
 * kỳ vai nào, kể cả vai mới tạo tuần trước.
 *
 * `RoleDef.name` là nguồn tên; thiếu tên thì lùi về mã chứ không để trống — một ô chọn
 * rỗng còn tệ hơn một mã máy.
 *
 * Hỏng thì trả vai đặc biệt chứ không ném: mất danh sách là phiền, còn màn cấu hình sập
 * vì một câu tra phụ trợ là mất luôn đường sửa chính sách.
 */
export async function layVaiNhanHoaHong(): Promise<VaiNhanHoaHong[]> {
  try {
    const vai = await db.roleDef.findMany({
      select: { code: true, name: true },
      orderBy: { name: "asc" },
    });
    return [
      ...vai.map((v) => ({ ma: v.code, ten: v.name?.trim() || v.code })),
      ...VAI_DAC_BIET,
    ];
  } catch {
    return VAI_DAC_BIET;
  }
}
