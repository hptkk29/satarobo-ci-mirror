// [CTX-*] [UI-*] — ngữ cảnh một lần bấm "Chấm công" (thuần, đồng hồ đóng băng). DB: tests/cham-cong/parttime-ngu-canh.spec.ts.
import { describe, expect, it } from "vitest";
import { cauDuDoan } from "@/lib/cham-cong/suy-huong";
import { dungNguCanh, hienKhoiNguCanh, type DauVaoNguCanh, type TietVao, type TrucVao } from "./ngu-canh-cham-cong";

const NGAY = "2026-11-02";
const vn = (h: string) => new Date(`${NGAY}T${h}:00+07:00`);
const tiet = (p: Partial<TietVao> & { tu?: string; den?: string } = {}): TietVao => {
  const { tu = "18:00", den = "19:30", ...con } = p;
  return {
    assignmentId: "pc1",
    role: "MAIN_TEACHER",
    activity: "REGULAR_CLASS",
    assignmentType: "SYSTEM",
    nhanLop: "SATA4-A",
    centerId: "cs2",
    centerCode: "CS2",
    batDau: vn(tu),
    ketThuc: vn(den),
    requiredFrom: new Date(vn(tu).getTime() - 10 * 60_000),
    daNhan: true,
    bangChung: null,
    ...con,
  };
};
const truc = (p: Partial<TrucVao> = {}): TrucVao => ({ dutyId: "d1", shiftCode: "T", tu: vn("17:15"), den: vn("21:00"), centerId: "cs2", centerCode: "CS2", daNhan: true, ...p });
const CA = { ten: "Ca chiều + tối", timeLabel: "13:45–16:30 · 17:30–21:00" };
const nc = (p: Partial<DauVaoNguCanh> = {}) =>
  dungNguCanh({ huong: { huong: "CHECK_IN", trung: false, nhanBuoi: null, cheDo: "PARTTIME" }, caThuong: null, tiet: [], truc: [], centerHienTai: "cs2", now: vn("14:02"), ...p });

