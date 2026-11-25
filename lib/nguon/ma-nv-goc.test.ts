/**
 * Ca [MNG-*] — CHUỖI GỐC của ô «Mã NV giới thiệu» (§22/§23, vòng UAT cuối). THUẦN: không DB, không đồng hồ.
 *
 * Luật cũ (11/10) — «chuỗi không có dạng mã KHÔNG được lưu» — chặn đúng chỗ SAI: nó coi việc LƯU là chỗ rò PII. Nhưng `Lead` đã chứa SĐT phụ huynh trong DB; thứ rò thật là HIỂN THỊ chuỗi đó
 * cho người không có quyền xem PII. Chủ dự án đòi người duyệt thấy `rawEmployeeCode`, các ứng viên xung đột và lý do — nên luật nay là:
 *   · LƯU: `signals.maNvSai.raw` = ô người nhập gõ, đã trim, tối đa 40 ký tự (KHAC_MA: các ô khác nhau nối « | », tối đa 5 ứng viên);
 *   · ĐỌC: MỘT hàm phía server (`docMaNvSai` ← `maNvSaiCuaDong`) nhận cờ quyền BẮT BUỘC (không mặc định). `raw` chỉ ra khỏi hàm khi `canViewPii = true`; còn lại vẫn là «đã ẩn» + độ dài như cũ.
 *
 *   [MNG-01] `chuoiGocDeLuu`: trim · cắt 40 · bỏ ký tự điều khiển · KHÔNG chuẩn hoá hoa/thường · giữ nguyên SĐT/tên (đây là chuỗi GỐC)
 *   [MNG-02] BO_QUA mang `raw` (chữ người gõ, KHÔNG phải bản đã chuẩn hoá); `maNvSaiTuKetQua` chuyển nó; `ma` (hiện cho mọi người) vẫn chỉ là chuỗi có dạng mã
 *   [MNG-03] KHAC_MA: ứng viên xung đột đủ (kể cả SĐT/tên ở phần `raw`), sắp theo mã chuẩn hoá, không phụ thuộc thứ tự dòng; trần 5 ứng viên; `ma` vẫn chỉ gồm phần có dạng mã
 *   [MNG-04] `docMaNvSai(…, canViewPii)`: có quyền ⇒ `raw` đầy đủ; không quyền ⇒ `raw = null` VÀ không dãy ≥ 8 chữ số nào trong TOÀN BỘ kết quả (dữ liệu server trả về, không chỉ ẩn bằng CSS)
 *   [MNG-05] `maNvSaiCuaDong(signals, canViewPii)`: cùng cổng; dòng cũ không có `raw` ⇒ `raw = null` cho cả hai bên; dấu xem tay đã gỡ ⇒ null cho cả người có quyền
 *   [MNG-06] (ca hành vi nằm ở ma-nv-sai.test.ts [MNR-02]/[MNR-03]: `quyNguon` GHI `raw` vào `signals.maNvSai`; ở đây chỉ có lưới dây nối [MNG-W1])
 *   [MNG-07] §23: luật «phải có ít nhất một chữ cái» còn nguyên; MỌI mã nhân viên thật đo ở DB dev (16 mã `satarobo_local`, 11/10/2026) đều có dạng mã; mã HỢP LỆ HIỆN HỮU dù hình dạng lạ vẫn
 *            RESOLVE (DUNG) — hình dạng chỉ quyết định việc HIỆN, không bao giờ quyết định việc GIẢI MÃ
 *   [MNG-08] chữ hiển thị `nhanMaNvDaGo`: raw ⇒ chính raw; không quyền ⇒ «đã ẩn»; người có quyền nhưng dòng cũ ⇒ nói thật «chưa lưu chuỗi gốc», KHÔNG gọi là «đã ẩn»
 *   [MNG-W1] lưới dây nối: tham số quyền BẮT BUỘC ở cả hai tầng đọc; hai nơi gọi truyền `p.canViewPii`; `raw` chỉ ra qua hàm đọc; nơi hiển thị chỉ in qua `nhanMaNvDaGo`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { docMaNvSai, laDangMaNv, RAW_TOI_DA, chuoiGocDeLuu } from "./ma-nv-an-toan";
import { chuanHoaMaNhanVien } from "./ma-nhan-vien";
import { cacMaGocKhacNhau, dungBangTraMaNv, gopMaCungSdt, maNvSaiKhacMa, maNvSaiTuKetQua, quyetDinhMaNvGioiThieu } from "./ma-nv-gioi-thieu";
import { maNvSaiCuaDong } from "./ly-do-hang-cho";
import { nhanMaNvDaGo } from "./nhan-hien-thi";

const CON = ["INVALID_EMPLOYEE_REFERRER_CODE"];
const BAY_GIO = new Date("2026-10-11T03:00:00.000Z");
/** Dãy ≥ 8 chữ số (kể cả bị ngăn bằng dấu chấm/gạch/cách) ở bất kỳ đâu trong JSON? */
const coNghiSdt = (v: unknown): boolean => JSON.stringify(v).replace(/[^0-9]/g, "").length >= 8;

