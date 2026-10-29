// lib/crm/commission-assignee.test.ts — AI hưởng QC 1% và Quản lý TT 2% (chốt 27/08/2026).
//
// Viết TRƯỚC phần hiện thực (luật cứng Nền Hệ thống #5). Đây là chỗ một dòng sai
// làm tiền thật chảy sang tài khoản khác mà con số tổng vẫn "đẹp", nên mọi luật đều
// có ca kiểm riêng: biên hiệu lực, nhiều người chia đều, và ca chưa khai người hưởng.
import { describe, it, expect } from "vitest";
import {
  nguoiHuongHieuLuc,
  VAI_HOA_HONG_CO_SO,
  type PhanCongCoSo,
} from "./commission-assignee";

const CS1 = "center-1";
const CS2 = "center-2";

function pc(patch: Partial<PhanCongCoSo> = {}): PhanCongCoSo {
  return {
    centerId: CS1,
    role: "QC",
    userId: "u-qc-a",
    effectiveFrom: new Date("2026-01-01T00:00:00+07:00"),
    effectiveTo: null,
    ...patch,
  };
}

describe("nguoiHuongHieuLuc — biên hiệu lực theo thời gian", () => {
  it("lấy đúng người đang phụ trách tại thời điểm hỏi", () => {
    const rows = [pc()];
    expect(nguoiHuongHieuLuc(rows, CS1, "QC", new Date("2026-08-15T10:00:00+07:00"))).toEqual([
      "u-qc-a",
    ]);
  });

  it("HỎI TRƯỚC ngày bắt đầu → chưa ai phụ trách (không suy ngược lịch sử)", () => {
    // Khai người phụ trách hôm nay KHÔNG được biến thành "đã phụ trách từ đầu năm":
    // chốt lại kỳ tháng 3 sẽ đẻ ra hoa hồng cho người tháng 3 chưa nhận việc.
    const rows = [pc({ effectiveFrom: new Date("2026-08-01T00:00:00+07:00") })];
    expect(nguoiHuongHieuLuc(rows, CS1, "QC", new Date("2026-07-31T23:00:00+07:00"))).toEqual([]);
  });

  it("biên PHẢI MỞ: người cũ kết thúc đúng lúc người mới bắt đầu ⇒ KHÔNG ai được tính hai lần", () => {
    // Đây là bẫy y hệt `khoangKy` (biên `lt` chứ không `lte`). Nếu cả hai cùng khớp
    // tại đúng thời khắc bàn giao thì 1% bị chia đôi cho hai người ở một bút toán
    // rơi trúng nửa đêm — sai âm thầm và không tái hiện được.
    const BAN_GIAO = new Date("2026-08-01T00:00:00+07:00");
    const rows = [
      pc({ userId: "u-cu", effectiveTo: BAN_GIAO }),
      pc({ userId: "u-moi", effectiveFrom: BAN_GIAO }),
    ];
    expect(nguoiHuongHieuLuc(rows, CS1, "QC", BAN_GIAO)).toEqual(["u-moi"]);
    expect(
      nguoiHuongHieuLuc(rows, CS1, "QC", new Date(BAN_GIAO.getTime() - 1)),
    ).toEqual(["u-cu"]);
  });

  it("đổi người phụ trách KHÔNG viết lại lịch sử — hỏi ngày cũ vẫn ra người cũ", () => {
    const rows = [
      pc({ userId: "u-cu", effectiveTo: new Date("2026-08-01T00:00:00+07:00") }),
      pc({ userId: "u-moi", effectiveFrom: new Date("2026-08-01T00:00:00+07:00") }),
    ];
    expect(nguoiHuongHieuLuc(rows, CS1, "QC", new Date("2026-07-10T09:00:00+07:00"))).toEqual([
      "u-cu",
    ]);
  });
});

