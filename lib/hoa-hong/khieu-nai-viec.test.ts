// @vitest-environment node
/**
 * [NHH-DSP-V*] — `viecDuocLam` (THUẦN). Bảng viết TAY theo 04 §15: ai được làm gì ở trạng thái nào. Bản so với service THẬT nằm ở
 * `tests/hoa-hong/khieu-nai-viec.spec.ts` (Postgres) — bảng này một mình không chứng minh nút không nói dối.
 */
import { describe, it, expect } from "vitest";

import { viecDuocLam, type ViecDuocLam, type VeKhieuNai } from "./khieu-nai-viec";
import { TRANG_THAI_KHIEU_NAI } from "./khieu-nai-trang-thai";

const KN = "u-khieu-nai";
const HR = "u-hr";
const HR2 = "u-hr2";
const ve = (p: Partial<VeKhieuNai> = {}): VeKhieuNai => ({ status: "OPEN", raisedByUserId: KN, assignedToUserId: null, resolution: null, ...p });
const khong: ViecDuocLam = { nhan: false, nhanLai: false, giao: false, quyet: false, dongDoiNguon: false };

describe("[NHH-DSP-V1] viecDuocLam", () => {
  it("không giữ quyền duyệt ⇒ KHÔNG việc nào, ở MỌI trạng thái (đối chứng của các ca dưới)", () => {
    for (const status of TRANG_THAI_KHIEU_NAI) {
      expect(viecDuocLam({ userId: HR, coQuyenDuyet: false }, ve({ status, assignedToUserId: HR })), status).toEqual(khong);
    }
  });

  it("người khiếu nại giữ quyền duyệt (HR tự khiếu nại) ⇒ KHÔNG việc nào, ở MỌI trạng thái", () => {
    for (const status of TRANG_THAI_KHIEU_NAI) {
      expect(viecDuocLam({ userId: KN, coQuyenDuyet: true }, ve({ status, assignedToUserId: KN, resolution: "SOURCE_CORRECTION" })), status).toEqual(khong);
    }
  });

  it("OPEN: chỉ NHẬN", () => {
    expect(viecDuocLam({ userId: HR, coQuyenDuyet: true }, ve())).toEqual({ ...khong, nhan: true });
  });

  it("UNDER_REVIEW do MÌNH xử lý: giao + quyết; do NGƯỜI KHÁC xử lý: chỉ nhận lại (không quyết)", () => {
    expect(viecDuocLam({ userId: HR, coQuyenDuyet: true }, ve({ status: "UNDER_REVIEW", assignedToUserId: HR }))).toEqual({ ...khong, giao: true, quyet: true });
    expect(viecDuocLam({ userId: HR2, coQuyenDuyet: true }, ve({ status: "UNDER_REVIEW", assignedToUserId: HR }))).toEqual({ ...khong, nhanLai: true });
  });

  it("APPROVED: chỉ cách 'sửa nguồn' mới có việc đóng; 'điều chỉnh tiền' hệ thống đã đóng sẵn nên không có nút", () => {
    expect(viecDuocLam({ userId: HR, coQuyenDuyet: true }, ve({ status: "APPROVED", assignedToUserId: HR, resolution: "SOURCE_CORRECTION" }))).toEqual({ ...khong, dongDoiNguon: true });
    expect(viecDuocLam({ userId: HR, coQuyenDuyet: true }, ve({ status: "APPROVED", assignedToUserId: HR, resolution: "MONEY_ADJUSTMENT" }))).toEqual(khong);
  });

  it("REJECTED · CLOSED ⇒ không việc nào", () => {
    for (const status of ["REJECTED", "CLOSED"] as const) {
      expect(viecDuocLam({ userId: HR, coQuyenDuyet: true }, ve({ status, assignedToUserId: HR })), status).toEqual(khong);
    }
  });
});