// 16 mã `Employee.employeeCode` ĐO ở `satarobo_local` ngày 11/10/2026 (BEGIN READ ONLY; current_database() = satarobo_local). Là toàn bộ nhân sự của DB dev — số nhỏ, nói thẳng.
const MA_THAT_DO_DUOC = [
  "CI.NV.901", "CI.NV.902", "CS1.GV.001", "CS1.GVU.001", "CS1.QL.001", "CS1.TVV.001", "CS2.TVV.001", "HO.DT.001",
  "HO.IT.002", "HO.KD.001", "HO.KT.001", "HO.MKT.001", "HO.NS.001", "ITLI_GV001", "ITLI_NV001", "ITLI_NV002",
];

describe("[MNG-01] chuoiGocDeLuu — chuỗi GỐC, đã trim, tối đa 40 ký tự", () => {
  it("trim hai đầu; KHÔNG đổi hoa/thường (đây là chữ người gõ, không phải mã chuẩn hoá); giữ nguyên SĐT/tên", () => {
    expect(chuoiGocDeLuu("  sr.nv.404  ")).toBe("sr.nv.404");
    expect(chuoiGocDeLuu(" 0905.123.456 ")).toBe("0905.123.456");
    expect(chuoiGocDeLuu("Nguyễn Văn A")).toBe("Nguyễn Văn A");
  });
  it(`cắt đúng ${RAW_TOI_DA} ký tự (40) — ký tự thứ 41 không được lưu; đúng 40 thì nguyên`, () => {
    expect(RAW_TOI_DA).toBe(40);
    expect(chuoiGocDeLuu("A".repeat(40))).toBe("A".repeat(40));
    expect(chuoiGocDeLuu("A".repeat(41))).toBe("A".repeat(40));
    expect(chuoiGocDeLuu("B".repeat(200))).toHaveLength(40);
  });
  it("ký tự điều khiển (xuống dòng · tab · NUL) đổi thành khoảng trắng rồi trim — không lọt vào JSON/giao diện", () => {
    expect(chuoiGocDeLuu("SR.NV\n.404\t")).toBe("SR.NV .404");
    expect(chuoiGocDeLuu("\u0000X\u0007")).toBe("X");
    expect(chuoiGocDeLuu("   ")).toBe("");
  });
});

describe("[MNG-02] BO_QUA và MaNvSai mang chuỗi gốc", () => {
  const bang = dungBangTraMaNv([{ id: "E1", employeeCode: "SR.NV.002", status: "ACTIVE" }], []);
  const hoi = (maTho: string) =>
    quyetDinhMaNvGioiThieu({ maTho, nhanKhai: null, ngayGiaiMa: BAY_GIO, bayGio: BAY_GIO, bang, nhomYeuCau: new Map([["EMPLOYEE_REFERRAL", "EMPLOYEE"]]), nhomNhanSu: "EMPLOYEE_REFERRAL" });

  it("mã không có trong hệ thống: raw là CHỮ NGƯỜI GÕ (đã trim, giữ hoa/thường), ma là bản chuẩn hoá", () => {
    expect(hoi("  sr.nv.404 ")).toMatchObject({ kieu: "BO_QUA", phanLoai: "KHONG_TON_TAI", ma: "SR.NV.404", raw: "sr.nv.404" });
  });
  it("SĐT dán nhầm: raw giữ NGUYÊN (người duyệt có quyền thấy), ma = null (hiện cho mọi người thì bị che), doDai = độ dài đã gõ", () => {
    const kq = maNvSaiTuKetQua(hoi(" 0905.123.456 "));
    expect(kq).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: "0905.123.456" });
  });
  it("mã dạng NV nhưng không tồn tại: ma VÀ raw cùng có (khác nhau ở hoa/thường)", () => {
    expect(maNvSaiTuKetQua(hoi("sr.nv.404"))).toEqual({ ma: "SR.NV.404", loai: "KHONG_TON_TAI", doDai: 9, raw: "sr.nv.404" });
  });
  it("ô dài hơn 40 ký tự: raw bị cắt 40, doDai vẫn là độ dài thật đã gõ", () => {
    const dai = "X".repeat(120);
    const kq = maNvSaiTuKetQua(hoi(dai));
    expect(kq?.raw).toHaveLength(40);
    expect(kq?.doDai).toBe(120);
  });
  it("đối chứng: DUNG/KHONG_CO ⇒ không MaNvSai nào (raw không sinh ra từ ô hợp lệ)", () => {
    expect(maNvSaiTuKetQua(hoi("SR.NV.002"))).toBeNull();
  });
});