describe("nguoiHuongHieuLuc — lọc đúng cơ sở và đúng vai", () => {
  it("không lẫn cơ sở", () => {
    const rows = [pc({ centerId: CS1, userId: "u-cs1" }), pc({ centerId: CS2, userId: "u-cs2" })];
    expect(nguoiHuongHieuLuc(rows, CS2, "QC", new Date("2026-08-15T10:00:00+07:00"))).toEqual([
      "u-cs2",
    ]);
  });

  it("không lẫn vai — QC và Quản lý TT là hai tầng tiền khác nhau", () => {
    const rows = [pc({ role: "QC", userId: "u-qc" }), pc({ role: "QL_TT", userId: "u-ql" })];
    const at = new Date("2026-08-15T10:00:00+07:00");
    expect(nguoiHuongHieuLuc(rows, CS1, "QC", at)).toEqual(["u-qc"]);
    expect(nguoiHuongHieuLuc(rows, CS1, "QL_TT", at)).toEqual(["u-ql"]);
  });

  it("bút toán KHÔNG rõ cơ sở (centerId null) → không gán bừa cho ai", () => {
    expect(nguoiHuongHieuLuc([pc()], null, "QC", new Date("2026-08-15T10:00:00+07:00"))).toEqual(
      [],
    );
  });

  it("cơ sở chưa khai người hưởng → mảng rỗng (tiền treo, KHÔNG rơi sang cơ sở khác)", () => {
    expect(
      nguoiHuongHieuLuc([pc({ centerId: CS1 })], CS2, "QC", new Date("2026-08-15T10:00:00+07:00")),
    ).toEqual([]);
  });
});

describe("nguoiHuongHieuLuc — nhiều người và tính TẤT ĐỊNH", () => {
  it("một cơ sở nhiều QC cùng hiệu lực → trả ĐỦ danh sách (engine chia đều)", () => {
    const rows = [pc({ userId: "u-b" }), pc({ userId: "u-a" })];
    expect(nguoiHuongHieuLuc(rows, CS1, "QC", new Date("2026-08-15T10:00:00+07:00"))).toEqual([
      "u-a",
      "u-b",
    ]);
  });

  it("thứ tự trả về ỔN ĐỊNH (sắp theo userId) — chốt lại kỳ phải ra bảng kê trùng khít", () => {
    const at = new Date("2026-08-15T10:00:00+07:00");
    const xuoi = nguoiHuongHieuLuc([pc({ userId: "u-a" }), pc({ userId: "u-b" })], CS1, "QC", at);
    const nguoc = nguoiHuongHieuLuc([pc({ userId: "u-b" }), pc({ userId: "u-a" })], CS1, "QC", at);
    expect(xuoi).toEqual(nguoc);
  });

  it("một người có HAI dòng chồng lấn → chỉ tính MỘT suất (không ăn đôi)", () => {
    // Nhập tay hai lần cho cùng một người là chuyện sẽ xảy ra. Không khử trùng ở đây
    // thì người đó nhận 2/3 của 1% thay vì 1/2 — sai theo hướng mất tiền công ty.
    const rows = [
      pc({ userId: "u-a", effectiveFrom: new Date("2026-01-01T00:00:00+07:00") }),
      pc({ userId: "u-a", effectiveFrom: new Date("2026-03-01T00:00:00+07:00") }),
      pc({ userId: "u-b" }),
    ];
    expect(nguoiHuongHieuLuc(rows, CS1, "QC", new Date("2026-08-15T10:00:00+07:00"))).toEqual([
      "u-a",
      "u-b",
    ]);
  });
});

describe("VAI_HOA_HONG_CO_SO", () => {
  it("đúng HAI vai, và tên vai TRÙNG KHỚP tên tầng hoa hồng", () => {
    // Trùng tên là có chủ đích: `commission-run` ánh xạ vai → tầng bằng chính chuỗi
    // đó. Đổi một bên mà quên bên kia là tiền rơi vào tầng sai.
    expect([...VAI_HOA_HONG_CO_SO]).toEqual(["QC", "QL_TT"]);
  });
});
