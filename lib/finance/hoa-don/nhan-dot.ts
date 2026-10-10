// lib/finance/hoa-don/nhan-dot.ts — nhãn đợt của một lần thu cho người đọc. THUẦN.
//
// Mẫu số = số đợt ≥ 1, KHÔNG VOID, CÙNG bé (orderItemId) với đợt đích đầu tiên. Khác `requestLabel`
// của màn đơn (đếm cả VOID và đợt của mọi bé ⇒ đơn hai con in "Đợt 1/6").

export function nhanDotLanThu(
  dich: readonly { id: string }[],
  dot: readonly { id: string; installmentNo: number; status: string; orderItemId: string | null }[],
): string | null {
  const theoId = new Map(dot.map((d) => [d.id, d]));
  const ds = dich.map((x) => theoId.get(x.id)).filter((d): d is NonNullable<typeof d> => d != null);
  if (ds.length === 0) return null;
  if (ds.every((d) => d.installmentNo === 0)) return "Toàn đơn";
  const con = ds[0]!.orderItemId;
  const mau = dot.filter((d) => d.installmentNo >= 1 && d.status !== "VOID" && d.orderItemId === con).length;
  const so = ds
    .map((d) => d.installmentNo)
    .filter((n) => n >= 1)
    .sort((a, b) => a - b)
    .join("+");
  return mau > 1 ? `Đợt ${so}/${mau}` : `Đợt ${so}`;
}
