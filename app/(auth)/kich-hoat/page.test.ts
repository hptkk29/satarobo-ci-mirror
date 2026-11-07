// @vitest-environment node
/**
 * [DISC-KH-*] HỒI QUY luồng /kich-hoat cũ khi thêm nhánh nhận bài DISC (?disc=1).
 * Luật: khách cũ (không có ?disc=1, hoặc cờ DISC tắt) thấy ĐÚNG form kích hoạt cũ; nhánh DISC chỉ mở khi cờ BẬT và có ?disc=1;
 * hai server action cũ (`_actions.ts`) không bị nhánh DISC chạm tới. Không DB, không mạng.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { boChuThich, docTep } from "../../../tests/disc/_quet";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("lucide-react", () => ({ ArrowLeft: () => null }));
vi.mock("./activate-form", () => ({ ActivateForm: function ActivateForm() { return null; } }));
vi.mock("./nhan-disc-form", () => ({ NhanDiscForm: function NhanDiscForm() { return null; } }));

const cu = process.env.DISC_ENABLED;
afterEach(() => {
  if (cu === undefined) delete process.env.DISC_ENABLED;
  else process.env.DISC_ENABLED = cu;
});

type Nut = { type?: unknown; props?: { children?: unknown } };
function ten(n: unknown, ra: string[] = []): string[] {
  if (Array.isArray(n)) n.forEach((x) => ten(x, ra));
  else if (n && typeof n === "object") {
    const e = n as Nut;
    if (typeof e.type === "function") ra.push((e.type as { name: string }).name);
    ten(e.props?.children, ra);
  }
  return ra;
}
async function ve(disc?: string) {
  const { default: Trang } = await import("./page");
  return Trang({ searchParams: Promise.resolve(disc === undefined ? {} : { disc }) });
}

describe("[DISC-KH-01] trang /kich-hoat chọn đúng form", () => {
  it("khách cũ (không ?disc=1) ⇒ form kích hoạt CŨ, dù cờ DISC bật", async () => {
    for (const co of ["true", undefined]) {
      if (co === undefined) delete process.env.DISC_ENABLED;
      else process.env.DISC_ENABLED = co;
      const cay = await ve();
      expect(ten(cay)).toContain("ActivateForm");
      expect(ten(cay)).not.toContain("NhanDiscForm");
      // Tiêu đề "Kích hoạt tài khoản" nay nằm TRONG ActivateForm (markup chép từ artifact) — trang chỉ còn tiêu đề tab.
      const { metadata } = await import("./page");
      expect(String(metadata.title)).toBe("Kích hoạt tài khoản");
    }
  });
  it("cờ TẮT + ?disc=1 ⇒ vẫn form kích hoạt cũ (nhánh DISC không lộ khi cờ tắt)", async () => {
    for (const co of [undefined, "false", "1"]) {
      if (co === undefined) delete process.env.DISC_ENABLED;
      else process.env.DISC_ENABLED = co;
      const cay = await ve("1");
      expect(ten(cay)).toContain("ActivateForm");
      expect(ten(cay)).not.toContain("NhanDiscForm");
    }
  });
  it("ĐỐI CHỨNG DƯƠNG: cờ BẬT + ?disc=1 ⇒ form nhận bài DISC; ?disc=0 / rác ⇒ form cũ", async () => {
    process.env.DISC_ENABLED = "true";
    const cay = await ve("1");
    expect(ten(cay)).toContain("NhanDiscForm");
    expect(ten(cay)).not.toContain("ActivateForm");
    for (const v of ["0", "true", ""]) expect(ten(await ve(v))).toContain("ActivateForm");
  });
});

describe("[DISC-KH-02] luồng cũ không bị nhánh DISC chạm tới", () => {
  it("_actions.ts và activate-form.tsx không nhắc tới DISC (action kích hoạt cũ giữ nguyên)", () => {
    for (const f of ["_actions.ts", "activate-form.tsx"]) {
      const ma = boChuThich(docTep(resolve(process.cwd(), `app/(auth)/kich-hoat/${f}`)));
      expect(ma, f).not.toMatch(/disc/i);
    }
  });
  it("nhan-disc-actions.ts không import/gọi requestActivationOtp/activateAccount (hai luồng tách biệt)", () => {
    const ma = boChuThich(docTep(resolve(process.cwd(), "app/(auth)/kich-hoat/nhan-disc-actions.ts")));
    expect(ma).not.toMatch(/requestActivationOtp|activateAccount|from\s*["']\.\/_actions["']/);
  });
});
