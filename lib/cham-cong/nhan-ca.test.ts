/**
 * Nhãn ô ca — hai bug prod 10/09/2026.
 *
 * Luật 16: mỗi vế CHẶN đi kèm vế CHO QUA. Ở đây:
 *   · "X/P KHÔNG bao giờ ra 'theo nơi làm'"  ⇔  "LD/D1/D2 VẪN ra đúng chuỗi đó"
 *   · "chưa chấm KHÔNG in 'Đã làm'"          ⇔  "có chấm thì VẪN in 'Đã làm'"
 * Thiếu vế thứ hai thì một bản vá xoá sạch chuỗi dự phòng / in "Chưa chấm" cho mọi dòng
 * vẫn xanh, và ta vừa làm hỏng đúng nhóm mà chuỗi ấy sinh ra để phục vụ.
 */
import { describe, expect, it } from "vitest";

import {
  NHAN_TRANG_THAI,
  laNgayNghi,
  nhanGioCa,
  nhanLoaiCa,
  trangThaiBuoiDay,
  trangThaiNgay,
  type LoaiMaCa,
} from "./nhan-ca";

describe("nhanLoaiCa — đọc `kind`, KHÔNG đọc `isLeave`", () => {
  it("X (OFF) ⇒ 'Nghỉ' — dù `isLeave` của nó là FALSE", () => {
    // Đây là chỗ dễ vá sai nhất: lọc bằng `isLeave` thì X lọt qua thành "Ca làm".
    expect(nhanLoaiCa("OFF")).toBe("Nghỉ");
  });

  it("P (LEAVE) ⇒ 'Nghỉ phép'", () => {
    expect(nhanLoaiCa("LEAVE")).toBe("Nghỉ phép");
  });

  it.each<LoaiMaCa>(["TIMED", "LOCATION_ONLY", "FLEXIBLE"])(
    "%s ⇒ 'Ca làm' (vế CHO QUA)",
    (k) => {
      expect(nhanLoaiCa(k)).toBe("Ca làm");
    },
  );

  it("laNgayNghi đúng cho cả năm loại", () => {
    expect(laNgayNghi("OFF")).toBe(true);
    expect(laNgayNghi("LEAVE")).toBe(true);
    for (const k of ["TIMED", "LOCATION_ONLY", "FLEXIBLE"] as LoaiMaCa[]) {
      expect(laNgayNghi(k), k).toBe(false);
    }
  });
});

describe("nhanGioCa — chuỗi dự phòng chỉ dành cho mã KHÔNG GIỜ mà VẪN LÀM", () => {
  it("có giờ ⇒ trả đúng chuỗi giờ, không đụng tới", () => {
    expect(nhanGioCa("TIMED", "07:45–11:30 · 13:30–17:30")).toBe("07:45–11:30 · 13:30–17:30");
  });

  // ── vế CHẶN: X và P không bao giờ ra "theo nơi làm" ────────────────────────
  it.each<LoaiMaCa>(["OFF", "LEAVE"])("%s không giờ ⇒ '—', KHÔNG 'theo nơi làm'", (k) => {
    const nhan = nhanGioCa(k, "");
    expect(nhan).toBe("—");
    expect(nhan).not.toContain("nơi làm");
  });

  // ── vế CHO QUA (luật 16): nhóm mà chuỗi ấy sinh ra để phục vụ ──────────────
  it.each<LoaiMaCa>(["LOCATION_ONLY", "FLEXIBLE"])(
    "%s không giờ ⇒ VẪN 'theo nơi làm' (LD/D1/D2)",
    (k) => {
      expect(nhanGioCa(k, "")).toBe("theo nơi làm");
    },
  );

  it("mã CÓ GIỜ mà là ngày nghỉ ⇒ vẫn ưu tiên chuỗi giờ đã dựng", () => {
    // Không có mã nào như vậy hôm nay, nhưng luật phải xác định: dữ liệu thật thắng suy diễn.
    expect(nhanGioCa("LEAVE", "08:00–12:00")).toBe("08:00–12:00");
  });
});

