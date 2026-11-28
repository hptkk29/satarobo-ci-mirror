import { describe, it, expect } from "vitest";
import {
  congDayCuaNguoi,
  loaiCua,
  phutGiuaHaiGio,
  phutGiuaHaiMoc,
  type BuoiDay,
  type LoaiCongDay,
} from "./cong-day";

function loai(p: Partial<LoaiCongDay> = {}): LoaiCongDay {
  return {
    code: "LOP_CHINH",
    name: "Lớp chính",
    source: "CLASS",
    role: "MAIN",
    basis: "PER_SESSION",
    factor: 1,
    countsInPeriod: true,
    isActive: true,
    categoryCode: null,
    ...p,
  };
}

function buoi(p: Partial<BuoiDay> = {}): BuoiDay {
  return {
    id: "s1",
    source: "CLASS",
    userId: "u1",
    role: "MAIN",
    ymd: "2026-09-10",
    minutes: 90,
    categoryCode: null,
    ...p,
  };
}

describe("loaiCua — mỗi buổi ứng đúng một loại", () => {
  it("khớp theo cặp nguồn × vai", () => {
    const dm = [loai(), loai({ code: "DAY_THAY", role: "SUBSTITUTE" })];
    expect(loaiCua(buoi(), dm)?.code).toBe("LOP_CHINH");
    expect(loaiCua(buoi({ role: "SUBSTITUTE" }), dm)?.code).toBe("DAY_THAY");
  });

  it("loại đã tắt thì coi như không có — đây là cách tắt một nhóm buổi mà không cần sửa mã", () => {
    expect(loaiCua(buoi({ source: "TRIAL" }), [loai({ code: "TN", source: "TRIAL", isActive: false })])).toBeNull();
  });

  it("không loại nào khớp ⇒ null, buổi rơi ra hẳn chứ không rơi nhầm sang loại khác", () => {
    expect(loaiCua(buoi({ role: "ASSISTANT" }), [loai()])).toBeNull();
  });
});

describe("congDayCuaNguoi", () => {
  it("tính theo BUỔI: mỗi buổi một hệ số", () => {
    const r = congDayCuaNguoi([buoi(), buoi({ id: "s2" }), buoi({ id: "s3" })], [loai()]);
    expect(r.dong[0].buoi).toBe(3);
    expect(r.tongCong).toBe(3);
  });

  it("hệ số là DỮ LIỆU: đổi hệ số ⇒ đổi công, không đụng mã", () => {
    const nua = congDayCuaNguoi([buoi(), buoi({ id: "s2" })], [loai({ factor: 0.5 })]);
    expect(nua.tongCong).toBe(1);
  });

  it("tính theo GIỜ: quy ra giờ rồi nhân hệ số", () => {
    const r = congDayCuaNguoi(
      [buoi({ minutes: 90 }), buoi({ id: "s2", minutes: 120 })],
      [loai({ basis: "PER_HOUR" })],
    );
    expect(r.dong[0].phut).toBe(210);
    expect(r.tongCong).toBe(3.5);
  });

  it("loại theo GIỜ mà buổi không suy được giờ ⇒ ĐẾM RIÊNG, không đoán 1 buổi = 1 giờ", () => {
    // Nếu im lặng bỏ qua thì tổng ra nhỏ hơn sự thật mà không ai biết vì sao; nếu đoán bừa thì
    // ra một con số sai. Đếm riêng để màn nói được "N buổi chưa có giờ nên chưa tính".
    const r = congDayCuaNguoi(
      [buoi({ minutes: 60 }), buoi({ id: "s2", minutes: null })],
      [loai({ basis: "PER_HOUR" })],
    );
    expect(r.dong[0].buoi).toBe(1);
    expect(r.dong[0].boQuaThieuGio).toBe(1);
    expect(r.tongCong).toBe(1);
  });

  it("loại TẮT 'cộng vào kỳ' vẫn liệt kê nhưng không vào tổng", () => {
    const r = congDayCuaNguoi(
      [buoi(), buoi({ id: "t1", source: "TRIAL" })],
      [loai(), loai({ code: "TN", name: "Trải nghiệm", source: "TRIAL", countsInPeriod: false })],
    );
    expect(r.tongBuoi).toBe(2);
    expect(r.tongCong).toBe(1); // chỉ lớp chính
    expect(r.dong.find((d) => d.code === "TN")?.buoi).toBe(1);
  });

  it("cùng một buổi lọt vào hai lần thì chỉ đếm một", () => {
    const r = congDayCuaNguoi([buoi(), buoi()], [loai()]);
    expect(r.dong[0].buoi).toBe(1);
    expect(r.tongCong).toBe(1);
  });

  it("cùng id nhưng KHÁC nguồn là hai buổi khác nhau", () => {
    // `ClassSession` và `TrialClassSession` là hai bảng, id có thể trùng nhau về mặt lý thuyết.
    const r = congDayCuaNguoi(
      [buoi({ id: "x" }), buoi({ id: "x", source: "TRIAL" })],
      [loai(), loai({ code: "TN", source: "TRIAL" })],
    );
    expect(r.tongBuoi).toBe(2);
  });

  it("không buổi nào / không danh mục nào ⇒ số 0 sạch, không ném lỗi", () => {
    expect(congDayCuaNguoi([], [loai()]).tongCong).toBe(0);
    expect(congDayCuaNguoi([buoi()], []).tongCong).toBe(0);
  });
});

