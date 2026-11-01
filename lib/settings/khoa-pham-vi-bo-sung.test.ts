// lib/settings/khoa-pham-vi-bo-sung.test.ts — SÁU KHOÁ CÒN THIẾU của bộ cài đặt "thu học phí theo phạm vi học"
// (BA Phần 4(b) §C.2: S5 · S9 · S10 · S12 · S15 · S20). THUẦN, không DB.
//
// Vì sao một tệp riêng, theo bảng: sáu khoá này CHƯA CÓ NGƯỜI ĐỌC nào (tính năng nối sau). Khoá không ai đọc
// thì không ca hành vi nào chạm tới nó — sửa nhầm mặc định, biên hay phạm vi cài-riêng-theo-cơ-sở đều xanh vĩnh
// viễn. Bảng dưới là CHỖ DUY NHẤT ghim ba thứ ấy cho từng khoá, nên mỗi dòng đi kèm một ý nghĩa nghiệp vụ,
// không chỉ là "giá trị hiện tại".
//
// ⚠️ Mặc định của S12 là `WARN`: đó là chế độ ĐO, KHÔNG thực hiện luật "hết ân hạn thì rời lớp". Ghim ở đây để
// ai muốn đổi sang `ENFORCE` phải sửa MỘT dòng có chủ đích và đọc lý do ngay cạnh.
import { describe, expect, it } from "vitest";
import { SO_BUOI_MOI_HOC_PHAN, TONG_SO_BUOI_KHOA_AP_LUAT } from "@/lib/orders/so-buoi-hoc-phan";
import { SETTINGS, validateSettingValue, type SettingKey } from "./registry";
import { nhanCuaKey } from "./nhan-van-hanh";

type Dong = {
  s: string;
  key: SettingKey;
  macDinh: unknown;
  /** Kiểu số nguyên: biên được nhận. Kiểu danh sách chọn: không khai. */
  bien?: { min: number; max: number };
  /** Kiểu danh sách chọn: đúng các giá trị `z.enum` nhận. */
  luaChon?: readonly string[];
  coSoSuaRieng: boolean;
  tab: "hoc-vien" | "tien";
  donVi?: string;
  canThan: boolean;
};

const BANG: readonly Dong[] = [
  { s: "S5", key: "enrollment.catchUpMaxStudentsPerGroup", macDinh: 0, bien: { min: 0, max: 30 }, coSoSuaRieng: true, tab: "hoc-vien", donVi: "học viên", canThan: false },
  { s: "S9", key: "enrollment.minClassSessionsToAdmit", macDinh: 12, bien: { min: 0, max: 48 }, coSoSuaRieng: true, tab: "hoc-vien", donVi: "buổi", canThan: false },
  { s: "S10", key: "enrollment.transferMaxLessonGap", macDinh: 4, bien: { min: 0, max: 12 }, coSoSuaRieng: true, tab: "hoc-vien", donVi: "bài", canThan: false },
  { s: "S12", key: "enrollment.entitlementGateMode", macDinh: "WARN", luaChon: ["OFF", "WARN", "ENFORCE"], coSoSuaRieng: true, tab: "hoc-vien", canThan: true },
  { s: "S15", key: "pricing.sameTimeChildOrder", macDinh: "LOWER_VALUE_FIRST", luaChon: ["LOWER_VALUE_FIRST", "HIGHER_VALUE_FIRST"], coSoSuaRieng: false, tab: "tien", canThan: true },
  { s: "S20", key: "orders.paymentDueDays", macDinh: 7, bien: { min: 1, max: 60 }, coSoSuaRieng: true, tab: "tien", donVi: "ngày", canThan: false },
];

