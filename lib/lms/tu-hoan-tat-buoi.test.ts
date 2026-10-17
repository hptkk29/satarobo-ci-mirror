import { describe, it, expect } from "vitest";
import { quyetDinhTuHoanTat } from "./tu-hoan-tat-buoi";

const GIO = 60 * 60 * 1000;
const NGAY = 24 * GIO;

/**
 * 04/09/2026 — mốc NỬA ĐÊM UTC của ngày VN. Đây là hình dạng của `homNayUtcMs`
 * (`vnDateOnly(now)`), KHÔNG phải hình dạng của `ClassSession.date`.
 */
const HOM_NAY = Date.UTC(2026, 8, 4);

/**
 * Dựng thời điểm buổi học ĐÚNG HÌNH DẠNG DỮ LIỆU THẬT.
 *
 * ⚠️ ĐỪNG dùng nửa đêm. Đo trên `satarobo_local` (609 buổi, psql TZ=Asia/Bangkok):
 * 0 buổi nửa đêm · 609 buổi mang giờ · dải **UTC 01:00–11:00** (VN 08:00–18:00) ·
 * 0/609 buổi có ngày UTC khác ngày VN.
 *
 * Bản test trước 07/09/2026 truyền đúng nửa đêm cho ca "buổi hôm nay" — một hình dạng
 * KHÔNG TỒN TẠI trong DB — nên nó xanh trong khi prod chết: cổng
 * `ngayBuoi > homNayUtcMs` luôn trả "chưa tới ngày" cho buổi của chính hôm nay.
 * Prod 07/09: 2 buổi COMPLETED / 287 SCHEDULED.
 */
const buoiLuc = (lechNgay: number, gioUtc = 3) =>
  new Date(HOM_NAY + lechNgay * NGAY + gioUtc * GIO);

const ids = (n: number, tien = "hv") =>
  Array.from({ length: n }, (_, i) => `${tien}-${i + 1}`);

const SI_SO = ids(10);

const co = (p: Partial<Parameters<typeof quyetDinhTuHoanTat>[0]> = {}) =>
  quyetDinhTuHoanTat({
    trangThaiBuoi: "SCHEDULED",
    ngayBuoi: buoiLuc(-1),
    homNayUtcMs: HOM_NAY,
    siSoStudentIds: SI_SO,
    daDanhDauStudentIds: SI_SO,
    ...p,
  });

