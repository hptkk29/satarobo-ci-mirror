/**
 * Ca [DTG-B*] — BẢNG báo cáo di trú bốn cột loại (AUTO · MANUAL_REVIEW · UNKNOWN · INVALID) + tóm tắt kế hoạch GHI (hướng E). THUẦN.
 *
 *   [DTG-B1]  cộng bốn cột = Count của từng dòng; tổng bảng khớp `tong` của kế hoạch (một nguồn cho số)
 *   [DTG-B2]  dòng HỖN HỢP / INVALID / không còn: bốn cột nói đúng, baseline-delta giữ nghĩa cũ
 *   [DTG-B3]  tóm tắt kế hoạch: công thức N, cảnh báo INVALID, nguồn CHƯA có chủ (theo luật lịch sử + cờ phải khai), digest chỉ in khi được phép
 */
import { describe, expect, it } from "vitest";
import { anhXaNhanCu, chuanHoaNhanNguon, type HangDiTru } from "./anh-xa-nhan-cu";
import { NHOM_NHAN_SU_GOC, VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import { dungBangDiTru, inBangDiTru, inTomTatKeHoach } from "./di-tru-bao-cao";
import { khoaBaseline } from "./di-tru-bang";
import { dungKeHoachDiTru, type NhomDiTru } from "./di-tru-ke-hoach";

const LUC = new Date("2026-09-15T03:00:00.000Z");
const hang = (leadId: string, nhan: string | null): HangDiTru => ({
  leadId,
  kq: anhXaNhanCu({ nhan, createdAt: LUC, affiliate: null, nguoiNhap: null, maNvTrongNote: null }, VAI_SANG_NGUON_MAC_DINH, NHOM_NHAN_SU_GOC),
  nhanChuan: chuanHoaNhanNguon(nhan),
  createdAt: LUC,
});
const invalid = (leadId: string, nhan: string): HangDiTru => ({ leadId, kq: { loai: "INVALID", nhanChuan: nhan }, nhanChuan: nhan, createdAt: LUC });

const NHOM: NhomDiTru[] = [
  { id: "g1", code: "PAID_ADS", ownerEmployeeId: null, attributionWindowDays: null },
  { id: "g2", code: "EMPLOYEE_REFERRAL", ownerEmployeeId: "E1", attributionWindowDays: 30 },
  { id: "g3", code: "CENTER_ORGANIC", ownerEmployeeId: null, attributionWindowDays: null },
  { id: "g4", code: "UNKNOWN", ownerEmployeeId: null, attributionWindowDays: null },
];
/** Hai nguồn mà (giả định) một chính sách đang hiệu lực trả tiền cho chủ nguồn. UNKNOWN không bao giờ vào tập thật (`nhom-can-chu.ts`); `PAID_ADS` có, `CENTER_ORGANIC` có. */
const CAN_CHU: ReadonlySet<string> = new Set(["PAID_ADS", "CENTER_ORGANIC"]);
const F = { tenNhom: (c: string) => `[${c}]`, ma: (s: string) => `\`${s}\``, so: (n: number) => String(n) };

const HANG = [
  hang("1", "Ads"),
  hang("2", "Ads"),
  hang("3", "Organic"),
  hang("4", "Quản Lý Trung Tâm"),
  hang("5", "Quản Lý Trung Tâm"),
  hang("6", null),
  invalid("7", "nhan la"),
];

describe("[DTG-B1] bốn cột loại cộng lại ra Count, và khớp kế hoạch", () => {
  const bang = dungBangDiTru(HANG, null);

  it("mỗi dòng: AUTO + MANUAL_REVIEW + UNKNOWN + INVALID = Count", () => {
    for (const r of bang) expect(r.soAuto + r.soReview + r.soUnknown + r.soInvalid, String(r.nhanChuan)).toBe(r.soLead);
  });
  it("giá trị từng dòng đúng loại: Ads AUTO · Quản Lý REVIEW (thiếu người) · nhãn rỗng UNKNOWN · nhãn lạ INVALID", () => {
    const dong = (nhan: string | null) => bang.find((d) => d.nhanChuan === nhan)!;
    expect(dong("ads")).toMatchObject({ soAuto: 2, soReview: 0, soUnknown: 0, soInvalid: 0, soLead: 2 });
    expect(dong("quản lý trung tâm")).toMatchObject({ soAuto: 0, soReview: 2, soUnknown: 0, soInvalid: 0 });
    expect(dong(null)).toMatchObject({ soAuto: 0, soReview: 0, soUnknown: 1, soInvalid: 0 });
    expect(dong("nhan la")).toMatchObject({ soAuto: 0, soReview: 0, soUnknown: 0, soInvalid: 1 });
  });
  it("tổng các cột = `tong` của kế hoạch (cùng `phanLoaiGhi` — báo cáo và lệnh ghi không thể lệch)", () => {
    const kh = dungKeHoachDiTru({ hang: HANG, chiTiet: new Map(), nhom: NHOM, nhomCanChu: CAN_CHU, cuaSoMacDinhNgay: 90 });
    const cong = (k: "soAuto" | "soReview" | "soUnknown" | "soInvalid") => bang.reduce((n, r) => n + r[k], 0);
    expect({ auto: cong("soAuto"), review: cong("soReview"), unknown: cong("soUnknown"), invalid: cong("soInvalid") }).toEqual({
      auto: kh.tong.auto,
      review: kh.tong.review,
      unknown: kh.tong.unknown,
      invalid: kh.tong.invalid,
    });
  });
});

describe("[DTG-B2] baseline và dòng không còn", () => {
  it("baseline giữ nghĩa cũ (Delta = Count − Baseline); dòng chỉ còn trong baseline ⇒ KHONG_CON với bốn cột = 0", () => {
    const baseline = new Map<string, number>([
      [khoaBaseline("ads", "PAID_ADS"), 5],
      [khoaBaseline("nhan cu da mat", "WALK_IN"), 3],
    ]);
    const bang = dungBangDiTru(HANG, baseline);
    const ads = bang.find((d) => d.nhanChuan === "ads")!;
    expect(ads).toMatchObject({ baseline: 5, delta: -3, soLead: 2 });
    const mat = bang.find((d) => d.nhanChuan === "nhan cu da mat")!;
    expect(mat).toMatchObject({ loai: "KHONG_CON", soLead: 0, soAuto: 0, soReview: 0, soUnknown: 0, soInvalid: 0, delta: -3 });
  });
  it("in bảng: có đủ tiêu đề các cột; INVALID đánh dấu 🔴; dòng không còn được nói rõ", () => {
    const baseline = new Map<string, number>([[khoaBaseline("nhan cu da mat", "WALK_IN"), 3]]);
    const dong = inBangDiTru(dungBangDiTru(HANG, baseline), F);
    expect(dong[0]).toBe("| Nhãn cũ (đã chuẩn hoá) | dòng bảng 06/10 | Nguồn đích | AUTO | MANUAL_REVIEW | UNKNOWN | INVALID | Count | Baseline | Delta |");
    const chu = dong.join("\n");
    expect(chu).toMatch(/🔴 INVALID \|/);
    expect(chu).toMatch(/không còn/);
    expect(dong).toHaveLength(2 + dungBangDiTru(HANG, baseline).length);
  });
});

describe("[DTG-B3] tóm tắt kế hoạch GHI", () => {
  const kh = dungKeHoachDiTru({ hang: HANG, chiTiet: new Map(), nhom: NHOM, nhomCanChu: CAN_CHU, cuaSoMacDinhNgay: 90 });

  it("nói công thức N = AUTO + MANUAL_REVIEW + UNKNOWN và cảnh báo INVALID > 0 ⇒ lệnh ghi từ chối", () => {
    const chu = inTomTatKeHoach(kh, F, { inSha: false }).join("\n");
    expect(chu).toContain("3 + 2 + 1 = 6"); // Ads×2 + Organic = 3 AUTO; Quản Lý×2 = 2 REVIEW; nhãn rỗng = 1 UNKNOWN
    expect(chu).toMatch(/INVALID = 1 > 0/);
    expect(chu).toMatch(/Lead\.source/);
  });
  it("nguồn ĐƯỢC DÙNG mà chưa có chủ bị cảnh báo THEO LUẬT LỊCH SỬ (không còn «vĩnh viễn») kèm đúng cờ phải khai; nguồn có chủ thì không", () => {
    const chu = inTomTatKeHoach(kh, F, { inSha: false }).join("\n");
    expect(chu).toMatch(/CHƯA có chủ/);
    expect(chu).not.toMatch(/VĨNH VIỄN/i); // câu cũ nói sai sau khi chủ nguồn có LỊCH SỬ (08 §16.4)
    expect(chu).toMatch(/lịch sử chủ nguồn/);
    expect(chu).toContain("--chap-nhan-nguon-chua-co-chu=CENTER_ORGANIC,PAID_ADS"); // danh sách ĐÃ SẮP, copy-paste được — chỉ nguồn CẦN chủ (UNKNOWN không cần)
    expect(chu).toMatch(/TỪ CHỐI/);
    expect(kh.nhomChuNull.map((g) => g.code)).toEqual(["CENTER_ORGANIC", "PAID_ADS", "UNKNOWN"]); // thông tin: mọi nguồn được dùng mà chưa chủ
    expect(kh.nhomPhaiCoChu.map((g) => g.code)).toEqual(["CENTER_ORGANIC", "PAID_ADS"]); // cổng: chỉ nguồn chính sách cần
    // đối chứng dương: EMPLOYEE_REFERRAL có chủ E1 ⇒ không nằm trong cảnh báo
    expect(kh.nhomChuNull.some((g) => g.code === "EMPLOYEE_REFERRAL")).toBe(false);
  });
  it("[B-OWN-1] nguồn chưa chủ mà KHÔNG chính sách nào cần chủ ⇒ chỉ ℹ️ thông tin: không đỏ, không đòi cờ chấp nhận, nói rõ chủ chỉ là metadata", () => {
    const k = dungKeHoachDiTru({ hang: HANG, chiTiet: new Map(), nhom: NHOM, nhomCanChu: new Set(), cuaSoMacDinhNgay: 90 });
    const chu = inTomTatKeHoach(k, F, { inSha: false }).join("\n");
    expect(k.nhomChuNull.map((g) => g.code)).toEqual(["CENTER_ORGANIC", "PAID_ADS", "UNKNOWN"]);
    expect(k.nhomPhaiCoChu).toEqual([]);
    expect(chu).toMatch(/ℹ️ \*\*3 nguồn chưa có chủ nhưng KHÔNG cần\*\*/);
    expect(chu).toMatch(/metadata quản trị/);
    expect(chu).not.toMatch(/CẦN chủ/);
    expect(chu).not.toContain("--chap-nhan-nguon-chua-co-chu=");
  });
  it("cửa sổ: nguồn có cửa sổ riêng in «(riêng)»; không riêng + biết số chung in «(chung lúc ghi)»; không biết số chung in nhắc setting", () => {
    const co = inTomTatKeHoach(kh, F, { inSha: false }).join("\n");
    expect(co).toMatch(/30 ngày \(riêng\)/);
    expect(co).toMatch(/90 ngày \(chung lúc ghi\)/);
    const chua = dungKeHoachDiTru({ hang: HANG, chiTiet: new Map(), nhom: NHOM, nhomCanChu: CAN_CHU, cuaSoMacDinhNgay: null });
    expect(inTomTatKeHoach(chua, F, { inSha: false }).join("\n")).toMatch(/setting chung lúc ghi/);
  });
  it("digest chỉ in khi nơi gọi cho phép (báo cáo chỉ-đọc không biết setting chung nên KHÔNG in)", () => {
    expect(inTomTatKeHoach(kh, F, { inSha: false }).join("\n")).not.toContain(kh.sha);
    expect(inTomTatKeHoach(kh, F, { inSha: true }).join("\n")).toContain(kh.sha);
  });
});
