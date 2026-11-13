// lib/nguon/doc-bao-cao-nguon.ts — ĐỌC SỐ LEAD THEO «NGUỒN KHÁCH HÀNG» (nhóm nguồn của LeadAttribution) cho các dashboard (audit X · GAP 5A).
//
// VÌ SAO: khi cờ `nguon.enabled` BẬT, `Lead.source` của lead mới là KÊNH KỸ THUẬT (`sale-form-app`, `Import Excel`, `Nhập tay`…) — chủ ý. Ba dashboard cũ vẫn nhóm theo cột đó nên biểu đồ
// «Nguồn lead» lai lịch sử (nhãn cũ) với một cột lớn «sale-form-app». Nguồn nghiệp vụ nằm ở `LeadAttribution.groupId`.
//
// CÁCH ĐỌC (cách ly cơ sở): chỉ đi qua `scopedDb(actor).lead.count` với bộ lọc LỒNG `attribution: { is: { groupId } }` — `Lead` ∈ SCOPED_MODELS nên CS1 không thấy lead CS2, và `LeadAttribution`
// (không có centerId — ngoại lệ có chủ đích 07/10) KHÔNG BAO GIỜ bị đọc thẳng. Số nhóm nguồn nhỏ (≤ vài chục) nên N câu `count` song song rẻ hơn kéo cả bảng về đếm bằng JS.
//
// Lead chưa có dòng quy nguồn (trước cutover, hoặc `chuanBiQuyNguon` lỗi) ⇒ dòng «Chưa quy nguồn» — KHÔNG biến mất khỏi tổng.
import type { Prisma } from "@prisma/client";
import type { scopedDb } from "@/lib/db-scope";

type Sdb = ReturnType<typeof scopedDb>;

export const NHAN_CHUA_QUY_NGUON = "Chưa quy nguồn";

export type DongLeadTheoNguon = { nhomId: string | null; ten: string; soLead: number };

/**
 * Số lead (chưa xoá) theo nhóm nguồn, giảm dần; nhóm 0 lead bị bỏ; «Chưa quy nguồn» nằm cuối khi > 0 và LUÔN được giữ (không chịu `toiDa`).
 * `where` thêm vào bộ lọc gốc (vd. khoảng thời gian); `deletedAt: null` luôn áp.
 */
export async function docLeadTheoNguon(
  sdb: Sdb,
  opts: { where?: Prisma.LeadWhereInput; toiDa?: number } = {},
): Promise<DongLeadTheoNguon[]> {
  const goc: Prisma.LeadWhereInput = { ...(opts.where ?? {}), deletedAt: null };
  const nhom = await sdb.leadSourceGroup.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } });
  const [theoNhom, chuaQuy] = await Promise.all([
    Promise.all(
      nhom.map(async (g) => ({
        nhomId: g.id as string | null,
        ten: g.name,
        soLead: await sdb.lead.count({ where: { AND: [goc, { attribution: { is: { groupId: g.id } } }] } }),
      })),
    ),
    sdb.lead.count({ where: { AND: [goc, { attribution: { is: null } }] } }),
  ]);
  const dong = theoNhom.filter((d) => d.soLead > 0).sort((a, b) => b.soLead - a.soLead || a.ten.localeCompare(b.ten, "vi"));
  const cat = opts.toiDa !== undefined ? dong.slice(0, opts.toiDa) : dong;
  return chuaQuy > 0 ? [...cat, { nhomId: null, ten: NHAN_CHUA_QUY_NGUON, soLead: chuaQuy }] : cat;
}
