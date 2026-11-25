// lib/ai-lead/dich-vu/ngoai-le-thuan.test.ts — phần THUẦN của «Ngoại lệ»: phân loại · lý do (không lộ nội dung lạ) · bảng nút nói thật. Không DB, không đồng hồ thật (`now` cố định).
import { describe, expect, it } from "vitest";
import {
  NHAN_LOAI,
  THU_TU_LOAI,
  bangNutNgoaiLe,
  lyDoNgoaiLe,
  maHopLe,
  mocNgoaiLe,
  phanLoaiNgoaiLe,
  type DauVaoNutNgoaiLe,
} from "./ngoai-le-thuan";

const NOW = new Date("2026-11-08T03:00:00.000Z");
const PHUT = 60_000;
const truoc = (ph: number) => new Date(NOW.getTime() - ph * PHUT);
const sau = (ph: number) => new Date(NOW.getTime() + ph * PHUT);
const hs = (o: Partial<{ state: string; claimedById: string | null; slaClaimDueAt: Date | null; slaResolveDueAt: Date | null }> = {}) => ({
  state: "WAITING_QLCS",
  claimedById: null,
  slaClaimDueAt: null,
  slaResolveDueAt: null,
  ...o,
});

describe("[NLT] phanLoaiNgoaiLe", () => {
  it("[NLT-01] SYSTEM_EXCEPTION và ASSIGNMENT_PENDING luôn là ngoại lệ, kể cả khi quá hạn (loại nặng hơn thắng — không đếm hai lần)", () => {
    expect(phanLoaiNgoaiLe(hs({ state: "SYSTEM_EXCEPTION", slaResolveDueAt: truoc(60) }), NOW)).toBe("SYSTEM_EXCEPTION");
    expect(phanLoaiNgoaiLe(hs({ state: "ASSIGNMENT_PENDING", slaResolveDueAt: truoc(60) }), NOW)).toBe("ASSIGNMENT_PENDING");
  });

  it("[NLT-02] hồ sơ kết thúc không bao giờ là ngoại lệ, kể cả hạn đã trôi", () => {
    for (const state of ["COMPLETED", "REJECTED", "EXPIRED"]) {
      expect(phanLoaiNgoaiLe(hs({ state, slaClaimDueAt: truoc(500), slaResolveDueAt: truoc(500) }), NOW)).toBeNull();
    }
  });

  it("[NLT-03] quá hạn NHẬN chỉ khi CHƯA ai nhận; quá hạn XỬ LÝ kể cả đã có người nhận; còn hạn ⇒ không phải", () => {
    expect(phanLoaiNgoaiLe(hs({ slaClaimDueAt: truoc(1) }), NOW)).toBe("QUA_HAN_SLA");
    expect(phanLoaiNgoaiLe(hs({ claimedById: "u1", slaClaimDueAt: truoc(1) }), NOW)).toBeNull();
    expect(phanLoaiNgoaiLe(hs({ claimedById: "u1", slaResolveDueAt: truoc(1) }), NOW)).toBe("QUA_HAN_SLA");
    expect(phanLoaiNgoaiLe(hs({ slaClaimDueAt: sau(1), slaResolveDueAt: sau(30) }), NOW)).toBeNull();
    expect(phanLoaiNgoaiLe(hs(), NOW)).toBeNull(); // chưa có hạn nào
  });

  it("[NLT-04] hạn đúng bằng `now` chưa quá hạn (so sánh nghiêm ngặt — khớp `lt` ở truy vấn)", () => {
    expect(phanLoaiNgoaiLe(hs({ slaClaimDueAt: NOW }), NOW)).toBeNull();
    expect(phanLoaiNgoaiLe(hs({ slaClaimDueAt: new Date(NOW.getTime() - 1) }), NOW)).toBe("QUA_HAN_SLA");
  });

  it("[NLT-05] thứ tự ưu tiên khai báo đúng và mọi loại đều có nhãn chữ", () => {
    expect([...THU_TU_LOAI]).toEqual(["SYSTEM_EXCEPTION", "ASSIGNMENT_PENDING", "QUA_HAN_SLA"]);
    for (const l of THU_TU_LOAI) expect(NHAN_LOAI[l].length).toBeGreaterThan(3);
  });
});

