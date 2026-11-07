// lib/cham-cong/xac-nhan-cong-thuan.test.ts — phần thuần của xác nhận / khiếu nại công (P2.2). Không DB, không đồng hồ.
import { describe, expect, it } from "vitest";
import {
  anhChupBangCong,
  chanKhoaKyViKhieuNai,
  chuyenKhieuNai,
  hanhDongHopLe,
  KHIEU_NAI_DANG_MO,
  laKhieuNaiNghiemTrong,
  ngayKhacNhau,
  trangThaiXacNhan,
  type DongCong,
  type HanhDongKhieuNai,
  type TrangThaiKhieuNai,
} from "./xac-nhan-cong-thuan";
import { vanTayBangCong } from "./van-tay-bang-cong";

const utc = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));
const dong = (o: Partial<DongCong> = {}): DongCong => ({
  workDate: utc(9, 2),
  templateCode: "HC",
  dayType: "WORKDAY",
  expectedMinutes: 450,
  workedMinutes: 450,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  lateApprovedMinutes: 0,
  earlyLeaveApprovedMinutes: 0,
  otPayableMinutes: 0,
  holidayWorkMinutes: 0,
  restDayWorkMinutes: 0,
  dayCreditEarned: 1,
  hourCredit: 0,
  leaveUnits: 0,
  holidayPaidUnits: 0,
  overrideUnits: null,
  absenceStatus: null,
  ...o,
});

describe("[XNC] vân tay bảng công", () => {
  it("[XNC-01] không phụ thuộc thứ tự dòng; đổi BẤT KỲ cột giá trị nào ⇒ vân tay đổi", () => {
    const a = [dong(), dong({ workDate: utc(9, 3) })];
    expect(vanTayBangCong(a)).toBe(vanTayBangCong([...a].reverse()));
    const goc = vanTayBangCong(a);
    const doi: Partial<DongCong>[] = [
      { templateCode: "S" },
      { workedMinutes: 449 },
      { lateMinutes: 5 },
      { dayCreditEarned: 0.5 },
      { overrideUnits: 1 },
      { absenceStatus: "UNEXCUSED" },
      { leaveUnits: 0.5 },
      { otPayableMinutes: 30 },
    ];
    for (const o of doi) expect(vanTayBangCong([dong(o), dong({ workDate: utc(9, 3) })]), JSON.stringify(o)).not.toBe(goc);
  });

  it("[XNC-01b] thêm dòng RỖNG (ngày không ca, mọi số 0) KHÔNG đổi vân tay — lượt tính lại cả tháng lúc chốt", () => {
    const rong = dong({ workDate: utc(9, 20), templateCode: null, dayType: "UNSCHEDULED", expectedMinutes: 0, workedMinutes: 0, dayCreditEarned: 0 });
    expect(vanTayBangCong([dong(), rong])).toBe(vanTayBangCong([dong()]));
    expect(anhChupBangCong([dong(), rong]).ngay).toHaveLength(1);
    // Nhưng ngày không ca mà bị XÁC NHẬN VẮNG / ghi đè thì có nghĩa ⇒ đổi vân tay.
    expect(vanTayBangCong([dong(), { ...rong, absenceStatus: "UNEXCUSED" }])).not.toBe(vanTayBangCong([dong()]));
    expect(vanTayBangCong([dong(), { ...rong, overrideUnits: 0 }])).not.toBe(vanTayBangCong([dong()]));
  });

  it("[XNC-02] số thực sai số dấu phẩy động KHÔNG làm đổi vân tay (0.1+0.2 ≡ 0.3)", () => {
    expect(vanTayBangCong([dong({ dayCreditEarned: 0.1 + 0.2 })])).toBe(vanTayBangCong([dong({ dayCreditEarned: 0.3 })]));
  });

  it("[XNC-03] ảnh chụp: công thực = ghi đè thắng công engine; so khác biệt chỉ ra đúng ngày đổi", () => {
    const cu = anhChupBangCong([dong(), dong({ workDate: utc(9, 3), dayCreditEarned: 1 })]);
    expect(cu.tong.cong).toBe(2);
    const moi = anhChupBangCong([dong(), dong({ workDate: utc(9, 3), dayCreditEarned: 1, overrideUnits: 0.5 })]);
    expect(moi.tong.cong).toBe(1.5);
    expect(ngayKhacNhau(cu, moi)).toEqual([{ d: "2026-09-03", truoc: "HC · 1", sau: "HC · 0.5" }]);
  });

  it("[XNC-04] trạng thái suy ra: chưa có / đã / cần xác nhận lại / HR xác nhận thay (và thay cũng có thể cũ)", () => {
    const vt = "abc";
    expect(trangThaiXacNhan(null, vt)).toBe("CHUA_XAC_NHAN");
    expect(trangThaiXacNhan({ status: "PENDING", snapshotHash: null }, vt)).toBe("CHUA_XAC_NHAN");
    expect(trangThaiXacNhan({ status: "CONFIRMED", snapshotHash: vt }, vt)).toBe("DA_XAC_NHAN");
    expect(trangThaiXacNhan({ status: "CONFIRMED", snapshotHash: "cu" }, vt)).toBe("CAN_XAC_NHAN_LAI");
    expect(trangThaiXacNhan({ status: "OVERRIDDEN", snapshotHash: vt }, vt)).toBe("HR_XAC_NHAN_THAY");
    expect(trangThaiXacNhan({ status: "OVERRIDDEN", snapshotHash: "cu" }, vt)).toBe("CAN_XAC_NHAN_LAI");
  });
});

