// lib/lead/tim-lead.ts — Ô TÌM LEAD DÙNG CHUNG (13/11/2026). PHẦN THUẦN: tách từ khoá + dựng mệnh đề SQL. Phần chạy DB ở `tim-lead-db.ts`.
//
// Vì sao có file này — hai lỗi CÂM của ô tìm cũ, cùng chép ở tám chỗ (trang /leads · hai bản xuất Excel · site Sale · ô tìm chung · gợi ý gắn lead…):
//   1. «Tên con» chỉ so với `Lead.childName` — tên đứa ĐẦU TIÊN. Phiếu nhiều con (`LeadChild`) thì đứa thứ hai trở đi KHÔNG BAO GIỜ tìm ra, trong khi cột hiện cả hai tên.
//   2. So theo đúng dấu: gõ «khai» không ra «Khải», «nguyen an» không ra «Nguyễn An». Prisma `contains` không có kiểu bỏ dấu và repo không có extension `unaccent`,
//      nên bỏ dấu bằng `translate()` thuần Postgres (không cần extension, không cần migration) trên CẢ cột lẫn từ khoá.
//
// Luật tìm (một chỗ, mọi màn cùng gọi):
//   · Tách từ khoá theo khoảng trắng; MỘT trường khớp khi chứa ĐỦ MỌI tiếng (gõ «an nguyen» vẫn ra «Nguyễn Văn An»). Tối đa `TU_KHOA_TOI_DA` tiếng.
//   · Các trường tên: tên phụ huynh · tên con trên phiếu · TỪNG bé trong `LeadChild`. Mỗi trường xét RIÊNG (không ghép tiếng của PH với tiếng của con).
//   · SĐT + email là PII: CHỈ tìm khi người tìm thấy được số thật (`duocTimSdtEmail`, cùng luật `canSearchPhone` — NỢ #11 / S-1). Thiếu quyền ⇒ hai nhánh này BIẾN MẤT khỏi câu.
//   · SĐT so theo phần lõi chữ số của CẢ `0…` lẫn `84…` (`phoneSearchTerm`), bỏ mọi dấu cách/chấm/gạch trong số đang lưu.
import { Prisma } from "@prisma/client";
import { boDau } from "@/lib/ui/bo-dau";
import { phoneSearchTerm } from "@/lib/phone";

/** Tối đa số tiếng khoá dùng để tìm — tiếng thứ 7 trở đi bị bỏ (không ai nhớ tên bằng chừng ấy chữ; chặn câu SQL phình theo đầu vào). */
export const TU_KHOA_TOI_DA = 6;
/** Mỗi tiếng cắt ở độ dài này. */
const DO_DAI_TIENG_TOI_DA = 40;
/** Trần số lead trả về từ một lượt tìm. Chạm trần ⇒ danh sách bị cắt: người dùng nên gõ cụ thể hơn (xem `TimLeadKetQua.daCat`). */
export const GIOI_HAN_ID_TIM = 5000;

const CHU_CO_DAU = "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ";
/** Dấu thanh/mũ ở dạng TỔ HỢP (NFD) — tên dán từ máy Mac/Zalo có thể lưu kiểu này; xoá bỏ để về chữ gốc. */
const DAU_TO_HOP = "̛̣̀́̂̃̆̉";

/**
 * Bảng cho `translate(cot, TU, THANH)`: mọi chữ có dấu (hoa + thường, dạng dựng sẵn) → chữ gốc thường; A–Z → a–z; dấu tổ hợp bị XOÁ (nằm cuối `TU`, không có ký tự tương ứng ở `THANH`).
 * Sinh bằng CHÍNH `boDau` dùng cho từ khoá ⇒ hai phía không thể lệch nhau.
 */
export const BANG_BO_DAU: { tu: string; thanh: string } = (() => {
  const chuHoaThuong = CHU_CO_DAU + CHU_CO_DAU.toUpperCase();
  const A_Z = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const tu = chuHoaThuong + A_Z;
  const thanh = [...chuHoaThuong].map((c) => boDau(c)).join("") + A_Z.toLowerCase();
  return { tu: tu + DAU_TO_HOP, thanh };
})();

/** Tách từ khoá: bỏ dấu, thường, theo khoảng trắng, bỏ trùng, tối đa `TU_KHOA_TOI_DA` tiếng. Rỗng ⇒ không có gì để tìm. */
export function tachTuKhoa(q: string): string[] {
  const tieng = boDau(q).split(/\s+/).filter(Boolean);
  return [...new Set(tieng.map((t) => t.slice(0, DO_DAI_TIENG_TOI_DA)))].slice(0, TU_KHOA_TOI_DA);
}

/** Thoát ký tự đặc biệt của `LIKE` (`\` `%` `_`) — từ khoá do người dùng gõ phải là chữ, không phải mẫu. */
export function thoatLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

const boDauCot = (cot: Prisma.Sql) => Prisma.sql`translate(coalesce(${cot}, ''), ${BANG_BO_DAU.tu}::text, ${BANG_BO_DAU.thanh}::text)`;
const chuaDuTieng = (cot: Prisma.Sql, tieng: string[]) => Prisma.join(tieng.map((t) => Prisma.sql`${boDauCot(cot)} LIKE ${`%${thoatLike(t)}%`}`), " AND ");

/**
 * Mệnh đề `WHERE` (đặt sau `FROM "Lead" l`) cho một chuỗi tìm; `null` khi chuỗi rỗng. KHÔNG kèm `deletedAt` / cơ sở / quyền sở hữu — người gọi gói kết quả vào `scopedDb` (xem `tim-lead-db.ts`).
 * Cột được ghép từ HẰNG chữ, chỉ từ khoá là tham số — không có đường nào đưa chuỗi người dùng vào tên cột.
 */
export function dieuKienTimLead(q: string, duocTimSdtEmail: boolean): Prisma.Sql | null {
  const tieng = tachTuKhoa(q);
  if (tieng.length === 0) return null;

  const nhanh: Prisma.Sql[] = [
    Prisma.sql`(${chuaDuTieng(Prisma.sql`l."parentName"`, tieng)})`,
    Prisma.sql`(${chuaDuTieng(Prisma.sql`l."childName"`, tieng)})`,
    // Từng bé trong phiếu — đây là vế mà bản cũ thiếu.
    Prisma.sql`EXISTS (SELECT 1 FROM "LeadChild" c WHERE c."leadId" = l."id" AND ${chuaDuTieng(Prisma.sql`c."fullName"`, tieng)})`,
  ];

  if (duocTimSdtEmail) {
    const loi = phoneSearchTerm(q);
    if (loi) nhanh.push(Prisma.sql`regexp_replace(coalesce(l."phone", ''), '[^0-9]', '', 'g') LIKE ${`%${thoatLike(loi)}%`}`);
    nhanh.push(Prisma.sql`(${chuaDuTieng(Prisma.sql`l."email"`, tieng)})`);
  }
  return Prisma.join(nhanh, " OR ");
}
