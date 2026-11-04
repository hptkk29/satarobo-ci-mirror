// lib/hoa-hong/giai-thich-db.ts — GHI giải thích «vì sao 0đ» vào `CommissionExplainLine` (Hướng G). Phần THUẦN ở `giai-thich-khong-tien.ts`; phần ĐỌC ở `giai-thich-doc.ts`.
//
// MỘT hàm ghi: `ghiGiaiThich`. `quet-khoan.ts` gọi nó ở ĐÚNG HAI chỗ, cả hai TRONG giao dịch của ô tính (lưới `[GTK-W1]`):
//   · `ghiMoiThu`  — ô vừa được tạo: giải thích sinh CÙNG LÚC với ô, nếu giao dịch lùi thì giải thích lùi theo;
//   · `soVoiOThu`  — ô đã có: CHỈ CHỮA CHỖ THIẾU (ô tạo trước khi có tính năng), không bao giờ viết lại.
//
// MỌI cổng đều nằm TRONG hàm này, không ở chỗ gọi (chỗ gọi là hàm Hướng B đang sửa — chỉ thêm MỘT dòng):
//   1. kết quả tính không phải OK / điều chỉnh tăng chép từ ô gốc (`chepTu`) ⇒ không ghi: không có «vai treo» của riêng khoản này;
//   2. đầu vào đã đổi mà người rà CHƯA duyệt (hash chưa được chấp nhận, hoặc đang có INPUT_DRIFT) ⇒ không ghi: một hiện trạng chưa chốt thì chưa giải thích;
//   3. người ấy ĐÃ có tiền ròng ≠ 0 ở ô này (vd INPUT_DRIFT bị «giữ nguyên» nên hash đã chấp nhận mà sổ vẫn trả) ⇒ không ghi «0đ» cho họ;
//   4. đã có dòng cho (ô × vai × người × lý do) ⇒ không ghi thêm. Nên mỗi khoá ĐÚNG MỘT dòng: hoàn tiền, đổi tỉ lệ, đổi cửa sổ SAU ĐÓ không sinh dòng thứ hai (ảnh chụp lúc ghi).
// Ghi bằng `createMany({ skipDuplicates })` = INSERT … ON CONFLICT DO NOTHING: hai lượt quét đua nhau không văng P2002 (lỗi đó làm hỏng CẢ giao dịch Postgres).
//
// Tính lại từ ĐẦU VÀO của kế hoạch (`kh.dauVao(netBase)`) chứ không nhận `kq` từ ngoài: `netBase` truyền vào là cơ sở GỐC của ô (không phải cơ sở còn lại sau hoàn), nên «lẽ ra»
// luôn là số của lần thu ấy dù ghi lúc tạo ô hay lúc chữa muộn.
import { Prisma } from "@prisma/client";

import type { BoiCanhQuet } from "./boi-canh";
import { dungGiaiThich, type CuaSoGhiCong } from "./giai-thich-khong-tien";
import { khoaNguoi, type KhoaNguoi } from "./khoa-so";
import { tinhDongChoKhoan, type DauVaoKhoan } from "./tinh-dong-cho-khoan";

/**
 * Phần của `KeHoachThu` (quet-khoan.ts) mà việc ghi giải thích cần. Khai CẤU TRÚC ở đây thay vì `import type { KeHoachThu }`: `quet-khoan.ts` đã nhập tệp này, nhập ngược lại là vòng
 * (dependency-cruiser `no-circular` đếm cả import kiểu — `tsPreCompilationDeps`). `KeHoachThu` gán được vào kiểu này; quên một trường là lỗi biên dịch ở chỗ gọi.
 */
export type KeHoachChoGiaiThich = {
  p: { id: string };
  kyTuNhien: string;
  co: { centerId: string; orgUnitId: string };
  loaiGiaoDich: "NEW" | "RENEWAL";
  nguon: { groupCode: string } | null;
  nguonChinhSach: { sourceGroupId: string | null };
  cuaSo: CuaSoGhiCong | null;
  /** `null` = khoản thu thường; có giá trị = điều chỉnh tăng chép từ ô gốc (không có «vai treo» của riêng khoản này). */
  chepTu: unknown;
  dauVao: (coSo: number) => DauVaoKhoan;
};

export type YeuCauGhiGiaiThich = {
  kh: KeHoachChoGiaiThich;
  bc: BoiCanhQuet;
  slotId: string;
  /** Cơ sở GỐC của ô (`netBase` của ô) — «lẽ ra» tính trên số này. */
  netBase: number;
  /** Băm kết quả đã gắn vào ô lúc này (`hash` ở ghi mới, `hashMoi` ở so ô). Chỉ để truy vết «giải thích này ứng với kết quả nào». */
  hash: string;
  /** Hash này đã được chấp nhận (ô vừa tạo ⇒ true; so ô ⇒ đã nằm trong `hashDaChapNhan` hoặc vừa được `danhDauOKhop`). BẮT BUỘC (luật 7). */
  hashDuocChapNhan: boolean;
  /** Lượt này đang để lại INPUT_DRIFT chờ duyệt. BẮT BUỘC. */
  coDrift: boolean;
  /** Tiền ròng hiện có của từng người trong ô (`OCoDong.rong`); ô mới ⇒ rỗng. BẮT BUỘC. */
  rong: ReadonlyMap<KhoaNguoi, number>;
};

