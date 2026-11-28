import { describe, expect, it } from "vitest";

import { SATA_ROBO_LOCATIONS, SATA_ROBO_PHONE } from "@/lib/locations";

import { lienHeChoHocSinh, lienHeCuaCoSo } from "./lien-he";

describe("[LH] liên hệ trung tâm cho Tổng quan", () => {
  it("[LH-01] số điện thoại + Zalo là hằng CHUNG của công ty (không theo cơ sở) và khớp `SATA_ROBO_PHONE`", () => {
    for (const ma of ["CS1", "CS2", null, undefined, "XX"]) {
      const l = lienHeCuaCoSo(ma);
      expect(l.soHien).toBe(SATA_ROBO_PHONE.hien);
      expect(l.soTho).toBe(SATA_ROBO_PHONE.tho);
      expect(l.zaloUrl).toBe(SATA_ROBO_PHONE.zalo);
    }
    expect(lienHeCuaCoSo("CS1").soHien).toBe("0837.312.860");
  });

  it("[LH-02] giờ mở cửa + tên theo ĐÚNG cơ sở của con; mã lạ/trống ⇒ giờ của trụ sở, tên null", () => {
    for (const cs of SATA_ROBO_LOCATIONS) {
      const l = lienHeCuaCoSo(cs.code);
      expect(l.gioMoCua).toBe(cs.workingHours);
      expect(l.tenCoSo).toBe(cs.name);
    }
    const hq = SATA_ROBO_LOCATIONS.find((l) => l.isHQ)!;
    expect(lienHeCuaCoSo(null).gioMoCua).toBe(hq.workingHours);
    expect(lienHeCuaCoSo("khong-co").tenCoSo).toBeNull();
    expect(lienHeCuaCoSo("CS1").gioMoCua).toBe("T3 - CN: 8:00 - 21:00");
  });

  it("[LH-03] KHÔNG chứa số cũ của cơ sở (đo trên DB TEST: Center.phone = 0818823720 là số trước 24/09)", () => {
    expect(JSON.stringify(lienHeCuaCoSo("CS1"))).not.toMatch(/0818|0702|193/);
  });
});

describe("[LH-HS] liên hệ cho HỌC SINH (Student Mode): chỉ chữ, KHÔNG liên kết ngoài", () => {
  it("[LH-HS-01] DTO có ĐÚNG ba khoá {soHien, gioMoCua, tenCoSo}; KHÔNG zaloUrl, KHÔNG soTho (tel:), không chuỗi nào dạng URL/tel:", () => {
    for (const ma of ["CS1", "CS2", null, undefined, "XX"]) {
      const l = lienHeChoHocSinh(ma);
      expect(Object.keys(l).sort()).toEqual(["gioMoCua", "soHien", "tenCoSo"]);
      const tho = JSON.stringify(l);
      expect(tho).not.toMatch(/zalo|https?:|tel:|0837312860/i); // số THUẦN (dùng cho tel:) cũng không lọt vào
    }
  });

  it("[LH-HS-02] giá trị đúng theo cơ sở: số in chung · giờ mở cửa của cơ sở · cơ sở lạ ⇒ giờ của trụ sở và tenCoSo null", () => {
    const cs2 = SATA_ROBO_LOCATIONS.find((l) => l.code === "CS2")!;
    expect(lienHeChoHocSinh("CS2")).toEqual({ soHien: SATA_ROBO_PHONE.hien, gioMoCua: cs2.workingHours, tenCoSo: cs2.name });
    const hq = SATA_ROBO_LOCATIONS.find((l) => l.isHQ)!;
    expect(lienHeChoHocSinh("XX")).toEqual({ soHien: SATA_ROBO_PHONE.hien, gioMoCua: hq.workingHours, tenCoSo: null });
    // đồng nhất với bản đầy đủ của phụ huynh ở ba trường chung
    const day = lienHeCuaCoSo("CS1");
    expect(lienHeChoHocSinh("CS1")).toEqual({ soHien: day.soHien, gioMoCua: day.gioMoCua, tenCoSo: day.tenCoSo });
  });
});
