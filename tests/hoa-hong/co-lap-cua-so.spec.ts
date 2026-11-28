// @vitest-environment node
/**
 * [CLS-*] — CÁCH LY GIỮA CÁC SPEC ĐO THEO CỬA SỔ NGÀY (luật 18). Postgres THẬT.
 *
 * Sự cố (đo 11/10/2026, gộp nhánh UAT): chạy CẢ thư mục `tests/hoa-hong` trên MỘT DB thì `[SBG-13d]` đỏ («tổng 3 / giữ 2 thay vì 1 / 0») và `[CUT-A02]` đỏ («tổng 12 thay vì 1»), còn
 * chạy từng file thì xanh. Gốc: so bóng và xem-trước cutover cộng MỌI khoản thực thu trong cửa sổ của CẢ DB, mà `donKichBan` chỉ dọn chính sách + sổ cái, KHÔNG dọn `Payment` —
 * spec nào ghi khoản thu vào ngày D rồi chạy trước spec đo đúng ngày D thì để lại khoản mồ côi. Thứ tự file do vitest xếp theo THỜI GIAN CHẠY LẦN TRƯỚC (cache), nên cặp
 * «gây nhiễu → nạn nhân» lúc có lúc không — chính vì vậy `[CUT-A02]` «không tái hiện lại».
 *
 * Bộ này canh HAI lớp phòng thủ, mỗi lớp một ca đối chứng dương (cấy lớp nào bỏ lớp đó thì ca của nó đỏ):
 *   · NGUỒN  — `donKichBan` gỡ (xoá mềm) khoản thu của kịch bản được dọn, và CHỈ của nó;
 *   · CỔNG   — `kiemCuaSoSach` thấy khoản của kịch bản KHÁC, nêu tên đơn, không cờ khoản của chính mình.
 * và lưới dây nối: hai spec đo (so bóng, xem trước cutover) thật sự gọi cổng trước mỗi phép ĐẾM.
 *
 * Mỗi ca tự dựng kịch bản riêng VÀ dùng NGÀY RIÊNG (luật 18): gỡ cơ chế dọn thì rác của ca nào chỉ làm hỏng đúng ca đó, nên tập ca ĐỎ khi cấy lỗi là tập ca thật sự canh lỗi ấy.
 * Ngày TUYỆT ĐỐI (luật 19). Dọn sau MỖI ca (kể cả ca ném giữa chừng).
 * Chạy: `pnpm test:hoa-hong-db` hoặc `vitest run -c vitest.db.config.ts tests/hoa-hong/co-lap-cua-so.spec.ts`.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 90_000 });

import { db } from "../../lib/db";
import { chaySoBong } from "../../lib/hoa-hong/so-bong-db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { D, donKichBan, dungBe, dungKichBan, goKhoanThuCuaKichBan, kiemCuaSoSach, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[CLS] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

/** Mỗi ca một ngày (tháng 1/2026, không spec nào khác dùng các ngày này). */
const NGAY = { c01: "2026-01-21", c02: "2026-01-22", c03: "2026-01-23", c04: "2026-01-24", c05: "2026-01-25", c06: "2026-01-26" } as const;
const cuaToi: KichBan[] = [];

async function dungCo(tien: string, ngay: string): Promise<{ k: KichBan; paymentId: string; orderCode: string }> {
  const k = await dungKichBan(tien);
  cuaToi.push(k);
  const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2026-01-10") });
  const paymentId = await tienVe(k, be, { soTien: 10_000_000, ngay: D(ngay) });
  const don = await db.order.findUniqueOrThrow({ where: { id: be.orderId }, select: { code: true } });
  return { k, paymentId, orderCode: don.code };
}

/** Số khoản thu mà phép ĐO THẬT (so bóng) thấy trong cửa sổ một ngày — không qua hàm của bộ này. */
async function soKhoanMaSoBongThay(ngay: string): Promise<number> {
  const b = await chaySoBong({ client: db, now: D("2026-11-20"), kyP: "2027-01", tuNgay: ngay, denNgay: ngay, tranSoKhoan: 500 });
  return b.khoan.tong;
}

