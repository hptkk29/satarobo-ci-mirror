// lib/hoa-hong/chinh-sach-quyen.ts — Ai được GHI cho chủ sở hữu nào (THUẦN). `scopedDb` chỉ che ĐỌC; đường ghi tự hỏi ở đây.
//
// Chủ sở hữu `null` = Hội sở / toàn hệ: đọc được ở mọi cơ sở (`NULL_IS_GLOBAL_MODELS`) nhưng chỉ người có tầm nhìn "ALL"
// (vai neo tại Hội sở, quản trị tối cao) được GHI — nếu không, một người chỉ thấy CS1 mà có `commission_policies:manage`
// (seed GLOBAL) sẽ sửa được chính sách áp dụng cho mọi cơ sở.
export type TamNhinChinhSach = "ALL" | readonly string[];

export function coTheGhiChoChuSoHuu(tamNhin: TamNhinChinhSach, chuSoHuuCenterId: string | null): boolean {
  if (tamNhin === "ALL") return true;
  if (chuSoHuuCenterId === null) return false;
  return tamNhin.includes(chuSoHuuCenterId);
}
