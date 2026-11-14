// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/bao-luu/kho-tep", () => ({ khoBaoLuuDaCauHinh: () => true, lietKeTepBaoLuu: vi.fn(), xoaNhieuTepBaoLuu: vi.fn() }));

import { chonTepMoCoi, TUOI_TOI_THIEU_MS, type TepTrongKho } from "@/lib/bao-luu/tep-mo-coi";
import { donTepBaoLuuMoCoi, type PhuThuocDonTep } from "@/lib/bao-luu/don-tep-mo-coi";

const NOW = new Date("2026-10-08T03:00:00Z");
const cu = new Date(NOW.getTime() - TUOI_TOI_THIEU_MS - 3600_000);
const moi = new Date(NOW.getTime() - TUOI_TOI_THIEU_MS + 3600_000);
const K = (n: number) => `bao-luu/2026-09/${String(n).padStart(8, "a")}.pdf`;
const tep = (khoa: string, lastModified: Date | null = cu): TepTrongKho => ({ khoa, lastModified });

describe("[BL7-TMC] chọn tệp mồ côi của kho bảo lưu", () => {
  it("[BL7-TMC-01] chỉ chọn tệp CŨ HƠN 7 ngày, đúng hình dạng khoá, KHÔNG được tham chiếu", () => {
    const r = chonTepMoCoi({
      tep: [tep(K(1)), tep(K(2), moi), tep(K(3)), tep("bao-luu/../x.pdf"), tep("hoa-don/CS1/2026/o1/u.pdf"), tep(K(4), null)],
      thamChieu: new Set([K(3)]),
      now: NOW,
      tran: 10,
    });
    expect(r).toEqual({ xoa: [K(1)], moCoi: 1 });
  });

  it("[BL7-TMC-02] đúng mốc 7 ngày KHÔNG bị xoá (cũ HƠN, không phải bằng)", () => {
    const dungMoc = new Date(NOW.getTime() - TUOI_TOI_THIEU_MS);
    expect(chonTepMoCoi({ tep: [tep(K(1), dungMoc)], thamChieu: new Set(), now: NOW, tran: 10 }).xoa).toEqual([]);
  });

  it("[BL7-TMC-03] trần mỗi lượt: cũ nhất trước, khoá trùng chỉ tính một lần, tran ≤ 0 ⇒ không chọn gì nhưng vẫn đếm mồ côi", () => {
    const a = new Date(cu.getTime() - 2 * 86_400_000);
    const b = new Date(cu.getTime() - 1 * 86_400_000);
    const ds = [tep(K(1), b), tep(K(2), a), tep(K(3), cu), tep(K(2), a)];
    expect(chonTepMoCoi({ tep: ds, thamChieu: new Set(), now: NOW, tran: 2 })).toEqual({ xoa: [K(2), K(1)], moCoi: 3 });
    expect(chonTepMoCoi({ tep: ds, thamChieu: new Set(), now: NOW, tran: 0 })).toEqual({ xoa: [], moCoi: 3 });
  });
});

describe("[BL7-DTM] runner: MẶC ĐỊNH chỉ báo cáo, không xoá", () => {
  const dep = (xoa = vi.fn(async (k: readonly string[]) => ({ daXoa: k.length, loi: 0 }))): PhuThuocDonTep & { xoa: typeof xoa } => ({
    daCauHinh: () => true,
    lietKe: async () => ({ tep: [tep(K(1)), tep(K(2)), tep(K(3))], catNgang: false }),
    docThamChieu: async () => new Set([K(3)]),
    xoa,
  });

  it("[BL7-DTM-01] choPhepXoa=false ⇒ báo cáo đủ số mồ côi nhưng KHÔNG gọi xoá", async () => {
    const d = dep();
    const r = await donTepBaoLuuMoCoi(NOW, { choPhepXoa: false }, d);
    expect(r).toMatchObject({ boQua: null, daXet: 3, moCoi: 2, seXoa: 2, daXoa: 0, conLai: 2, choPhepXoa: false });
    expect(d.xoa).not.toHaveBeenCalled();
  });

  it("[BL7-DTM-02] choPhepXoa=true ⇒ xoá ĐÚNG danh sách đã chọn (khoá được tham chiếu không bị đụng)", async () => {
    const d = dep();
    const r = await donTepBaoLuuMoCoi(NOW, { choPhepXoa: true }, d);
    expect(d.xoa).toHaveBeenCalledWith([K(1), K(2)]);
    expect(r).toMatchObject({ moCoi: 2, daXoa: 2, conLai: 0 });
  });

  it("[BL7-DTM-03] kho chưa cấu hình ⇒ bỏ qua cả lượt, không liệt kê, không xoá", async () => {
    const d = { ...dep(), daCauHinh: () => false, lietKe: vi.fn() };
    const r = await donTepBaoLuuMoCoi(NOW, { choPhepXoa: true }, d);
    expect(r.boQua).toBe("KHO_CHUA_CAU_HINH");
    expect(d.lietKe).not.toHaveBeenCalled();
    expect(d.xoa).not.toHaveBeenCalled();
  });

  it("[BL7-DTM-04] lưới ghim: route cron chỉ bật xoá bằng env BAO_LUU_DON_TEP_XOA === \"1\" (mặc định tắt)", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/cron/bao-luu-tep-mo-coi/route.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src.match(/choPhepXoa:/g)).toHaveLength(1);
    expect(src).toContain('choPhepXoa: process.env.BAO_LUU_DON_TEP_XOA === "1"');
  });
});
