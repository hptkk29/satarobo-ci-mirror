/**
 * [NHH-UI-CN-*] — luật THUẦN của ô chọn nguồn (Sheet "Gán nguồn" + form nhập lead). Không DB, không DOM.
 *
 * Cùng một bộ hàm cho CẢ HAI chỗ dùng (luật 12b) và cùng `kiemThamChieu`/`kiemGiaiTrinh` với máy chủ: một câu lỗi
 * ở trình duyệt không được khác câu lỗi ở máy chủ.
 */
import { describe, expect, it } from "vitest";
import {
  NHAN_VAI,
  gomTheoNguoi,
  groupIdSeGui,
  kiemFormChonNguon,
  locNhomChon,
  loaiNguoiCuaNhom,
  thamChieuTuNguoi,
  type NguoiDaChon,
  type NhomChonTho,
} from "./chon-nguon";

const g = (p: Partial<NhomChonTho> & Pick<NhomChonTho, "code" | "id">): NhomChonTho => ({
  name: p.code,
  description: null,
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  status: "ACTIVE",
  sortOrder: 100,
  effectiveFrom: null,
  effectiveTo: null,
  ...p,
});

/** Đồng hồ cố định (luật 19): `locNhomChon` nhận `now` BẮT BUỘC. */
const NOW = new Date("2026-11-20T03:00:00.000Z");

const DM: NhomChonTho[] = [
  g({ id: "g1", code: "PARENT_REFERRAL", name: "Nguồn từ phụ huynh giới thiệu", referrerRequirement: "PARENT", sortOrder: 1 }),
  g({ id: "g2", code: "PAID_ADS", name: "Nguồn từ Quảng Cáo", sortOrder: 2 }),
  g({ id: "g5", code: "EMPLOYEE_REFERRAL", name: "Nguồn từ nhân sự giới thiệu", referrerRequirement: "EMPLOYEE", sortOrder: 5 }),
  g({ id: "g9", code: "EVENT", name: "Nguồn từ sự kiện", referrerRequirement: "EVENT", sortOrder: 9 }),
  g({ id: "g10", code: "PARTNER", name: "Nguồn từ đối tác", referrerRequirement: "AFFILIATE_ORG", sortOrder: 10 }),
  g({ id: "g11", code: "OTHER", name: "Nguồn khác", requiresNote: true, sortOrder: 11 }),
  g({ id: "gU", code: "UNKNOWN", name: "Không rõ nguồn (hệ thống)", selectable: false, sortOrder: 999 }),
  g({ id: "gOld", code: "CU", name: "Nhóm đã ngừng", status: "INACTIVE", sortOrder: 50 }),
];

const nhom = locNhomChon(DM, NOW);
const byCode = (c: string) => nhom.find((x) => x.code === c)!;

const NV_TEACHER: NguoiDaChon = {
  loai: "NHAN_SU",
  employeeId: "e1",
  ten: "Cô Lan",
  ma: "SR.NV.07",
  vai: "TEACHER",
};
const PH: NguoiDaChon = {
  loai: "PHU_HUYNH",
  studentId: "s1",
  parentUserId: "u1",
  ten: "Chị Mai",
  ma: null,
  moTa: "phụ huynh của bé An",
};
const DT: NguoiDaChon = { loai: "DOI_TAC", affiliateId: "a1", ten: "Công ty X", ma: "AFF1" };

describe("[NHH-UI-CN-01] danh sách chọn nguồn: UNKNOWN và nhóm ngừng KHÔNG có mặt", () => {
  it("chỉ ACTIVE ∧ selectable, theo sortOrder", () => {
    expect(nhom.map((x) => x.code)).toEqual([
      "PARENT_REFERRAL",
      "PAID_ADS",
      "EMPLOYEE_REFERRAL",
      "EVENT",
      "PARTNER",
      "OTHER",
    ]);
    expect(nhom.some((x) => x.code === "UNKNOWN")).toBe(false);
    expect(nhom.some((x) => x.code === "CU")).toBe(false);
  });
  it("danh mục MỞ: nhóm admin thêm (không nằm trong 9 mã gốc) vẫn được liệt kê và có hành vi theo thuộc tính", () => {
    const them = locNhomChon([
      ...DM,
      g({ id: "gX", code: "TRUONG_HOC", name: "Trường học", referrerRequirement: "EMPLOYEE", sortOrder: 12 }),
    ], NOW);
    expect(them.map((x) => x.code)).toContain("TRUONG_HOC");
    expect(gomTheoNguoi(them).coNguoi.map((x) => x.code)).toContain("TRUONG_HOC");
  });
});