describe("[MNG-03] KHAC_MA — ứng viên xung đột", () => {
  it("raw liệt kê MỌI ứng viên (kể cả SĐT/tên), sắp theo mã chuẩn hoá, nối « | »; ma chỉ gồm phần có dạng mã", () => {
    const kq = maNvSaiKhacMa(cacMaGocKhacNhau(["sr.nv.003", "SR.NV.001", "0905123456"]));
    expect(kq).toEqual({ ma: "SR.NV.001 | SR.NV.003", loai: "KHAC_MA", doDai: 28, raw: "0905123456 | SR.NV.001 | sr.nv.003" });
  });
  it("KHÔNG phụ thuộc thứ tự dòng; cùng mã khác hoa/thường là MỘT ứng viên (lấy bản nhỏ nhất theo thứ tự chữ để ổn định)", () => {
    const a = maNvSaiKhacMa(cacMaGocKhacNhau(["sr.nv.003", "SR.NV.001", "SR.NV.003"]));
    const b = maNvSaiKhacMa(cacMaGocKhacNhau(["SR.NV.003", "sr.nv.003", "SR.NV.001"]));
    expect(a).toEqual(b);
    expect(a.raw).toBe("SR.NV.001 | SR.NV.003");
  });
  it("ô trống/null không phải ứng viên; mỗi ứng viên cắt 40 ký tự", () => {
    expect(cacMaGocKhacNhau([null, "  ", "B.1", "A.1"])).toEqual(["A.1", "B.1"]);
    const dai = cacMaGocKhacNhau(["Z".repeat(80), "A.1"]);
    expect(dai).toEqual(["A.1", "Z".repeat(40)]);
  });
  it("trần 5 ứng viên: dư thì ghi «… +N» (raw không phình theo số dòng Excel); ma/doDai vẫn tính trên MỌI ứng viên", () => {
    const nhieu = Array.from({ length: 7 }, (_, i) => `SR.NV.00${i + 1}`);
    const kq = maNvSaiKhacMa(cacMaGocKhacNhau(nhieu));
    expect(kq.raw).toBe("SR.NV.001 | SR.NV.002 | SR.NV.003 | SR.NV.004 | SR.NV.005 | … +2");
    expect(kq.ma?.split(" | ")).toHaveLength(7);
    expect(kq.doDai).toBe(7 * 9);
  });
});

