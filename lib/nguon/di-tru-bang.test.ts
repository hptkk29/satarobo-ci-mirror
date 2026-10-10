/**
 * Ca [NHH-DT-BANG-*] — bảng "Nhãn cũ × Nguồn đích" của báo cáo di trú: Nhãn cũ · Nguồn đích · Số lượng · Baseline · Delta ·
 * AUTO / MANUAL_REVIEW. THUẦN (không DB, không đồng hồ). Báo cáo CHỈ ĐỌC; baseline là tệp JSON của lượt chạy TRƯỚC.
 */
import { describe, expect, it } from "vitest";
import { chuanHoaNhanNguon, tomTatDiTru, type HangDiTru } from "./anh-xa-nhan-cu";
import { VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";
import { anhXaNhanCu } from "./anh-xa-nhan-cu";
import { docBaseline, dungBangNhan, khoaBaseline, thanhBaseline } from "./di-tru-bang";

const TRUOC = new Date("2026-09-15T03:00:00.000Z");
const hang = (leadId: string, nhan: string): HangDiTru => ({
  leadId,
  kq: anhXaNhanCu({ nhan, createdAt: TRUOC, affiliate: null, nguoiNhap: null, maNvTrongNote: null }, VAI_SANG_NGUON_MAC_DINH, "EMPLOYEE_REFERRAL"),
  nhanChuan: chuanHoaNhanNguon(nhan),
  createdAt: TRUOC,
});

const rows: HangDiTru[] = [
  hang("1", "Ads"),
  hang("2", "Ads"),
  hang("3", "Ads"),
  hang("4", "Sale tự kiếm"),
  hang("5", "Sale tự kiếm"),
  hang("6", "Organic"),
  { leadId: "7", kq: { loai: "INVALID", nhanChuan: "la" }, nhanChuan: "la", createdAt: TRUOC },
];
const theoNhan = tomTatDiTru(rows, new Set()).theoNhan;

describe("[NHH-DT-BANG-01] dòng bảng: số lượng · phân loại AUTO / MANUAL_REVIEW", () => {
  const bang = dungBangNhan(theoNhan, null);
  const dong = (nhan: string) => bang.find((d) => d.nhanChuan === chuanHoaNhanNguon(nhan))!;

  it("mỗi cặp (nhãn × đích) đúng MỘT dòng, đủ số lượng", () => {
    expect(bang).toHaveLength(4);
    expect(dong("Ads")).toMatchObject({ nhom: "PAID_ADS", soLead: 3, loai: "AUTO" });
    expect(dong("Organic")).toMatchObject({ nhom: "CENTER_ORGANIC", soLead: 1, loai: "AUTO" });
  });

  it("nhãn cần NGƯỜI mà nhãn cũ không mang người ⇒ MANUAL_REVIEW (không tự gán người); nhãn lạ ⇒ INVALID", () => {
    expect(dong("Sale tự kiếm")).toMatchObject({ nhom: "EMPLOYEE_REFERRAL", soLead: 2, loai: "MANUAL_REVIEW" });
    expect(dong("la")).toMatchObject({ nhom: "INVALID", loai: "INVALID" });
  });

  it("dòng HỖN HỢP (một phần lead cần xem tay) ⇒ nói rõ `HON_HOP`, không gộp thành AUTO", () => {
    const hon = dungBangNhan([{ nhanChuan: "x", stt: 1, nhom: "WALK_IN", soLead: 5, soXemTay: 2 }], null);
    expect(hon[0]).toMatchObject({ loai: "HON_HOP", soXemTay: 2 });
  });

  it("không có baseline ⇒ cột Baseline/Delta là null (KHÔNG bịa số 0)", () => {
    for (const d of bang) expect([d.baseline, d.delta]).toEqual([null, null]);
  });
});

describe("[NHH-DT-BANG-02] baseline từ lượt chạy trước ⇒ Delta = hiện tại − baseline", () => {
  it("khoá baseline = nhãn chuẩn hoá + đích; nhãn trống có khoá riêng", () => {
    expect(khoaBaseline("ads", "PAID_ADS")).toBe("ads\u0000PAID_ADS");
    expect(khoaBaseline(null, "UNKNOWN")).toBe("\u0000UNKNOWN");
  });

  it("vòng khứ hồi: thanhBaseline → docBaseline → dungBangNhan cho Delta đúng; dòng mới (chưa có baseline) coi baseline = 0", () => {
    const luu = thanhBaseline(dungBangNhan(theoNhan, null));
    const doc = docBaseline(JSON.parse(JSON.stringify(luu)));
    expect(doc).not.toBeNull();
    // Lượt sau: "Ads" tăng từ 3 lên 5, "Organic" mất baseline (dòng mới), "Sale tự kiếm" giảm.
    const baseline = new Map(doc!);
    baseline.set(khoaBaseline("ads", "PAID_ADS"), 3);
    baseline.delete(khoaBaseline("organic", "CENTER_ORGANIC"));
    baseline.set(khoaBaseline("sale tự kiếm", "EMPLOYEE_REFERRAL"), 4);
    const luotSau = dungBangNhan(
      [
        { nhanChuan: "ads", stt: 6, nhom: "PAID_ADS", soLead: 5, soXemTay: 0 },
        { nhanChuan: "organic", stt: 15, nhom: "CENTER_ORGANIC", soLead: 1, soXemTay: 0 },
        { nhanChuan: "sale tự kiếm", stt: 18, nhom: "EMPLOYEE_REFERRAL", soLead: 2, soXemTay: 2 },
      ],
      baseline,
    );
    const g = (n: string) => luotSau.find((d) => d.nhanChuan === n)!;
    expect([g("ads").baseline, g("ads").delta]).toEqual([3, 2]);
    expect([g("organic").baseline, g("organic").delta]).toEqual([0, 1]);
    expect([g("sale tự kiếm").baseline, g("sale tự kiếm").delta]).toEqual([4, -2]);
  });

  it("nhãn CÓ trong baseline mà NAY KHÔNG CÒN ⇒ vẫn liệt kê (KHONG_CON, 0 lead, Delta âm); baseline 0 thì không bịa dòng", () => {
    const baseline = new Map([
      [khoaBaseline("cu", "WALK_IN"), 7],
      [khoaBaseline("rong", "WALK_IN"), 0],
    ]);
    const bang = dungBangNhan([{ nhanChuan: "moi", stt: 1, nhom: "PAID_ADS", soLead: 2, soXemTay: 0 }], baseline);
    expect(bang.map((d) => [d.nhanChuan, d.nhom, d.soLead, d.baseline, d.delta, d.loai])).toEqual([
      ["moi", "PAID_ADS", 2, 0, 2, "AUTO"],
      ["cu", "WALK_IN", 0, 7, -7, "KHONG_CON"],
    ]);
    // KHONG_CON không đi vào baseline của lượt sau (nó đã biến mất).
    expect(thanhBaseline(bang).dong.map((d) => d.khoa)).toEqual([khoaBaseline("moi", "PAID_ADS")]);
  });

  it("baseline hỏng (không phải bản đồ số nguyên không âm) ⇒ null, không ném, không đoán", () => {
    expect(docBaseline(null)).toBeNull();
    expect(docBaseline({ phienBan: 1, dong: "x" })).toBeNull();
    expect(docBaseline({ phienBan: 1, dong: [{ khoa: "a", soLead: -1 }] })).toBeNull();
    expect(docBaseline({ phienBan: 1, dong: [{ khoa: "a", soLead: 1.5 }] })).toBeNull();
    expect(docBaseline({ phienBan: 2, dong: [] })).toBeNull();
    // Đối chứng dương: bản hợp lệ.
    expect(docBaseline({ phienBan: 1, dong: [{ khoa: "a", soLead: 2 }] })?.get("a")).toBe(2);
  });
});
