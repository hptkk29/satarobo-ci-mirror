// [PSH-*] — áp kế hoạch trả góp thì phiếu thu nào bị VOID (rà vòng 4, luật 12). THUẦN + lưới ghim.
// Hành vi thật (Postgres): `tests/finance/pos-vong3.test.ts` `[V4-NT-01]` — lời nói trước khớp
// đúng tập phiếu `recordInstallmentPlan` VOID.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chanTruocKhiLuuKeHoach,
  dotSeDoiSoKhiApKeHoach,
  LY_DO_DON_THU_THEO_CON,
  phieuSeChamKhiLuuKeHoach,
  phieuSeHuyKhiApKeHoach,
  phieuSeHuyKhiLuuKeHoach,
} from "./phieu-se-huy-ke-hoach";

const p = (id: string, installmentNo: number, status = "PENDING", allocated = 0, amountDue = 1_000_000) => ({
  id,
  orderItemId: null as string | null,
  installmentNo,
  amountDue,
  status,
  allocated,
});
/** Đợt THEO CON — `orderItemId` khác null, đánh số riêng từng bé. */
const c = (id: string, be: string, installmentNo: number, status = "PENDING", allocated = 0, amountDue = 1_000_000) => ({
  ...p(id, installmentNo, status, allocated, amountDue),
  orderItemId: be,
});

