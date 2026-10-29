// @vitest-environment node
// lib/ai-lead/dich-vu/tinh-ho-so.test.ts — TRẠNG THÁI HỒ SƠ do Gateway tính (design §4.1). THUẦN.
// Mã ca: [AIL-HS-01..]
import { describe, expect, it } from "vitest";
import { canNguoiXuLy, coTheTinhLai, danhSachThieu, TRANG_THAI_DONG, tinhHanSla, tinhTrangThaiThuThap } from "./tinh-ho-so";
import type { ThieuDieuKien } from "./dieu-kien";
import type { OwnerState } from "../kieu";

const T = (...x: ThieuDieuKien[]) => x;
const NHOM: OwnerState[] = ["AI_ACTIVE", "HANDOFF_REQUESTED", "TAKEOVER_PENDING", "HUMAN_ACTIVE", "PAUSED"];

describe("[AIL-HS-01] tinhTrangThaiThuThap", () => {
  it.each(NHOM)("đủ điều kiện ⇒ READY_FOR_REVIEW (ownerState %s)", (o) => {
    expect(tinhTrangThaiThuThap({ thieu: T(), ownerState: o })).toBe("READY_FOR_REVIEW");
  });
  // `it.each` SPREAD mỗi phần tử mảng thành đối số ⇒ phải bọc trong một mảng nữa, nếu không `thieu` chỉ là phần tử đầu (đã gặp: ca xanh vì lý do sai).
  it.each([[T("phone")], [T("campus")], [T("phone", "campus")], [T("phone", "fbName")], [T("campus", "fbName")], [T("phone", "campus", "fbName")]])(
    "thiếu thứ KHÁCH cung cấp được %j: AI còn giữ ⇒ COLLECTING",
    (thieu) => {
      expect(Array.isArray(thieu)).toBe(true);
      expect(tinhTrangThaiThuThap({ thieu, ownerState: "AI_ACTIVE" })).toBe("COLLECTING");
    },
  );
  it.each([[T("phone")], [T("campus")], [T("phone", "fbName")]])("thiếu thứ khách cung cấp được %j: đã giao người ⇒ PENDING_INFO", (thieu) => {
    for (const o of NHOM.filter((x) => x !== "AI_ACTIVE")) expect(tinhTrangThaiThuThap({ thieu, ownerState: o })).toBe("PENDING_INFO");
  });
  it.each(NHOM)("CHỈ thiếu tên Facebook (khách không cung cấp được) ⇒ WAITING_QLCS bất kể ownerState (%s)", (o) => {
    expect(tinhTrangThaiThuThap({ thieu: T("fbName"), ownerState: o })).toBe("WAITING_QLCS");
  });
});

describe("[AIL-HS-02] Gateway chỉ đổi state khi hồ sơ ở bốn trạng thái thu thập — KHÔNG kéo công việc của người lùi lại", () => {
  it.each(["COLLECTING", "PENDING_INFO", "WAITING_QLCS", "READY_FOR_REVIEW"])("%s tính lại được", (s) => expect(coTheTinhLai(s)).toBe(true));
  it.each(["IN_PROGRESS", "COMPLETED", "REJECTED", "EXPIRED", "SYSTEM_EXCEPTION", "ASSIGNMENT_PENDING"])("%s KHÔNG tính lại", (s) =>
    expect(coTheTinhLai(s)).toBe(false),
  );
  it("COLLECTING chưa cần người; ba trạng thái còn lại cần người", () => {
    expect(["COLLECTING", "PENDING_INFO", "WAITING_QLCS", "READY_FOR_REVIEW"].map(canNguoiXuLy)).toEqual([false, true, true, true]);
  });
  it("hồ sơ 'đóng' khớp ba trạng thái cuối của design §0 mục 6", () => {
    expect([...TRANG_THAI_DONG]).toEqual(["COMPLETED", "REJECTED", "EXPIRED", "ASSIGNMENT_PENDING"]);
  });
});

describe("[AIL-HS-03] hạn SLA tính từ now theo tham số; missingFields thứ tự cố định", () => {
  it("now + phút", () => {
    const now = new Date("2026-10-27T03:00:00.000Z");
    const h = tinhHanSla(now, { slaClaimMinutes: 30, slaResolveMinutes: 240 });
    expect(h.slaClaimDueAt.toISOString()).toBe("2026-10-27T03:30:00.000Z");
    expect(h.slaResolveDueAt.toISOString()).toBe("2026-10-27T07:00:00.000Z");
  });
  it("không đọc đồng hồ: cùng đầu vào ⇒ cùng kết quả", () => {
    const now = new Date(0);
    expect(tinhHanSla(now, { slaClaimMinutes: 1, slaResolveMinutes: 2 })).toEqual(tinhHanSla(now, { slaClaimMinutes: 1, slaResolveMinutes: 2 }));
  });
  it("danhSachThieu: thứ tự phone, campus, fbName bất kể thứ tự vào", () => {
    expect(danhSachThieu(T("fbName", "campus", "phone"))).toEqual(["phone", "campus", "fbName"]);
    expect(danhSachThieu(T())).toEqual([]);
  });
});
