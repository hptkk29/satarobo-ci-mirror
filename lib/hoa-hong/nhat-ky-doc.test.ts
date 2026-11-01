/** [NHH-DSP-NK-L*] — chữ của nhật ký (THUẦN): mã kỹ thuật thành chữ người đọc; mã lạ in nguyên (không đoán); PII bị che. */
import { describe, expect, it } from "vitest";

import { dungThayDoi } from "./nhat-ky-doc";

describe("[NHH-DSP-NK-L1] dungThayDoi", () => {
  it("mã nhóm nguồn → tên nhóm; loại người giới thiệu → chữ; mã nhóm LẠ in nguyên mã", () => {
    const t = dungThayDoi({ nhom: "PAID_ADS", referrerKind: "PARENT" }, { nhom: "PARENT_REFERRAL", referrerKind: "EMPLOYEE" }, ["nhom", "referrerKind"], "Lead");
    expect(t).toEqual([
      { truong: "Nguồn", cu: "Nguồn từ Quảng Cáo", moi: "Nguồn từ phụ huynh giới thiệu" },
      { truong: "Loại người giới thiệu", cu: "Phụ huynh", moi: "Nhân sự" },
    ]);
    expect(dungThayDoi({ nhom: "X_LA" }, { nhom: "Y_LA" }, ["nhom"], "Lead")).toEqual([{ truong: "Nguồn", cu: "X_LA", moi: "Y_LA" }]);
  });

  it("trạng thái của khiếu nại/kỳ → chữ Việt; trường id/hash bị ẩn; cặp không đổi bị bỏ", () => {
    expect(dungThayDoi({ status: "UNDER_REVIEW" }, { status: "APPROVED", dongDieuChinhId: "abc" }, ["status", "dongDieuChinhId"], "CommissionDispute")).toEqual([
      { truong: "Trạng thái", cu: "Đang xem xét", moi: "Đã duyệt" },
    ]);
    expect(dungThayDoi({ status: "OPEN" }, { status: "OPEN" }, ["status"], "CommissionDispute")).toEqual([]);
  });

  it("giá trị cũ rỗng (mục TẠO) in '—' ở phía cũ để giao diện bỏ mũi tên", () => {
    expect(dungThayDoi(null, { status: "OPEN" }, ["status"], "CommissionDispute")).toEqual([{ truong: "Trạng thái", cu: "—", moi: "Mới tiếp nhận" }]);
  });
});