describe("[PSH] phiếu thu bị VOID khi áp kế hoạch", () => {
  it("[PSH-01] phiếu toàn đơn còn sống ⇒ VOID vô điều kiện (kể cả đang có tiền — R-02 chặn trước)", () => {
    expect(phieuSeHuyKhiApKeHoach({ phieu: [p("r0", 0)], soDot: [1, 2] })).toEqual({ duOra: [], toanDon: "r0" });
    expect(phieuSeHuyKhiApKeHoach({ phieu: [p("r0", 0, "PARTIAL", 500)], soDot: [1] }).toanDon).toBe("r0");
    expect(phieuSeHuyKhiApKeHoach({ phieu: [p("r0", 0, "VOID")], soDot: [1] }).toanDon, "đã VOID").toBeNull();
  });

  it("[PSH-02] đợt dư (ngoài kế hoạch): VOID nếu chưa dính tiền THẬT; đã có tiền / đã VOID ⇒ giữ", () => {
    const phieu = [p("d1", 1), p("d2", 2), p("d3", 3), p("d4", 4, "PARTIAL", 1_000), p("d5", 5, "VOID")];
    expect(phieuSeHuyKhiApKeHoach({ phieu, soDot: [1, 2] })).toEqual({ duOra: ["d3"], toanDon: null });
  });

  it("[PSH-03] kế hoạch không có đợt nào ⇒ không VOID gì (materialize trả noop)", () => {
    expect(phieuSeHuyKhiApKeHoach({ phieu: [p("r0", 0), p("d3", 3)], soDot: [] })).toEqual({
      duOra: [],
      toanDon: null,
    });
  });

  it("[PSH-04] lưu kế hoạch mà MỌI đợt đã thu ⇒ không áp lên sổ phiếu ⇒ không VOID gì", () => {
    const phieu = [p("r0", 0)];
    expect(phieuSeHuyKhiLuuKeHoach({ phieu, dots: [{ daThu: true }, { daThu: true }] })).toEqual([]);
    // Đối chứng dương: có một đợt chưa thu ⇒ R0 bị VOID.
    expect(phieuSeHuyKhiLuuKeHoach({ phieu, dots: [{ daThu: true }, { daThu: false }] })).toEqual(["r0"]);
  });

  it("[PSH-05] lưu kế hoạch đánh số đợt 1..n theo thứ tự — rút từ 3 xuống 2 đợt ⇒ VOID đợt 3", () => {
    const phieu = [p("r0", 0, "VOID"), p("d1", 1), p("d2", 2), p("d3", 3)];
    expect(phieuSeHuyKhiLuuKeHoach({ phieu, dots: [{ daThu: false }, { daThu: false }] })).toEqual(["d3"]);
  });

  it("[PSH-W1] `materializeInstallmentRequests` quyết phiếu VOID bằng CHÍNH hàm này — không còn bản điều kiện riêng", () => {
    const nguon = readFileSync(resolve(process.cwd(), "lib/payments/payment-request.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s\/\/.*$/gm, "");
    const i = nguon.indexOf("export async function materializeInstallmentRequests(");
    const j = nguon.indexOf("\nexport ", i + 10);
    const than = nguon.slice(i, j);
    expect(than.match(/phieuSeHuyKhiApKeHoach\(/g)?.length ?? 0).toBe(1);
    // Mã TRƯỚC bản vá tự viết luật tại chỗ — hai bản của một luật tiền:
    //   `const planned = new Set(dots.map(...))` … `planned.has(r.installmentNo)` …
    //   `const full = byNo.get(FULL_ORDER_INSTALLMENT_NO)`.
    expect(than).not.toMatch(/planned\.has\(|byNo\.get\(FULL_ORDER_INSTALLMENT_NO\)/);
    // Và nó thật sự VOID đúng hai danh sách hàm trả về.
    expect(than).toMatch(/for \(const id of seHuy\.duOra\)/);
    expect(than).toMatch(/where: \{ id: seHuy\.toanDon \}, data: \{ status: "VOID" \}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rà vòng 5 (30/09/2026). Hành vi thật (Postgres): `tests/finance/pos-vong5.test.ts` `[V5-40]` `[V5-41]`.
// ─────────────────────────────────────────────────────────────────────────────
describe("[PSH] rà vòng 5 — đợt theo con, đợt đổi số, lời báo chặn trước", () => {
  it("[PSH-06] đợt THEO CON không thuộc kế hoạch mức đơn: không VOID, không bị coi là 'đợt số 1 đã có'", () => {
    const phieu = [c("a1", "be-a", 1), c("b1", "be-b", 1), c("a3", "be-a", 3)];
    expect(phieuSeHuyKhiApKeHoach({ phieu, soDot: [1, 2] })).toEqual({ duOra: [], toanDon: null });
    expect(dotSeDoiSoKhiApKeHoach({ phieu, dots: [{ soDot: 1, amount: 5 }] }), "đợt con không bị sửa số").toEqual([]);
  });

  it("[PSH-07] đợt cấp đơn ĐỔI SỐ ⇒ nằm trong `doiSo`; cùng số (kể cả lệch làm tròn) ⇒ không", () => {
    const phieu = [p("r0", 0, "VOID"), p("d1", 1, "PENDING", 0, 3_366_000), p("d2", 2, "PENDING", 0, 3_366_000)];
    expect(
      phieuSeChamKhiLuuKeHoach({ phieu, dots: [{ daThu: false, amount: 2_000_000 }, { daThu: false, amount: 4_732_000 }] }),
    ).toEqual({ seHuy: [], doiSo: ["d1", "d2"] });
    expect(
      phieuSeChamKhiLuuKeHoach({ phieu, dots: [{ daThu: false, amount: 3_366_000.2 }, { daThu: false, amount: 3_366_000 }] }).doiSo,
    ).toEqual([]);
    // Mọi đợt đã thu ⇒ không áp lên sổ phiếu ⇒ không đổi gì.
    expect(
      phieuSeChamKhiLuuKeHoach({ phieu, dots: [{ daThu: true, amount: 1 }, { daThu: true, amount: 6_731_999 }] }),
    ).toEqual({ seHuy: [], doiSo: [] });
  });

  it("[PSH-10] đơn đang thu THEO CON ⇒ chặn trước bằng CHÍNH câu máy chủ ném; đợt con đã VOID hết ⇒ không chặn", () => {
    expect(chanTruocKhiLuuKeHoach({ phieu: [c("a1", "be-a", 1)], dots: [{ daThu: false }] })).toBe(LY_DO_DON_THU_THEO_CON);
    expect(chanTruocKhiLuuKeHoach({ phieu: [c("a1", "be-a", 1, "VOID"), p("r0", 0)], dots: [{ daThu: false }] })).toBeNull();
  });

  it("[PSH-11] phiếu toàn đơn giữ tiền + kế hoạch có đợt chưa thu ⇒ chặn trước bằng câu R-02 (không hứa 'đóng mã')", () => {
    const lyDo = chanTruocKhiLuuKeHoach({ phieu: [p("r0", 0, "PARTIAL", 1_000_000)], dots: [{ daThu: false }, { daThu: false }] });
    expect(lyDo).toMatch(/^Phiếu thu toàn đơn đã nhận 1\.000\.000/);
  });

  it("[PSH-12] đối chứng: R0 chưa có tiền, hoặc mọi đợt đã thu ⇒ không chặn trước", () => {
    expect(chanTruocKhiLuuKeHoach({ phieu: [p("r0", 0)], dots: [{ daThu: false }] })).toBeNull();
    expect(chanTruocKhiLuuKeHoach({ phieu: [p("r0", 0, "PARTIAL", 1_000_000)], dots: [{ daThu: true }] })).toBeNull();
  });

  it("[PSH-W2] đường ghi: `materialize` chỉ đọc phiếu CẤP ĐƠN, soát theo `dotSeDoiSoKhiApKeHoach`; `recordInstallmentPlan` chặn đơn thu theo con TRƯỚC phép ghi đầu", () => {
    const bo = (t: string) =>
      t.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
    const pr = bo(readFileSync(resolve(process.cwd(), "lib/payments/payment-request.ts"), "utf8"));
    const i = pr.indexOf("export async function materializeInstallmentRequests(");
    const than = pr.slice(i, pr.indexOf("\nexport ", i + 10));
    expect(than).toMatch(/where: \{ orderId, orderItemId: null \}/);
    expect(than.match(/dotSeDoiSoKhiApKeHoach\(/g)?.length ?? 0).toBe(1);
    expect(than).toMatch(/soatPhieuGopDoiSoTrongTx\(tx, orderId, doiSo\)/);

    const ins = bo(readFileSync(resolve(process.cwd(), "lib/orders/installments.ts"), "utf8"));
    const j = ins.indexOf("export async function recordInstallmentPlan(");
    const t2 = ins.slice(j, ins.indexOf("\nexport ", j + 10));
    const cong = t2.indexOf("if (donDangThuTheoCon(dotCon)) throw new InstallmentMoneyBlocked(LY_DO_DON_THU_THEO_CON, 0);");
    expect(cong, "cổng có mặt").toBeGreaterThan(0);
    expect(cong, "cổng đứng TRƯỚC phép ghi đầu tiên").toBeLessThan(t2.indexOf("tx.orderInstallment.deleteMany"));
  });
});