describe("suy số phút", () => {
  it("hai chuỗi HH:mm", () => {
    expect(phutGiuaHaiGio("08:00", "09:30")).toBe(90);
    expect(phutGiuaHaiGio("08:00", "08:00")).toBeNull();
    expect(phutGiuaHaiGio("22:00", "01:00")).toBeNull(); // qua nửa đêm — không đoán hộ
    expect(phutGiuaHaiGio("xin chào", "09:00")).toBeNull();
    expect(phutGiuaHaiGio(null, "09:00")).toBeNull();
  });

  it("hai mốc thời gian thực", () => {
    const a = new Date("2026-09-10T01:00:00Z");
    const b = new Date("2026-09-10T02:45:00Z");
    expect(phutGiuaHaiMoc(a, b)).toBe(105);
    expect(phutGiuaHaiMoc(b, a)).toBeNull();
    expect(phutGiuaHaiMoc(a, null)).toBeNull();
  });
});

describe("loaiCua — phân loại buổi là chiều thứ ba (07/09)", () => {
  // Dòng BAO SÂN (categoryCode null) + dòng RIÊNG cho Workshop. Đây đúng là hình dạng sau khi
  // BLĐ thêm một dòng trên màn: sáu dòng seed cũ mang null, dòng mới mang mã phân loại.
  const baoSan = loai({ code: "LOP_CHINH", factor: 1 });
  const ws = loai({ code: "LOP_WORKSHOP", categoryCode: "WORKSHOP", factor: 1.2 });

  it("dòng riêng thắng dòng bao sân khi buổi đúng phân loại đó", () => {
    expect(loaiCua(buoi({ categoryCode: "WORKSHOP" }), [baoSan, ws])?.code).toBe("LOP_WORKSHOP");
  });

  it("thứ tự trong danh mục không đổi kết quả — dòng riêng vẫn thắng", () => {
    // Nếu `loaiCua` chỉ `find` một lượt thì kết quả phụ thuộc thứ tự Postgres trả về, tức tổng
    // công dạy đổi khi ai đó sửa `displayOrder`. Khoá lại bằng test này.
    expect(loaiCua(buoi({ categoryCode: "WORKSHOP" }), [ws, baoSan])?.code).toBe("LOP_WORKSHOP");
  });

  it("phân loại KHÁC rơi về dòng bao sân — thêm dòng mới không đụng buổi cũ", () => {
    expect(loaiCua(buoi({ categoryCode: "CHINH_THUC" }), [baoSan, ws])?.code).toBe("LOP_CHINH");
    expect(loaiCua(buoi({ categoryCode: null }), [baoSan, ws])?.code).toBe("LOP_CHINH");
  });

  it("dòng riêng bị TẮT thì rơi về bao sân, không rơi ra ngoài", () => {
    const tat = { ...ws, isActive: false };
    expect(loaiCua(buoi({ categoryCode: "WORKSHOP" }), [baoSan, tat])?.code).toBe("LOP_CHINH");
  });

  it("chỉ có dòng riêng, không có bao sân ⇒ buổi phân loại khác rơi ra hẳn", () => {
    expect(loaiCua(buoi({ categoryCode: "CHINH_THUC" }), [ws])).toBeNull();
    expect(loaiCua(buoi({ categoryCode: "WORKSHOP" }), [ws])?.code).toBe("LOP_WORKSHOP");
  });

  it("hệ số của dòng riêng thật sự vào tổng — Workshop 120% ra 1,2 công", () => {
    const r = congDayCuaNguoi(
      [buoi({ id: "a", categoryCode: "WORKSHOP" }), buoi({ id: "b", categoryCode: "CHINH_THUC" })],
      [baoSan, ws],
    );
    expect(r.tongCong).toBe(2.2);
    expect(r.tongBuoi).toBe(2);
  });

  it("vai khác nhau vẫn tách nhau dù cùng phân loại", () => {
    const tg = loai({ code: "TG_WS", role: "ASSISTANT", categoryCode: "WORKSHOP", factor: 0.5 });
    const dm = [baoSan, ws, tg];
    expect(loaiCua(buoi({ categoryCode: "WORKSHOP" }), dm)?.code).toBe("LOP_WORKSHOP");
    expect(loaiCua(buoi({ role: "ASSISTANT", categoryCode: "WORKSHOP" }), dm)?.code).toBe("TG_WS");
  });
});
