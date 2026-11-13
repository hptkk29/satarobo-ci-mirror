// [YCH] — nhãn hiển thị yêu cầu phụ huynh (lịch VN, THUẦN).
import { describe, expect, it } from "vitest";
import { nhanGio, nhanMocDeXuat, nhanNgayDayDu, nhanThoiDiemGui, THU_TU_LOAI } from "./yeu-cau-hien-thi";
import { parseVnDateTimeLocal, parseVnYmd } from "@/lib/time/vn";

describe("[YCH] yêu cầu phụ huynh — nhãn hiển thị", () => {
  it("[YCH-01] mốc có giờ in cả thứ + ngày + giờ theo lịch VN (không lệch 7 tiếng khi máy chủ chạy UTC)", () => {
    const d = parseVnDateTimeLocal("2026-11-17T18:30")!;
    expect(nhanNgayDayDu(d)).toBe("Thứ Ba, 17/11/2026");
    expect(nhanGio(d)).toBe("18:30");
    expect(nhanMocDeXuat(d)).toBe("Thứ Ba, 17/11/2026 · 18:30");
  });

  it("[YCH-02] đơn CŨ chỉ lưu ngày (nửa đêm VN) ⇒ chỉ in ngày, không in «00:00»; không có mốc ⇒ null", () => {
    expect(nhanMocDeXuat(parseVnYmd("2026-11-20"))).toBe("Thứ Sáu, 20/11/2026");
    expect(nhanMocDeXuat(null)).toBeNull();
  });

  it("[YCH-03] thời điểm gửi in dd/MM/yyyy HH:mm giờ VN", () => {
    expect(nhanThoiDiemGui(new Date("2026-11-13T01:13:00.000Z"))).toBe("13/11/2026 08:13");
  });

  it("[YCH-04] danh sách thứ tự nhóm chứa ĐỦ mọi loại yêu cầu, mỗi loại một lần (thêm loại mới vào enum mà quên đây là nhóm biến mất khỏi màn admin)", () => {
    expect([...THU_TU_LOAI].sort()).toEqual(["ABSENCE", "CONSENT_CHANGE", "MAKEUP", "OTHER", "RESERVE", "TRANSFER_CENTER", "TRANSFER_CLASS"]);
  });
});
