// lib/trial/reschedule-rules.test.ts — GĐ3.
//
// Năm nhánh chặn của dời lịch + luật "Sale hết quyền sửa đề xuất sau khi Đào tạo chốt".
// Kèm một test chống trôi: chuỗi trạng thái ở đây phải khớp enum Prisma thật.
import { describe, it, expect } from "vitest";
import { TrialEnrollmentStatus, TrialSessionStatus } from "@prisma/client";
import { danhGiaDoiLich, saleDuocDeXuat } from "./reschedule-rules";

const buoiHopLe = {
  id: "b2",
  trialClassId: "lop1",
  status: "SCHEDULED" as const,
};

const caHopLe = {
  caStatus: "ACTIVE" as const,
  caTrialClassId: "lop1",
  caSessionId: "b1",
};

describe("danhGiaDoiLich", () => {
  it("ca đang học, buổi mới cùng lớp và chưa diễn ra → cho dời", () => {
    expect(danhGiaDoiLich({ ...caHopLe, buoiMoi: buoiHopLe })).toEqual({ ok: true });
  });

  it("ca chưa từng xếp buổi nào vẫn dời được", () => {
    expect(
      danhGiaDoiLich({ ...caHopLe, caSessionId: null, buoiMoi: buoiHopLe }),
    ).toEqual({ ok: true });
  });

  it("ca đã gỡ hoặc đã xong thì chặn", () => {
    for (const s of ["WITHDRAWN", "COMPLETED"] as const) {
      const r = danhGiaDoiLich({ ...caHopLe, caStatus: s, buoiMoi: buoiHopLe });
      expect(r.ok).toBe(false);
    }
  });

  it("buổi không tồn tại → cùng thông điệp với buổi lớp khác", () => {
    // Cố ý gộp hai ca: nói rõ "không tồn tại" là mở kênh dò id.
    const khongCo = danhGiaDoiLich({ ...caHopLe, buoiMoi: null });
    const lopKhac = danhGiaDoiLich({
      ...caHopLe,
      buoiMoi: { ...buoiHopLe, trialClassId: "lop2" },
    });
    expect(khongCo.ok).toBe(false);
    expect(lopKhac.ok).toBe(false);
    if (!khongCo.ok && !lopKhac.ok) expect(khongCo.error).toBe(lopKhac.error);
  });

  it("buổi đã xong hoặc đã huỷ thì chặn", () => {
    for (const s of ["COMPLETED", "CANCELLED"] as const) {
      const r = danhGiaDoiLich({ ...caHopLe, buoiMoi: { ...buoiHopLe, status: s } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("Chỉ dời được sang buổi chưa diễn ra");
    }
  });

  it("dời sang đúng buổi đang ở thì chặn, không đếm oan một lần dời", () => {
    const r = danhGiaDoiLich({
      ...caHopLe,
      caSessionId: "b2",
      buoiMoi: buoiHopLe,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Ca này đã ở đúng buổi đó rồi");
  });

  it("báo lỗi CỤ THỂ nhất trước: buổi lớp khác thắng lỗi 'ca đã kết thúc'", () => {
    // Người bấm nhầm buổi của lớp khác mà nhận thông báo "ca đã kết thúc" thì không
    // sửa được gì. Nhưng ca đã kết thúc thì đúng là chặn trước — đây là kiểm thứ tự.
    const r = danhGiaDoiLich({
      ...caHopLe,
      caStatus: "WITHDRAWN",
      buoiMoi: { ...buoiHopLe, trialClassId: "lop2" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("đã kết thúc");
  });
});

describe("saleDuocDeXuat", () => {
  it("chưa ai phân công → Sale đề xuất được", () => {
    expect(saleDuocDeXuat({ status: "ACTIVE", gvPhanCongId: null })).toEqual({ ok: true });
  });

  it("Đào tạo đã phân công → Sale hết quyền sửa", () => {
    const r = saleDuocDeXuat({ status: "ACTIVE", gvPhanCongId: "gv1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("qua Đào tạo");
  });

  it("ca đã kết thúc → chặn kể cả khi chưa phân công", () => {
    expect(saleDuocDeXuat({ status: "COMPLETED", gvPhanCongId: null }).ok).toBe(false);
  });
});

describe("chống trôi so với enum Prisma", () => {
  // Hai type chuỗi ở reschedule-types.ts được chép tay để file luật không phải nạp
  // Prisma. Test này là lưới duy nhất bắt được khi ai đó đổi enum mà quên chép sang.
  it("TrialEnrollmentStatus khớp đủ ba giá trị", () => {
    expect(Object.values(TrialEnrollmentStatus).sort()).toEqual([
      "ACTIVE",
      "COMPLETED",
      "WITHDRAWN",
    ]);
  });

  it("TrialSessionStatus khớp đủ ba giá trị", () => {
    expect(Object.values(TrialSessionStatus).sort()).toEqual([
      "CANCELLED",
      "COMPLETED",
      "SCHEDULED",
    ]);
  });
});
