// @vitest-environment node
/**
 * [FLG-*] — NGỮ NGHĨA HAI CÔNG TẮC (R9, docs/source-commission/12 §11.9): `affiliate.enabled` là cổng NHẬN/GHI NHẬN; `hoaHong.engineBat` là công tắc TỔNG của tiền.
 * Lưới ghim mã nguồn (hành vi có ca Postgres: `[FLG-DB-01]` · `[NHH-UI-ACT-04c]` · `[NHH-UI-TN-07]` · `[AHD-OFF-*]` · `[AFI-10]`). Neo hẹp, bỏ chú thích TRƯỚC khi đếm (luật 11).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SETTINGS } from "@/lib/settings/registry";
import { NHAN_VAN_HANH } from "@/lib/settings/nhan-van-hanh";

const GOC = process.cwd();
const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(GOC, p), "utf8").replace(/\r\n/g, "\n"));
const dem = (s: string, mau: RegExp): number => (s.match(new RegExp(mau.source, mau.flags.includes("g") ? mau.flags : `${mau.flags}g`)) ?? []).length;

function tepMa(thuMuc: string): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const ten of readdirSync(d)) {
      const p = resolve(d, ten);
      if (statSync(p).isDirectory()) di(p);
      else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.(ts|tsx)$/.test(ten)) ra.push(relative(GOC, p).split(sep).join("/"));
    }
  };
  di(resolve(GOC, thuMuc));
  return ra;
}

describe("[FLG-01] engine hoa hồng KHÔNG đọc `affiliate.enabled` — tắt Affiliate không làm biến mất tiền đã phát sinh", () => {
  it("không tệp mã nào trong `lib/hoa-hong/**` nhắc cờ Affiliate (import feature · khoá · hàm đọc)", () => {
    const vi = tepMa("lib/hoa-hong").filter((f) => /affiliate\/feature|laAffiliateBat|KHOA_AFFILIATE|hopCoAffiliate|["']affiliate\.enabled["']/.test(doc(f)));
    expect(vi).toEqual([]);
  });

  it("engine có cờ RIÊNG, đọc ở MỘT hàm; hai cờ là hai khoá khác nhau trong registry (mặc định cùng TẮT)", () => {
    expect(dem(doc("lib/hoa-hong/feature.ts"), /"hoaHong\.engineBat"|KHOA_ENGINE/g)).toBeGreaterThanOrEqual(1);
    expect(SETTINGS["hoaHong.engineBat"].default).toBe(false);
    expect(SETTINGS["affiliate.enabled"].default).toBe(false);
    expect("hoaHong.engineBat").not.toBe("affiliate.enabled");
  });
});

describe("[FLG-02] `affiliate.enabled` TẮT ⇒ không tạo attribution Affiliate MỚI: BA cổng đọc cờ, fail-closed (đọc lỗi ⇒ coi như TẮT)", () => {
  const thuThap = doc("lib/nguon/thu-thap-tin-hieu.ts");
  const timNguoi = doc("lib/nguon/tim-nguoi-gioi-thieu.ts");
  const doiNguon = doc("lib/nguon/doi-nguon-lead.ts");

  it("choke point `thuThapTinHieuTheoLo`: đọc cờ ĐÚNG MỘT lần, CHỈ khi có dòng cần đối tác; chặn CẢ ô chọn nguồn lẫn referral đã kiểm", () => {
    expect(dem(thuThap, /laAffiliateBatTho\(\)/g)).toBe(1);
    expect(dem(thuThap, /await laAffiliateBatTho\(\)\.catch\(\(\) => false\)/g)).toBe(1);
    expect(dem(thuThap, /idDoiTacChon\.length > 0 && affiliateBat/g)).toBe(1);
    expect(dem(thuThap, /idAffiliateReferral\.length > 0 && affiliateBat/g)).toBe(1);
    // cờ phải được đọc TRƯỚC câu tra đối tác đầu tiên (`Promise.all`)
    expect(thuThap.indexOf("const affiliateBat")).toBeGreaterThan(-1);
    expect(thuThap.indexOf("const affiliateBat")).toBeLessThan(thuThap.indexOf("const [leadCungSdt"));
  });

  it("bộ chọn người giới thiệu: `timDoiTac` đọc cờ TRƯỚC câu tra, cờ tắt ⇒ `[]`", () => {
    const ham = timNguoi.slice(timNguoi.indexOf("async function timDoiTac("));
    expect(dem(ham, /laAffiliateBatTho\(\)\.catch\(\(\) => false\)\)\) return \[\]/g)).toBe(1);
    expect(ham.indexOf("laAffiliateBatTho")).toBeLessThan(ham.indexOf("db.affiliate.findMany"));
  });

  it("đổi nguồn bằng tay: `kiemNguoiTonTai` nhánh đối tác đọc cờ TRƯỚC câu tra, cờ tắt ⇒ cùng câu «không tồn tại hoặc đã tắt»", () => {
    const ham = doiNguon.slice(doiNguon.indexOf("async function kiemNguoiTonTai("), doiNguon.indexOf("type NhomDich"));
    expect(dem(ham, /laAffiliateBatTho\(\)\.catch\(\(\) => false\)\)\) return "Đối tác giới thiệu không tồn tại hoặc đã tắt\."/g)).toBe(1);
    expect(ham.indexOf("laAffiliateBatTho")).toBeLessThan(ham.indexOf("db.affiliate.findFirst"));
  });

  it("ba nơi cùng MỘT hàm đọc cờ (`laAffiliateBatTho`) — không nơi nào tự đọc `getSetting(\"affiliate.enabled\")`", () => {
    for (const f of ["lib/nguon/thu-thap-tin-hieu.ts", "lib/nguon/tim-nguoi-gioi-thieu.ts", "lib/nguon/doi-nguon-lead.ts"]) {
      expect(doc(f), f).not.toMatch(/getSetting\(["']affiliate\.enabled["']\)/);
      expect(doc(f), f).toMatch(/import \{ laAffiliateBatTho \} from "@\/lib\/affiliate\/feature"/);
    }
  });
});

describe("[FLG-03] nhãn vận hành NÓI ĐÚNG cái mỗi cờ gác (màn Cấu hình vận hành in chúng — người vận hành không được hiểu sai)", () => {
  it("«Affiliate / người giới thiệu»: nhận & ghi nhận khách MỚI; tắt KHÔNG dừng tiền; chỉ đường dừng tiền", () => {
    const g = NHAN_VAN_HANH["affiliate.enabled"].giaiThich;
    expect(g).toContain("nhận và ghi nhận khách do đối tác giới thiệu");
    expect(g).toContain("Tắt thì ngừng nhận khách giới thiệu MỚI");
    expect(g).toContain("KHÔNG bật và cũng KHÔNG dừng việc tính tiền");
    expect(g).toContain("tắt công tắc đó");
  });
  it("«Engine hoa hồng mới»: CÔNG TẮC TỔNG của tiền, tắt dừng cả hoa hồng Affiliate đã có người hưởng", () => {
    const g = NHAN_VAN_HANH["hoaHong.engineBat"].giaiThich;
    expect(g).toContain("CÔNG TẮC TỔNG của tiền");
    expect(g).toContain("dừng hoa hồng của đối tác Affiliate đã có người hưởng");
  });
});