describe("[NHH-UI-CN-02] gom 'có người' / 'không có người' theo thuộc tính, không theo mã", () => {
  it("PARENT · EMPLOYEE · AFFILIATE_ORG ⇒ có người; NONE · EVENT ⇒ không", () => {
    const { coNguoi, khongNguoi } = gomTheoNguoi(nhom);
    expect(coNguoi.map((x) => x.code)).toEqual(["PARENT_REFERRAL", "EMPLOYEE_REFERRAL", "PARTNER"]);
    expect(khongNguoi.map((x) => x.code)).toEqual(["PAID_ADS", "EVENT", "OTHER"]);
  });
  it("loại người cần chọn theo yêu cầu của nhóm", () => {
    expect(loaiNguoiCuaNhom("PARENT")).toBe("PHU_HUYNH");
    expect(loaiNguoiCuaNhom("EMPLOYEE")).toBe("NHAN_SU");
    expect(loaiNguoiCuaNhom("AFFILIATE_ORG")).toBe("DOI_TAC");
    expect(loaiNguoiCuaNhom("NONE")).toBeNull();
    expect(loaiNguoiCuaNhom("EVENT")).toBeNull();
  });
});

describe("[NHH-UI-CN-03] vai chỉ là ảnh chụp, nói bằng chữ không bằng số", () => {
  it("nhãn vai là chữ, không có chữ số 5–8", () => {
    for (const v of Object.values(NHAN_VAI)) expect(v).not.toMatch(/\d/);
    expect(Object.keys(NHAN_VAI).sort()).toEqual(["MANAGER", "OTHER_EMPLOYEE", "SALE", "TEACHER"]);
  });
});

describe("[NHH-UI-CN-04] groupIdSeGui — nhóm ghi vào = nhóm ĐÃ CHỌN, kể cả khi chọn nhân sự (nguồn động)", () => {
  it("chọn nhóm nhân sự ⇒ gửi đúng nhóm đó, người là ai (vai nào) cũng KHÔNG đổi nhóm", () => {
    expect(groupIdSeGui(byCode("EMPLOYEE_REFERRAL"))).toBe("g5");
  });
  it("[DYN-UI-01] nhóm do ADMIN TẠO kiểu nhân sự ⇒ gửi đúng id nhóm admin tạo (bản cũ ghi đè về nhóm gốc theo vai); đối chứng dương: nhóm gốc vẫn gửi id của nó", () => {
    const them = locNhomChon([...DM, g({ id: "gX", code: "TRUONG_HOC", name: "Trường học", referrerRequirement: "EMPLOYEE", sortOrder: 12 })], NOW);
    expect(groupIdSeGui(them.find((x) => x.code === "TRUONG_HOC")!)).toBe("gX");
    expect(groupIdSeGui(them.find((x) => x.code === "EMPLOYEE_REFERRAL")!)).toBe("g5");
  });
  it("nhóm chưa chọn ⇒ null", () => {
    expect(groupIdSeGui(null)).toBeNull();
  });
});

describe("[NHH-UI-CN-05] thamChieuTuNguoi — id gửi lên đúng cột, đúng loại", () => {
  it("nhân sự → employeeId; phụ huynh → studentId (+ parentUserId); đối tác → affiliateId; null → null", () => {
    expect(thamChieuTuNguoi(NV_TEACHER)).toEqual({ employeeId: "e1", parentUserId: null, studentId: null, affiliateId: null });
    expect(thamChieuTuNguoi(PH)).toEqual({ employeeId: null, parentUserId: "u1", studentId: "s1", affiliateId: null });
    expect(thamChieuTuNguoi(DT)).toEqual({ employeeId: null, parentUserId: null, studentId: null, affiliateId: "a1" });
    expect(thamChieuTuNguoi(null)).toBeNull();
  });
});

