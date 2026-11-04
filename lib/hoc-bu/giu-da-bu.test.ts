// [GDB-*] — luật GIỮ "đã học bù" khi lưu điểm danh (T02, HB-05/HB-40). Thuần: bảng chân trị đầy đủ.
import { describe, expect, it } from "vitest";
import { doiHaDaBu, kiemLyDoKhongCanBu, laChonKhongCanBuMoi, laVangDiemDanh, makeupStatusSauKhiLuu, type MakeupStatusDiemDanh } from "@/lib/hoc-bu/giu-da-bu";
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";

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

describe("[GDB] 'Không cần bù' (22/10/2026) — chủ dự án đảo một phần chốt 02/10", () => {
  it("[GDB-09] vắng + nhân viên chọn TƯỜNG MINH 'Không cần bù' ⇒ NONE, với mọi loại vắng và mọi bản ghi cũ chưa MADE_UP", () => {
    for (const status of VANG) {
      for (const cu of CU.filter((x) => x !== "MADE_UP")) {
        for (const guiLen of GUI) {
          expect(makeupStatusSauKhiLuu({ status, cu, guiLen: guiLen === "MADE_UP" ? "NONE" : guiLen, khongCanBu: true }), `${status}/${cu}/${guiLen}`).toBe("NONE");
        }
      }
    }
  });

  it("[GDB-10] 'Không cần bù' KHÔNG thắng hai luật cao hơn: đã MADE_UP thì giữ; client gửi MADE_UP thì MADE_UP; có mặt thì NONE (đi học không có gì để bù)", () => {
    for (const status of VANG) {
      expect(makeupStatusSauKhiLuu({ status, cu: "MADE_UP", guiLen: "NONE", khongCanBu: true })).toBe("MADE_UP");
      expect(makeupStatusSauKhiLuu({ status, cu: "NEEDS_MAKEUP", guiLen: "MADE_UP", khongCanBu: true })).toBe("MADE_UP");
    }
    for (const status of CO_MAT) expect(makeupStatusSauKhiLuu({ status, cu: "NEEDS_MAKEUP", guiLen: "NONE", khongCanBu: true })).toBe("NONE");
  });

  it("[GDB-11] GIỮ lựa chọn: nơi khác lưu lại mà không nói gì (guiLen trống) cho bản ghi cũ vắng + NONE ⇒ vẫn NONE; sang vắng khác (ABSENT→EXCUSED) cũng giữ", () => {
    for (const status of VANG) {
      for (const statusCu of VANG) {
        expect(makeupStatusSauKhiLuu({ status, cu: "NONE", guiLen: undefined, statusCu }), `${statusCu}→${status}`).toBe("NONE");
      }
    }
  });

  it("[GDB-12] ĐỐI CHỨNG ÂM của [GDB-11]: KHÔNG giữ khi bản ghi cũ là CÓ MẶT (vắng mới ⇒ cần bù), khi không biết trạng thái cũ, khi cũ là NEEDS_MAKEUP, hoặc khi client nói tường minh NEEDS_MAKEUP (bấm lại 'Cần học bù')", () => {
    for (const status of VANG) {
      for (const statusCu of CO_MAT) expect(makeupStatusSauKhiLuu({ status, cu: "NONE", guiLen: undefined, statusCu })).toBe("NEEDS_MAKEUP");
      expect(makeupStatusSauKhiLuu({ status, cu: "NONE", guiLen: undefined, statusCu: undefined })).toBe("NEEDS_MAKEUP");
      expect(makeupStatusSauKhiLuu({ status, cu: "NEEDS_MAKEUP", guiLen: undefined, statusCu: "ABSENT" })).toBe("NEEDS_MAKEUP");
      expect(makeupStatusSauKhiLuu({ status, cu: undefined, guiLen: undefined, statusCu: "ABSENT" })).toBe("NEEDS_MAKEUP");
      expect(makeupStatusSauKhiLuu({ status, cu: "NONE", guiLen: "NEEDS_MAKEUP", statusCu: "ABSENT" })).toBe("NEEDS_MAKEUP");
    }
  });

  it("[GDB-13] MẶC ĐỊNH KHÔNG ĐỔI: không cờ + không statusCu ⇒ 'NONE' gửi lên cho buổi vắng vẫn là cần bù (các đường lưu khác — phiếu nghỉ, dịch vụ — không được thấy hành vi mới)", () => {
    for (const status of VANG) {
      for (const guiLen of [undefined, "NONE"] as const) {
        expect(makeupStatusSauKhiLuu({ status, cu: "NONE", guiLen })).toBe("NEEDS_MAKEUP");
        expect(makeupStatusSauKhiLuu({ status, cu: "NONE", guiLen, khongCanBu: false })).toBe("NEEDS_MAKEUP");
      }
    }
  });
});