describe("[NLT] lyDoNgoaiLe — câu người đọc được, không lộ nội dung", () => {
  const se = (resultNote: string | null) => lyDoNgoaiLe({ loai: "SYSTEM_EXCEPTION", resultNote, mucSla: "KHONG_AP_DUNG", leadDaCoNguoi: null });

  it("[NLT-10] mọi mã mà mã nguồn thật sự ghi đều dịch được và mang mã ra", () => {
    const MA = ["INGEST_NEM_LOI", "AUTO_LOI_INGEST", "INGEST_GHI", "INGEST_KHONG_CO_LEAD", "AUTO_TU_DONG_TAT", "INGEST_SDT", "INGEST_TEN", "INGEST_TU_CHOI", "AUTO_CO_SO_KHONG_HOP_LE"];
    for (const ma of MA) {
      const r = se(ma);
      expect(r.ma).toBe(ma);
      expect(r.cau.length).toBeGreaterThan(10);
      expect(r.goiY.length).toBeGreaterThan(10);
    }
  });

  it("[NLT-11] lỗi tạm thời ⇒ thử lại được; lỗi dữ liệu hồ sơ ⇒ KHÔNG (nút tối, gợi ý sửa hồ sơ)", () => {
    for (const ma of ["INGEST_NEM_LOI", "AUTO_LOI_INGEST", "INGEST_GHI", "INGEST_KHONG_CO_LEAD", "AUTO_TU_DONG_TAT"]) expect(se(ma).thuLaiDuoc).toBe(true);
    for (const ma of ["INGEST_SDT", "INGEST_TEN", "INGEST_TU_CHOI", "AUTO_CO_SO_KHONG_HOP_LE"]) expect(se(ma).thuLaiDuoc).toBe(false);
  });

  it("[NLT-12] mã LẠ / rỗng ⇒ câu chung, ma = null, KHÔNG BAO GIỜ in lại nguyên văn (có thể là lỗi kèm SĐT)", () => {
    const doc = "Unique constraint failed on phone 0905123456 Nguyễn Thị Lan";
    for (const x of [doc, "", null, "ingest_sdt", "__proto__", "toString", "constructor"]) {
      const r = se(x);
      expect(r.ma).toBeNull();
      expect(r.thuLaiDuoc).toBe(true);
      const json = JSON.stringify(r);
      expect(json).not.toContain("0905123456");
      expect(json).not.toContain("Nguyễn Thị Lan");
      expect(json).not.toContain("Unique constraint");
    }
  });

  it("[NLT-13] maHopLe chỉ nhận khoá của bảng (không nhận khoá thừa kế của Object)", () => {
    expect(maHopLe("INGEST_SDT")).toBe("INGEST_SDT");
    expect(maHopLe("hasOwnProperty")).toBeNull();
    expect(maHopLe(undefined)).toBeNull();
  });

  it("[NLT-14] ASSIGNMENT_PENDING nói việc cần làm là giao sale ở màn lead; quá hạn phân biệt NHẬN và XỬ LÝ", () => {
    const ap = lyDoNgoaiLe({ loai: "ASSIGNMENT_PENDING", resultNote: "INGEST_SDT", mucSla: "KHONG_AP_DUNG", leadDaCoNguoi: false });
    expect(ap.cau).toContain("chưa có sale");
    expect(ap.ma).toBeNull(); // resultNote của loại khác không rò sang
    // Lead ĐÃ có sale ⇒ câu KHÔNG được nói «chưa có sale» (nút «Đánh dấu đã xử lý» đang sáng — hai thứ phải cùng một sự thật).
    const daCo = lyDoNgoaiLe({ loai: "ASSIGNMENT_PENDING", resultNote: null, mucSla: "KHONG_AP_DUNG", leadDaCoNguoi: true });
    expect(daCo.cau).toContain("đã có sale");
    expect(daCo.cau).not.toContain("chưa có sale");
    expect(daCo.goiY).not.toContain("Giao sale");
    expect(lyDoNgoaiLe({ loai: "QUA_HAN_SLA", resultNote: null, mucSla: "QUA_HAN_NHAN", leadDaCoNguoi: null }).cau).toContain("Quá hạn nhận");
    expect(lyDoNgoaiLe({ loai: "QUA_HAN_SLA", resultNote: null, mucSla: "QUA_HAN_XU_LY", leadDaCoNguoi: null }).cau).toContain("Quá hạn xử lý");
  });
});

describe("[NLT] mocNgoaiLe", () => {
  it("[NLT-15] lỗi/chờ phân công tính từ lần cập nhật cuối; quá hạn tính từ HẠN đã trôi (xử lý nặng hơn nhận)", () => {
    const base = { updatedAt: truoc(10), claimedById: null, slaClaimDueAt: truoc(40), slaResolveDueAt: truoc(20) };
    expect(mocNgoaiLe("SYSTEM_EXCEPTION", base, NOW).moc).toEqual(truoc(10));
    expect(mocNgoaiLe("ASSIGNMENT_PENDING", base, NOW).moc).toEqual(truoc(10));
    expect(mocNgoaiLe("QUA_HAN_SLA", base, NOW)).toEqual({ moc: truoc(20), nhan: "Quá hạn" });
    expect(mocNgoaiLe("QUA_HAN_SLA", { ...base, slaResolveDueAt: sau(5) }, NOW).moc).toEqual(truoc(40));
  });
});