describe("[KNC] khiếu nại — bảng chuyển trạng thái", () => {
  const ok = (hienTai: TrangThaiKhieuNai, hanhDong: HanhDongKhieuNai, vai: "NV" | "QL", ghiChu = "lý do đủ dài") =>
    chuyenKhieuNai({ hienTai, hanhDong, vai, ghiChu });

  it("[KNC-01] luồng chuẩn: mở → QL nhận → hỏi lại → NV trả lời → giải quyết → NV đồng ý ⇒ đóng", () => {
    expect(ok("OPEN", "NHAN_XU_LY", "QL")).toEqual({ ok: true, den: "IN_REVIEW" });
    expect(ok("IN_REVIEW", "HOI_LAI", "QL")).toEqual({ ok: true, den: "WAITING_EMPLOYEE" });
    expect(ok("WAITING_EMPLOYEE", "TRA_LOI", "NV")).toEqual({ ok: true, den: "IN_REVIEW" });
    expect(ok("IN_REVIEW", "GIAI_QUYET", "QL")).toEqual({ ok: true, den: "RESOLVED" });
    expect(ok("RESOLVED", "DONG_Y", "NV")).toEqual({ ok: true, den: "CLOSED" });
  });

  it("[KNC-02] sai vai bị chặn: NV không tự giải quyết, QL không trả lời thay NV", () => {
    expect(ok("OPEN", "GIAI_QUYET", "NV").ok).toBe(false);
    expect(ok("WAITING_EMPLOYEE", "TRA_LOI", "QL").ok).toBe(false);
  });

  it("[KNC-03] sai trạng thái bị chặn; đóng rồi là hết (không hành động nào hợp lệ)", () => {
    expect(ok("CLOSED", "KHIEU_NAI_TIEP", "NV").ok).toBe(false);
    expect(ok("RESOLVED", "GIAI_QUYET", "QL").ok).toBe(false);
    expect(hanhDongHopLe("NV", "CLOSED")).toEqual([]);
    expect(hanhDongHopLe("QL", "CLOSED")).toEqual([]);
    expect(hanhDongHopLe("QL", "RESOLVED")).toEqual([]);
  });

  it("[KNC-04] kết luận / hỏi lại / trả lời / khiếu nại tiếp BẮT BUỘC ghi nội dung; rút / đồng ý / nhận thì không", () => {
    expect(ok("IN_REVIEW", "TU_CHOI", "QL", "abc").ok).toBe(false);
    expect(ok("REJECTED", "KHIEU_NAI_TIEP", "NV", " ").ok).toBe(false);
    expect(ok("OPEN", "RUT", "NV", "").ok).toBe(true);
    expect(ok("OPEN", "NHAN_XU_LY", "QL", "").ok).toBe(true);
  });

  it("[KNC-05] khiếu nại tiếp sau kết luận ⇒ quay về MỞ (lại chặn khoá kỳ)", () => {
    expect(ok("REJECTED", "KHIEU_NAI_TIEP", "NV")).toEqual({ ok: true, den: "OPEN" });
    expect(KHIEU_NAI_DANG_MO).toContain("OPEN");
  });

  it("[KNC-06] MỌI trạng thái chưa kết luận đều chặn khoá kỳ — đẩy sang 'chờ NV' không phải đường lách", () => {
    expect([...KHIEU_NAI_DANG_MO].sort()).toEqual(["IN_REVIEW", "OPEN", "WAITING_EMPLOYEE"]);
    expect(chanKhoaKyViKhieuNai(0, "2026-09")).toBeNull();
    expect(chanKhoaKyViKhieuNai(2, "2026-09")).toMatch(/còn 2 khiếu nại/);
    expect(laKhieuNaiNghiemTrong("OTHER")).toBe(false);
    expect(laKhieuNaiNghiemTrong("MISSING_CHECKIN")).toBe(true);
  });
});