describe("[GDB] 'Không cần bù' chỉ cấp quản lý cơ sở + bắt buộc lý do (22/10/2026) — thế nào là lựa chọn MỚI", () => {
  it("[GDB-14] MỚI = vắng + kết quả NONE + bản ghi cũ CHƯA là NONE (chưa có bản ghi, hoặc đang cần bù)", () => {
    for (const status of VANG) {
      for (const cu of [undefined, "NEEDS_MAKEUP"] as const) {
        expect(laChonKhongCanBuMoi({ status, cu, sau: "NONE" }), `${status}/${cu}`).toBe(true);
      }
    }
  });

  it("[GDB-15] KHÔNG mới: bản ghi cũ đã NONE (lưới gửi lại giá trị đã tải / panel GV giữ lại) — đòi quyền + lý do lần nữa là chặn oan mọi lần sửa ghi chú", () => {
    for (const status of VANG) expect(laChonKhongCanBuMoi({ status, cu: "NONE", sau: "NONE" })).toBe(false);
    // đúng đường GV: cu NONE + không nói gì + trạng thái cũ vắng ⇒ luật giữ NONE, nhưng KHÔNG phải quyết định mới
    const sau = makeupStatusSauKhiLuu({ status: "ABSENT", cu: "NONE", guiLen: undefined, statusCu: "ABSENT" });
    expect(sau).toBe("NONE");
    expect(laChonKhongCanBuMoi({ status: "ABSENT", cu: "NONE", sau })).toBe(false);
  });

  it("[GDB-16] KHÔNG mới: kết quả không phải NONE (cần bù / đã bù), hoặc có mặt (đi học không có gì để bù)", () => {
    for (const status of VANG) {
      expect(laChonKhongCanBuMoi({ status, cu: "NEEDS_MAKEUP", sau: "NEEDS_MAKEUP" })).toBe(false);
      expect(laChonKhongCanBuMoi({ status, cu: undefined, sau: "MADE_UP" })).toBe(false);
    }
    for (const status of CO_MAT) expect(laChonKhongCanBuMoi({ status, cu: "NEEDS_MAKEUP", sau: "NONE" })).toBe(false);
  });

  it("[GDB-17] lý do: thiếu / rỗng / toàn khoảng trắng / ngắn hơn ngưỡng ⇒ câu từ chối; đủ ngưỡng (sau khi cắt khoảng trắng) ⇒ null", () => {
    for (const lyDo of [undefined, null, "", "   ", "x".repeat(LY_DO_TOI_THIEU - 1), `  ${"x".repeat(LY_DO_TOI_THIEU - 1)}  `]) {
      expect(kiemLyDoKhongCanBu(lyDo), String(lyDo)).toContain(String(LY_DO_TOI_THIEU));
    }
    expect(kiemLyDoKhongCanBu("x".repeat(LY_DO_TOI_THIEU))).toBeNull();
    expect(kiemLyDoKhongCanBu(`  ${"x".repeat(LY_DO_TOI_THIEU)}  `)).toBeNull();
  });
});