describe("[NLT] bangNutNgoaiLe — nút nói thật (luật 12)", () => {
  const goc: DauVaoNutNgoaiLe = {
    loai: "SYSTEM_EXCEPTION",
    state: "SYSTEM_EXCEPTION",
    coQuyenXuLy: true,
    claimedById: null,
    claimedBoiToi: false,
    claimedTen: null,
    thieu: [],
    thuLaiDuoc: true,
    leadId: null,
    leadDaCoNguoi: null,
    soUngVien: 2,
  };
  const voi = (o: Partial<DauVaoNutNgoaiLe>): DauVaoNutNgoaiLe => ({ ...goc, ...o });

  it("[NLT-20] lỗi hệ thống, đủ điều kiện: Thử lại + Giao người sáng, không có «Đánh dấu đã xử lý»", () => {
    const b = bangNutNgoaiLe(goc);
    expect(b.thuLai).toMatchObject({ hien: true, bat: true });
    expect(b.giaoNguoi).toMatchObject({ hien: true, bat: true });
    expect(b.danhDauDaXuLy.hien).toBe(false);
  });

  it("[NLT-21] chỉ có quyền XEM ⇒ không nút nào, có ghi chú vì sao", () => {
    const b = bangNutNgoaiLe(voi({ coQuyenXuLy: false }));
    expect([b.thuLai.hien, b.giaoNguoi.hien, b.danhDauDaXuLy.hien]).toEqual([false, false, false]);
    expect(b.ghiChu).toContain("ai-leads:review");
  });

  it("[NLT-22] Thử lại TỐI kèm lý do bằng chữ: người khác giữ · còn thiếu · lỗi do dữ liệu", () => {
    const khac = bangNutNgoaiLe(voi({ claimedById: "u2", claimedTen: "Chị Hoa" }));
    expect(khac.thuLai).toMatchObject({ hien: true, bat: false });
    expect(khac.thuLai.lyDoKhoa).toContain("Chị Hoa");
    expect(khac.giaoNguoi.bat).toBe(false);
    const thieu = bangNutNgoaiLe(voi({ thieu: ["phone", "campus"] }));
    expect(thieu.thuLai.bat).toBe(false);
    expect(thieu.thuLai.lyDoKhoa).toContain("Số điện thoại");
    expect(thieu.thuLai.lyDoKhoa).toContain("cơ sở");
    const du = bangNutNgoaiLe(voi({ thuLaiDuoc: false }));
    expect(du.thuLai.bat).toBe(false);
    expect(du.thuLai.lyDoKhoa).toContain("dữ liệu hồ sơ");
  });

  it("[NLT-23] chính mình đang giữ ⇒ vẫn sáng", () => {
    const b = bangNutNgoaiLe(voi({ claimedById: "me", claimedBoiToi: true }));
    expect(b.thuLai.bat).toBe(true);
    expect(b.giaoNguoi.bat).toBe(true);
  });

  it("[NLT-24] ASSIGNMENT_PENDING: KHÔNG có Thử lại / Giao người; Đánh dấu chỉ sáng khi lead ĐÃ có người phụ trách", () => {
    const ap = voi({ loai: "ASSIGNMENT_PENDING", state: "ASSIGNMENT_PENDING", leadId: "l1", leadDaCoNguoi: false });
    const chua = bangNutNgoaiLe(ap);
    expect([chua.thuLai.hien, chua.giaoNguoi.hien]).toEqual([false, false]);
    expect(chua.danhDauDaXuLy).toMatchObject({ hien: true, bat: false });
    expect(chua.danhDauDaXuLy.lyDoKhoa).toContain("chưa có người phụ trách");
    expect(bangNutNgoaiLe({ ...ap, leadDaCoNguoi: true }).danhDauDaXuLy.bat).toBe(true);
    expect(bangNutNgoaiLe({ ...ap, leadDaCoNguoi: null }).danhDauDaXuLy.bat).toBe(false); // không biết ≠ có
    const khongLead = bangNutNgoaiLe({ ...ap, leadId: null, leadDaCoNguoi: true });
    expect(khongLead.danhDauDaXuLy.bat).toBe(false);
  });

  it("[NLT-25] quá hạn: không Thử lại; Giao người tối khi Agent còn thu thập (COLLECTING) hoặc không có ứng viên", () => {
    const qh = voi({ loai: "QUA_HAN_SLA", state: "WAITING_QLCS" });
    const b = bangNutNgoaiLe(qh);
    expect(b.thuLai.hien).toBe(false);
    expect(b.giaoNguoi.bat).toBe(true);
    const thuThap = bangNutNgoaiLe({ ...qh, state: "COLLECTING" });
    expect(thuThap.giaoNguoi).toMatchObject({ hien: true, bat: false });
    expect(thuThap.giaoNguoi.lyDoKhoa).toContain("thu thập");
    const khongAi = bangNutNgoaiLe({ ...qh, soUngVien: 0 });
    expect(khongAi.giaoNguoi.bat).toBe(false);
    expect(khongAi.giaoNguoi.lyDoKhoa).toContain("quản lý nào khác");
  });
});