/** Trả số dòng MỚI được ghi. */
export async function ghiGiaiThich(tx: Prisma.TransactionClient, y: YeuCauGhiGiaiThich): Promise<number> {
  const { kh, bc } = y;
  if (kh.chepTu || y.coDrift || !y.hashDuocChapNhan) return 0;
  const nhomId = kh.nguonChinhSach.sourceGroupId;
  if (kh.cuaSo === null || nhomId === null || kh.nguon === null) return 0;

  const kq = tinhDongChoKhoan(kh.dauVao(y.netBase));
  if (kq.loai !== "OK") return 0;
  const dong = dungGiaiThich({ treo: kq.treo, cuaSo: kh.cuaSo }).filter(
    (d) => d.beneficiaryKind === null || d.beneficiaryId === null || (y.rong.get(khoaNguoi(d.roleCode, d.beneficiaryKind, d.beneficiaryId)) ?? 0) === 0,
  );
  if (dong.length === 0) return 0;

  const daCo = await tx.commissionExplainLine.findMany({ where: { calcSlotId: y.slotId }, select: { roleCode: true, beneficiaryKey: true, reasonCode: true } });
  const khoaDaCo = new Set(daCo.map((d) => `${d.roleCode}|${d.beneficiaryKey}|${d.reasonCode}`));
  const moi = dong.filter((d) => !khoaDaCo.has(`${d.roleCode}|${d.beneficiaryKey}|${d.reasonCode}`) && bc.idVai.has(d.roleCode));
  if (moi.length === 0) return 0;

  const uIds = [...new Set(moi.flatMap((d) => (d.beneficiaryKind === "USER" && d.beneficiaryId ? [d.beneficiaryId] : [])))];
  const aIds = [...new Set(moi.flatMap((d) => (d.beneficiaryKind === "AFFILIATE" && d.beneficiaryId ? [d.beneficiaryId] : [])))];
  const [us, as] = await Promise.all([
    uIds.length ? tx.user.findMany({ where: { id: { in: uIds } }, select: { id: true, name: true, email: true } }) : [],
    aIds.length ? tx.affiliate.findMany({ where: { id: { in: aIds } }, select: { id: true, name: true } }) : [],
  ]);
  const ten = new Map<string, string>([...us.map((u) => [u.id, u.name ?? u.email ?? u.id] as const), ...as.map((a) => [a.id, a.name] as const)]);

  const r = await tx.commissionExplainLine.createMany({
    skipDuplicates: true,
    data: moi.map((d) => ({
      calcSlotId: y.slotId,
      paymentId: kh.p.id,
      roleCode: d.roleCode,
      beneficiaryRoleId: bc.idVai.get(d.roleCode)!,
      beneficiaryKey: d.beneficiaryKey,
      beneficiaryKind: d.beneficiaryKind,
      beneficiaryUserId: d.beneficiaryKind === "USER" ? d.beneficiaryId : null,
      beneficiaryAffiliateId: d.beneficiaryKind === "AFFILIATE" ? d.beneficiaryId : null,
      beneficiaryName: d.beneficiaryId ? (ten.get(d.beneficiaryId) ?? d.beneficiaryId) : null,
      reasonCode: d.reasonCode,
      sourceGroupId: nhomId,
      sourceGroupCode: kh.nguon!.groupCode,
      transactionTypeCode: kh.loaiGiaoDich,
      policyId: d.quyTac.policyId,
      policyVersionId: d.quyTac.versionId,
      versionNo: d.quyTac.version,
      ruleId: d.quyTac.ruleId,
      documentNumber: d.quyTac.documentNumber,
      calcKind: d.quyTac.kieuTinh,
      rate: d.quyTac.kieuTinh === "PERCENT" ? new Prisma.Decimal(String(d.quyTac.giaTri)) : null,
      fixedAmount: d.quyTac.kieuTinh === "FIXED_PER_PURCHASE" ? Number(d.quyTac.giaTri) : null,
      wouldBeAmount: d.wouldBeAmount,
      netBase: y.netBase,
      naturalPeriod: kh.kyTuNhien,
      details: { ...d.chiTiet },
      inputHash: y.hash,
      centerId: kh.co.centerId,
      orgUnitId: kh.co.orgUnitId,
    })),
  });
  return r.count;
}
