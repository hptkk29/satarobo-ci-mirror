// @vitest-environment node
/**
 * [NHH-H-IND-*] — LƯỚI GHIM MÃ NGUỒN: spec DB của lead-intake / hoa-hong phải TỰ DỰNG cơ sở + đơn vị mà nó tra (luật 18).
 *
 * Sự cố (08/10/2026, task H-TEST-INDEPENDENCE): ba tệp `nguon-noi-day`, `nguon-noi-day-duong`, `nguon-thu-thap-tin-hieu` gọi
 * `findUniqueOrThrow({ where: { code: "CS1" } })` mà KHÔNG tự dựng. Chạy cả thư mục thì XANH (tệp chạy trước để lại Center/OrgUnit), chạy MỘT MÌNH trên DB
 * trống thì 33 ca đỏ `No Center found` / `No OrgUnit found`. Xanh vì THỨ TỰ chứ không vì ca đúng — và chữ ký của lớp lỗi này là «chạy 1 ca ĐỎ, cả bộ XANH».
 *
 * Lưới này THUẦN (không DB, chạy trong `pnpm test:unit`): quét văn bản các spec đã BỎ chú thích (chú thích giải thích bản vá chứa đúng chuỗi cần tìm — luật 11).
 * Nó chỉ bắt CÁCH THỨC lỗi phổ biến nhất; bằng chứng đầy đủ là chạy từng spec một mình trên DB sạch (xem docs/source-commission/05, mục «Độc lập fixture»).
 *
 * Đã CẤY (luật 14): gỡ `damBaoToChuc(` khỏi từng spec ⇒ `[NHH-H-IND-01]` đỏ đúng tệp đó.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const THU_MUC = ["tests/lead-intake", "tests/hoa-hong"] as const;

/** Bỏ chú thích khối + chú thích dòng (không đụng `://` trong chuỗi URL). */
export function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Tra Center/OrgUnit theo mã CỐ ĐỊNH của cây tổ chức chuẩn (HO · CS1 · CS2) — thứ mà DB trống không có. */
const TRA_CO_SO_CO_DINH = /\b(?:center|orgUnit)\s*\.\s*(?:findUniqueOrThrow|findFirstOrThrow|findUnique|findFirst)\s*\(\s*\{\s*where\s*:\s*\{\s*code\s*:\s*"(?:HO|CS1|CS2)"/;
/** Hàm trợ giúp của bộ kịch bản mà BÊN TRONG nó tra OrgUnit `HO` cố định. */
const DUNG_DON_VI_HOI_SO = /\b(?:donViHoiSo|nguoiKyHo)\s*\(/;
/** Cách spec TỰ dựng tổ chức. */
const TU_DUNG_TO_CHUC = /\b(?:seedOrg|damBaoToChuc)\s*\(/;

export type ViPham = { ma: "TRA_CO_SO_KHONG_TU_DUNG" | "DON_VI_HOI_SO_KHONG_TU_DUNG"; chiTiet: string };

/** Hàm quyết định (thuần) — kiểm MỘT spec đã bỏ chú thích. */
export function kiemSpec(vanBan: string): ViPham[] {
  const ra: ViPham[] = [];
  const tuDung = TU_DUNG_TO_CHUC.test(vanBan);
  if (TRA_CO_SO_CO_DINH.test(vanBan) && !tuDung) ra.push({ ma: "TRA_CO_SO_KHONG_TU_DUNG", chiTiet: "tra Center/OrgUnit HO|CS1|CS2 mà không gọi seedOrg()/damBaoToChuc()" });
  if (DUNG_DON_VI_HOI_SO.test(vanBan) && !tuDung) ra.push({ ma: "DON_VI_HOI_SO_KHONG_TU_DUNG", chiTiet: "dùng donViHoiSo()/nguoiKyHo() (tra OrgUnit HO) mà không gọi seedOrg()/damBaoToChuc()" });
  return ra;
}

function docTatCaSpec(): { tep: string; vanBan: string }[] {
  const ra: { tep: string; vanBan: string }[] = [];
  for (const d of THU_MUC) {
    const abs = resolve(process.cwd(), d);
    for (const f of readdirSync(abs).filter((x) => x.endsWith(".spec.ts")).sort()) {
      ra.push({ tep: `${d}/${f}`, vanBan: boChuThich(readFileSync(resolve(abs, f), "utf8")) });
    }
  }
  return ra;
}

describe("[NHH-H-IND] spec DB tự dựng tổ chức mà nó tra (luật 18)", () => {
  const spec = docTatCaSpec();

  it("[NHH-H-IND-00] đối chứng: quét thấy đủ spec của cả hai thư mục (lưới không rỗng)", () => {
    expect(spec.length).toBeGreaterThanOrEqual(30);
    expect(spec.some((s) => s.tep.startsWith("tests/lead-intake/"))).toBe(true);
    expect(spec.some((s) => s.tep.startsWith("tests/hoa-hong/"))).toBe(true);
  });

  it("[NHH-H-IND-01] KHÔNG spec nào tra Center/OrgUnit HO|CS1|CS2 hoặc dùng donViHoiSo/nguoiKyHo mà không tự dựng tổ chức", () => {
    const loi = spec.flatMap((s) => kiemSpec(s.vanBan).map((v) => `${s.tep}: ${v.chiTiet}`));
    expect(loi).toEqual([]);
  });

  it("[NHH-H-IND-02] đối chứng dương: ba tệp từng đỏ khi chạy một mình NAY có tra tổ chức VÀ có tự dựng (lưới thật sự nhìn thấy chúng)", () => {
    for (const ten of ["nguon-noi-day.spec.ts", "nguon-noi-day-duong.spec.ts", "nguon-thu-thap-tin-hieu.spec.ts"]) {
      const s = spec.find((x) => x.tep.endsWith(`/${ten}`));
      expect(s, ten).toBeDefined();
      expect(TRA_CO_SO_CO_DINH.test(s!.vanBan), `${ten} có tra Center/OrgUnit cố định`).toBe(true);
      expect(TU_DUNG_TO_CHUC.test(s!.vanBan), `${ten} tự dựng tổ chức`).toBe(true);
    }
  });

  it("[NHH-H-IND-03] hàm quyết định tự kiểm: văn bản thiếu seed bị bắt, đủ seed thì qua, chú thích không đánh lừa", () => {
    const tra = `const c = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });`;
    expect(kiemSpec(tra).map((v) => v.ma)).toEqual(["TRA_CO_SO_KHONG_TU_DUNG"]);
    expect(kiemSpec(`await seedOrg(["CS1"]);\n${tra}`)).toEqual([]);
    expect(kiemSpec(`await damBaoToChuc();\n${tra}`)).toEqual([]);
    expect(kiemSpec(`const ho = await donViHoiSo();`).map((v) => v.ma)).toEqual(["DON_VI_HOI_SO_KHONG_TU_DUNG"]);
    // tra theo mã KHÁC (do chính spec dựng) thì không phải tra tổ chức cố định
    expect(kiemSpec(`await db.center.findUniqueOrThrow({ where: { code: "NDAY1" } });`)).toEqual([]);
    // chú thích nhắc seedOrg KHÔNG được coi là có gọi
    expect(kiemSpec(boChuThich(`// seedOrg(["CS1"]) — nhớ gọi\n${tra}`)).map((v) => v.ma)).toEqual(["TRA_CO_SO_KHONG_TU_DUNG"]);
    expect(kiemSpec(boChuThich(`/* damBaoToChuc( ) */\n${tra}`)).map((v) => v.ma)).toEqual(["TRA_CO_SO_KHONG_TU_DUNG"]);
  });
});