describe("[NHH-UI-CN-06] kiemFormChonNguon — lỗi theo ô, cùng luật với máy chủ", () => {
  const form = (p: Partial<Parameters<typeof kiemFormChonNguon>[0]> = {}) => ({
    nhom: byCode("PAID_ADS") as ReturnType<typeof byCode> | null,
    nguoi: null as NguoiDaChon | null,
    giaiTrinh: "",
    lyDo: "",
    canLyDo: false,
    ...p,
  });
  it("chưa chọn nguồn ⇒ lỗi ở ô 'nguon'", () => {
    expect(kiemFormChonNguon(form({ nhom: null }), nhom).nguon).toMatch(/chọn/i);
  });
  it("nguồn cần người mà chưa chọn ⇒ lỗi ở ô 'thamChieu' (câu của máy chủ)", () => {
    const e = kiemFormChonNguon(form({ nhom: byCode("EMPLOYEE_REFERRAL") }), nhom);
    expect(e.thamChieu).toBe("Nguồn này cần chọn nhân sự giới thiệu.");
  });
  it("nguồn 'Khác' thiếu giải trình ⇒ lỗi ở ô 'giaiTrinh' kèm số ký tự hiện có; đủ 10 ký tự ⇒ hết lỗi", () => {
    expect(kiemFormChonNguon(form({ nhom: byCode("OTHER"), giaiTrinh: "  ngắn " }), nhom).giaiTrinh).toContain("hiện 4");
    expect(
      kiemFormChonNguon(form({ nhom: byCode("OTHER"), giaiTrinh: "khách đến từ hội thảo" }), nhom).giaiTrinh,
    ).toBeUndefined();
  });
  it("đổi nguồn của lead đã có quy nguồn ⇒ lý do ≥ 10 ký tự BẮT BUỘC; tạo mới ⇒ không đòi", () => {
    expect(kiemFormChonNguon(form({ canLyDo: true, lyDo: "ngắn" }), nhom).lyDo).toMatch(/10/);
    expect(kiemFormChonNguon(form({ canLyDo: true, lyDo: "đã hỏi lại phụ huynh" }), nhom).lyDo).toBeUndefined();
    expect(kiemFormChonNguon(form({ canLyDo: false, lyDo: "" }), nhom).lyDo).toBeUndefined();
  });
  it("hợp lệ ⇒ object rỗng; chọn nhân sự thì kiểm theo NHÓM SẼ GHI (người là giáo viên vẫn hợp lệ ở nhóm nhân sự giới thiệu)", () => {
    expect(kiemFormChonNguon(form({ nhom: byCode("EMPLOYEE_REFERRAL"), nguoi: NV_TEACHER }), nhom)).toEqual({});
  });
  it("người lạc loại (đối tác ở nhóm nhân sự) ⇒ lỗi", () => {
    expect(kiemFormChonNguon(form({ nhom: byCode("EMPLOYEE_REFERRAL"), nguoi: DT }), nhom).thamChieu).toBeTruthy();
  });
  it("[NHH-UI-CN-06b] BIÊN của lý do: ĐÚNG 10 ký tự (sau trim) là đủ, 9 là thiếu — cùng ngưỡng với máy chủ (`quyetDinhDoiNguon`)", () => {
    // Cấy `< LY_DO_TOI_THIEU` → `<=`: lý do đúng 10 ký tự bị trình duyệt chặn trong khi máy chủ nhận.
    expect(kiemFormChonNguon(form({ canLyDo: true, lyDo: "1234567890" }), nhom).lyDo).toBeUndefined();
    expect(kiemFormChonNguon(form({ canLyDo: true, lyDo: "  1234567890  " }), nhom).lyDo).toBeUndefined();
    expect(kiemFormChonNguon(form({ canLyDo: true, lyDo: "123456789" }), nhom).lyDo).toContain("hiện 9");
    expect(kiemFormChonNguon(form({ canLyDo: true, lyDo: "123456789 " }), nhom).lyDo).toContain("hiện 9"); // khoảng trắng không cộng vào
  });
  it("[NHH-UI-CN-06c] luật người đo trên NHÓM SẼ GHI = nhóm đang bấm: nhóm admin tạo kiểu nhân sự + người nhân sự ⇒ hợp lệ dù nhóm nhân sự gốc bị đổi thuộc tính (không còn 'nhóm suy từ vai' để lệch)", () => {
    // Cấy `kiemThamChieu(nhomGhi, …)` → bắt nhóm KHÁC nhóm bấm: trình duyệt và máy chủ đo lệch nhau. Nay nhóm GHI = nhóm bấm nên chỉ còn một cách đo.
    const lech = locNhomChon([
      ...DM.map((x) => (x.code === "EMPLOYEE_REFERRAL" ? { ...x, referrerRequirement: "NONE" as const } : x)),
      g({ id: "gX", code: "TRUONG_HOC", name: "Trường học", referrerRequirement: "EMPLOYEE", sortOrder: 12 }),
    ], NOW);
    const bam = lech.find((x) => x.code === "TRUONG_HOC")!;
    expect(groupIdSeGui(bam)).toBe("gX"); // nhóm ghi = nhóm bấm, không phải nhóm gốc theo vai
    expect(kiemFormChonNguon(form({ nhom: bam, nguoi: NV_TEACHER }), lech)).toEqual({});
    // đối chứng âm: nhóm KHÔNG cần người + người nhân sự ⇒ lỗi đúng câu
    const khongNguoi = lech.find((x) => x.code === "EMPLOYEE_REFERRAL")!;
    expect(kiemFormChonNguon(form({ nhom: khongNguoi, nguoi: NV_TEACHER }), lech).thamChieu).toBe("Nguồn này không có người giới thiệu — bỏ phần đã chọn.");
    // đối chứng dương: danh mục gốc ⇒ cùng người, cùng nhóm bấm ⇒ hợp lệ
    expect(kiemFormChonNguon(form({ nhom: byCode("EMPLOYEE_REFERRAL"), nguoi: NV_TEACHER }), nhom)).toEqual({});
  });
});

