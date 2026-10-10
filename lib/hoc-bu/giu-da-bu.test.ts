// [GDB-*] — luật GIỮ "đã học bù" khi lưu điểm danh (T02, HB-05/HB-40). Thuần: bảng chân trị đầy đủ.
import { describe, expect, it } from "vitest";
import { doiHaDaBu, laVangDiemDanh, makeupStatusSauKhiLuu, type MakeupStatusDiemDanh } from "@/lib/hoc-bu/giu-da-bu";

const CU: (MakeupStatusDiemDanh | undefined)[] = [undefined, "NONE", "NEEDS_MAKEUP", "MADE_UP"];
const GUI: (MakeupStatusDiemDanh | undefined)[] = [undefined, "NONE", "NEEDS_MAKEUP", "MADE_UP"];
const VANG = ["ABSENT", "EXCUSED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"];
const CO_MAT = ["PRESENT", "LATE"];

describe("[GDB] makeupStatusSauKhiLuu — MADE_UP chỉ do module học bù gỡ", () => {
  it("[GDB-01] đã MADE_UP thì GIỮ MADE_UP với MỌI trạng thái điểm danh và MỌI giá trị client gửi", () => {
    for (const status of [...VANG, ...CO_MAT]) {
      for (const guiLen of GUI) {
        expect(makeupStatusSauKhiLuu({ status, cu: "MADE_UP", guiLen }), `${status}/${guiLen}`).toBe("MADE_UP");
      }
    }
  });

  it("[GDB-02] chưa MADE_UP + có mặt ⇒ NONE, bất kể client gửi gì (đi học thì không có gì để bù)", () => {
    for (const status of CO_MAT) {
      for (const cu of CU.filter((x) => x !== "MADE_UP")) {
        for (const guiLen of GUI) {
          expect(makeupStatusSauKhiLuu({ status, cu, guiLen }), `${status}/${cu}/${guiLen}`).toBe("NONE");
        }
      }
    }
  });

  it("[GDB-03] chưa MADE_UP + vắng ⇒ CẦN BÙ — cả vắng CÓ PHÉP; client gửi NONE cũng ra cần bù (chốt 02/10: không còn 'không bù' ở lưới)", () => {
    for (const status of VANG) {
      for (const cu of CU.filter((x) => x !== "MADE_UP")) {
        for (const guiLen of [undefined, "NONE", "NEEDS_MAKEUP"] as const) {
          expect(makeupStatusSauKhiLuu({ status, cu, guiLen }), `${status}/${cu}/${guiLen}`).toBe("NEEDS_MAKEUP");
        }
      }
    }
  });

  it("[GDB-04] chỉ client gửi TƯỜNG MINH MADE_UP mới đặt được 'đã bù' cho buổi vắng (nhân viên chọn 'Đã học bù' ở lưới admin)", () => {
    for (const status of VANG) {
      expect(makeupStatusSauKhiLuu({ status, cu: "NEEDS_MAKEUP", guiLen: "MADE_UP" })).toBe("MADE_UP");
      expect(makeupStatusSauKhiLuu({ status, cu: undefined, guiLen: "MADE_UP" })).toBe("MADE_UP");
    }
    // Nhưng có mặt thì không: đi học đúng buổi không "đã bù".
    expect(makeupStatusSauKhiLuu({ status: "PRESENT", cu: "NEEDS_MAKEUP", guiLen: "MADE_UP" })).toBe("NONE");
  });

  it("[GDB-05] ca đúng chỗ HB-05: panel GV gửi PRESENT không kèm makeupStatus cho dòng đã MADE_UP ⇒ KHÔNG mất", () => {
    expect(makeupStatusSauKhiLuu({ status: "PRESENT", cu: "MADE_UP", guiLen: undefined })).toBe("MADE_UP");
    expect(makeupStatusSauKhiLuu({ status: "ABSENT_EXCUSED", cu: "MADE_UP", guiLen: undefined })).toBe("MADE_UP");
  });

  it("[GDB-06] laVangDiemDanh: chỉ PRESENT / LATE là có mặt", () => {
    for (const s of CO_MAT) expect(laVangDiemDanh(s)).toBe(false);
    for (const s of VANG) expect(laVangDiemDanh(s)).toBe(true);
  });
});

describe("[GDB] doiHaDaBu — client ĐÒI hạ một buổi vắng đã bù", () => {
  it("[GDB-07] buổi vắng đã MADE_UP mà client gửi NEEDS_MAKEUP / NONE tường minh ⇒ true (lưới cũ mở trước lúc bù xong)", () => {
    for (const status of VANG) {
      for (const guiLen of ["NEEDS_MAKEUP", "NONE"] as const) {
        expect(doiHaDaBu({ status, cu: "MADE_UP", guiLen }), `${status}/${guiLen}`).toBe(true);
      }
    }
  });

  it("[GDB-08] ÂM: client gửi MADE_UP, hoặc không gửi gì, hoặc buổi đã có mặt (lưới gửi NONE cho dòng có mặt), hoặc chưa MADE_UP ⇒ false", () => {
    for (const status of VANG) {
      expect(doiHaDaBu({ status, cu: "MADE_UP", guiLen: "MADE_UP" })).toBe(false);
      expect(doiHaDaBu({ status, cu: "MADE_UP", guiLen: undefined })).toBe(false);
      for (const cu of [undefined, "NONE", "NEEDS_MAKEUP"] as const) {
        expect(doiHaDaBu({ status, cu, guiLen: "NEEDS_MAKEUP" })).toBe(false);
      }
    }
    for (const status of CO_MAT) expect(doiHaDaBu({ status, cu: "MADE_UP", guiLen: "NONE" })).toBe(false);
  });
});
