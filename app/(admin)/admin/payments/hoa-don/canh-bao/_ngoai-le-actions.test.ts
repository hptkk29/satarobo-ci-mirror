// Ca [NLA-*] — cổng của action xử lý ngoại lệ hoá đơn (lát S12, Invoice Hub). Thứ cần đo: cờ tắt / chưa đăng nhập / thiếu `payments:confirm` / đầu vào sai thì KHÔNG chạm tầng ghi;
// đúng người thì chạm đúng MỘT lần với đúng tham số. Dịch vụ ghi đã đo trên Postgres thật ở `tests/finance/hoa-don-ngoai-le-db.test.ts`; ở đây dịch vụ là giả.
// Ca [NLA-W*] là lưới ghim mã nguồn (neo vào LỜI GỌI, đếm SỐ LẦN, bỏ chú thích).
import { readFileSync } from "node:fs";
import { resolve as duongDan } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(async () => ({ user: { id: "u1", name: "Kế toán A" } }) as unknown),
  checkPermission: vi.fn(async (_k: string) => true),
  resolveActor: vi.fn(async () => ({ userId: "u1" }) as unknown),
  revalidatePath: vi.fn(),
  xuLy: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHubQuetBat: h.bat }));
vi.mock("@/lib/finance/hoa-don/ngoai-le-db", () => ({ xuLyNgoaiLe: h.xuLy }));

import { xuLyNgoaiLeAction } from "./_ngoai-le-actions";

const OK = { ok: true as const, id: "nl1", trangThai: "DANG_XU_LY" as const };
const HOP_LE = { id: "nl1", hanhDong: "NHAN_XU_LY" as const, lyDo: "" };

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Kế toán A" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u1" });
  h.xuLy.mockResolvedValue(OK);
});

describe("[NLA-01] cổng: cờ → đầu vào → đăng nhập → payments:confirm", () => {
  it("cờ scanner TẮT ⇒ từ chối, KHÔNG hỏi phiên, KHÔNG chạm dịch vụ", async () => {
    h.bat.mockResolvedValue(false);
    const r = await xuLyNgoaiLeAction(HOP_LE);
    expect(r).toMatchObject({ ok: false });
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.xuLy).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập / thiếu payments:confirm ⇒ từ chối, không chạm dịch vụ; đối chứng: đủ cả hai thì chạm", async () => {
    h.auth.mockResolvedValueOnce(null);
    expect(await xuLyNgoaiLeAction(HOP_LE)).toMatchObject({ ok: false, error: expect.stringMatching(/đăng nhập/i) });
    h.checkPermission.mockResolvedValueOnce(false);
    expect(await xuLyNgoaiLeAction(HOP_LE)).toMatchObject({ ok: false, error: expect.stringMatching(/quyền/i) });
    expect(h.checkPermission).toHaveBeenCalledWith("payments:confirm");
    expect(h.xuLy).not.toHaveBeenCalled();
    expect(await xuLyNgoaiLeAction(HOP_LE)).toMatchObject({ ok: true });
    expect(h.xuLy).toHaveBeenCalledTimes(1);
  });

  it("đầu vào sai (id rỗng, hành động lạ, lý do quá dài, kiểu không phải đối tượng) ⇒ từ chối trước khi hỏi quyền", async () => {
    for (const x of [null, "x", { id: "", hanhDong: "NHAN_XU_LY", lyDo: "" }, { id: "a", hanhDong: "XOA", lyDo: "" }, { id: "a", hanhDong: "BO_QUA", lyDo: "x".repeat(501) }, { id: "a".repeat(65), hanhDong: "BO_QUA", lyDo: "" }]) {
      expect(await xuLyNgoaiLeAction(x as never), JSON.stringify(x)).toMatchObject({ ok: false });
    }
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.xuLy).not.toHaveBeenCalled();
  });
});

describe("[NLA-02] gọi dịch vụ và dịch kết quả", () => {
  it("đúng người ⇒ dịch vụ nhận actor đã resolve + tên người + đúng tham số; làm mới ĐÚNG tab Cảnh báo", async () => {
    await xuLyNgoaiLeAction({ id: "nl1", hanhDong: "BO_QUA", lyDo: "Đã soát cùng kế toán trưởng" });
    expect(h.xuLy).toHaveBeenCalledWith({ actor: { userId: "u1" }, ten: "Kế toán A", id: "nl1", hanhDong: "BO_QUA", lyDo: "Đã soát cùng kế toán trưởng" });
    expect(h.revalidatePath).toHaveBeenCalledWith("/payments/hoa-don/canh-bao");
  });

  it("dịch vụ từ chối ⇒ giữ nguyên câu + mã, KHÔNG làm mới; dịch vụ ném ⇒ câu chung, không lộ nội dung lỗi", async () => {
    h.xuLy.mockResolvedValueOnce({ ok: false, error: "Ngoại lệ vừa được người khác xử lý", ma: "DA_DOI" });
    expect(await xuLyNgoaiLeAction(HOP_LE)).toEqual({ ok: false, error: "Ngoại lệ vừa được người khác xử lý", ma: "DA_DOI" });
    expect(h.revalidatePath).not.toHaveBeenCalled();
    h.xuLy.mockRejectedValueOnce(new Error("connection refused 10.0.0.5:5432 password=abc"));
    const r = await xuLyNgoaiLeAction(HOP_LE);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toMatch(/10\.0\.0\.5|password|connection/i);
  });
});

describe("[NLA-W] lưới ghim mã nguồn", () => {
  const src = readFileSync(duongDan(process.cwd(), "app/(admin)/admin/payments/hoa-don/canh-bao/_ngoai-le-actions.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
  const dem = (re: RegExp) => src.match(new RegExp(re.source, "g"))?.length ?? 0;

  it("[NLA-W1] 'use server'; chỉ export hàm async; dịch vụ gọi ĐÚNG một lần; quyền hỏi qua checkPermission, không so vai/cơ sở tại chỗ", () => {
    expect(src.trimStart().startsWith('"use server"')).toBe(true);
    expect(dem(/\bxuLyNgoaiLe\(/)).toBe(1);
    expect(dem(/\bcheckPermission\("payments:confirm"\)/)).toBe(1);
    expect(dem(/\bexport (?!async function)/)).toBe(0);
    expect(dem(/\.role\b|roles\.includes|\.centerId\s*===/)).toBe(0);
  });

  it("[NLA-W2] cờ hỏi TRƯỚC phiên và quyền; revalidatePath chỉ sau khi dịch vụ báo ok; không chạm bảng nào trực tiếp", () => {
    expect(src.search(/laHubQuetBat\(\)/)).toBeGreaterThan(-1);
    expect(src.search(/laHubQuetBat\(\)/)).toBeLessThan(src.search(/\bauth\(\)/));
    expect(src.search(/\bauth\(\)/)).toBeLessThan(src.search(/checkPermission\(/));
    expect(src.search(/\bxuLyNgoaiLe\(/)).toBeLessThan(src.search(/revalidatePath\(/));
    expect(dem(/\bdb\./)).toBe(0);
    expect(dem(/\bprisma\b|scopedDb/)).toBe(0);
  });
});
