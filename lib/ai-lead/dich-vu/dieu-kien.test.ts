// lib/ai-lead/dich-vu/dieu-kien.test.ts — điều kiện hồ sơ → lead + dấu xác minh của nhân viên + SLA + che PII. Thuần: không DB, không đồng hồ thật.
import { describe, expect, it } from "vitest";
import {
  daRaLead,
  docXacMinhNhanVien,
  ghiXacMinhNhanVien,
  laKetThuc,
  nguonTenFacebook,
  nhanVienXuLyDuoc,
  sdtChuanHoa,
  thieuDieuKien,
  tuChoiDuoc,
  type DauVaoDieuKien,
} from "./dieu-kien";
import { laQuaHan, mucSla } from "./sla";
import { chePhone, cheTenFacebook, cheChoAudit } from "./che-pii";

const LUC = new Date("2026-11-07T01:00:00.000Z");
const du: DauVaoDieuKien = { fbName: "Nguyễn Thị Lan", fbNameSource: "META_PROFILE_API", phoneCanonical: "84905123456", phoneRaw: null, campusCenterId: "c1", evidence: {} };

describe("[DK] thieuDieuKien & nguồn tên Facebook", () => {
  it("[DK-01] đủ ba điều kiện ⇒ không thiếu gì", () => {
    expect(thieuDieuKien(du)).toEqual([]);
  });
  it("[DK-02] thiếu theo thứ tự cố định [fbName, phone, campus]", () => {
    expect(thieuDieuKien({ ...du, fbNameSource: "CUSTOMER_STATED", phoneCanonical: null, campusCenterId: null })).toEqual(["fbName", "phone", "campus"]);
  });
  it("[DK-03] SĐT: cột chuẩn hoá sai khuôn bị bỏ, bản thô chuẩn hoá lại được thì dùng; số bàn/rác ⇒ thiếu", () => {
    expect(sdtChuanHoa({ phoneCanonical: "0905123456", phoneRaw: "0905 123 456" })).toBe("84905123456");
    expect(sdtChuanHoa({ phoneCanonical: null, phoneRaw: "0905123456" })).toBe("84905123456");
    expect(sdtChuanHoa({ phoneCanonical: null, phoneRaw: "02363123456" })).toBeNull();
    expect(sdtChuanHoa({ phoneCanonical: null, phoneRaw: null })).toBeNull();
  });
  it("[DK-04] tên do Agent lấy từ Meta ⇒ AGENT_XAC_MINH; khách tự gõ ⇒ null; tên rỗng ⇒ null", () => {
    expect(nguonTenFacebook(du)).toBe("AGENT_XAC_MINH");
    expect(nguonTenFacebook({ ...du, fbNameSource: "WEBHOOK_PAYLOAD" })).toBe("AGENT_XAC_MINH");
    expect(nguonTenFacebook({ ...du, fbNameSource: "CUSTOMER_STATED" })).toBeNull();
    expect(nguonTenFacebook({ ...du, fbName: "   ", fbNameSource: "META_PROFILE_API" })).toBeNull();
  });
  it("[DK-05] dấu nhân viên chỉ có hiệu lực với ĐÚNG giá trị đã xác minh (Agent ghi đè tên khác ⇒ mất hiệu lực)", () => {
    const ev = ghiXacMinhNhanVien({}, "fbName", "Nguyễn Thị Lan", "u1", LUC);
    expect(nguonTenFacebook({ ...du, fbNameSource: "CUSTOMER_STATED", evidence: ev })).toBe("NHAN_VIEN");
    expect(nguonTenFacebook({ ...du, fbNameSource: "CUSTOMER_STATED", fbName: "Tên khác", evidence: ev })).toBeNull();
    expect(nguonTenFacebook({ ...du, fbNameSource: "CUSTOMER_STATED", fbName: "  Nguyễn Thị Lan  ", evidence: ev })).toBe("NHAN_VIEN"); // so sau trim
  });
  it("[DK-06] ghiXacMinhNhanVien GIỮ nguyên khoá của Agent (mid) và dấu các trường khác; không sửa đối tượng gốc", () => {
    const goc = { phoneMessageMid: "mid.1", staff: { phone: { v: "84900000000", by: "u0", at: "2026-01-01T00:00:00.000Z" } } };
    const sau = ghiXacMinhNhanVien(goc, "fbName", "A", "u1", LUC);
    expect(sau.phoneMessageMid).toBe("mid.1");
    expect(docXacMinhNhanVien(sau)).toMatchObject({ phone: { v: "84900000000" }, fbName: { v: "A", by: "u1", at: LUC.toISOString() } });
    expect(goc.staff).not.toHaveProperty("fbName");
  });
  it("[DK-07] evidence hỏng/lạ ⇒ không dấu nào (fail-closed: chưa xác minh)", () => {
    for (const x of [null, undefined, 5, "x", [], { staff: "x" }, { staff: { fbName: { v: 1 } } }]) expect(docXacMinhNhanVien(x)).toEqual({});
  });
});

