// Ca [NMC-CD-*] — CÀI ĐẶT «ngày bắt đầu áp dụng người mua là con»: mặc định TẮT, khai ở registry, đọc ở đúng MỘT hàm (`docMocNguoiMuaTheoCon`).
// Cùng khuôn lưới `[HDF-02]` (`feature.test.ts`): rải `getSetting("hoaDon.nguoiMuaTheoConTuNgay")` khắp nơi là mỗi chỗ tự quyết nghĩa của «tắt».
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({ giaTri: "" as string }));
vi.mock("@/lib/settings/service", () => ({ getSetting: async () => h.giaTri }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { docMocNguoiMuaTheoCon, KHOA_NGUOI_MUA_THEO_CON } from "./feature";
import { SETTINGS } from "@/lib/settings/registry";
import { NHAN_VAN_HANH } from "@/lib/settings/nhan-van-hanh";

describe("[NMC-CD-01] khai báo", () => {
  it("khoá là `hoaDon.nguoiMuaTheoConTuNgay`, mặc định RỖNG = TẮT, toàn hệ (không lệch theo cơ sở), nhóm tài chính", () => {
    expect(KHOA_NGUOI_MUA_THEO_CON).toBe("hoaDon.nguoiMuaTheoConTuNgay");
    const d = SETTINGS[KHOA_NGUOI_MUA_THEO_CON];
    // Mặc định khác rỗng là bật luật cho cả prod ngay lần deploy kế tiếp — hoá đơn là chứng từ thuế, không bật theo mặc định.
    expect(d.default).toBe("");
    expect(d.centerOverridable).toBe(false);
    expect(d.group).toBe("finance");
  });

  it("schema chỉ nhận ngày YYYY-MM-DD hoặc rỗng", () => {
    const s = SETTINGS[KHOA_NGUOI_MUA_THEO_CON].schema;
    expect(s.safeParse("").success).toBe(true);
    expect(s.safeParse("2026-11-17").success).toBe(true);
    expect(s.safeParse("17/11/2026").success).toBe(false);
    expect(s.safeParse("hôm nay").success).toBe(false);
    expect(s.safeParse(true).success).toBe(false);
  });

  it("có nhãn cho người vận hành ở tab Tiền, đánh dấu CẨN THẬN", () => {
    const n = NHAN_VAN_HANH[KHOA_NGUOI_MUA_THEO_CON];
    expect(n.tab).toBe("tien");
    expect(n.canThan).toBe(true);
    expect(n.giaiThich).toMatch(/Để trống = tắt/);
  });
});

describe("[NMC-CD-02] docMocNguoiMuaTheoCon", () => {
  beforeEach(() => {
    h.giaTri = "";
  });
  it("rỗng / khoảng trắng ⇒ null (TẮT)", async () => {
    expect(await docMocNguoiMuaTheoCon()).toBeNull();
    h.giaTri = "   ";
    expect(await docMocNguoiMuaTheoCon()).toBeNull();
  });
  it("ngày hợp lệ ⇒ 00:00 GIỜ VIỆT NAM của ngày đó (= 17:00 UTC hôm trước)", async () => {
    h.giaTri = "2026-11-17";
    expect((await docMocNguoiMuaTheoCon())?.toISOString()).toBe("2026-11-16T17:00:00.000Z");
  });
  it("giá trị hỏng ⇒ null (fail-closed: không đoán ngày)", async () => {
    h.giaTri = "hôm qua";
    expect(await docMocNguoiMuaTheoCon()).toBeNull();
  });
});

describe("[NMC-CD-03] LƯỚI: khoá chỉ được nhắc ở feature.ts + registry + nhãn", () => {
  const bocChuThich = (v: string) =>
    v
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((d) => d.replace(/\/\/[^\n]*$/, ""))
      .join("\n");
  it("0 tệp khác nhắc chuỗi khoá (ngoài chú thích)", { timeout: 30_000 }, () => {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app", "components"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter((d) => /\.tsx?$/.test(d))
      .filter((d) => !/\.(test|spec)\.tsx?$/.test(d))
      .filter((d) => !["lib/finance/hoa-don/feature.ts", "lib/settings/registry.ts", "lib/settings/nhan-van-hanh.ts"].includes(d))
      .filter((d) => existsSync(resolve(process.cwd(), d)));
    expect(ra.length).toBeGreaterThan(200);
    const viPham = ra.filter((d) => bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8")).includes(KHOA_NGUOI_MUA_THEO_CON));
    expect(viPham, `Đọc cài đặt ngoài feature.ts: ${viPham.join(", ")}`).toEqual([]);
  });
});

describe("[NMC-CD-04] LƯỚI DÂY NỐI: mỗi nơi dựng người mua cho MỘT chứng từ phải truyền DÒNG ĐƠN của khoản (đơn nhiều con: mỗi tờ một bé)", () => {
  const doc = (p: string) =>
    readFileSync(resolve(process.cwd(), p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((d) => d.replace(/\/\/[^\n]*$/, ""))
      .join("\n");
  const dem = (src: string, re: RegExp) => (src.match(re) ?? []).length;
  it("phát hành MISA/VIN + lô đêm (qua `kiemCongChotTrongTx`): người mua theo dòng đơn của khoản trong lần thu", () => {
    const src = doc("lib/finance/hoa-don/chot-hoa-don.ts");
    expect(dem(src, /orderItemIdsCuaKhoan\(input\.khoan\.map\(\(k\) => k\.paymentId\), tx\)/g)).toBe(1);
    expect(dem(src, /ganConChoDon\(orderId, donTho, tx, dongCuaKhoan, input\.nguoiMuaChon\)/g)).toBe(1);
  });
  it("bản chụp người mua lúc tạo hoá đơn nháp (`taoHoaDonChoLanThu`)", () => {
    expect(dem(doc("lib/finance/hoa-don/ghi-hoa-don.ts"), /ganConChoDon\(input\.orderId, donTho, tx, await orderItemIdsCuaKhoan\(input\.khoan\.map\(\(k\) => k\.id\), tx\)\)/g)).toBe(1);
  });
  it("phiếu chờ (một lần thu) và phiếu thu chính thức (một khoản)", () => {
    expect(dem(doc("lib/finance/hoa-don/trang-phieu-cho.ts"), /ganConChoDon\(\s*row\.orderId,\s*\{\},\s*undefined,\s*row\.khoan\.map\(\(k\) => theoId\.get\(k\.id\)\?\.orderItemId \?\? null\),\s*nguoiMuaChon,?\s*\)/g)).toBe(1);
    expect(dem(doc("lib/pdf/phieu-thu-khoan.ts"), /napConChoMotDon\(payment\.orderId, undefined, \[payment\.orderItemId\]\)/g)).toBe(1);
  });
  it("hàng chờ: MỖI lần thu dựng lại người mua từ khoản của nó (không dùng một người mua chung cho cả đơn)", () => {
    const src = doc("lib/finance/hoa-don/dong-hang-cho.ts");
    expect(dem(src, /conChoChungTu\(don\.thongTinCon, dongCuaKhoan\)/g)).toBe(1);
    expect(dem(src, /const nm = nguoiMuaCuaLanThu\(lt\);/g)).toBe(1);
    expect(dem(src, /const nm = nguoiMuaChoDon\(don\);/g), "không còn người mua dựng MỘT lần ngoài vòng lần thu").toBe(0);
  });
});
