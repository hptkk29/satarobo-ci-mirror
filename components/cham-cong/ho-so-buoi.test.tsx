// @vitest-environment jsdom
// [HSB-*] — hồ sơ buổi trên thẻ Chấm công / Công việc của tôi: lối tắt chỉ hiện khi làm được; chấm vào KHÔNG thay điểm danh.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoSoBuoi } from "@/components/cham-cong/ho-so-buoi";
import { KhoiNguCanh } from "@/components/cham-cong/khoi-ngu-canh";
import type { NguCanhChamCong, TietHienThi } from "@/lib/parttime/ngu-canh-cham-cong";
import type { NhanTuanThu } from "@/lib/parttime/nhan-tuan-thu";

const hoSo = (p: { ddXong: boolean; nxCho?: boolean; nxXong?: boolean }): NhanTuanThu => ({
  buoc: [
    { ma: "NHAN_LOP", nhan: "Đã nhận lớp", xong: true, tone: "success", chiTiet: "" },
    { ma: "CHAM_VAO", nhan: "Chấm vào 17:48", xong: true, tone: "success", chiTiet: "" },
    { ma: "DIEM_DANH", nhan: p.ddXong ? "Điểm danh 9/9" : "Điểm danh 0/9", xong: p.ddXong, tone: p.ddXong ? "success" : "muted", chiTiet: "", conThieu: p.ddXong ? 0 : 9 },
    { ma: "CHAM_RA", nhan: "Chấm ra", xong: false, tone: "muted", chiTiet: "" },
    p.nxCho
      ? { ma: "NHAN_XET", nhan: "Nhận xét — chờ điểm danh", xong: false, tone: "muted", chiTiet: "", choBuocTruoc: true }
      : { ma: "NHAN_XET", nhan: p.nxXong ? "Nhận xét 9/9" : "Nhận xét 7/9", xong: !!p.nxXong, tone: "warning", chiTiet: "", conThieu: p.nxXong ? 0 : 2 },
  ],
  tong: { nhan: "Hồ sơ buổi đang làm", tone: "warning" },
  vanDe: [],
});

describe("[HSB] hồ sơ buổi", () => {
  it("[HSB-01] chưa điểm danh: có lối 'Điểm danh lớp'; nhận xét đang CHỜ điểm danh ⇒ KHÔNG có lối 'Nhận xét học viên'", () => {
    render(<HoSoBuoi n={hoSo({ ddXong: false, nxCho: true })} diemDanhHref="/dd" nhanXetHref="/nx" />);
    expect(screen.getByRole("link", { name: "Điểm danh lớp" }).getAttribute("href")).toBe("/dd");
    expect(screen.queryByRole("link", { name: "Nhận xét học viên" })).toBeNull();
  });

  it("[HSB-02] điểm danh đủ, nhận xét 7/9 ⇒ chỉ còn lối nhận xét; đủ cả hai ⇒ không lối nào (đối chứng dương ở HSB-01)", () => {
    const { unmount } = render(<HoSoBuoi n={hoSo({ ddXong: true })} diemDanhHref="/dd" nhanXetHref="/nx" />);
    expect(screen.queryByRole("link", { name: "Điểm danh lớp" })).toBeNull();
    expect(screen.getByRole("link", { name: "Nhận xét học viên" }).getAttribute("href")).toBe("/nx");
    unmount();
    render(<HoSoBuoi n={hoSo({ ddXong: true, nxXong: true })} diemDanhHref="/dd" nhanXetHref="/nx" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("[HSB-03] Control Tower (không truyền đường dẫn) ⇒ KHÔNG lối tắt — QLCS không điểm danh hộ", () => {
    render(<HoSoBuoi n={hoSo({ ddXong: false })} gon />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Điểm danh 0/9")).toBeTruthy();
  });

  const tiet = (p: Partial<TietHienThi>): TietHienThi => ({
    assignmentId: "pc", nhanVai: "Đứng chính", tieuDe: "GIÁO VIÊN ĐỨNG CHÍNH", nhanLop: "CS2.SATA3", gio: "18:00–19:30", coMatTruoc: "17:50", khacCoSo: null,
    bangChung: "Đã vào 17:48", hoSo: hoSo({ ddXong: false, nxCho: true }), dich: { loai: "LOP", sessionId: "s1", classId: "c1", dayThay: false }, daBatDau: true, ...p,
  });
  const nc = (t: TietHienThi): NguCanhChamCong => ({
    direction: "CHECK_OUT", contexts: ["TEACHING_MAIN"], primary: "TEACHING", normalShift: null, teaching: [t], nextTeaching: t, sauDo: null, operationsDuty: null, warnings: [], cauDuDoan: "", huongTiepTheo: "CHECK_IN",
  });

  it("[HSB-04] thẻ Chấm công: lớp ĐÃ bắt đầu, chưa điểm danh ⇒ nhắc 'Cần điểm danh học viên' + lối tới màn điểm danh của ĐÚNG site", () => {
    const { unmount } = render(<KhoiNguCanh nc={nc(tiet({}))} site="GIAO_VIEN" />);
    expect(screen.getByText("Cần điểm danh học viên")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Điểm danh lớp" }).getAttribute("href")).toBe("/teacher/lop?classId=c1&sessionId=s1");
    unmount();
    render(<KhoiNguCanh nc={nc(tiet({}))} site="ADMIN" />);
    expect(screen.getByRole("link", { name: "Điểm danh lớp" }).getAttribute("href")).toBe("/attendance?sessionId=s1");
  });

  it("[HSB-05] trước giờ học (đã chấm vào sớm): KHÔNG nhắc; đã điểm danh đủ: không lối; sau khi ra: 'Nhận xét 7/9 · còn thiếu 2'", () => {
    const { unmount } = render(<KhoiNguCanh nc={nc(tiet({ daBatDau: false }))} site="GIAO_VIEN" />);
    expect(screen.queryByText("Cần điểm danh học viên")).toBeNull();
    unmount();
    render(<KhoiNguCanh nc={nc(tiet({ hoSo: hoSo({ ddXong: true }) }))} site="GIAO_VIEN" />);
    expect(screen.queryByRole("link", { name: "Điểm danh lớp" })).toBeNull();
    expect(screen.getByText(/Nhận xét 7\/9 · còn thiếu 2/)).toBeTruthy();
  });
});
