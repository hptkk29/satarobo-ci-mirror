// @vitest-environment node
/** [LGT-*] Chi tiết lượt giao — thống kê đầu màn + avatar (thuần). */
import { describe, expect, it } from "vitest";
import { chuCaiDau, thongKeLuotGiao } from "./luot-giao-thong-ke";

const d = (...status: string[]) => status.map((s) => ({ status: s }));

describe("[LGT-01] thongKeLuotGiao", () => {
  it("🔴 đếm đúng từng nhóm; hoàn thành trễ thuộc 'Đã xong' (không đếm hai lần); quá hạn chưa xong là 'Trễ'", () => {
    const r = thongKeLuotGiao(d("COMPLETED", "COMPLETED_LATE", "OVERDUE", "OVERDUE", "OVERDUE", "REVOKED", "IN_PROGRESS", "NOT_STARTED"));
    expect(r).toEqual({ daXong: 2, tre: 3, thuHoi: 1, conLai: 2, tong: 8 });
  });
  it("tổng các phần luôn bằng tổng số dòng (không có con số nào mồ côi); danh sách rỗng ⇒ toàn 0", () => {
    const x = thongKeLuotGiao(d("COMPLETED", "REVOKED", "LA", "NOT_STARTED"));
    expect(x.daXong + x.tre + x.thuHoi + x.conLai).toBe(x.tong);
    expect(thongKeLuotGiao([])).toEqual({ daXong: 0, tre: 0, thuHoi: 0, conLai: 0, tong: 0 });
  });
});

describe("[LGT-02] chuCaiDau", () => {
  it("họ + tên cuối, in hoa theo tiếng Việt; một từ ⇒ một chữ; rỗng ⇒ ?", () => {
    expect(chuCaiDau("Đặng Quốc Bảo")).toBe("ĐB");
    expect(chuCaiDau("trần mai anh")).toBe("TA");
    expect(chuCaiDau("An")).toBe("A");
    expect(chuCaiDau("   ")).toBe("?");
  });
});