describe("[CTX] phân loại theo DỮ LIỆU hôm nay, không theo vai RBAC", () => {
  it("[CTX-01] chỉ ca thường ⇒ NORMAL_SHIFT; câu dự đoán ĐÚNG câu cũ", () => {
    const h = { huong: "CHECK_OUT" as const, trung: false, nhanBuoi: "ca hôm nay", cheDo: "CA" as const };
    const r = nc({ caThuong: CA, huong: h });
    expect([r.primary, r.contexts]).toEqual(["NORMAL_SHIFT", ["NORMAL_SHIFT"]]);
    expect(r.cauDuDoan).toBe(cauDuDoan(h));
    expect(r.cauDuDoan).toBe("Dự đoán: lần này sẽ ghi RA · ca hôm nay.");
  });

  it("[CTX-02][CTX-09-noops] chỉ một tiết đứng chính, KHÔNG dòng trực ⇒ TEACHING, operationsDuty = null (dạy một tiết rồi về = 0 trực)", () => {
    const r = nc({ tiet: [tiet()] });
    expect([r.primary, r.contexts, r.operationsDuty]).toEqual(["TEACHING", ["TEACHING_MAIN"], null]);
    expect(r.nextTeaching).toMatchObject({ tieuDe: "GIÁO VIÊN ĐỨNG CHÍNH", nhanLop: "SATA4-A", gio: "18:00–19:30", coMatTruoc: "17:50", nhanVai: "Đứng chính" });
  });

  it("[CTX-03] trợ giảng ⇒ TEACHING_ASSISTANT, nhãn TRỢ GIẢNG (không gọi là đứng chính)", () => {
    const r = nc({ tiet: [tiet({ role: "TEACHING_ASSISTANT" })] });
    expect(r.contexts).toEqual(["TEACHING_ASSISTANT"]);
    expect(r.nextTeaching).toMatchObject({ tieuDe: "TRỢ GIẢNG", nhanVai: "Trợ giảng" });
  });

  it("[CTX-04][CTX-05] dạy thay ⇒ DẠY THAY (vai đứng chính); học bù ⇒ HỌC BÙ; học thử ⇒ HỌC THỬ", () => {
    expect(nc({ tiet: [tiet({ assignmentType: "SUBSTITUTE" })] }).nextTeaching).toMatchObject({ tieuDe: "DẠY THAY", nhanVai: "Đứng chính" });
    expect(nc({ tiet: [tiet({ activity: "MAKEUP" })] }).nextTeaching).toMatchObject({ tieuDe: "HỌC BÙ" });
    expect(nc({ tiet: [tiet({ activity: "MAKEUP", role: "TEACHING_ASSISTANT" })] }).nextTeaching).toMatchObject({ tieuDe: "HỌC BÙ", nhanVai: "Trợ giảng" });
    expect(nc({ tiet: [tiet({ activity: "TRIAL" })] }).nextTeaching).toMatchObject({ tieuDe: "HỌC THỬ" });
  });

  it("[CTX-06] chỉ trực ⇒ OPERATIONS_DUTY", () => {
    const r = nc({ truc: [truc()] });
    expect([r.primary, r.contexts, r.operationsDuty]).toEqual(["OPERATIONS_DUTY", ["OPERATIONS_DUTY"], { dutyId: "d1", shiftCode: "T", gio: "17:15–21:00", khacCoSo: null }]);
    expect(r.cauDuDoan).toBe("Dự đoán: lần này sẽ ghi VÀO · ca trực.");
  });

  it("[CTX-07] đứng chính + trực ⇒ MIXED, giữ CẢ HAI ngữ cảnh; câu 'ca trực + lịch dạy'", () => {
    const r = nc({ tiet: [tiet()], truc: [truc()] });
    expect([r.primary, r.contexts]).toEqual(["MIXED", ["TEACHING_MAIN", "OPERATIONS_DUTY"]]);
    expect(r.cauDuDoan).toBe("Dự đoán: lần này sẽ ghi VÀO · ca trực + lịch dạy hôm nay.");
  });

  it("[CTX-08] hai tiết ⇒ tiết ĐẦU thẻ đổi theo giờ (sắp tới → đang diễn ra → vừa xong) + 'Sau đó'", () => {
    const hai = [tiet({ assignmentId: "a", nhanLop: "SATA3-A", tu: "17:30", den: "19:00" }), tiet({ assignmentId: "b", nhanLop: "SATA4-B", tu: "19:15", den: "20:45" })];
    expect(nc({ tiet: hai, now: vn("14:02") })).toMatchObject({ nextTeaching: { nhanLop: "SATA3-A" }, sauDo: { nhanLop: "SATA4-B" } });
    expect(nc({ tiet: hai, now: vn("19:10") })).toMatchObject({ nextTeaching: { nhanLop: "SATA4-B" }, sauDo: null });
    expect(nc({ tiet: hai, now: vn("21:30") })).toMatchObject({ nextTeaching: { nhanLop: "SATA4-B" } });
    expect(nc({ tiet: hai }).teaching).toHaveLength(2);
  });

  it("[CTX-09] không ca, không tiết, không trực ⇒ NONE + cảnh báo; câu dự đoán là câu cũ", () => {
    const r = nc();
    expect(r.primary).toBe("NONE");
    expect(r.warnings.map((w) => w.ma)).toEqual(["KHONG_LICH"]);
    expect(r.cauDuDoan).toBe("Dự đoán: lần này sẽ ghi VÀO.");
  });

  it("[CTX-18] tiết CHƯA NHẬN không thành ngữ cảnh, chỉ cảnh báo; trực chưa nhận cũng vậy", () => {
    const r = nc({ tiet: [tiet({ daNhan: false })], truc: [truc({ daNhan: false })] });
    expect([r.primary, r.contexts, r.operationsDuty]).toEqual(["NONE", [], null]);
    expect(r.warnings.map((w) => w.ma)).toEqual(["CHUA_NHAN_LOP", "CHUA_NHAN_TRUC", "KHONG_LICH"]);
  });

  it("[CTX-17] thẻ dùng khối ngữ cảnh: CHỈ ca thường theo luật ca ⇒ KHÔNG (thẻ cũ); ca thường + cảnh báo, hoặc ngày Parttime ⇒ CÓ", () => {
    const caCu = nc({ caThuong: CA, huong: { huong: "CHECK_IN", trung: false, nhanBuoi: "ca hôm nay", cheDo: "CA" } });
    expect(hienKhoiNguCanh(caCu)).toBe(false);
    expect(hienKhoiNguCanh(null)).toBe(false);
    // ô ca + tiết chưa nhận: việc chính vẫn là ca thường nhưng hướng đã theo hiện diện ⇒ phải nói ra.
    const chuaNhan = nc({ caThuong: CA, tiet: [tiet({ daNhan: false })] });
    expect(chuaNhan.primary).toBe("NORMAL_SHIFT");
    expect(hienKhoiNguCanh(chuaNhan)).toBe(true);
    expect(hienKhoiNguCanh(nc({ caThuong: CA, huong: { huong: "CHECK_IN", trung: false, nhanBuoi: null, cheDo: "CA" }, tiet: [tiet({ daNhan: false })] }))).toBe(true); // chỉ vì cảnh báo
    expect(hienKhoiNguCanh(nc({ caThuong: CA }))).toBe(true); // chỉ vì ngày Parttime
    expect(hienKhoiNguCanh(nc({ tiet: [tiet()] }))).toBe(true);
  });

  it("[CTX-16] tiết ở cơ sở KHÁC điểm đang quét ⇒ nói rõ (dạy thay ở cơ sở khác — không giả định cơ sở nhà)", () => {
    const r = nc({ tiet: [tiet({ centerId: "cs1", centerCode: "CS1" })] });
    expect(r.nextTeaching?.khacCoSo).toBe("CS1");
    expect(r.warnings.map((w) => w.ma)).toEqual(["KHAC_CO_SO"]);
  });
});

