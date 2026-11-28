import { describe, expect, it, vi } from "vitest";

/**
 * [LT] `GET /students/:id/schedule?month=YYYY-MM` (lịch THÁNG, B4) + chi tiết buổi — trước V8.24 KHÔNG có test nào và KHÔNG có trong tài liệu bàn giao (B ghi «chưa có nguồn dữ liệu tháng»).
 * Mock ba nguồn của web; kiểm: tham số tháng, nhóm buổi theo GIỜ VIỆT NAM (buổi 23:30 cuối tháng không rơi sang tháng sau), thứ tự, ánh xạ trạng thái, null khi nguồn thiếu, 404 đồng nhất khi buổi không thuộc học viên.
 *   [LT-01] docThang: chỉ YYYY-MM hợp lệ (01–12, năm 2000–2100); rác ⇒ null
 *   [LT-02] layLichThang: lưới chuyển nguyên; buổi lọc theo THÁNG GIỜ VN (UTC 16:30 ngày 30/11 = 23:30 VN ⇒ THÁNG 11; UTC 17:30 = 00:30 VN ngày 01/12 ⇒ THÁNG 12), sắp theo ngày rồi số buổi
 *   [LT-03] trạng thái buổi ánh xạ đủ 7 giá trị nguồn, không bịa trạng thái «đổi lịch»; tên «Buổi học» chung ⇒ chuỗi rỗng
 *   [LT-04] layChiTietBuoi: buổi không thuộc học viên ⇒ null (route trả 404); buổi đã qua ⇒ gio/phong/giaoVien null; buổi sắp tới lấy từ lịch; coNhanXet đúng
 */
const mock = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  sched: null as unknown,
  phieu: [] as Array<{ classSessionId: string }>,
}));
vi.mock("@/lib/portal/hanh-trinh", () => ({
  getHanhTrinh: vi.fn(async (_hs: string, o: { y: number; m0: number }) => ({
    lich: { nhanThang: `Tháng ${o.m0 + 1}/${o.y}`, y: o.y, m0: o.m0, truoc: { y: o.y, m0: o.m0 - 1 }, sau: { y: o.y, m0: o.m0 + 1 }, o: [{ key: `${o.y}-${o.m0 + 1}-01`, ngay: 1, trongThang: true, homNay: false, kieu: "xong", thua: "bi-loai" }], conLaiTrongKhoa: 6 },
  })),
}));
vi.mock("@/lib/portal/student-sessions", () => ({ getStudentSessionsView: vi.fn(async () => ({ sessions: mock.sessions })) }));
vi.mock("@/lib/portal/schedule", () => ({ getStudentSchedule: vi.fn(async () => mock.sched) }));
vi.mock("@/lib/portal/feedback", () => ({ getStudentFeedback: vi.fn(async () => mock.phieu) }));

import { docThang, layChiTietBuoi, layLichThang, ngayVn } from "./dich-vu/lich-thang";

const HS = "hs-1" as never;
const buoi = (id: string, date: string, order: number, attendance: string, title = "Buổi học") => ({ id, date, order, attendance, title, nhan: `Buổi ${order}`, nhanNgay: "x", past: false, today: false, className: "L1", objectives: ["m1"] });

describe("[LT] lịch tháng + chi tiết buổi", () => {
  it("[LT-01] docThang chỉ nhận YYYY-MM hợp lệ", () => {
    expect(docThang("2026-11")).toEqual({ y: 2026, m0: 10 });
    expect(docThang("2026-01")).toEqual({ y: 2026, m0: 0 });
    for (const x of ["2026-13", "2026-00", "2026-1", "26-11", "1999-12", "2101-01", "2026-11-01", "tháng 11", "", null]) expect(docThang(x as string | null), String(x)).toBeNull();
  });

  it("[LT-02] lọc buổi theo THÁNG GIỜ VN; lưới chuyển nguyên; sắp theo ngày rồi số buổi", async () => {
    mock.sessions = [
      buoi("a", "2026-11-30T16:30:00Z", 3, "FUTURE"), // 23:30 VN 30/11 ⇒ tháng 11
      buoi("b", "2026-11-30T17:30:00Z", 4, "FUTURE"), // 00:30 VN 01/12 ⇒ tháng 12
      buoi("c", "2026-11-05T11:00:00Z", 2, "PRESENT", "Bài 2 — Lắp khung"),
      buoi("d", "2026-11-05T11:00:00Z", 1, "ABSENT"), // cùng ngày, số buổi nhỏ hơn ⇒ đứng trước
    ];
    const t11 = await layLichThang(HS, 2026, 10, new Date("2026-11-21T05:00:00Z"));
    expect(t11.buoi.map((b) => b.id)).toEqual(["d", "c", "a"]);
    expect(t11.buoi.map((b) => b.ngayKey)).toEqual(["2026-11-05", "2026-11-05", "2026-11-30"]);
    expect(t11).toMatchObject({ nhanThang: "Tháng 11/2026", y: 2026, m0: 10, conLaiTrongKhoa: 6, truoc: { y: 2026, m0: 9 }, sau: { y: 2026, m0: 11 } });
    expect(Object.keys(t11.o[0]!).sort()).toEqual(["homNay", "key", "kieu", "ngay", "trongThang"]); // không lọt trường lạ của nguồn
    const t12 = await layLichThang(HS, 2026, 11, new Date("2026-11-21T05:00:00Z"));
    expect(t12.buoi.map((b) => b.id)).toEqual(["b"]);
    expect(ngayVn("2026-11-30T17:30:00Z")).toBe("2026-12-01");
  });

  it("[LT-03] trạng thái buổi ánh xạ đủ 7 giá trị; tên «Buổi học» ⇒ rỗng", async () => {
    mock.sessions = ["PRESENT", "MAKEUP", "EXCUSED", "ABSENT", "UNMARKED", "FUTURE", "CANCELLED"].map((a, i) => buoi(`s${i}`, `2026-11-${String(10 + i).padStart(2, "0")}T11:00:00Z`, i + 1, a));
    const t = await layLichThang(HS, 2026, 10);
    expect(t.buoi.map((b) => b.trangThai)).toEqual(["co-mat", "hoc-bu", "vang-co-phep", "vang-khong-phep", "chua-cham", "chua-hoc", "huy"]);
    expect(t.buoi.every((b) => b.ten === "")).toBe(true);
  });

  it("[LT-04] chi tiết buổi: lạ ⇒ null; đã qua ⇒ gio/phong/giaoVien null; sắp tới lấy từ lịch; coNhanXet", async () => {
    mock.sessions = [{ ...buoi("qua", "2026-11-05T11:00:00Z", 1, "PRESENT", "Bài 1"), past: true }, buoi("sap", "2026-11-25T11:00:00Z", 6, "FUTURE", "Bài 6")];
    mock.sched = { next: { id: "sap", time: "18:00 - 19:30", room: "P302", teacher: "Cô Lan Anh" }, thisWeek: [], upcoming: [] };
    mock.phieu = [{ classSessionId: "qua" }];
    expect(await layChiTietBuoi(HS, "khong-co")).toBeNull();
    const qua = await layChiTietBuoi(HS, "qua");
    expect(qua).toMatchObject({ id: "qua", daQua: true, gio: null, phong: null, giaoVien: null, coNhanXet: true, trangThai: "co-mat" });
    const sap = await layChiTietBuoi(HS, "sap");
    expect(sap).toMatchObject({ gio: "18:00 - 19:30", phong: "P302", giaoVien: "Cô Lan Anh", coNhanXet: false, trangThai: "chua-hoc", mucTieu: ["m1"] });
  });
});