describe("[MNG-03b] gopMaCungSdt — giữ ô GỐC khi cả nhà ghi CÙNG một mã (đường tới quyetDinhMaNvGioiThieu không được đi qua bản đã chuẩn hoá)", () => {
  it("cùng mã khác hoa/thường/khoảng trắng ⇒ ma chuẩn hoá + goc là ô gốc ổn định (không phụ thuộc thứ tự dòng)", () => {
    expect(gopMaCungSdt(["  sr.nv.404 ", "SR.NV.404", null])).toEqual({ ma: "SR.NV.404", goc: "SR.NV.404", khacNhau: false });
    expect(gopMaCungSdt(["SR.NV.404", "sr.nv.404"])).toEqual(gopMaCungSdt(["sr.nv.404", "SR.NV.404"]));
  });
  it("một ô gõ SĐT: goc giữ NGUYÊN chữ (đã trim, KHÔNG cắt — doDai phải là độ dài thật), ma là bản chuẩn hoá", () => {
    expect(gopMaCungSdt([" 0905.123.456 "])).toEqual({ ma: "0905.123.456", goc: "0905.123.456", khacNhau: false });
    const dai = "x".repeat(120);
    expect(gopMaCungSdt([dai])).toEqual({ ma: dai.toUpperCase(), goc: dai, khacNhau: false });
  });
  it("trống ⇒ không mã, không goc; khác nhau ⇒ không lấy mã nào, goc = null (chuỗi các ứng viên do cacMaGocKhacNhau lo)", () => {
    expect(gopMaCungSdt([null, "  "])).toEqual({ ma: null, goc: null, khacNhau: false });
    expect(gopMaCungSdt(["A.1", "B.1"])).toEqual({ ma: null, goc: null, khacNhau: true });
  });
});

describe("[MNG-04] docMaNvSai — cổng quyền BẮT BUỘC", () => {
  const LUU = { ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: "0905.123.456" };
  it("có quyền PII ⇒ raw đầy đủ (kể cả SĐT)", () => {
    expect(docMaNvSai(LUU, true)).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: "0905.123.456", coQuyenXem: true });
  });
  it("KHÔNG quyền ⇒ raw = null VÀ toàn bộ kết quả không có dãy ≥ 8 chữ số (dữ liệu server trả về, không chỉ ẩn bằng CSS)", () => {
    const r = docMaNvSai(LUU, false);
    expect(r).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: null, coQuyenXem: false });
    expect(coNghiSdt(r)).toBe(false);
    expect(JSON.stringify(r)).not.toContain("0905");
  });
  it("KHAC_MA: không quyền ⇒ không ứng viên SĐT nào, ma (phần có dạng mã) vẫn hiện; có quyền ⇒ cả danh sách gốc", () => {
    const luu = JSON.parse(JSON.stringify(maNvSaiKhacMa(cacMaGocKhacNhau(["SR.NV.001", "0905123456"])))) as unknown;
    expect(docMaNvSai(luu, true)).toMatchObject({ ma: "SR.NV.001", raw: "0905123456 | SR.NV.001" });
    const khong = docMaNvSai(luu, false);
    expect(khong).toMatchObject({ ma: "SR.NV.001", raw: null });
    expect(coNghiSdt(khong)).toBe(false);
  });
  it("dòng CŨ không có raw ⇒ raw = null cho cả hai bên (không bịa); raw không phải chuỗi / rỗng ⇒ null; raw quá dài (dữ liệu hỏng) bị cắt lại 40", () => {
    expect(docMaNvSai({ ma: "SR.NV.999", loai: "KHONG_TON_TAI" }, true)).toEqual({ ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: null, coQuyenXem: true });
    expect(docMaNvSai({ ma: null, loai: "X", doDai: 3, raw: 12345 }, true)?.raw).toBeNull();
    expect(docMaNvSai({ ma: null, loai: "X", doDai: 3, raw: "   " }, true)?.raw).toBeNull();
    expect(docMaNvSai({ ma: null, loai: "X", doDai: 3, raw: "Q".repeat(500) }, true)?.raw).toHaveLength(40);
  });
  it("hình lạ ⇒ null cho cả hai bên", () => {
    for (const hong of [null, "SR.NV.999", [], { loai: 3 }, { ma: 1, loai: "X" }, { ma: "", loai: "X" }]) {
      expect(docMaNvSai(hong, true), JSON.stringify(hong)).toBeNull();
      expect(docMaNvSai(hong, false), JSON.stringify(hong)).toBeNull();
    }
  });
});

describe("[MNG-05] maNvSaiCuaDong — cùng cổng; hàng chờ + trang chi tiết + sheet cùng gọi hàm này", () => {
  const signals = { xemTay: CON, maNvSai: { ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: "0905.123.456" } };
  it("có quyền thấy chuỗi gốc đầy đủ; không quyền không thấy chữ số nào", () => {
    expect(maNvSaiCuaDong(signals, true)).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: "0905.123.456", coQuyenXem: true });
    const khong = maNvSaiCuaDong(signals, false);
    expect(khong).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: null, coQuyenXem: false });
    expect(coNghiSdt(khong)).toBe(false);
  });
  it("dấu xem tay đã GỠ (người duyệt đã chọn người) ⇒ null cho CẢ người có quyền: chuỗi gốc còn trong DB làm vết, KHÔNG hiện như đang chờ", () => {
    expect(maNvSaiCuaDong({ xemTay: [], maNvSai: signals.maNvSai }, true)).toBeNull();
    expect(maNvSaiCuaDong({ maNvSai: signals.maNvSai }, true)).toBeNull();
  });
});

