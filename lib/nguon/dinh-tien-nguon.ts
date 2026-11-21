/**
 * lib/nguon/dinh-tien-nguon.ts — NGUỒN NÀY ĐANG «DÍNH TIỀN» THEO RULE NÀO: MỘT chỗ ĐỌC cho cổng ghi (trong transaction) lẫn màn hình (nút nói thật). CHỈ ĐỌC.
 *
 * ── Vì sao có (W2, 10/10/2026 — res3 R3-M2/M3 · res1 R1-M1 · res2 R2-M1) ──────────────────────────────────────────────────────────────────────────────
 * Ba câu hỏi «nguồn có chính sách riêng đang chạy không · rule vai SOURCE_OWNER chạy trên nó không · trong chính sách riêng có dòng thu hút không» từng được hỏi ở BA nơi bằng ba truy vấn
 * chép tay (`suaNguon` · `taoNguon`/`doiTrangThaiNguon` · `docFormSuaNguon`) và màn hình KHÔNG hỏi gì — nên nút «Kích hoạt» vẽ ra rồi máy chủ mới từ chối (affordance nói dối, luật 12). Nay cả
 * máy chủ lẫn màn hình gọi cùng `docDinhTienNguon`; phép kết hợp (rule chủ chạy trên nguồn = rule không gắn nguồn nào HOẶC rule của chính nguồn) là hàm THUẦN `ruleChuChayChoNguon`.
 *
 * «Rule vai SOURCE_OWNER chạy trên nguồn G» = rule ở version ACTIVE có `scopeSourceGroupId = G` (rule của chính nguồn) HOẶC có phạm vi KHÔNG gắn nguồn nào (chung · đơn vị · vai…) — phạm vi nguồn KHÁC
 * thì không liên quan. `G = null` (nguồn đang được TẠO, chưa có id) ⇒ chỉ còn phạm vi không gắn nguồn. «Dòng thu hút» là vị từ của engine (`laDongThuHut`), không viết lại.
 *
 * Số truy vấn KHÔNG phụ thuộc số nguồn: ba câu cho cả danh sách. `client` có thể là transaction (cổng ghi, sau khi đã khoá) hoặc `db` (màn hình).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { laDongThuHut, type KieuTinh } from "@/lib/hoa-hong/chon-quy-tac";

type Khach = PrismaClient | Prisma.TransactionClient;

export type DinhTienMotNguon = {
  /** Có phiên bản chính sách ACTIVE phạm vi RIÊNG nguồn này (`scopeSourceGroupId`). */
  chinhSachRieng: boolean;
  /** …và trong đó có ít nhất một dòng THU HÚT (mọi kiểu tính trừ EXCLUDE) — tắt `commissionEnabled` sẽ làm dòng ấy ngừng chạy. */
  coDongThuHutRieng: boolean;
  /** Có rule vai SOURCE_OWNER ACTIVE ở phạm vi RIÊNG nguồn này. */
  ruleChuRieng: boolean;
};

export type DinhTienNguon = {
  /** Có rule vai SOURCE_OWNER ACTIVE ở phạm vi KHÔNG gắn nguồn nào (chung · đơn vị · vai…) — trả cho chủ của MỌI nguồn. */
  ruleChuChung: boolean;
  /** Có rule vai SOURCE_OWNER ACTIVE ở BẤT KỲ phạm vi nào (kể cả phạm vi của một nguồn khác). */
  ruleChuBatKy: boolean;
  theoNguon: ReadonlyMap<string, DinhTienMotNguon>;
};

const KHONG: DinhTienMotNguon = { chinhSachRieng: false, coDongThuHutRieng: false, ruleChuRieng: false };

/** Đúng `groupIds` được hỏi; id không có chính sách riêng nào vẫn có mặt trong `theoNguon` (giá trị `KHONG`). */
export async function docDinhTienNguon(client: Khach, groupIds: readonly string[]): Promise<DinhTienNguon> {
  const ids = [...new Set(groupIds)];
  const [phienBan, ruleChuChung, ruleChuBatKy] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : client.commissionPolicyVersion.findMany({
          where: { status: "ACTIVE", scopeSourceGroupId: { in: ids } },
          select: { scopeSourceGroupId: true, rules: { select: { calcKind: true, beneficiaryRole: { select: { resolverType: true } } } } },
        }),
    client.commissionRule.findFirst({
      where: { version: { status: "ACTIVE", scopeType: { not: "SOURCE_GROUP" } }, beneficiaryRole: { resolverType: "SOURCE_OWNER" } },
      select: { id: true },
    }),
    client.commissionRule.findFirst({ where: { version: { status: "ACTIVE" }, beneficiaryRole: { resolverType: "SOURCE_OWNER" } }, select: { id: true } }),
  ]);
  const theoNguon = new Map<string, DinhTienMotNguon>(ids.map((id) => [id, KHONG]));
  for (const v of phienBan) {
    if (v.scopeSourceGroupId === null) continue;
    const cu = theoNguon.get(v.scopeSourceGroupId) ?? KHONG;
    theoNguon.set(v.scopeSourceGroupId, {
      chinhSachRieng: true,
      coDongThuHutRieng: cu.coDongThuHutRieng || v.rules.some((r) => laDongThuHut(r.calcKind as KieuTinh)),
      ruleChuRieng: cu.ruleChuRieng || v.rules.some((r) => r.beneficiaryRole.resolverType === "SOURCE_OWNER"),
    });
  }
  return { ruleChuChung: ruleChuChung !== null, ruleChuBatKy: ruleChuBatKy !== null, theoNguon };
}

/** Dinh tiền của MỘT nguồn trong kết quả (id vắng ⇒ `KHONG`). */
export function dinhTienCuaNguon(d: DinhTienNguon, groupId: string | null): DinhTienMotNguon {
  return groupId === null ? KHONG : (d.theoNguon.get(groupId) ?? KHONG);
}

/** Rule vai SOURCE_OWNER có CHẠY trên nguồn này không: rule không gắn nguồn nào, hoặc rule của chính nó. `groupId = null` (nguồn đang tạo) ⇒ chỉ phần đầu. THUẦN. */
export function ruleChuChayChoNguon(d: DinhTienNguon, groupId: string | null): boolean {
  return d.ruleChuChung || dinhTienCuaNguon(d, groupId).ruleChuRieng;
}
