// @vitest-environment node
import { describe, it, expect } from "vitest";
import { kiemLo, lapKeHoachCa, ngayThat, TRAN_CA_MOI_LUOT, type BoiCanh, type CaNhap, type SuThat } from "@/lib/bao-luu/legacy-nhap";

const NOW = new Date("2026-10-08T03:00:00Z");
const DON = "bao-luu/2026-10/aaaaaaaa11111111.pdf";
const BOI: BoiCanh = { effectiveDate: "2026-09-01", maxMonths: 6, now: NOW };
const CA_B: CaNhap = { nhom: "B", studentId: "hv1", enrollmentId: "gd1", reserveId: null, ngayBatDau: "2026-08-15", applicationFileKey: DON };
const ST_B: SuThat = {
  flagBat: true,
  reserve: null,
  enrollment: { id: "gd1", studentId: "hv1", status: "PAUSED", deletedAt: null, khoaChoPhepBaoLuu: true },
  daCoHoSoMoPhu: false,
  soLanDaDung: 0,
  maxPerEnrollment: 1,
};
const CA_C: CaNhap = { ...CA_B, nhom: "C" };
const ST_C: SuThat = { ...ST_B, enrollment: { ...ST_B.enrollment!, status: "ACTIVE" } };
const CA_A: CaNhap = { nhom: "A", studentId: "hv1", enrollmentId: "gd1", reserveId: "r1", ngayBatDau: "2026-08-15", applicationFileKey: DON };
const ST_A: SuThat = {
  ...ST_B,
  reserve: { id: "r1", studentId: "hv1", enrollmentId: null, isActive: true, endedAt: null, approvedAt: null },
};