describe("[MNG-07] §23 — luật dạng mã giữ nguyên; mã thật không bị từ chối", () => {
  it("MỌI mã nhân viên đo được ở DB dev (16) đều có dạng mã sau chuẩn hoá — luật «có ít nhất một chữ cái · tổng chữ số < 8» KHÔNG chặn mã thật nào", () => {
    expect(MA_THAT_DO_DUOC).toHaveLength(16);
    for (const m of MA_THAT_DO_DUOC) expect(laDangMaNv(chuanHoaMaNhanVien(m)), m).toBe(true);
  });
  it("luật «ít nhất một chữ cái» còn nguyên (đối chứng âm): dãy toàn chữ số — dù ngắn hơn ngưỡng SĐT — không phải dạng mã", () => {
    for (const s of ["0905123", "456789", "1234567", "12-34-56"]) expect(laDangMaNv(s), s).toBe(false);
    expect(laDangMaNv("SR.1234567")).toBe(true);
  });
  it("mã HỢP LỆ HIỆN HỮU vẫn RESOLVE kể cả khi hình dạng lạ (toàn số · nhiều chữ số): hình dạng chỉ quyết định việc HIỆN, không quyết định việc GIẢI MÃ", () => {
    const bang = dungBangTraMaNv(
      [
        { id: "E_SO", employeeCode: "1234567890", status: "ACTIVE" },
        { id: "E_DAI", employeeCode: "XX.NV.20260001", status: "ACTIVE" },
        { id: "E_THAT", employeeCode: "CS1.GV.001", status: "ACTIVE" },
      ],
      [],
    );
    const giai = (maTho: string) =>
      quyetDinhMaNvGioiThieu({ maTho, nhanKhai: null, ngayGiaiMa: BAY_GIO, bayGio: BAY_GIO, bang, nhomYeuCau: new Map([["EMPLOYEE_REFERRAL", "EMPLOYEE"]]), nhomNhanSu: "EMPLOYEE_REFERRAL" });
    expect(laDangMaNv("1234567890")).toBe(false); // hình dạng bị coi là SĐT…
    expect(giai("1234567890")).toEqual({ kieu: "DUNG", employeeId: "E_SO" }); // …nhưng là mã THẬT nên vẫn giải được
    expect(giai("xx.nv.20260001")).toEqual({ kieu: "DUNG", employeeId: "E_DAI" });
    expect(giai("cs1.gv.001")).toEqual({ kieu: "DUNG", employeeId: "E_THAT" });
  });
});

describe("[MNG-08] nhanMaNvDaGo — chữ hiển thị", () => {
  it("có raw ⇒ in raw; chỉ có ma ⇒ in ma; cả hai null ⇒ «đã ẩn» + độ dài (người KHÔNG có quyền)", () => {
    expect(nhanMaNvDaGo({ ma: null, doDai: 12, raw: "0905.123.456" })).toBe("0905.123.456");
    expect(nhanMaNvDaGo({ ma: "SR.NV.999", doDai: 9, raw: null })).toBe("SR.NV.999");
    const che = nhanMaNvDaGo({ ma: null, doDai: 10, raw: null });
    expect(che).toMatch(/đã ẩn/);
    expect(che).toContain("10");
  });
  it("người CÓ quyền nhưng dòng cũ chưa lưu raw: nói thật «chưa lưu chuỗi gốc», KHÔNG nói «đã ẩn» (không ai che gì với họ)", () => {
    const t = nhanMaNvDaGo({ ma: null, doDai: 10, raw: null, coQuyenXem: true });
    expect(t).toMatch(/chưa lưu chuỗi gốc/);
    expect(t).not.toMatch(/đã ẩn/);
  });
});