describe("[DK] cổng trạng thái", () => {
  it("[DK-08] kết thúc / đã ra lead / nhân viên xử lý được / từ chối được", () => {
    expect(["COMPLETED", "REJECTED", "EXPIRED"].every(laKetThuc)).toBe(true);
    expect(["COLLECTING", "ASSIGNMENT_PENDING", "SYSTEM_EXCEPTION"].some(laKetThuc)).toBe(false);
    expect(daRaLead("COMPLETED") && daRaLead("ASSIGNMENT_PENDING")).toBe(true);
    expect(daRaLead("REJECTED")).toBe(false);
    expect(nhanVienXuLyDuoc("COLLECTING")).toBe(false);
    expect(["PENDING_INFO", "WAITING_QLCS", "IN_PROGRESS", "READY_FOR_REVIEW", "SYSTEM_EXCEPTION"].every(nhanVienXuLyDuoc)).toBe(true);
    expect(tuChoiDuoc("COLLECTING")).toBe(true);
    expect(tuChoiDuoc("ASSIGNMENT_PENDING")).toBe(false);
    expect(tuChoiDuoc("COMPLETED")).toBe(false);
  });
});

describe("[SLA] mucSla — now là tham số", () => {
  const NOW = new Date("2026-11-07T10:00:00.000Z");
  const phut = (n: number) => new Date(NOW.getTime() + n * 60_000);
  const hs = (o: Partial<Parameters<typeof mucSla>[0]>) => ({ state: "WAITING_QLCS", claimedById: null, slaClaimDueAt: null, slaResolveDueAt: null, ...o });
  it("[SLA-01] chưa nhận: quá hạn NHẬN ⇒ đỏ; còn xa ⇒ trong hạn; ≤ 15 phút ⇒ sắp hết hạn", () => {
    expect(mucSla(hs({ slaClaimDueAt: phut(-1) }), NOW)).toBe("QUA_HAN_NHAN");
    expect(mucSla(hs({ slaClaimDueAt: phut(120) }), NOW)).toBe("TRONG_HAN");
    expect(mucSla(hs({ slaClaimDueAt: phut(10) }), NOW)).toBe("SAP_HAN");
  });
  it("[SLA-02] đã nhận: hạn nhận hết ý nghĩa; chỉ còn hạn XỬ LÝ; quá hạn xử lý nặng hơn quá hạn nhận", () => {
    expect(mucSla(hs({ claimedById: "u", slaClaimDueAt: phut(-500), slaResolveDueAt: phut(300) }), NOW)).toBe("TRONG_HAN");
    expect(mucSla(hs({ claimedById: "u", slaResolveDueAt: phut(-1) }), NOW)).toBe("QUA_HAN_XU_LY");
    expect(mucSla(hs({ slaClaimDueAt: phut(-5), slaResolveDueAt: phut(-5) }), NOW)).toBe("QUA_HAN_XU_LY");
    expect(laQuaHan("QUA_HAN_NHAN") && laQuaHan("QUA_HAN_XU_LY") && !laQuaHan("SAP_HAN")).toBe(true);
  });
  it("[SLA-03] hồ sơ đã ra lead/đã đóng, hoặc không có hạn ⇒ không áp dụng", () => {
    for (const state of ["COMPLETED", "ASSIGNMENT_PENDING", "REJECTED", "EXPIRED"]) expect(mucSla(hs({ state, slaClaimDueAt: phut(-99) }), NOW)).toBe("KHONG_AP_DUNG");
    expect(mucSla(hs({}), NOW)).toBe("KHONG_AP_DUNG");
  });
});

describe("[PII] che SĐT / tên", () => {
  it("[PII-01] có quyền ⇒ nguyên văn; thiếu quyền ⇒ che và KHÔNG chứa số/tên thật; rỗng ⇒ null", () => {
    expect(chePhone("84905123456", true)).toBe("84905123456");
    const che = chePhone("84905123456", false)!;
    expect(che).not.toBe("84905123456");
    expect(che).not.toContain("905123");
    expect(cheTenFacebook("Nguyễn Thị Lan", true)).toBe("Nguyễn Thị Lan");
    expect(cheTenFacebook("Nguyễn Thị Lan", false)).toBe("Nguyễn T. L.");
    expect(chePhone(null, false)).toBeNull();
    expect(cheTenFacebook("", false)).toBeNull();
  });
  it("[PII-02] cheChoAudit LUÔN che (kể cả người sửa có quyền xem); trường vắng thì không thêm khoá", () => {
    const r = cheChoAudit({ fbName: "Nguyễn Thị Lan", phone: "84905123456" });
    expect(JSON.stringify(r)).not.toMatch(/905123|Thị Lan/);
    expect(cheChoAudit({ phone: "84905123456" })).not.toHaveProperty("fbName");
  });
});
