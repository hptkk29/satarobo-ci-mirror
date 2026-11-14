/**
 * lib/nguon/chup-lai-chu-nguon-sql.ts — MẢNH SQL dùng chung của «chụp lại chủ nguồn» (đọc đếm · chọn lô · ghi lô). Chỉ là biểu thức, không chạy gì.
 *
 * Vì sao là SQL thô chứ không phải accessor: `signals` là JSON tuỳ ý, mà thứ cần là «đổi ĐÚNG MỘT khoá lồng (`nguon.chuNhanVienId`) của cả lô bằng MỘT câu lệnh» — accessor Prisma chỉ
 * thay được nguyên cột JSON, tức mỗi dòng một `update` (100 vòng đi-về/lô, trần transaction 5 giây). SQL thô vào hai bảng nguồn chỉ được phép trong `lib/nguon/**` (`[QN-W11]`),
 * và phép GHI nằm duy nhất ở `ghi-nguon.ts` (`ghiChuNguonChupLo`).
 *
 * `BAN_CHUP_HOP_LE` là bản SQL của `nguonChupSchema` (strict): đúng hai khoá, `cuaSoNgay` nguyên 1..CUA_SO_NGAY_NGUON_TOI_DA, `chuNhanVienId` chuỗi khác rỗng hoặc JSON null. Lệch với Zod
 * là lệch giữa «số lead hiện ra trên nút» và «số lead được ghi» — nên `tests/hoa-hong/nguon-chup-lai-chu.spec.ts` [CLC-DB-01] đối chiếu hai bên trên cùng một bảng hình dạng.
 * `CASE` (không `AND` trần) vì Postgres không bảo đảm thứ tự đánh giá của `AND`: ép kiểu `::numeric` trước khi kiểm `jsonb_typeof` là ném lỗi trên dòng hỏng.
 */
import { Prisma } from "@prisma/client";
import { CUA_SO_NGAY_NGUON_TOI_DA } from "./nguon-chup";

const TOI_DA = Prisma.raw(String(CUA_SO_NGAY_NGUON_TOI_DA));

/** Chủ đã chụp (văn bản); SQL NULL cho cả «JSON null» lẫn «không có khoá». Chỉ có nghĩa khi `BAN_CHUP_HOP_LE`. */
export const CHU_DA_CHUP = Prisma.sql`("signals"->'nguon'->>'chuNhanVienId')`;

export const BAN_CHUP_HOP_LE = Prisma.sql`(
  jsonb_typeof("signals"->'nguon') = 'object'
  AND ("signals"->'nguon') - 'cuaSoNgay' - 'chuNhanVienId' = '{}'::jsonb
  AND jsonb_exists("signals"->'nguon', 'cuaSoNgay')
  AND jsonb_exists("signals"->'nguon', 'chuNhanVienId')
  AND CASE WHEN jsonb_typeof("signals"->'nguon'->'cuaSoNgay') = 'number'
        THEN ("signals"->'nguon'->>'cuaSoNgay')::numeric BETWEEN 1 AND ${TOI_DA}
             AND ("signals"->'nguon'->>'cuaSoNgay')::numeric = trunc(("signals"->'nguon'->>'cuaSoNgay')::numeric)
        ELSE false END
  AND CASE jsonb_typeof("signals"->'nguon'->'chuNhanVienId')
        WHEN 'null' THEN true
        WHEN 'string' THEN length("signals"->'nguon'->>'chuNhanVienId') > 0
        ELSE false END
)`;

/**
 * «Lead này ĐÃ CÓ khoản chi cho vai chủ nguồn còn hiệu lực» — MỘT định nghĩa cho cả ba nơi dùng (đếm ở `docNhomChupLai` · chọn lô · `WHERE` của phép ghi); lệch nhau là số trên nút khác số dòng ghi.
 * Còn hiệu lực = Σ `amount` của các dòng sổ `resolverType = SOURCE_OWNER` của bản quy nguồn, theo từng người hưởng, KHÁC 0: dòng gốc +, dòng đảo (hoàn tiền) −, nên hoàn trọn thì về 0 và không còn là «đã chi»;
 * hoàn một phần thì vẫn còn. Không xét `payoutStatus` — dòng chờ duyệt cũng là tiền đã tính cho người đó.
 * Vì sao loại khỏi diện chụp lại (fin3 R5 M1): đổi chủ đã chụp của lead ĐÃ chi cho A rồi quét lại sinh INPUT_DRIFT A −x / B +x, một cú «Áp dụng» là THU HỒI hồi tố từ người được trả hợp lệ. Lead đó GIỮ chủ cũ;
 * chỉ khoản CHƯA chi mới chuyển người nhận.
 * ⚠️ Cột phải gọi tên đủ `"LeadAttribution"."id"`: trong truy vấn con, `"id"` trần là `CommissionTransaction.id` — phép loại sẽ im lặng không làm gì. Chỉ dùng trong câu có `FROM`/`UPDATE "LeadAttribution"` (không bí danh).
 */
export const DA_CHI_CHU_NGUON = Prisma.sql`EXISTS (
  SELECT 1 FROM "CommissionTransaction" ct
  WHERE ct."resolverType" = 'SOURCE_OWNER' AND ct."attributionId" = "LeadAttribution"."id"
  GROUP BY ct."beneficiaryUserId"
  HAVING sum(ct."amount") <> 0
)`;

/**
 * Dòng cần chụp lại theo TẬP chủ đã chụp: `chuNghi` là các `Employee.id` bị coi là không còn hiệu lực (xem `phanLoaiChuChup`); `thieuChu` cho chụp `null`.
 * Luôn kèm `BAN_CHUP_HOP_LE` ở nơi dùng. Dòng đã chi cho chủ cũ (`DA_CHI_CHU_NGUON`) KHÔNG thuộc diện — đúng một chỗ, ở đây.
 */
export function dieuKienTheoChu(p: { thieuChu: boolean; chuKhongConHieuLuc: readonly string[]; chuHienTai: string }): Prisma.Sql {
  const hoac: Prisma.Sql[] = [];
  if (p.thieuChu) hoac.push(Prisma.sql`${CHU_DA_CHUP} IS NULL`);
  if (p.chuKhongConHieuLuc.length > 0) hoac.push(Prisma.sql`${CHU_DA_CHUP} = ANY(${[...p.chuKhongConHieuLuc]}::text[])`);
  // Không có vế nào ⇒ không dòng nào (KHÔNG bao giờ rơi về «mọi dòng»).
  if (hoac.length === 0) return Prisma.sql`false`;
  return Prisma.sql`(${Prisma.join(hoac, " OR ")}) AND ${CHU_DA_CHUP} IS DISTINCT FROM ${p.chuHienTai} AND NOT ${DA_CHI_CHU_NGUON}`;
}