// ── [MNG-W1] lưới dây nối — soi MÃ (bỏ chú thích), neo hẹp, đếm số lần khớp, không cờ /s (luật 11) ───────────────────────────────────────
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const docMa = (p: string): string =>
  doc(p)
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[MNG-W1] chuỗi gốc chỉ ra khỏi server qua MỘT hàm đọc có cổng quyền", () => {
  it("tham số quyền BẮT BUỘC (không dấu ?, không giá trị mặc định) ở docMaNvSai và maNvSaiCuaDong", () => {
    expect(docMa("lib/nguon/ma-nv-an-toan.ts")).toMatch(/export function docMaNvSai\(luu: unknown, canViewPii: boolean\)/);
    expect(docMa("lib/nguon/ly-do-hang-cho.ts")).toMatch(/export function maNvSaiCuaDong\(signals: unknown, canViewPii: boolean\)/);
  });
  it("hàm đọc trả raw CHỈ khi canViewPii (đúng một biểu thức điều kiện), và maNvSaiCuaDong chuyển cờ cho docMaNvSai", () => {
    expect(dem(docMa("lib/nguon/ma-nv-an-toan.ts"), /canViewPii \? /g)).toBe(1);
    expect(dem(docMa("lib/nguon/ly-do-hang-cho.ts"), /return docMaNvSai\(signals\.maNvSai, canViewPii\);/g)).toBe(1);
  });
  it("hai nơi đọc phía server (hàng chờ + gán nguồn/chi tiết lead/sheet) truyền ĐÚNG cờ quyền của người xem, không hằng", () => {
    expect(dem(docMa("lib/nguon/doc-hang-cho.ts"), /maNvSaiCuaDong\(a\.signals, p\.canViewPii\)/g)).toBe(1);
    expect(dem(docMa("lib/nguon/doc-gan-nguon.ts"), /maNvSaiCuaDong\(a\.signals, p\.canViewPii\)/g)).toBe(1);
    for (const t of ["lib/nguon/doc-hang-cho.ts", "lib/nguon/doc-gan-nguon.ts"]) expect(docMa(t), t).not.toMatch(/maNvSaiCuaDong\([^)]*\b(?:true|false)\)/);
  });
  it("`signals.maNvSai` ghi kèm raw lấy từ tín hiệu (một chỗ ghi)", () => {
    expect(dem(docMa("lib/nguon/quy-nguon.ts"), /signals\.maNvSai = \{ ma: tin\.maNvSai\.ma, loai: tin\.maNvSai\.loai, doDai: tin\.maNvSai\.doDai, raw: tin\.maNvSai\.raw \};/g)).toBe(1);
  });
  it("giao diện: không ai in thẳng `.raw`/`.ma` của maNvSai — chỉ qua nhanMaNvDaGo (mỗi nơi đúng một lần)", () => {
    for (const t of ["components/admin/nguon-hoa-hong/nguon-status-pill.tsx", "components/admin/nguon-hoa-hong/thong-tin-nguon.tsx"]) {
      const s = docMa(t);
      expect(dem(s, /nhanMaNvDaGo\(/g), t).toBe(1);
      expect(s, t).not.toMatch(/\bmaNvSai\.(?:ma|raw)\b/);
    }
  });
  it("hai route nhập Excel dựng MaNvSai bằng hai hàm dùng chung và truyền ô GỐC (không chuỗi đã chuẩn hoá): KHAC_MA qua cacMaGocKhacNhau, mã đơn qua gopMa[i].goc", () => {
    for (const t of ["app/api/admin/import/leads/route.ts", "app/api/admin/import/leads/registered/route.ts"]) {
      expect(dem(docMa(t), /maNvSaiKhacMa\(cacMaGocKhacNhau\(/g), t).toBe(1);
      expect(docMa(t), t).not.toMatch(/\bcacMaKhacNhau\b/);
      // Mã đơn vào quyetDinhMaNvGioiThieu: ô GỐC (`goc`), không phải bản đã chuẩn hoá (`ma`) — chuẩn hoá xong là mất chữ người gõ, `raw` không còn gì để lưu.
      expect(dem(docMa(t), /maTho: gopMa\[i\]!\.goc\b/g), t).toBe(1);
      expect(docMa(t), t).not.toMatch(/maTho: gopMa\[i\]!\.ma\b/);
    }
  });
});
