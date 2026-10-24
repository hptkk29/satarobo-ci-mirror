// @vitest-environment node
/**
 * [NHH-BC-01] — `dungBoiCanhQuet`: CỔNG BẬT/TẮT của engine hoa hồng mới. THUẦN (mock cờ, mốc cutover, nạp chính sách).
 *
 * Vì sao có tệp này — cấy lỗi 08/10, cả hai đều 0 ca đỏ: (1) bỏ đọc cờ `hoaHong.engineBat` ⇒ engine chạy dù đang TẮT; (2) "chưa có mốc cutover" bị coi là BẬT
 * với mốc 2000-01 ⇒ engine ghi sổ cho cả lịch sử. `[NHH-FLG-11]` chỉ đo `laEngineHoaHongBat` đọc đúng khoá; `[NHH-W8]` chỉ ghim chữ trong route. Không ca nào hỏi
 * "cờ tắt thì engine có dựng bối cảnh không".
 */
import type { PrismaClient } from "@prisma/client";
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ bat: false, moc: null as string | null, goiMoc: 0, goiCtx: 0 }));
vi.mock("./feature", () => ({ laEngineHoaHongBat: async () => h.bat }));
vi.mock("./cutover", () => ({
  docMocCutover: async () => {
    h.goiMoc++;
    return h.moc;
  },
}));
vi.mock("./chinh-sach-service", () => ({
  docHoaHongContext: async () => {
    h.goiCtx++;
    return { quyTac: [], nhomNguon: [], vaiHuong: [], thuTuPhamVi: [], phienBanThuTu: "v1", tranTongTiLe: 0.09, vatTheoNgay: [] };
  },
}));
vi.mock("@/lib/nguon/feature", () => ({ layCuaSoGhiCongNgay: async () => 90 }));

import { dungBoiCanhQuet } from "./boi-canh";

const client = {
  leadSourceGroup: { findFirst: async () => ({ id: "g-unknown", code: "UNKNOWN" }) },
  beneficiaryRole: { findMany: async () => [{ id: "r-sale", code: "SALE" }] },
} as unknown as PrismaClient;
const NOW = new Date("2026-11-10T03:00:00.000Z");

beforeEach(() => {
  h.bat = false;
  h.moc = null;
  h.goiMoc = 0;
  h.goiCtx = 0;
});

describe("[NHH-BC-01] dungBoiCanhQuet", () => {
  it("[NHH-BC-01] CỜ TẮT ⇒ TAT/ENGINE_TAT, KHÔNG đọc mốc cutover, KHÔNG nạp chính sách — dù đã có mốc", async () => {
    h.bat = false;
    h.moc = "2026-10";
    expect(await dungBoiCanhQuet(client, NOW)).toEqual({ loai: "TAT", lyDo: "ENGINE_TAT" });
    expect(h.goiMoc).toBe(0);
    expect(h.goiCtx).toBe(0);
  });

  it("[NHH-BC-01] cờ BẬT nhưng CHƯA có mốc cutover ⇒ TAT/CHUA_CO_MOC_CUTOVER, không nạp chính sách (engine không ghi kỳ nào)", async () => {
    h.bat = true;
    h.moc = null;
    expect(await dungBoiCanhQuet(client, NOW)).toEqual({ loai: "TAT", lyDo: "CHUA_CO_MOC_CUTOVER" });
    expect(h.goiMoc).toBe(1);
    expect(h.goiCtx).toBe(0);
  });

  it("[NHH-BC-01] cờ BẬT + có mốc ⇒ BAT; bối cảnh mang đúng mốc, đúng `now` truyền vào (luật 19), cửa sổ ngày, nhóm UNKNOWN và bản đồ vai", async () => {
    h.bat = true;
    h.moc = "2026-10";
    const r = await dungBoiCanhQuet(client, NOW);
    expect(r.loai).toBe("BAT");
    if (r.loai !== "BAT") return;
    expect(r.bc.kyCutover).toBe("2026-10");
    expect(r.bc.now).toBe(NOW);
    expect(r.bc.cuaSoNgay).toBe(90);
    expect(r.bc.nhomUnknown).toEqual({ id: "g-unknown", code: "UNKNOWN" });
    expect(r.bc.idVai.get("SALE")).toBe("r-sale");
    expect(h.goiCtx).toBe(1);
  });
});