describe.skipIf(!RUN_DB_TESTS)("[CLS] cách ly dữ liệu giữa các spec đo theo cửa sổ ngày", () => {
  beforeAll(() => {
    assertTestDb();
  });
  afterEach(async () => {
    await donKichBan(cuaToi.splice(0));
  }, 60_000);

  it("[CLS-01] CỔNG thấy khoản thu của kịch bản KHÁC (đối chứng dương) và nêu TÊN ĐƠN để lần ra spec gây nhiễu", async () => {
    const a = await dungCo("cls01a", NGAY.c01);
    const b = await dungKichBan("cls01b");
    cuaToi.push(b);
    await expect(kiemCuaSoSach([b], NGAY.c01, NGAY.c01)).rejects.toThrow(a.orderCode);
    await expect(kiemCuaSoSach([b], NGAY.c01, NGAY.c01)).rejects.toThrow(/kịch bản KHÁC/);
  });

  it("[CLS-02] CỔNG không cờ khoản của CHÍNH kịch bản đang đo (không báo oan)", async () => {
    const a = await dungCo("cls02a", NGAY.c02);
    await expect(kiemCuaSoSach([a.k], NGAY.c02, NGAY.c02)).resolves.toBeUndefined();
  });

  it("[CLS-03] NGUỒN: donKichBan gỡ khoản thu của kịch bản khỏi cửa sổ (xoá MỀM — dòng vẫn còn, chỉ `deletedAt` khác null); cổng với kịch bản khác thông trở lại", async () => {
    const a = await dungCo("cls03a", NGAY.c03);
    const b = await dungKichBan("cls03b");
    cuaToi.push(b);
    await expect(kiemCuaSoSach([b], NGAY.c03, NGAY.c03)).rejects.toThrow(); // trước khi dọn: còn khoản lạ
    await donKichBan([a.k]);
    await expect(kiemCuaSoSach([b], NGAY.c03, NGAY.c03)).resolves.toBeUndefined();
    const dong = await db.payment.findUniqueOrThrow({ where: { id: a.paymentId }, select: { deletedAt: true } });
    expect(dong.deletedAt).not.toBeNull();
  });

  it("[CLS-04] NGUỒN chỉ gỡ khoản của kịch bản ĐƯỢC DỌN — khoản của kịch bản khác còn nguyên (đối chứng: dọn rộng tay thì phá spec đang chạy)", async () => {
    const a = await dungCo("cls04a", NGAY.c04);
    const b = await dungCo("cls04b", NGAY.c04);
    await donKichBan([a.k]);
    const conLai = await db.payment.findUniqueOrThrow({ where: { id: b.paymentId }, select: { deletedAt: true } });
    expect(conLai.deletedAt).toBeNull();
    expect(await goKhoanThuCuaKichBan([])).toBe(0); // không kịch bản nào ⇒ không gỡ gì
  });

  it("[CLS-05] cặp «gây nhiễu → nạn nhân» thu nhỏ: kịch bản 1 thu ngày D rồi được dọn; kịch bản 2 thu ngày D và ĐO — so bóng thấy ĐÚNG 1 khoản, không phải 2", async () => {
    await kiemCuaSoSach([], NGAY.c05, NGAY.c05); // mở đầu: cửa sổ phải TRỐNG — nếu spec khác để sót khoản vào đúng ngày này thì NÉM nêu tên đơn, không phải lệch số khó hiểu
    const a = await dungCo("cls05a", NGAY.c05);
    await donKichBan([a.k]);
    await dungCo("cls05b", NGAY.c05);
    expect(await soKhoanMaSoBongThay(NGAY.c05)).toBe(1);
  });

  it("[CLS-06] đối chứng dương cho chính phép ĐO: chưa dọn kịch bản 1 thì so bóng thấy 2 khoản — tức ca CLS-05 thật sự phân biệt được", async () => {
    await kiemCuaSoSach([], NGAY.c06, NGAY.c06);
    await dungCo("cls06a", NGAY.c06);
    await dungCo("cls06b", NGAY.c06);
    expect(await soKhoanMaSoBongThay(NGAY.c06)).toBe(2);
  });
});

// ═══ LƯỚI DÂY NỐI — luật «mọi phép ĐẾM khoản trong cửa sổ đi qua cổng» ═════════════════════════
// Hành vi của cổng đã có ở trên; thứ test hành vi KHÔNG chứng minh được là hai spec đo có GỌI nó hay không (gỡ lời gọi thì cả hai spec vẫn xanh khi DB sạch).
function doc(duongDan: string): string {
  const src = readFileSync(resolve(process.cwd(), duongDan), "utf8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const dem = (s: string, m: string) => s.split(m).length - 1;

describe("[CLS-W] dây nối cổng cửa sổ sạch", () => {
  it("[CLS-W1] so-bong.spec: `chay()` (mọi phép đo theo tháng) và [SBG-09] (đo theo ngày) đều gọi `kiemCuaSoSach(` — tối thiểu 2 lời gọi", () => {
    const s = doc("tests/hoa-hong/so-bong.spec.ts");
    expect(dem(s, "kiemCuaSoSach(")).toBeGreaterThanOrEqual(2);
  });

  it("[CLS-W2] cutover-hanh-dong.spec: mọi `xemTruocCutover({` có `cuaSo: await cuaSoSach(` — không còn `cuaSo: cuaSo(` trần ở lời gọi xem trước", () => {
    const s = doc("tests/hoa-hong/cutover-hanh-dong.spec.ts");
    const xemTruoc = dem(s, "xemTruocCutover({");
    expect(xemTruoc).toBeGreaterThanOrEqual(5);
    expect(dem(s, "cuaSo: await cuaSoSach(")).toBe(xemTruoc);
    expect(dem(s, "cuaSo: cuaSo(")).toBe(0);
  });
});