describe("[BL8-LG] lập kế hoạch nhập ca LEGACY", () => {
  it("[BL8-LG-01] ngày hiệu lực CHƯA khai ⇒ CHẶN mọi nhóm, câu lỗi nói đúng chỗ phải khai; không có kế hoạch", () => {
    for (const [ca, st] of [[CA_B, ST_B], [CA_C, ST_C], [CA_A, ST_A]] as const) {
      const r = lapKeHoachCa(ca, st, { ...BOI, effectiveDate: "" });
      expect(r.ke, ca.nhom).toBeNull();
      expect(r.loi.join(" "), ca.nhom).toMatch(/Ngày hiệu lực quy chế/);
    }
  });

  it("[BL8-LG-02] ngày hiệu lực sai định dạng (cuốn chiếu '2026-13-45') cũng bị chặn", () => {
    const r = lapKeHoachCa(CA_B, ST_B, { ...BOI, effectiveDate: "2026-13-45" });
    expect(r.ke).toBeNull();
    expect(r.loi.join(" ")).toMatch(/không hợp lệ/);
    expect(ngayThat("2026-13-45")).toBeNull();
    expect(ngayThat("2026-02-30")).toBeNull();
    expect(ngayThat("2026-02-28")).not.toBeNull();
  });

  it("[BL8-LG-03] HẠN = ngày hiệu lực + maxMonths THÁNG LỊCH — KHÔNG phụ thuộc ngày bắt đầu thực tế (BR-28)", () => {
    const a = lapKeHoachCa(CA_B, ST_B, BOI);
    const b = lapKeHoachCa({ ...CA_B, ngayBatDau: "2026-03-01" }, ST_B, BOI);
    expect(a.loi).toEqual([]);
    expect(a.ke!.han.toISOString()).toBe("2027-02-28T17:00:00.000Z"); // 01/09/2026 + 6 tháng = 01/03/2027 00:00 VN
    expect(b.ke!.han.toISOString()).toBe(a.ke!.han.toISOString());
    expect(a.ke!.startedAt.toISOString()).toBe("2026-08-14T17:00:00.000Z"); // 15/08/2026 00:00 VN
    expect(a.ke).toMatchObject({ hanhDong: "TAO_MOI", quaHan: false, chuyenGhiDanhSangPaused: false });
  });

  it("[BL8-LG-04] hạn đã QUA ⇒ vẫn lập được nhưng CẢNH BÁO có số ngày + nói trước hệ quả cron", () => {
    const r = lapKeHoachCa(CA_B, ST_B, { ...BOI, effectiveDate: "2026-01-01" }); // hạn 01/07/2026
    expect(r.loi).toEqual([]);
    expect(r.ke).toMatchObject({ quaHan: true, soNgayQuaHan: 99 });
    expect(r.canhBao.join(" ")).toMatch(/QUA 99 ngày.*cron/);
  });

  it("[BL8-LG-05] thiếu đơn / khoá tệp sai hình dạng / ngày bắt đầu sai hoặc ở tương lai ⇒ chặn; hôm nay thì được", () => {
    expect(lapKeHoachCa({ ...CA_B, applicationFileKey: null }, ST_B, BOI).loi.join(" ")).toMatch(/Thiếu đơn/);
    expect(lapKeHoachCa({ ...CA_B, applicationFileKey: "hoa-don/x.pdf" }, ST_B, BOI).loi.join(" ")).toMatch(/Khoá tệp/);
    expect(lapKeHoachCa({ ...CA_B, ngayBatDau: "2026-02-31" }, ST_B, BOI).loi.join(" ")).toMatch(/Ngày bắt đầu nghỉ thực tế không hợp lệ/);
    expect(lapKeHoachCa({ ...CA_B, ngayBatDau: "2026-10-09" }, ST_B, BOI).loi.join(" ")).toMatch(/tương lai/);
    expect(lapKeHoachCa({ ...CA_B, ngayBatDau: "2026-10-08" }, ST_B, BOI).loi).toEqual([]);
  });

  it("[BL8-LG-06] cờ cơ sở TẮT ⇒ chặn", () => {
    expect(lapKeHoachCa(CA_B, { ...ST_B, flagBat: false }, BOI).loi.join(" ")).toMatch(/chưa bật bảo lưu/);
  });

  it("[BL8-LG-07] nhóm B: ghi danh phải đang PAUSED và chưa có hồ sơ mở phủ; nhóm C: phải đang học và CHUYỂN sang PAUSED; sai trạng thái ⇒ chặn", () => {
    expect(lapKeHoachCa(CA_B, { ...ST_B, enrollment: { ...ST_B.enrollment!, status: "ACTIVE" } }, BOI).loi.join(" ")).toMatch(/không ở trạng thái Tạm dừng/);
    expect(lapKeHoachCa(CA_B, { ...ST_B, daCoHoSoMoPhu: true }, BOI).loi.join(" ")).toMatch(/đã có hồ sơ bảo lưu đang mở/);
    const c = lapKeHoachCa(CA_C, ST_C, BOI);
    expect(c.loi).toEqual([]);
    expect(c.ke).toMatchObject({ chuyenGhiDanhSangPaused: true });
    expect(c.canhBao.join(" ")).toMatch(/chuyển sang Tạm dừng/);
    expect(lapKeHoachCa(CA_C, ST_B, BOI).loi.join(" ")).toMatch(/không còn ở trạng thái đang học/); // đã PAUSED thì không phải nhóm C
  });

  it("[BL8-LG-08] nhóm A: dòng phải CÒN MỞ, chưa duyệt theo quy chế, đúng học viên; dòng cả-học-viên bắt buộc chọn ghi danh; đã duyệt rồi thì KHÔNG nhập lại", () => {
    const ok = lapKeHoachCa(CA_A, ST_A, BOI);
    expect(ok.loi).toEqual([]);
    expect(ok.ke).toMatchObject({ hanhDong: "CAP_NHAT_DONG_CU", enrollmentId: "gd1" });
    expect(lapKeHoachCa({ ...CA_A, enrollmentId: null }, ST_A, BOI).loi.join(" ")).toMatch(/chưa gắn ghi danh/);
    expect(lapKeHoachCa(CA_A, { ...ST_A, reserve: { ...ST_A.reserve!, approvedAt: NOW } }, BOI).loi.join(" ")).toMatch(/đã được xử lý theo quy chế/);
    expect(lapKeHoachCa(CA_A, { ...ST_A, reserve: { ...ST_A.reserve!, endedAt: NOW } }, BOI).loi.join(" ")).toMatch(/đã kết thúc/);
    expect(lapKeHoachCa(CA_A, { ...ST_A, reserve: { ...ST_A.reserve!, studentId: "hv-khac" } }, BOI).loi.join(" ")).toMatch(/không thuộc học viên/);
    expect(lapKeHoachCa({ ...CA_A, enrollmentId: "gd-khac" }, { ...ST_A, reserve: { ...ST_A.reserve!, enrollmentId: "gd1" } }, BOI).loi.join(" ")).toMatch(/ghi danh khác/);
    expect(lapKeHoachCa({ ...CA_A, reserveId: "r-khac" }, ST_A, BOI).loi.join(" ")).toMatch(/Không tìm thấy dòng/);
  });

  it("[BL8-LG-09] LEGACY tính là MỘT lần dùng: ghi danh đã hết lượt ⇒ CẢNH BÁO (không chặn); khoá tắt allowPause ⇒ cảnh báo", () => {
    const r = lapKeHoachCa(CA_B, { ...ST_B, soLanDaDung: 1 }, BOI);
    expect(r.loi).toEqual([]);
    expect(r.canhBao.join(" ")).toMatch(/1\/1 lần.*Q3/);
    expect(lapKeHoachCa(CA_B, { ...ST_B, enrollment: { ...ST_B.enrollment!, khoaChoPhepBaoLuu: false } }, BOI).canhBao.join(" ")).toMatch(/allowPause/);
  });

  it("[BL8-LG-10] lô: rỗng / quá trần / hai ca cùng ghi danh ⇒ lỗi cấp lô", () => {
    expect(kiemLo([])).toEqual(["Chưa chọn ca nào."]);
    expect(kiemLo(Array.from({ length: TRAN_CA_MOI_LUOT + 1 }, (_, i) => ({ ...CA_B, enrollmentId: `g${i}` })))).toEqual([`Mỗi lượt nhập tối đa ${TRAN_CA_MOI_LUOT} ca.`]);
    expect(kiemLo([CA_B, { ...CA_C }])).toEqual(["Có hai ca cùng một ghi danh trong lượt nhập."]);
    expect(kiemLo([CA_B, { ...CA_B, enrollmentId: "gd2" }])).toEqual([]);
  });
});