describe("[DIR] hướng KHÔNG tính ở đây — chỉ chuyển nguyên kết quả máy chủ", () => {
  it("[DIR-06p] direction === hướng đầu vào ở MỌI hình dạng ngữ cảnh (dự đoán = lượt ghi: cùng `suyHuongHomNay`)", () => {
    for (const huong of ["CHECK_IN", "CHECK_OUT"] as const)
      for (const p of [{}, { caThuong: CA }, { tiet: [tiet()] }, { truc: [truc()] }, { tiet: [tiet()], truc: [truc()], caThuong: CA }])
        expect(nc({ ...p, huong: { huong, trung: false, nhanBuoi: null, cheDo: "PARTTIME" } }).direction).toBe(huong);
  });

  it("[DIR-03p] câu dự đoán đi theo HƯỚNG máy chủ, không theo giờ tiết gần nhất (14:02 mà đang mở ⇒ RA)", () => {
    const r = nc({ tiet: [tiet()], now: vn("14:02"), huong: { huong: "CHECK_OUT", trung: false, nhanBuoi: null, cheDo: "PARTTIME" } });
    expect(r.cauDuDoan).toBe("Dự đoán: lần này sẽ ghi RA · công việc hôm nay.");
    expect(r.huongTiepTheo).toBe("CHECK_IN");
  });

  it("[UI-09] dự đoán theo ngữ cảnh: tiết dạy nêu tên lớp; bấm trùng ⇒ câu trùng cũ; luật ca ⇒ không đoán lượt sau", () => {
    expect(nc({ tiet: [tiet()] }).cauDuDoan).toBe("Dự đoán: lần này sẽ ghi VÀO · tiết dạy SATA4-A.");
    expect(nc({ tiet: [tiet()], huong: { huong: "CHECK_IN", trung: true, nhanBuoi: null, cheDo: "PARTTIME" } }).cauDuDoan).toMatch(/TRÙNG \(VÀO\)/);
    expect(nc({ caThuong: CA, tiet: [tiet()] }).cauDuDoan).toBe("Dự đoán: lần này sẽ ghi VÀO · ca hôm nay + lịch dạy.");
    expect(nc({ tiet: [tiet()], huong: { huong: "CHECK_IN", trung: false, nhanBuoi: null, cheDo: "CA" } }).huongTiepTheo).toBeNull();
  });

  it("[UI-NOPAY] không chữ công / tiền nào trong ngữ cảnh hiển thị (§46)", () => {
    const s = JSON.stringify(nc({ tiet: [tiet({ bangChung: "Vào 17:47 · ra 19:35" })], truc: [truc()], caThuong: CA }));
    // Tiền ("120.000đ"), đơn vị trả ("0,5 ca"), số công ("1 công") — không phải chữ "công việc" hay "Dự đoán".
    expect(s).not.toMatch(/\d[\d.]*\s?đ|\b(0,5|1,0)\s?(ca|công)|\d+\s?công\b/);
    expect("Vào 17:47 · 120.000đ").toMatch(/\d[\d.]*\s?đ/); // đối chứng: mẫu bắt được tiền thật
  });
});
