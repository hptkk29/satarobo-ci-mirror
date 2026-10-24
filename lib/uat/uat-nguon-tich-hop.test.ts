/**
 * [UTH-*] — LƯỚI DÂY NỐI của các ca UAT lane E2 (`tests/uat-nguon/{setup-engine,src-30-t1-hang-cho,src-40-tich-hop}.uat.ts` + `_lib/{xlsx,nhap-khach,hoa-hong-ui,audit}.ts`).
 *
 * Các ca UAT chạy bằng trình duyệt THẬT trên test.satarobo.vn nên không chạy trong CI; thứ CI canh được là những chỗ mà ca UAT **chép tay** một hằng của ứng dụng/fixture — chép lệch là ca chạy ra
 * «không tìm thấy» (BLOCKED oan) hoặc, tệ hơn, đo nhầm đối tượng. Mỗi lưới dưới đây ghim MỘT chỗ chép tay ấy với NGUỒN của nó:
 *   · SĐT / tên của fixture «UAT SOURCE FINAL» (lead cũ, lead đã thu) ↔ `lib/uat/nguon-final.ts`;
 *   · tiêu đề cột tệp Excel nhập lead ↔ `LEAD_IMPORT_COLUMNS` của ứng dụng;
 *   · tập mã ca (đủ, không trùng, không `test.skip` — thiếu tiền đề là `biChan`, không phải skip câm) và THỨ TỰ các ca nối nhau;
 *   · ca ghi cấu hình dùng chung (chuan-bi) luôn idempotent (đọc trạng thái trước khi ghi) và không bao giờ dời mốc cutover.
 *
 * Soi MÃ chứ không soi chú thích (bỏ chú thích trước khi so) — chú thích giải thích bản vá thường chứa đúng chuỗi đang cấm.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEAD_IMPORT_COLUMNS } from "@/lib/lead/import";
import { LEAD_CU, TIEN_TO_NGUON_FINAL, phoneHangCho, phoneLeadCu, phoneLeadCuDaiDien, tenLeadCu, tenLeadCuDaiDien } from "@/lib/uat/nguon-final";

const doc = (p: string): string => readFileSync(resolve(process.cwd(), p), "utf8");
const boChuThichTs = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SETUP_GOC = doc("tests/uat-nguon/setup-engine.uat.ts");
const T1_GOC = doc("tests/uat-nguon/src-30-t1-hang-cho.uat.ts");
const TICH_HOP_GOC = doc("tests/uat-nguon/src-40-tich-hop.uat.ts");
const XLSX_GOC = doc("tests/uat-nguon/_lib/xlsx.ts");
const SETUP = boChuThichTs(SETUP_GOC);
const T1 = boChuThichTs(T1_GOC);
const TICH_HOP = boChuThichTs(TICH_HOP_GOC);

const maCa = (src: string): string[] => [...src.matchAll(/^test\(\s*"\[(SRC-[0-9]{2}[a-z]?)\]/gm)].map((m) => m[1]!);
const viTri = (src: string, ma: string): number => src.indexOf(`test("[${ma}]`);

describe("[UTH-ID] tập mã ca đủ và đúng thứ tự", () => {
  it("[UTH-ID-00] đối chứng: bộ đọc thấy mã ca ở cả ba tệp", () => {
    expect(maCa(SETUP).length).toBeGreaterThanOrEqual(5);
    expect(maCa(T1).length).toBeGreaterThanOrEqual(5);
    expect(maCa(TICH_HOP).length).toBeGreaterThanOrEqual(15);
  });

  it("[UTH-ID-01] tập mã ca CHÍNH XÁC (xoá/đổi tên một ca là đỏ — bảng ở uat-harness.md §4 phải đổi cùng)", () => {
    expect(maCa(SETUP)).toEqual(["SRC-39", "SRC-45", "SRC-40", "SRC-41", "SRC-42", "SRC-43", "SRC-44"]);
    expect(maCa(T1)).toEqual(["SRC-30", "SRC-31", "SRC-32", "SRC-33", "SRC-34", "SRC-35"]);
    expect(maCa(TICH_HOP).sort()).toEqual(
      ["SRC-06", "SRC-07", "SRC-08", "SRC-09", "SRC-09b", "SRC-10", "SRC-11", "SRC-12", "SRC-12b", "SRC-13", "SRC-13b", "SRC-14", "SRC-17", "SRC-18", "SRC-18b", "SRC-19", "SRC-20", "SRC-21", "SRC-22", "SRC-23"].sort(),
    );
  });

  it("[UTH-ID-02] không ca nào dùng `test.skip`/`test.only`/`test.fixme` — thiếu tiền đề thì `ca.biChan(lý do)` (BLOCKED có chữ), skip câm không để lại bằng chứng", () => {
    for (const [ten, src] of [["setup-engine", SETUP], ["t1", T1], ["tich-hop", TICH_HOP]] as const) {
      expect(src, ten).not.toMatch(/test\.(skip|only|fixme)\(/);
    }
  });

  it("[UTH-ID-03] THỨ TỰ nối nhau: setup 39 → 40 → 41 → 42 → 43 → 44 (cutover đòi chính sách chung ACTIVE); T1 30 → 31 → 32 → 33 → 34 → 35 (35 trả ngưỡng ở CUỐI); tích hợp 06 → 09 → 09b → 14 → 22 và 13 → 12 → 12b", () => {
    const dung = (src: string, ds: string[]): void => {
      const vt = ds.map((m) => viTri(src, m));
      expect(vt.every((v) => v >= 0), `thiếu ca trong ${ds.join(",")}`).toBe(true);
      expect([...vt].sort((a, b) => a - b)).toEqual(vt);
    };
    dung(SETUP, ["SRC-39", "SRC-40", "SRC-41", "SRC-42", "SRC-43", "SRC-44"]);
    dung(T1, ["SRC-30", "SRC-31", "SRC-32", "SRC-33", "SRC-34", "SRC-35"]);
    dung(TICH_HOP, ["SRC-06", "SRC-09", "SRC-09b", "SRC-14", "SRC-22"]);
    dung(TICH_HOP, ["SRC-13", "SRC-12", "SRC-12b"]);
    dung(TICH_HOP, ["SRC-18", "SRC-22"]);
  });
});

describe("[UTH-W] hằng chép tay khớp nguồn của nó", () => {
  it("[UTH-W1] ba lead cũ (SĐT · tên) của SRC-20 khớp fixture `lib/uat/nguon-final.ts`", () => {
    expect(LEAD_CU.map((l) => l.ma)).toEqual(["AUTO", "MANUAL_REVIEW", "OTHER"]);
    // Bộ CHUNG (099040000x) và bộ ĐẠI DIỆN (09907, đường `uat-nap-lead-cu-*`): mỗi lớp ứng với MỘT lead đại diện — AUTO↔ADS · MANUAL_REVIEW↔GIOI_THIEU · OTHER↔NGUON_KHAC.
    const daiDien: Readonly<Record<string, string>> = { AUTO: "ADS", MANUAL_REVIEW: "GIOI_THIEU", OTHER: "NGUON_KHAC" };
    for (const l of LEAD_CU) {
      const dd = daiDien[l.ma]!;
      expect(TICH_HOP, `${l.ma}: bộ chung`).toContain(`{ sdt: "${phoneLeadCu(l.ma)}", ten: "${tenLeadCu(l.ma)}" }`);
      expect(TICH_HOP, `${l.ma}: bộ đại diện (${dd})`).toContain(`{ sdt: "${phoneLeadCuDaiDien(dd)}", ten: "${tenLeadCuDaiDien(dd)}" }`);
    }
  });

  it("[UTH-W1b] lead ĐÃ THU của SRC-09b (SĐT + tên học viên) và hai học viên hàng chờ của T1 khớp fixture", () => {
    expect(TICH_HOP).toContain(`const SDT_LEAD_DA_THU = "${phoneHangCho("DRIFT")}";`);
    expect(TICH_HOP).toContain(`const TEN_HOC_VIEN_DA_THU = "Bé ${TIEN_TO_NGUON_FINAL} DRIFT";`);
    expect(T1).toContain(`DRIFT: "Bé ${TIEN_TO_NGUON_FINAL} DRIFT", WITHDRAWN: "Bé ${TIEN_TO_NGUON_FINAL} WITHDRAWN"`);
    expect(phoneHangCho("DRIFT")).toBe("0990500001");
  });

  it("[UTH-W2] cột của tệp Excel nhập lead trong `_lib/xlsx.ts` TRÙNG `LEAD_IMPORT_COLUMNS` của ứng dụng (cùng chữ, cùng thứ tự)", () => {
    const khoi = /export const COT_NHAP_LEAD = \[([\s\S]*?)\] as const;/.exec(XLSX_GOC)?.[1] ?? "";
    const cot = [...khoi.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(cot.length).toBeGreaterThan(5);
    expect(cot).toEqual([...LEAD_IMPORT_COLUMNS]);
  });
});

describe("[UTH-GHI] ca chuan-bi: idempotent, không dời mốc, có cổng", () => {
  it("[UTH-GHI-01] SRC-43 đọc «Chưa đặt mốc» TRƯỚC khi ghi và dừng (ALREADY_DONE) khi mốc đã có — không nhánh nào bấm «Dời mốc»/«Gỡ mốc»", () => {
    const i = SETUP.indexOf('test("[SRC-43]');
    const j = SETUP.indexOf('test("[SRC-44]');
    const than = SETUP.slice(i, j);
    expect(than).toMatch(/const chuaDat = \/Chưa đặt mốc\/\.test\(khoiHienTai\);/);
    expect(than).toMatch(/if \(!chuaDat\) \{[\s\S]*?ALREADY_DONE[\s\S]*?return;\s*\}/);
    expect(than.indexOf("if (!chuaDat)")).toBeLessThan(than.indexOf('name: "Đặt mốc", exact: true'));
    expect(than).not.toMatch(/Dời mốc|Gỡ mốc/);
  });

  it("[UTH-GHI-02] mỗi ca ghi của chuan-bi đọc trạng thái hiện có TRƯỚC khi ghi (có nhánh ALREADY_DONE): SRC-39/40/41/42/43", () => {
    expect((SETUP_GOC.match(/ALREADY_DONE/g) ?? []).length).toBeGreaterThanOrEqual(5);
    for (const m of ["SRC-40", "SRC-41", "SRC-42", "SRC-43"]) {
      const i = viTri(SETUP_GOC, m);
      const j = SETUP_GOC.indexOf('\ntest("[SRC-', i + 5);
      expect(SETUP_GOC.slice(i, j < 0 ? undefined : j), m).toMatch(/ALREADY_DONE/);
    }
    expect(SETUP).toMatch(/if \(\(await c\.getAttribute\("aria-checked"\)\) === "true"\) return "ALREADY_DONE";/);
  });

  it("[UTH-GHI-03] cờ Affiliate chỉ bật khi UAT_BAT_AFFILIATE=1 (mặc định BLOCKED, không tự bật)", () => {
    expect(SETUP).toMatch(/if \(process\.env\.UAT_BAT_AFFILIATE !== "1"\) ca\.biChan\(/);
  });

  it("[UTH-GHI-04] T1: ngưỡng hai cấp CHỈ trả về khi nó đang đúng giá trị mà SRC-30 đặt (không ghi đè thay đổi của người khác); SRC-30 ghi giá trị gốc ra tệp TRƯỚC khi hạ", () => {
    expect(T1).toMatch(/if \(hienTai !== NGUONG_THU\) ca\.biChan\(/);
    expect(T1.indexOf("writeFileSync(TEP_NGUONG_GOC")).toBeGreaterThan(0);
    expect(T1.indexOf("writeFileSync(TEP_NGUONG_GOC")).toBeLessThan(T1.indexOf("await datNguong(ca, ad, NGUONG_THU"));
  });
});

describe("[UTH-DO] đo bằng thứ NGƯỜI THẤY, không tin URL/ toast một mình", () => {
  it("[UTH-DO-01] đọc Audit Log bằng ô lọc + «Áp dụng» (tham số URL `?action=` KHÔNG lọc ở màn này — bản đầu tin nó và PASS trên danh sách chưa lọc)", () => {
    const A = boChuThichTs(doc("tests/uat-nguon/_lib/audit.ts"));
    expect(A).toMatch(/oHanhDong\.fill\(o\.hanhDong\)/);
    expect(A).toMatch(/getByRole\("button", \{ name: "Áp dụng" \}\)\.click\(\)/);
    expect(TICH_HOP).not.toMatch(/\/audit-log\?action=/);
  });

  it("[UTH-DO-02] «sổ không bị sửa» đo bằng ĐA TẬP dòng sổ trước/sau (`dongCuBiDoi`), ở T1 và ở SRC-09b — không chỉ đếm số dòng", () => {
    expect(T1).toMatch(/dongCuBiDoi\(truoc, sau\)/);
    expect(TICH_HOP).toMatch(/dongCuBiDoi\(truocSo, sauSo\)/);
  });

  it("[UTH-DO-03] khẳng định «KHÔNG thấy X» đều có đối chứng dương cạnh nó: SRC-17 (Kế toán thấy), SRC-18 (QLCS/Admin có nút), SRC-31 (N1 có nút)", () => {
    expect(TICH_HOP).toMatch(/ĐỐI CHỨNG DƯƠNG — Kế toán Hội sở mở Sổ/);
    expect(TICH_HOP).toMatch(/ĐỐI CHỨNG DƯƠNG — QLCS CS1 mở lead CS1/);
    expect(TICH_HOP).toMatch(/ĐỐI CHỨNG DƯƠNG — Admin mở lead CS2/);
    expect(T1).toMatch(/N1 thấy nút «Xử lý» ở dòng INPUT_DRIFT \(đối chứng dương\)/);
  });
});
