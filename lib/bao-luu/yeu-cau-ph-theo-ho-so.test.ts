// [YCP-*] Yêu cầu bảo lưu của phụ huynh đi THEO hồ sơ: trạng thái + câu chữ (vòng 3). Ngày TUYỆT ĐỐI (luật 19).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buocYeuCauTheoHoSo, CHU_CHUA_CO_LICH_HOC_LAI, CHU_DA_XU_LY_CHUNG } from "@/lib/bao-luu/yeu-cau-ph-theo-ho-so";

const now = new Date("2026-10-12T03:00:00Z");
const bd = new Date("2026-10-13T00:00:00+07:00");
const kt = new Date("2027-01-13T00:00:00+07:00");
const buoiDau = new Date("2026-10-17T14:00:00+07:00"); // thứ Bảy — KHÁC ngày bấm phục học (12/10)
const goc = { now, startedAt: bd, standardEndDate: kt, buoiDauLopMoi: buoiDau };

describe("[YCP] yêu cầu phụ huynh theo hồ sơ", () => {
  it("[YCP-01] duyệt ⇒ APPROVED + 'Đã duyệt bảo lưu từ dd/mm/yyyy đến dd/mm/yyyy'", () => {
    expect(buocYeuCauTheoHoSo({ ...goc, kind: "APPROVE", den: "APPROVED" })).toEqual({ status: "APPROVED", response: "Đã duyệt bảo lưu từ 13/10/2026 đến 13/01/2027" });
  });
  it("[YCP-02] từ chối / huỷ ⇒ REJECTED / CANCELLED + câu chung, KHÔNG có lý do nội bộ", () => {
    expect(buocYeuCauTheoHoSo({ ...goc, kind: "REJECT", den: "REJECTED" })).toEqual({ status: "REJECTED", response: CHU_DA_XU_LY_CHUNG });
    expect(buocYeuCauTheoHoSo({ ...goc, kind: "CANCEL", den: "CANCELLED" })).toEqual({ status: "CANCELLED", response: CHU_DA_XU_LY_CHUNG });
    expect(CHU_DA_XU_LY_CHUNG).toBe("Trung tâm đã xử lý yêu cầu, nhân viên sẽ liên hệ phụ huynh.");
  });
  it("[YCP-03] phục học (RESUME → ENDED) ⇒ 'Đã xếp lớp học lại từ dd/mm/yyyy' = NGÀY BUỔI ĐẦU của lớp đích (giờ VN), KHÔNG phải ngày bấm phục học", () => {
    const r = buocYeuCauTheoHoSo({ ...goc, kind: "RESUME", den: "ENDED" });
    expect(r).toEqual({ status: "APPROVED", response: "Đã xếp lớp học lại từ 17/10/2026" });
    expect(r?.response).not.toContain("12/10/2026"); // ngày bấm (vòng 3) — đã bỏ
  });
  it("[YCP-03b] buổi đầu lúc 00:30 giờ VN (17:30 UTC hôm trước) vẫn in ĐÚNG ngày VN, không lùi một ngày", () => {
    const r = buocYeuCauTheoHoSo({ ...goc, kind: "RESUME", den: "ENDED", buoiDauLopMoi: new Date("2026-10-16T17:30:00Z") });
    expect(r?.response).toBe("Đã xếp lớp học lại từ 17/10/2026");
  });
  it("[YCP-03c] lớp đích chưa có lịch (null) ⇒ 'Trung tâm sẽ báo lịch học lại' — không bịa ngày, vẫn APPROVED", () => {
    expect(buocYeuCauTheoHoSo({ ...goc, kind: "RESUME", den: "ENDED", buoiDauLopMoi: null })).toEqual({ status: "APPROVED", response: CHU_CHUA_CO_LICH_HOC_LAI });
    expect(CHU_CHUA_CO_LICH_HOC_LAI).toBe("Trung tâm sẽ báo lịch học lại");
  });
  it("[YCP-04] các bước còn lại KHÔNG đụng vào yêu cầu (START sau APPROVE, nhắc, gia hạn, chấm dứt, báo phục học)", () => {
    for (const [kind, den] of [["START", "ACTIVE"], ["RESUME_REQUEST", "RESUME_PENDING"], ["EXTEND", "ACTIVE"], ["EXPIRE", "OVERDUE"], ["TERMINATE", "ENDED"], ["TERMINATE", "TERMINATED"]] as const) {
      expect(buocYeuCauTheoHoSo({ ...goc, kind, den })).toBeNull();
    }
  });
  it("[YCP-05] duyệt mà thiếu ngày ⇒ không ghi câu thiếu ngày (null)", () => {
    expect(buocYeuCauTheoHoSo({ ...goc, kind: "APPROVE", den: "APPROVED", standardEndDate: null })).toBeNull();
  });
});

describe("[YCP-W] dây nối: chuyenTrangThai gọi đồng bộ trong CÙNG transaction", () => {
  const src = readFileSync(resolve(process.cwd(), "lib/bao-luu/chuyen-trang-thai.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("[YCP-W1] chuyenTrangThai gọi dongBoYeuCauPhuHuynh(tx, …) 1 lần, sau phép ghi hồ sơ, và hàm ghi parentRequest bằng tx", () => {
    expect(src.match(/await dongBoYeuCauPhuHuynh\(tx,/g)).toHaveLength(1);
    expect(src.indexOf("await dongBoYeuCauPhuHuynh(tx,")).toBeGreaterThan(src.indexOf("await tx.studentReserve.updateMany("));
    expect(src.match(/tx\.parentRequest\.updateMany\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/\bdb\.parentRequest/);
  });
});