describe("[KPV] sáu khoá bổ sung của thu học phí theo phạm vi học", () => {
  it("[KPV-00] đối chứng: bảng có đủ SÁU dòng và khoá nào cũng có thật trong registry (không rỗng vì gõ sai tên)", () => {
    expect(BANG.map((d) => d.s)).toEqual(["S5", "S9", "S10", "S12", "S15", "S20"]);
    for (const d of BANG) expect(SETTINGS[d.key], d.s).toBeDefined();
  });

  for (const d of BANG) {
    describe(`[KPV-${d.s}] ${d.key}`, () => {
      it("mặc định đúng bảng BA và tự thoả schema của nó", () => {
        expect(SETTINGS[d.key].default).toBe(d.macDinh);
        expect(validateSettingValue(d.key, d.macDinh).ok).toBe(true);
      });

      it("phạm vi cài-riêng-theo-cơ-sở đúng bảng, và KHÔNG khai qlcsSuaDuoc (Quản lý cơ sở không tự sửa)", () => {
        expect(SETTINGS[d.key].centerOverridable).toBe(d.coSoSuaRieng);
        expect((SETTINGS[d.key] as { qlcsSuaDuoc?: boolean }).qlcsSuaDuoc).toBeUndefined();
      });

      if (d.bien) {
        const { min, max } = d.bien;
        it(`nhận đúng biên ${min}..${max}, từ chối ngoài biên và số lẻ`, () => {
          expect(validateSettingValue(d.key, min).ok).toBe(true);
          expect(validateSettingValue(d.key, max).ok).toBe(true);
          expect(validateSettingValue(d.key, min - 1).ok).toBe(false);
          expect(validateSettingValue(d.key, max + 1).ok).toBe(false);
          expect(validateSettingValue(d.key, min + 0.5).ok).toBe(false);
          expect(validateSettingValue(d.key, String(min)).ok).toBe(false);
        });
      }

      if (d.luaChon) {
        const luaChon = d.luaChon;
        it("schema nhận ĐÚNG các lựa chọn khai và từ chối giá trị lạ", () => {
          for (const v of luaChon) expect(validateSettingValue(d.key, v).ok, v).toBe(true);
          expect(validateSettingValue(d.key, "warn").ok).toBe(false);
          expect(validateSettingValue(d.key, "").ok).toBe(false);
          expect(validateSettingValue(d.key, 1).ok).toBe(false);
        });

        it("nhãn vận hành có danh sách chọn KHỚP KHÍT các giá trị (thiếu một giá trị là không ai chọn được)", () => {
          const chon = nhanCuaKey(d.key).chon;
          expect(chon?.map((c) => c.giaTri).sort()).toEqual([...luaChon].sort());
        });
      }

      it("nhãn vận hành: đúng tab, đúng đơn vị, đúng mức cần-cân-nhắc", () => {
        const n = nhanCuaKey(d.key);
        expect(n.tab).toBe(d.tab);
        expect(n.donVi).toBe(d.donVi);
        expect(n.canThan === true).toBe(d.canThan);
      });

      it("giải thích nói rõ khoá CHỈ có tác dụng khi bật 'Thu học phí theo phạm vi học' (luật 12: không hứa suông)", () => {
        expect(nhanCuaKey(d.key).giaiThich).toContain("Thu học phí theo phạm vi học");
      });
    });
  }

  it("[KPV-S9-neo] trần của S9 NEO vào hằng tổng số buổi của khoá áp luật (đo trên REGISTRY, không phải trên bảng ở đầu tệp)", () => {
    const k = "enrollment.minClassSessionsToAdmit";
    expect(validateSettingValue(k, TONG_SO_BUOI_KHOA_AP_LUAT).ok).toBe(true);
    expect(validateSettingValue(k, TONG_SO_BUOI_KHOA_AP_LUAT + 1).ok).toBe(false);
    // Mặc định = đúng MỘT học phần (12 buổi): lớp còn dưới một học phần thì không nhận học viên mới.
    expect(SETTINGS[k].default).toBe(SO_BUOI_MOI_HOC_PHAN);
  });

  it("[KPV-S5-0] số 0 của S5 nghĩa là KHÔNG GIỚI HẠN — giải thích phải nói điều đó (người vận hành đọc 0 là 'không ai được vào')", () => {
    const g = nhanCuaKey("enrollment.catchUpMaxStudentsPerGroup").giaiThich;
    expect(g).toMatch(/0[^.]*không giới hạn/i);
  });

  it("[KPV-S12-WARN] S12 mặc định WARN và giải thích nói WARN chỉ CẢNH BÁO, không tự cho học viên rời lớp", () => {
    const n = nhanCuaKey("enrollment.entitlementGateMode");
    const warn = n.chon?.find((c) => c.giaTri === "WARN");
    expect(warn?.hauQua).toMatch(/chỉ cảnh báo/i);
    const enforce = n.chon?.find((c) => c.giaTri === "ENFORCE");
    expect(enforce?.hauQua).toMatch(/chặn/i);
  });

  it("[KPV-S12-TRUOC-KHI-BAT] giải thích S12 dặn: trước khi bật 'Thu học phí theo phạm vi học' ở cơ sở thật thì phải để đúng lựa chọn ENFORCE (BA C.2) — và gọi nó đúng bằng nhãn của lựa chọn", () => {
    // Mặc định WARN là chế độ ĐO. Câu dặn này là thứ duy nhất báo người vận hành rằng bật cờ thu tiền mà để WARN thì học viên hết
    // buổi vẫn học không giới hạn mà không ai hay. Xoá nó thì mọi ca khác ở trên vẫn xanh (đã cấy thử: xanh).
    const n = nhanCuaKey("enrollment.entitlementGateMode");
    const enforce = n.chon?.find((c) => c.giaTri === "ENFORCE");
    expect(enforce?.nhan).toBeTruthy();
    expect(n.giaiThich).toMatch(/Trước khi bật/);
    expect(n.giaiThich).toContain(`“${enforce?.nhan}”`);
    const warn = n.chon?.find((c) => c.giaTri === "WARN");
    expect(n.giaiThich).toContain(`“${warn?.nhan}”`);
  });

  it("[KPV-S15-khac] S15 và 'Ưu đãi anh chị em áp cho con nào' là HAI nút khác nhau — nhãn S15 phải nói nó chỉ là ô chọn sẵn khi mua cùng lúc", () => {
    const s15 = nhanCuaKey("pricing.sameTimeChildOrder");
    expect(s15.ten).not.toBe(nhanCuaKey("billing.siblingTarget").ten);
    expect(s15.giaiThich).toMatch(/cùng lúc/);
    expect(s15.giaiThich).toMatch(/phụ huynh chọn/i);
  });
});