describe("quyetDinhTuHoanTat — điểm danh đủ thì buổi tự đóng", () => {
  it("buổi đã qua + phủ đủ sĩ số → tự hoàn tất", () => {
    expect(co()).toEqual({ tuHoanTat: true });
  });

  it("buổi HÔM NAY đóng được ở MỌI khung giờ dạy thật (dạy xong trong ngày)", () => {
    for (const gioUtc of [1, 3, 7, 10, 11]) {
      expect(
        co({ ngayBuoi: buoiLuc(0, gioUtc) }),
        `buổi ${gioUtc}h UTC (${gioUtc + 7}h VN) phải đóng được`,
      ).toEqual({ tuHoanTat: true });
    }
  });

  it("ranh giới: buổi cuối ngày hôm nay đóng được, buổi đầu ngày mai thì không", () => {
    // 11:00 UTC = 18:00 VN — buổi muộn nhất đo được trên dữ liệu thật.
    expect(co({ ngayBuoi: buoiLuc(0, 11) })).toEqual({ tuHoanTat: true });
    // 01:00 UTC hôm sau = 08:00 VN — buổi sớm nhất của ngày kế.
    expect(co({ ngayBuoi: buoiLuc(1, 1) })).toEqual({
      tuHoanTat: false,
      lyDo: "CHUA_TOI_NGAY",
    });
  });

  it("KHÔNG đóng buổi tương lai — giáo viên đánh sẵn cả lớp là chuyện có thật", () => {
    // Đóng buổi chưa dạy = phát `session.taught` ⇒ giao bài và bắn thông báo cho phụ
    // huynh sớm cả tuần.
    for (const gioUtc of [1, 7, 11]) {
      expect(
        co({ ngayBuoi: buoiLuc(1, gioUtc) }),
        `buổi mai ${gioUtc}h UTC không được đóng`,
      ).toEqual({ tuHoanTat: false, lyDo: "CHUA_TOI_NGAY" });
    }
  });

  it("điểm danh THIẾU người → chưa đóng", () => {
    expect(co({ daDanhDauStudentIds: SI_SO.slice(0, 9) })).toEqual({
      tuHoanTat: false,
      lyDo: "DIEM_DANH_THIEU",
    });
  });

  it("một dòng lẻ (duyệt phiếu xin nghỉ) KHÔNG đủ để đóng buổi", () => {
    // Đúng lớp lỗi BUG-029: "có ≥1 dòng" từng bị coi là đã điểm danh.
    expect(co({ daDanhDauStudentIds: SI_SO.slice(0, 1) })).toEqual({
      tuHoanTat: false,
      lyDo: "DIEM_DANH_THIEU",
    });
  });

  // ── 08/09/2026 — ca mà cách ĐẾM cũ sẽ SAI ────────────────────────────────────
  //
  // Học viên HỌC BÙ từ lớp khác cũng sinh dòng `Attendance` cho buổi này. Cổng cũ so
  // `daDanhDau >= siSo` bằng SỐ, nên các em học bù BÙ CHỖ cho em trong sĩ số chưa được
  // đánh dấu ⇒ buổi đóng trong khi điểm danh còn thiếu người.
  //
  // Lỗ này vốn ngủ (cổng ngày sai làm cả cơ chế không nổ). Vá cổng ngày ở 4df347b4
  // đánh thức nó, nên hai bản vá phải đi cùng một chuyến deploy.
  it("HỌC BÙ từ lớp khác KHÔNG bù chỗ cho em trong sĩ số chưa điểm danh", () => {
    const chuaDanhDau = SI_SO.slice(0, 9); // thiếu đúng `hv-10`
    const hocBu = ids(3, "hocbu"); // 3 em từ lớp khác
    const daDanhDauStudentIds = [...chuaDanhDau, ...hocBu];

    // Cách ĐẾM cũ: 12 dòng ≥ 10 sĩ số ⇒ đã đóng buổi. Sai.
    expect(daDanhDauStudentIds.length).toBeGreaterThan(SI_SO.length);

    expect(co({ daDanhDauStudentIds })).toEqual({
      tuHoanTat: false,
      lyDo: "DIEM_DANH_THIEU",
    });
  });

  it("điểm danh DƯ (có em học bù) vẫn đóng được KHI đã phủ đủ sĩ số", () => {
    expect(co({ daDanhDauStudentIds: [...SI_SO, ...ids(2, "hocbu")] })).toEqual(
      {
        tuHoanTat: true,
      },
    );
  });

  it("dòng điểm danh TRÙNG studentId không làm phồng độ phủ", () => {
    // Không phải ca đang xảy ra, nhưng `count` từng đếm cả dòng trùng còn tập thì không.
    expect(
      co({ daDanhDauStudentIds: [...SI_SO.slice(0, 9), ...SI_SO.slice(0, 9)] }),
    ).toEqual({
      tuHoanTat: false,
      lyDo: "DIEM_DANH_THIEU",
    });
  });

  it("lớp chưa có học viên nào → không đóng, và lý do KHÁC 'thiếu điểm danh'", () => {
    // `attendanceCoversRoster` trả false cho cả hai ca; hai ca này cần hai lý do khác
    // nhau — "lớp chưa có ai" không phải "giáo viên còn nợ việc".
    expect(co({ siSoStudentIds: [], daDanhDauStudentIds: [] })).toEqual({
      tuHoanTat: false,
      lyDo: "SI_SO_RONG",
    });
  });

  it("buổi đã COMPLETED / CANCELLED → không đụng tới", () => {
    for (const st of ["COMPLETED", "CANCELLED"]) {
      expect(co({ trangThaiBuoi: st })).toEqual({
        tuHoanTat: false,
        lyDo: "DA_XONG",
      });
    }
  });

  it("IN_PROGRESS vẫn đóng được", () => {
    expect(co({ trangThaiBuoi: "IN_PROGRESS" })).toEqual({ tuHoanTat: true });
  });
});
