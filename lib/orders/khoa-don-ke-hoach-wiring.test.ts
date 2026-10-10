// [KDK-W*] — lưới ghim: mọi transaction VOID đợt của KẾ HOẠCH (lưu / duyệt / từ chối) giữ khoá đơn
// làm câu ĐẦU TIÊN (rà vòng 4, 30/09/2026).
//
// Ca DB `[V3-06]` (tests/finance/pos-vong3.test.ts) chứng minh bằng hành vi cho `recordInstallmentPlan`.
// Bốn đường duyệt/từ chối không có ca đua riêng (cùng hình dạng, dựng ca đua cho từng đường là bốn
// fixture duyệt) ⇒ ghim bằng mã nguồn: bỏ khoá ở đường nào là đường đó lại VOID đợt + soát phiếu
// song song với lượt thu đang giữ khoá, và tiền rót vào đợt VOID.
//
// Mã TRƯỚC bản vá: `await db.$transaction(async (tx) => {` rồi thẳng phép ghi đầu tiên
// (`tx.orderInstallment.deleteMany` / `applyInstallment*` / `if (parts.includes("discount"))`).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function ma(tep: string): string {
  return readFileSync(resolve(process.cwd(), tep), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\n\s*\n/g, "\n");
}

function than(nguon: string, dau: string): string {
  const i = nguon.indexOf(dau);
  expect(i, dau).toBeGreaterThanOrEqual(0);
  const j = nguon.indexOf("\nexport ", i + 10);
  return nguon.slice(i, j < 0 ? undefined : j);
}

/** Mỗi `db.$transaction(async (tx) => {` trong thân: câu kế tiếp phải là khoá đơn. */
function moiTxMoDauBangKhoa(t: string, bienDon: string): number {
  const mo = "db.$transaction(async (tx) => {\n";
  let dem = 0;
  for (let i = t.indexOf(mo); i >= 0; i = t.indexOf(mo, i + 1)) {
    const cauDau = (t.slice(i + mo.length).trimStart().split("\n")[0] ?? "").replace(/\s*\/\/.*$/, "");
    expect(cauDau, `câu đầu tiên của transaction`).toBe(`await khoaDonTrongTx(tx, ${bienDon});`);
    dem++;
  }
  return dem;
}

describe("[KDK] khoá đơn trên đường VOID đợt của kế hoạch", () => {
  it("[KDK-W1] recordInstallmentPlan: transaction mở đầu bằng khoá đơn", () => {
    const t = than(ma("lib/orders/installments.ts"), "export async function recordInstallmentPlan(");
    expect(moiTxMoDauBangKhoa(t, "orderId")).toBe(1);
  });

  it("[KDK-W2] approveInstallmentPlan + rejectInstallmentPlan: transaction mở đầu bằng khoá đơn", () => {
    const nguon = ma("lib/orders/installments.ts");
    expect(moiTxMoDauBangKhoa(than(nguon, "export async function approveInstallmentPlan("), "order.id")).toBe(1);
    expect(moiTxMoDauBangKhoa(than(nguon, "export async function rejectInstallmentPlan("), "order.id")).toBe(1);
  });

  it("[KDK-W4] changeOrderStatusAction (Huỷ đơn — đường VOID đợt thứ sáu): transaction mở đầu bằng khoá đơn, và nhánh huỷ soát phiếu gộp", () => {
    // Rà vòng 5 (30/09/2026). Mã TRƯỚC bản vá: `const tx = txRaw as …;` rồi thẳng
    // `const updateData …` / `tx.order.updateMany` — không khoá ⇒ lượt thu đang giữ khoá rót vào
    // đợt vừa VOID, ghi `Payment` trên đơn đã huỷ (ca `[V5-01]`). Và nhánh CANCELLED chỉ VOID đợt +
    // hết hạn QR, không soát phiếu gộp ⇒ phiếu OPEN trên đợt VOID.
    const t = than(ma("app/(admin)/admin/orders/_actions.ts"), "export async function changeOrderStatusAction(");
    const mo = "sdb.$transaction(async (txRaw) => {\n";
    expect(t.split(mo).length - 1, "đúng một transaction").toBe(1);
    const sau = t.slice(t.indexOf(mo) + mo.length).trimStart().split("\n");
    expect(sau[0]?.trim()).toBe("const tx = txRaw as unknown as Prisma.TransactionClient;");
    expect(sau[1]?.trim(), "câu đầu tiên sau khi ép kiểu tx").toBe("await khoaDonTrongTx(tx, orderId);");
    const huy = /if \(parsed\.data\.toStatus === "CANCELLED"\) \{[\s\S]*?\n {4}\}/.exec(t)?.[0] ?? "";
    expect(huy).toContain("await voidTienKhiHuyDonTrongTx(tx, orderId)");
    expect(ma("lib/orders/huy-don-tien.ts")).toMatch(/return soatPhieuGopMoTrongTx\(tx, orderId\);/);
    // Kết quả soát đi lên toast (luật 12) — không vứt.
    expect(t).toMatch(/thongDiepPhieu: thongDiepPhieuKhiHuyDon\(txResult\.phieuGopDaSoat\)/);
  });

  it("[KDK-W3] approveOrder + rejectOrder: transaction mở đầu bằng khoá đơn", () => {
    const nguon = ma("lib/orders/approval.ts");
    expect(moiTxMoDauBangKhoa(than(nguon, "export async function approveOrder("), "order.id")).toBe(1);
    expect(moiTxMoDauBangKhoa(than(nguon, "export async function rejectOrder("), "order.id")).toBe(1);
  });
});
