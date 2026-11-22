// @vitest-environment jsdom
/**
 * Trang Options (đặc tả GĐ5): agentSecret KHÔNG hiển thị lại sau khi lưu — ô bí mật luôn rỗng,
 * chỉ báo "đã lưu — dán bí mật mới để thay". Trang không tự đọc kho: mọi đọc/ghi đi qua service
 * worker, và service worker không bao giờ trả bí mật (xem [EXT-BDP-21], [EXT-BG-03]).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { khoiTaoTrangOptions } from "../src/options";
import { AGENT_ID, BI_MAT, GOC_PROD, MERCHANT } from "./ho-tro/du-lieu";

const HTML = readFileSync(resolve(process.cwd(), "pos-agent-extension/src/options.html"), "utf8");

function napTrang(): void {
  const than = /<body[^>]*>([\s\S]*)<\/body>/i.exec(HTML)?.[1] ?? "";
  document.body.innerHTML = than.replace(/<script[\s\S]*?<\/script>/gi, "");
}

const CAU_HINH = { agentId: AGENT_ID, centerCode: "CS1", merchantCode: MERCHANT, satAroboBaseUrl: GOC_PROD };

function nenGia(coBiMat = true, trangThaiThem: Record<string, unknown> = {}) {
  const tin: Array<Record<string, unknown>> = [];
  const gui = async (m: unknown): Promise<unknown> => {
    const msg = m as Record<string, unknown>;
    tin.push(structuredClone(msg));
    switch (msg.lenh) {
      case "LAY_CAU_HINH":
        return { cauHinh: CAU_HINH, coBiMat, gocChoPhep: [GOC_PROD] };
      case "LAY_TRANG_THAI":
        return {
          phienBan: "0.1.0",
          trangThaiPhien: "READY",
          lyDoHet: null,
          hetHanLuc: "2026-10-08T08:15:00+07:00",
          lastSyncedAt: "2026-10-07T10:20:00+07:00",
          dung: null,
          loiMo: [],
          tabId: 12,
          ...trangThaiThem,
        };
      case "LUU_CAU_HINH":
        if (msg.biMatMoi === "sai") return { ok: false, loi: { agentSecret: "Bí mật phải là 64 ký tự hex thường" } };
        return { ok: true, xem: { cauHinh: msg.cauHinh, coBiMat: true, gocChoPhep: [GOC_PROD] } };
      default:
        return null;
    }
  };
  return { tin, gui };
}

const o = (name: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
const cho = () => new Promise((r) => setTimeout(r, 0));

describe("Trang Options", () => {
  it("[EXT-OPT-01] nạp cấu hình đã lưu: điền các ô, ô bí mật RỖNG + báo 'đã lưu'; HTML không chứa bí mật", async () => {
    napTrang();
    const n = nenGia(true);
    await khoiTaoTrangOptions(document, n.gui);
    expect(o("agentId")?.value).toBe(AGENT_ID);
    expect(o("merchantCode")?.value).toBe(MERCHANT);
    expect(o("satAroboBaseUrl")?.value).toBe(GOC_PROD);
    const bm = o("agentSecret") as HTMLInputElement;
    expect(bm.type).toBe("password");
    expect(bm.value).toBe("");
    expect(bm.placeholder).toMatch(/đã lưu/i);
    expect(document.documentElement.outerHTML).not.toContain(BI_MAT);
    expect(n.tin.map((t) => t.lenh)).toEqual(["LAY_CAU_HINH", "LAY_TRANG_THAI"]);
  });

  it("[EXT-OPT-02] lưu KHÔNG gõ bí mật ⇒ không gửi biMatMoi; gõ bí mật ⇒ gửi đúng một lần rồi XOÁ khỏi ô", async () => {
    napTrang();
    const n = nenGia(true);
    await khoiTaoTrangOptions(document, n.gui);
    const form = document.querySelector("form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await cho();
    await cho();
    const luu1 = n.tin.find((t) => t.lenh === "LUU_CAU_HINH");
    expect(luu1).toBeDefined();
    expect(luu1 && "biMatMoi" in luu1).toBe(false);
    (o("agentSecret") as HTMLInputElement).value = BI_MAT;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await cho();
    await cho();
    const luu = n.tin.filter((t) => t.lenh === "LUU_CAU_HINH");
    expect(luu).toHaveLength(2);
    expect(luu[1].biMatMoi).toBe(BI_MAT);
    expect((o("agentSecret") as HTMLInputElement).value).toBe("");
    expect(document.documentElement.outerHTML).not.toContain(BI_MAT);
  });

  it("[EXT-OPT-03] bí mật sai dạng ⇒ hiện lỗi ở đúng ô, KHÔNG lặp lại chuỗi đã dán", async () => {
    napTrang();
    const n = nenGia(false);
    await khoiTaoTrangOptions(document, n.gui);
    (o("agentSecret") as HTMLInputElement).value = "sai";
    (document.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await cho();
    await cho();
    const loi = document.querySelector('[data-loi="agentSecret"]');
    expect(loi?.textContent).toMatch(/64 ký tự/);
    expect(loi?.textContent).not.toContain("sai");
  });

  it("[EXT-OPT-04] khối trạng thái: phiên, hết hạn lúc, lần đồng bộ cuối, phiên bản — không có bí mật", async () => {
    napTrang();
    const n = nenGia(true);
    await khoiTaoTrangOptions(document, n.gui);
    const tt = document.querySelector("#trang-thai")?.textContent ?? "";
    expect(tt).toMatch(/READY|Đang đăng nhập/);
    expect(tt).toContain("0.1.0");
    expect(tt).toContain("08/10/2026 08:15");
    expect(tt).not.toContain(BI_MAT);
  });

  it("[EXT-OPT-05] hợp đồng 1.1 — lỗi FIELD_TOO_LONG hiện KÈM trường máy chủ báo vượt trần (người vận hành biết báo dev sửa khoá nào); mã khác hiện như cũ", async () => {
    napTrang();
    await khoiTaoTrangOptions(document, nenGia(true, { loiMo: ["SYNC_FAILED", "FIELD_TOO_LONG"], truongQuaDai: ["store_code", "terminal_code"] }).gui);
    expect(document.querySelector('[data-tt="loi"]')?.textContent).toBe("SYNC_FAILED, FIELD_TOO_LONG (store_code, terminal_code)");
    // chưa biết trường (máy chủ không gửi `field`) ⇒ chỉ mã
    napTrang();
    await khoiTaoTrangOptions(document, nenGia(true, { loiMo: ["FIELD_TOO_LONG"], truongQuaDai: [] }).gui);
    expect(document.querySelector('[data-tt="loi"]')?.textContent).toBe("FIELD_TOO_LONG");
  });
});
