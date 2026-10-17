// lib/hoa-hong/khoa-so.ts — KHOÁ idempotency của dòng sổ + DẤU VÂN TAY đầu vào (`inputHash`). THUẦN.
//
// Nguồn: docs/source-commission/04 §10.3 (khoá), §10.4 (`inputHash`).
//
// ⚠️ Khoá KHÔNG phải thứ chặn trả hai lần giữa các `kind` — khoá `ORIGINAL` và khoá correction khác nhau nên cả hai luôn ghi
// được. Thứ chặn là Ô TÍNH (L13: ô đã có ⇒ cấm ORIGINAL) + Σ ròng (L14). Khoá là LỚP PHÒNG THỨ HAI (02 §9.6 luật 8):
// retry cùng một lượt ghi không đẻ dòng thứ hai.
//
// ⚠️ KHÔNG có `policyVersionId` trong khoá `ORIGINAL`: nếu có thì version mới ra, lượt quét lại sinh dòng THỨ HAI cho cùng
// khoản × vai × người — khoá không chặn được đúng ca nó sinh ra để chặn (04 §10.3). Version chỉ được CHỤP trên dòng.
//
// Mọi thành phần của khoá NOT NULL; "-" cho "không có" (bài học `@@unique` vô tác dụng khi NULL ≠ NULL).
import { createHash } from "node:crypto";

export const KHONG_CO = "-";

export type KieuNguoi = "USER" | "AFFILIATE";
/** `<roleCode>|<USER|AFFILIATE>|<id>` — khoá một (vai × người) trong một ô. */
export type KhoaNguoi = string;

export function khoaNguoi(roleCode: string, kind: KieuNguoi, beneficiaryId: string): KhoaNguoi {
  return `${roleCode}|${kind}|${beneficiaryId}`;
}

export function tachKhoaNguoi(k: KhoaNguoi): { roleCode: string; kind: KieuNguoi; beneficiaryId: string } {
  const [roleCode, kind, ...rest] = k.split("|");
  if (!roleCode || (kind !== "USER" && kind !== "AFFILIATE") || rest.length === 0) throw new Error(`Khoá người không hợp lệ: "${k}"`);
  return { roleCode, kind, beneficiaryId: rest.join("|") };
}

/** ORIGINAL và LATE_ARRIVAL (cùng là "dòng đầu tiên của ô") dùng CHUNG một khoá — không thể có cả hai. */
export function khoaOriginal(p: {
  paymentId: string;
  orderItemKey: string;
  thanhPhan: string;
  roleCode: string;
  kind: KieuNguoi;
  beneficiaryId: string;
}): string {
  return ["ORIG", p.paymentId, p.orderItemKey || KHONG_CO, p.thanhPhan, p.roleCode, p.kind, p.beneficiaryId].join("|");
}

/** REVERSAL: `paymentId` CỦA BÚT TOÁN ÂM × dòng gốc nó đảo. */
export function khoaDao(paymentIdAm: string, refEntryId: string): string {
  return ["REV", paymentIdAm, refEntryId].join("|");
}

/** SOURCE_CORRECTION / INPUT_CORRECTION / DISPUTE_ADJUSTMENT: MỘT dòng chênh lệch cho mỗi (sự kiện × ô × người). */
export function khoaDieuChinh(p: {
  loai: "SOURCE_CORRECTION" | "INPUT_CORRECTION" | "DISPUTE_ADJUSTMENT";
  refEventId: string;
  calcSlotId: string | null;
  roleCode: string;
  kind: KieuNguoi;
  beneficiaryId: string;
}): string {
  return [p.loai, p.refEventId, p.calcSlotId ?? KHONG_CO, p.roleCode, p.kind, p.beneficiaryId].join("|");
}

export function khoaLegacy(paymentId: string, tier: string, recipientId: string): string {
  return ["LREV", paymentId, tier, recipientId].join("|");
}

/** `holdKey` của hàng chờ — chống đẻ trùng giữa các lượt quét. */
export const khoaHold = {
  theoKhoan: (ma: string, paymentId: string, ...them: string[]) => [ma, paymentId, ...them].join(":"),
  inputDrift: (calcSlotId: string, hashMoi: string) => `INPUT_DRIFT:${calcSlotId}:${hashMoi}`,
  /** Theo KHOẢN (không theo ô): lúc ghi lần đầu ô chưa có id. */
  treo: (paymentId: string, roleCode: string, nguoi: string = KHONG_CO) => `UNRESOLVED:${paymentId}:${roleCode}:${nguoi}`,
  rutTien: (calcSlotId: string) => `PAYMENT_WITHDRAWN:${calcSlotId}`,
};

/** JSON ổn định: khoá đối tượng sắp tăng dần, `Date` → ISO, `undefined` bị bỏ — để cùng đầu vào luôn ra cùng chuỗi. */
export function chuoiChuanHoa(x: unknown): string {
  return JSON.stringify(chuanHoa(x));
}

function chuanHoa(x: unknown): unknown {
  if (x === null || typeof x !== "object") {
    if (typeof x === "number" && !Number.isFinite(x)) throw new Error("Không băm được số không hữu hạn");
    return x;
  }
  if (x instanceof Date) return x.toISOString();
  if (x instanceof Map) return chuanHoa([...x.entries()].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)));
  if (x instanceof Set) return chuanHoa([...x].sort());
  if (Array.isArray(x)) return x.map(chuanHoa);
  const o = x as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = chuanHoa(o[k]);
  return out;
}

/** `inputHash` = sha256 hex của JSON chuẩn hoá (04 §10.4). */
export function bamDauVao(x: unknown): string {
  return createHash("sha256").update(chuoiChuanHoa(x)).digest("hex");
}