describe("[DYN-WIN-UT] locNhomChon: khoảng hiệu lực của nguồn (SPEC nguồn động §1.1)", () => {
  const T = new Date("2026-11-20T03:00:00.000Z");
  const lui = (ms: number) => new Date(T.getTime() + ms);
  const codes = (rows: NhomChonTho[], now: Date) => locNhomChon(rows, now).map((x) => x.code);

  it("ngoài khoảng ⇒ KHÔNG có mặt; trong khoảng / không hạn ⇒ có mặt (đối chứng dương)", () => {
    const rows = [
      g({ id: "a", code: "KHONG_HAN" }),
      g({ id: "b", code: "TRONG", effectiveFrom: lui(-86_400_000), effectiveTo: lui(86_400_000) }),
      g({ id: "c", code: "HET_HAN", effectiveTo: lui(-1) }),
      g({ id: "d", code: "CHUA_TOI", effectiveFrom: lui(1) }),
    ];
    expect(codes(rows, T)).toEqual(["KHONG_HAN", "TRONG"]);
  });
  it("biên: bắt đầu ĐÓNG (đúng lúc bắt đầu là chọn được), kết thúc MỞ (đúng lúc kết thúc là hết)", () => {
    expect(codes([g({ id: "a", code: "BD", effectiveFrom: T })], T)).toEqual(["BD"]);
    expect(codes([g({ id: "a", code: "KT", effectiveTo: T })], T)).toEqual([]);
  });
  it("hiệu lực KHÔNG cứu nguồn đã ngừng / không chọn được: vẫn ACTIVE ∧ selectable", () => {
    const rows = [g({ id: "a", code: "NGUNG", status: "INACTIVE", effectiveFrom: lui(-1) }), g({ id: "b", code: "AN", selectable: false, effectiveFrom: lui(-1) })];
    expect(codes(rows, T)).toEqual([]);
  });
});