describe("trangThaiNgay — tính từ DỮ LIỆU, không từ so ngày", () => {
  const co = (workedMinutes: number, units: number) => ({ workedMinutes, units });

  // ── vế CHẶN: chưa chấm thì KHÔNG được in "Đã làm" ──────────────────────────
  it("quá khứ, ĐÃ TÍNH nhưng 0 phút và 0 công ⇒ 'Chưa chấm'", () => {
    const t = trangThaiNgay({ tuongLai: false, kind: "TIMED", ngayCong: co(0, 0) });
    expect(t).toBe("CHUA_CHAM");
    expect(NHAN_TRANG_THAI[t]).not.toBe("Đã làm");
  });

  it("quá khứ, engine CHƯA tính ngày này ⇒ 'Chưa tính', khác 'Chưa chấm'", () => {
    // Hai chuyện khác nhau: "đã tính, ra 0" vs "chưa ai tính". Gộp là mất thông tin.
    expect(trangThaiNgay({ tuongLai: false, kind: "TIMED", ngayCong: null })).toBe("CHUA_TINH");
  });

  // ── vế CHO QUA ────────────────────────────────────────────────────────────
  it("quá khứ, có 6h51 (411 phút) ⇒ 'Đã làm' — khớp đúng số admin hiện", () => {
    const t = trangThaiNgay({ tuongLai: false, kind: "TIMED", ngayCong: co(411, 1) });
    expect(NHAN_TRANG_THAI[t]).toBe("Đã làm");
  });

  it("0 phút nhưng quản lý ĐÃ ghi đè công ⇒ vẫn 'Đã làm'", () => {
    // Ngày công tác / ngày quản lý ghi đè: không có lượt quét nhưng công là thật.
    expect(trangThaiNgay({ tuongLai: false, kind: "TIMED", ngayCong: co(0, 1) })).toBe("DA_LAM");
  });

  // ── thứ tự ưu tiên ────────────────────────────────────────────────────────
  it("TƯƠNG LAI thắng mọi thứ — kể cả ngày nghỉ tuần sau", () => {
    expect(trangThaiNgay({ tuongLai: true, kind: "OFF", ngayCong: null })).toBe("SAP_TOI");
    expect(trangThaiNgay({ tuongLai: true, kind: "TIMED", ngayCong: co(411, 1) })).toBe("SAP_TOI");
  });

  it.each<LoaiMaCa>(["OFF", "LEAVE"])("%s trong quá khứ ⇒ 'Nghỉ', không phải 'Đã làm'", (k) => {
    expect(trangThaiNgay({ tuongLai: false, kind: k, ngayCong: null })).toBe("NGHI");
    expect(trangThaiNgay({ tuongLai: false, kind: k, ngayCong: co(0, 0) })).toBe("NGHI");
  });

  it("mọi trạng thái đều có nhãn tiếng Việt", () => {
    for (const k of [
      "SAP_TOI",
      "NGHI",
      "DA_LAM",
      "CHUA_CHAM",
      "CHUA_TINH",
      "CHUA_CHOT",
    ] as const) {
      expect(NHAN_TRANG_THAI[k]?.length, k).toBeGreaterThan(2);
    }
  });
});

describe("trangThaiBuoiDay — buổi dạy chốt bằng STATUS, không bằng ngày đã trôi qua", () => {
  // ── vế CHẶN ────────────────────────────────────────────────────────────────
  it("buổi QUÁ KHỨ chưa ai bấm hoàn tất ⇒ 'Chưa chốt', KHÔNG 'Đã làm'", () => {
    const t = trangThaiBuoiDay({ tuongLai: false, hoanTat: false });
    expect(t).toBe("CHUA_CHOT");
    expect(NHAN_TRANG_THAI[t]).not.toBe("Đã làm");
  });

  // ── vế CHO QUA (luật 16) ───────────────────────────────────────────────────
  it("buổi đã COMPLETED ⇒ VẪN 'Đã làm'", () => {
    expect(NHAN_TRANG_THAI[trangThaiBuoiDay({ tuongLai: false, hoanTat: true })]).toBe("Đã làm");
  });

  it("buổi tương lai ⇒ 'Sắp tới' — cùng luật với trangThaiNgay", () => {
    expect(trangThaiBuoiDay({ tuongLai: true, hoanTat: false })).toBe("SAP_TOI");
    expect(trangThaiBuoiDay({ tuongLai: true, hoanTat: true })).toBe("SAP_TOI");
  });
});
