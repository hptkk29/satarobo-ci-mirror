// @vitest-environment node
/**
 * [XCF-U*] / [XCF-W*] — «NGUỒN CỦA CẢ FILE» của hai đường nhập Excel lead (28/10/2026). Không DB (ca Postgres thật: `tests/lead-intake/nguon-excel-ma-nv.spec.ts` [XCF-*]).
 *
 *   [XCF-U1]  `docVaEpNguonCaFile`: cờ nguồn BẬT ⇒ thiếu / hỏng ⇒ từ chối đúng câu; hợp lệ ⇒ trả lựa chọn đã chuẩn hoá. Cờ TẮT ⇒ luôn `{ ok: true, nguonChon: null }` kể cả khi client gửi kèm.
 *   [XCF-U2]  nhận CẢ dạng đối tượng (JSON body) lẫn chuỗi JSON (FormData); chuỗi hỏng ⇒ từ chối (khi cờ BẬT) / bỏ qua (khi TẮT)
 *   [XCF-U3]  `loiNguonCaFile`: MỘT câu cho cả lô khi MỌI dòng mới cùng bị chặn; một dòng lọt ⇒ không có lỗi cả-file
 *   [XCF-U4]  `dungNguonChonGui`: cùng luật `kiemFormChonNguon` với máy chủ; hợp lệ ⇒ đúng hình `nguonChon`; giải trình chỉ đi kèm nguồn đòi giải trình
 *   [XCF-W1]  lưới ghim mã nguồn HAI route: cổng đứng TRƯỚC mọi truy vấn · `nguonChon` được truyền vào `chuanBiQuyNguon` · lỗi cả-file chặn TRƯỚC transaction ghi · bước giải mã mã NV bị bỏ khi có lựa chọn · touchpoint của lead đã có mang `nhomChonId`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ ep: true }));
vi.mock("./nguon-cho-form-nhap", () => ({ epChonNguonChoMaCoSo: async () => MOCK.ep }));

import { CAU_NGUON_CA_FILE_SAI_DANG, CAU_THIEU_NGUON_CA_FILE, docVaEpNguonCaFile, loiNguonCaFile } from "./nguon-ca-file";
import { dungNguonChonGui, type NhomChon } from "./chon-nguon";
import type { NguonDaChuanBi } from "./noi-day";

beforeEach(() => {
  MOCK.ep = true;
});

const HOP_LE = { groupId: "g1", employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null };

describe("[XCF-U1] docVaEpNguonCaFile — cổng của máy chủ", () => {
  it("cờ BẬT: thiếu (undefined · null · chuỗi rỗng) ⇒ câu CAU_THIEU_NGUON_CA_FILE", async () => {
    for (const v of [undefined, null, "", "  "]) {
      expect(await docVaEpNguonCaFile(v), String(v)).toEqual({ ok: false, error: CAU_THIEU_NGUON_CA_FILE });
    }
  });

  it("cờ BẬT: hỏng dạng (chuỗi lạ · số · mảng · thiếu groupId · groupId rỗng · groupId quá dài) ⇒ câu CAU_NGUON_CA_FILE_SAI_DANG", async () => {
    for (const v of ["abc", 123, [], {}, { groupId: "" }, { groupId: "x".repeat(65) }, { employeeId: "e1" }]) {
      expect(await docVaEpNguonCaFile(v), JSON.stringify(v)).toEqual({ ok: false, error: CAU_NGUON_CA_FILE_SAI_DANG });
    }
  });

  it("cờ BẬT: hợp lệ ⇒ trả lựa chọn đã chuẩn hoá (id rỗng ⇒ null, trim, giải trình rỗng ⇒ null)", async () => {
    const r = await docVaEpNguonCaFile({ groupId: " g1 ", employeeId: "", parentUserId: undefined, studentId: null, affiliateId: "  ", giaiTrinh: "" });
    expect(r).toEqual({ ok: true, nguonChon: HOP_LE });
    expect(await docVaEpNguonCaFile({ ...HOP_LE, employeeId: "e-1", giaiTrinh: "Khách đến từ hội thảo" })).toEqual({
      ok: true,
      nguonChon: { ...HOP_LE, employeeId: "e-1", giaiTrinh: "Khách đến từ hội thảo" },
    });
  });

  it("cờ TẮT: LUÔN `{ ok: true, nguonChon: null }` — kể cả khi client gửi kèm một lựa chọn hay một thứ hỏng (hành vi cũ y nguyên)", async () => {
    MOCK.ep = false;
    for (const v of [undefined, null, HOP_LE, "abc", 123, "{khong-phai-json"]) {
      expect(await docVaEpNguonCaFile(v), JSON.stringify(v)).toEqual({ ok: true, nguonChon: null });
    }
  });
});

describe("[XCF-U2] docVaEpNguonCaFile — đường FormData gửi CHUỖI JSON", () => {
  it("chuỗi JSON hợp lệ ⇒ như đối tượng; chuỗi rỗng ⇒ thiếu; JSON sai ⇒ từ chối (cờ BẬT)", async () => {
    expect(await docVaEpNguonCaFile(JSON.stringify(HOP_LE))).toEqual({ ok: true, nguonChon: HOP_LE });
    expect(await docVaEpNguonCaFile("")).toEqual({ ok: false, error: CAU_THIEU_NGUON_CA_FILE });
    expect(await docVaEpNguonCaFile("{khong-phai-json")).toEqual({ ok: false, error: CAU_NGUON_CA_FILE_SAI_DANG });
    expect(await docVaEpNguonCaFile("null")).toEqual({ ok: false, error: CAU_THIEU_NGUON_CA_FILE });
  });
});

describe("[XCF-U3] loiNguonCaFile — MỘT câu cho cả lô", () => {
  const chan = (c: string): NguonDaChuanBi => ({ bat: true, ketQua: {} as never, duLieu: {} as never, touchpoints: [], chanNhap: c });
  const qua = (): NguonDaChuanBi => ({ bat: true, ketQua: {} as never, duLieu: {} as never, touchpoints: [], chanNhap: null });
  const hong = (): NguonDaChuanBi => ({ bat: false, loi: "lỗi hệ thống" });

  it("MỌI dòng mới cùng bị chặn ⇒ trả đúng câu (của dòng đầu)", () => {
    expect(loiNguonCaFile([chan("Nguồn này không còn dùng được."), chan("Nguồn này không còn dùng được.")])).toBe("Nguồn này không còn dùng được.");
  });
  it("chỉ MỘT dòng lọt ⇒ KHÔNG có lỗi cả-file (đường dòng-từng-dòng vẫn lo phần còn lại)", () => {
    expect(loiNguonCaFile([chan("x"), qua()])).toBeNull();
  });
  it("lỗi HỆ THỐNG ở bước quy nguồn (`bat: false`) KHÔNG phải lỗi lựa chọn ⇒ null (lead vẫn tạo — T4)", () => {
    expect(loiNguonCaFile([hong(), hong()])).toBeNull();
    expect(loiNguonCaFile([chan("x"), hong()])).toBeNull();
  });
  it("lô rỗng (mọi SĐT đã có lead) ⇒ null — không có lead mới nào để kiểm lựa chọn", () => {
    expect(loiNguonCaFile([])).toBeNull();
  });
});

describe("[XCF-U4] dungNguonChonGui — cùng luật với máy chủ", () => {
  const g = (p: Partial<NhomChon> & Pick<NhomChon, "id" | "code" | "name">): NhomChon => ({
    description: null,
    referrerRequirement: "NONE",
    requiresNote: false,
    sortOrder: 1,
    ...p,
  });
  const DM: NhomChon[] = [
    g({ id: "ads", code: "PAID_ADS", name: "Quảng cáo" }),
    g({ id: "ns", code: "EMPLOYEE_REFERRAL", name: "Nhân sự", referrerRequirement: "EMPLOYEE" }),
    g({ id: "khac", code: "OTHER", name: "Khác", requiresNote: true }),
  ];

  it("chưa chọn nhóm ⇒ lỗi «Chọn một nguồn.», không có nguonChon", () => {
    expect(dungNguonChonGui(DM, { nhomId: null, nguoi: null, giaiTrinh: "" })).toEqual({ loi: { nguon: "Chọn một nguồn." }, nguonChon: null });
    expect(dungNguonChonGui(DM, { nhomId: "khong-co", nguoi: null, giaiTrinh: "" }).nguonChon).toBeNull();
  });
  it("nhóm không đòi người ⇒ hợp lệ, đúng hình; giải trình gõ thừa KHÔNG đi kèm", () => {
    expect(dungNguonChonGui(DM, { nhomId: "ads", nguoi: null, giaiTrinh: "gõ thừa" })).toEqual({
      loi: {},
      nguonChon: { groupId: "ads", employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null },
    });
  });
  it("nhóm đòi nhân sự: thiếu người ⇒ lỗi đúng câu máy chủ; có người ⇒ gửi employeeId", () => {
    const thieu = dungNguonChonGui(DM, { nhomId: "ns", nguoi: null, giaiTrinh: "" });
    expect(thieu.nguonChon).toBeNull();
    expect(thieu.loi.thamChieu).toBe("Nguồn này cần chọn nhân sự giới thiệu.");
    const co = dungNguonChonGui(DM, { nhomId: "ns", nguoi: { loai: "NHAN_SU", employeeId: "e1", ten: "A", ma: null, vai: "SALE" }, giaiTrinh: "" });
    expect(co.nguonChon).toMatchObject({ groupId: "ns", employeeId: "e1", parentUserId: null });
  });
  it("nhóm đòi giải trình: thiếu ⇒ lỗi; đủ ⇒ gửi đã trim", () => {
    expect(dungNguonChonGui(DM, { nhomId: "khac", nguoi: null, giaiTrinh: "" }).loi.giaiTrinh).toBeTruthy();
    expect(dungNguonChonGui(DM, { nhomId: "khac", nguoi: null, giaiTrinh: "  khách đến từ hội thảo STEM  " }).nguonChon?.giaiTrinh).toBe("khách đến từ hội thảo STEM");
  });
});

// ── Lưới ghim mã nguồn (luật 11: bỏ chú thích, neo hẹp, đếm số lần) ───────────────────────────────────────────────
describe("[XCF-W1] lưới ghim mã nguồn hai route nhập Excel", () => {
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));
  const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;
  /** Chuỗi con cân ngoặc bắt đầu tại dấu "(" ở `mo`. */
  const canNgoac = (ma: string, mo: number): string => {
    let sau = 0;
    for (let i = mo; i < ma.length; i++) {
      if (ma[i] === "(") sau++;
      else if (ma[i] === ")" && --sau === 0) return ma.slice(mo, i + 1);
    }
    return ma.slice(mo);
  };

  const CA_HAI = [
    { ten: "D (sự kiện)", tep: "app/api/admin/import/leads/route.ts", chuanBi: "chuanBiQuyNguon(", doiTuongChuanBi: "chuanBi", ghi: "sdb.$transaction(" },
    { ten: "E (đã đăng ký)", tep: "app/api/admin/import/leads/registered/route.ts", chuanBi: "chuanBiQuyNguon(", doiTuongChuanBi: "chuanBiTao", ghi: "sdb.$transaction(" },
  ];

  for (const c of CA_HAI) {
    describe(c.ten, () => {
      const ma = doc(c.tep);

      it("đúng MỘT lời gọi `docVaEpNguonCaFile(`, và nó đứng TRƯỚC mọi truy vấn (resolveActor · scopedDb · giải mã NV)", () => {
        expect(dem(ma, /\bdocVaEpNguonCaFile\(/g)).toBe(1);
        const cong = ma.indexOf("docVaEpNguonCaFile(");
        for (const sau of ["resolveActor(", "scopedDb(", "giaiMaNvGioiThieuTheoLo("]) {
          expect(cong, `cổng nguồn phải đứng TRƯỚC ${sau}`).toBeGreaterThan(-1);
          expect(ma.indexOf(sau), sau).toBeGreaterThan(cong);
        }
      });

      it("từ chối cả lô khi cổng không ok: có nhánh `!nguonCaFile.ok` trả 400", () => {
        expect(dem(ma, /if \(!nguonCaFile\.ok\) return [^;]*(?:400)/g)).toBe(1);
      });

      it("`nguonChon` được TRUYỀN vào `chuanBiQuyNguon(…)` (đúng một lần, dạng tên thuộc tính rút gọn)", () => {
        const goi = ma.indexOf(c.chuanBi);
        expect(goi).toBeGreaterThan(0);
        const args = canNgoac(ma, goi + c.chuanBi.length - 1);
        expect(dem(args, /\bnguonChon,/g)).toBe(1);
        expect(dem(args, /\bmaNvSai:/g), "khoá maNvSai vẫn còn (lưới [MNR-W*])").toBe(1);
      });

      it("lỗi cả-file (`loiNguonCaFile(`) chặn SAU khi chuẩn bị quy nguồn và TRƯỚC transaction ghi", () => {
        expect(dem(ma, /\bloiNguonCaFile\(/g)).toBe(1);
        const loi = ma.indexOf("loiNguonCaFile(");
        expect(loi).toBeGreaterThan(ma.indexOf(c.chuanBi));
        expect(loi).toBeLessThan(ma.indexOf(c.ghi));
        expect(dem(ma, new RegExp(`loiNguonCaFile\\(${c.doiTuongChuanBi}\\)`, "g"))).toBe(1);
        // Kết quả PHẢI được dùng để từ chối (gọi hàm mà bỏ kết quả thì lưới "có gọi" vẫn xanh — đã cấy thử).
        expect(dem(ma, /if \(loiCaFile\) return [^;]*400/g)).toBe(1);
      });

      it("bước giải mã NV bị BỎ khi có lựa chọn: `giaiMaNvGioiThieuTheoLo(` chỉ chạy ở nhánh `nguonChon ? null : await …`", () => {
        expect(dem(ma, /nguonChon\s*\?\s*null\s*:\s*await giaiMaNvGioiThieuTheoLo\(/g)).toBe(1);
        expect(dem(ma, /\bgiaiMaNvGioiThieuTheoLo\(/g)).toBe(1);
      });

      it("lead ĐÃ CÓ: touchpoint NHAP_EXCEL mang `nhomChonId` của lựa chọn (vết, không đổi nguồn gốc)", () => {
        expect(dem(ma, /nhomChonId:\s*nguonChon\?\.groupId \?\? null/g)).toBe(1);
        expect(dem(ma, /kind:\s*"NHAP_EXCEL"/g)).toBe(1);
      });
    });
  }

  it("route E đọc lựa chọn từ FormData (`form.get(\"nguonChon\")`) CHỈ một lần", () => {
    expect(dem(doc("app/api/admin/import/leads/registered/route.ts"), /form\.get\("nguonChon"\)/g)).toBe(1);
  });

  it("route D đọc lựa chọn từ thân JSON (`body.nguonChon`) CHỈ một lần", () => {
    expect(dem(doc("app/api/admin/import/leads/route.ts"), /\(body as \{ nguonChon\?: unknown \}\)\?\.nguonChon/g)).toBe(1);
  });

  it("cả hai route dùng nhãn kỹ thuật CỐ ĐỊNH «Import Excel» cho `Lead.source` khi có lựa chọn (nhãn trong file không rò vào cột định tuyến)", () => {
    expect(dem(doc("app/api/admin/import/leads/route.ts"), /if \(nguonChon\) for \(const g of dsTao\) g\.base\.source = "Import Excel"/g)).toBe(1);
    expect(dem(doc("app/api/admin/import/leads/registered/route.ts"), /\(nguonChon \? "Import Excel" :/g)).toBe(1);
  });

  it("[tự kiểm] bộ đếm THẤY lời gọi và KHÔNG đếm tên hàm nằm trong chú thích", () => {
    expect(dem(boChuThich("await docVaEpNguonCaFile(x)"), /\bdocVaEpNguonCaFile\(/g)).toBe(1);
    expect(dem(boChuThich("// docVaEpNguonCaFile(x)\nconst a = 1"), /\bdocVaEpNguonCaFile\(/g)).toBe(0);
  });
});
