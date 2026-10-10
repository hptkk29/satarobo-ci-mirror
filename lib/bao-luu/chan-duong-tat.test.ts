// lib/bao-luu/chan-duong-tat.test.ts — chặn đặt "Bảo lưu" ngoài hồ sơ. PHIÊN 1.
//
// HAI TẦNG, vì thứ cần khoá có hai nửa:
//   · phép quyết định (thuần)         — `[BL1-CD-0x]`;
//   · DÂY NỐI vào năm chỗ ghi `PAUSED` — `[BL1-CD-W*]`. Test hành vi của từng action đều giả lập
//     auth/DB nên quên gọi `chanDatBaoLuuNgoaiHoSo` là KHÔNG ca nào đỏ (cùng lý do lưới
//     `[DBL-W*]`). Lưới này đếm lời gọi trên mã ĐÃ BỎ CHÚ THÍCH (luật 11): chú thích giải thích
//     bản vá chứa đúng chuỗi bộ so khớp đang tìm.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chanDatBaoLuuNgoaiHoSo, type DuongDatBaoLuu } from "./chan-duong-tat";

const DUONG: DuongDatBaoLuu[] = [
  "DOI_TRANG_THAI_GHI_DANH",
  "FORM_GHI_DANH",
  "FORM_HOC_VIEN",
  "IMPORT_EXCEL",
];

describe("[BL1-CD] chanDatBaoLuuNgoaiHoSo", () => {
  it("[BL1-CD-01] ĐẶT PAUSED từ trạng thái khác ⇒ bị chặn trên MỌI đường, thông điệp nhắc chữ Bảo lưu", () => {
    for (const duong of DUONG) {
      const loi = chanDatBaoLuuNgoaiHoSo({ duong, truoc: "ACTIVE", sau: "PAUSED" });
      expect(loi, duong).toMatch(/Bảo lưu/);
    }
  });

  it("[BL1-CD-02] TẠO MỚI với PAUSED (truoc = null/undefined) ⇒ bị chặn", () => {
    expect(chanDatBaoLuuNgoaiHoSo({ duong: "FORM_HOC_VIEN", truoc: null, sau: "PAUSED" })).not.toBeNull();
    expect(chanDatBaoLuuNgoaiHoSo({ duong: "FORM_GHI_DANH", truoc: undefined, sau: "PAUSED" })).not.toBeNull();
  });

  it("[BL1-CD-03] đã PAUSED sẵn mà gửi lại PAUSED (sửa ô khác) ⇒ KHÔNG chặn — không thì mọi lượt sửa hồ sơ học viên đang bảo lưu đều hỏng", () => {
    for (const duong of DUONG) {
      expect(chanDatBaoLuuNgoaiHoSo({ duong, truoc: "PAUSED", sau: "PAUSED" }), duong).toBeNull();
    }
  });

  it("[BL1-CD-04] mọi trạng thái KHÁC PAUSED ⇒ không chặn; thao tác không chạm trạng thái (sau = undefined) ⇒ không chặn", () => {
    for (const sau of ["ACTIVE", "STUDYING", "INACTIVE", "GRADUATED", "WITHDREW", null, undefined]) {
      expect(chanDatBaoLuuNgoaiHoSo({ duong: "FORM_HOC_VIEN", truoc: "ACTIVE", sau }), String(sau)).toBeNull();
    }
  });

  it("[BL1-CD-05] gỡ PAUSED (PAUSED → ACTIVE) không thuộc phép chặn này", () => {
    expect(chanDatBaoLuuNgoaiHoSo({ duong: "FORM_HOC_VIEN", truoc: "PAUSED", sau: "ACTIVE" })).toBeNull();
  });

  it("[BL1-CD-06] mỗi đường có thông điệp riêng; import chỉ cách chỉnh file, không nhắc 'hộp đổi trạng thái'", () => {
    const m = (duong: DuongDatBaoLuu) => chanDatBaoLuuNgoaiHoSo({ duong, truoc: null, sau: "PAUSED" })!;
    expect(new Set(DUONG.map(m)).size).toBe(DUONG.length);
    expect(m("IMPORT_EXCEL")).toMatch(/Excel/);
    expect(m("IMPORT_EXCEL")).not.toMatch(/hộp đổi trạng thái/);
    expect(m("DOI_TRANG_THAI_GHI_DANH")).toMatch(/hồ sơ học viên/);
  });
});

/** Mã THẬT — đã bỏ chú thích (luật 11). */
function maThat(duongDan: string): string {
  const src = readFileSync(resolve(process.cwd(), duongDan), "utf8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trimStart().startsWith("//"))
    .join("\n");
}

/**
 * Đếm lời gọi KHỚP ĐỦ BA THỨ: đúng đường, đúng `truoc`, đúng `sau`, VÀ có câu `return` ngay sau.
 *
 * ⚠️ Bản đầu chỉ đếm tên đường. Cấy `truoc: "PAUSED"` (giả vờ học viên đã bảo lưu sẵn ⇒ cổng
 * không bao giờ chặn) hay `sau: undefined` thì lưới VẪN XANH — cổng còn trên giấy, hết tác dụng.
 * Một lời gọi mà kết quả không được dùng cũng vô nghĩa nên phải khớp cả câu `return`.
 */
function demCuocGoi(
  ma: string,
  duong: DuongDatBaoLuu,
  truoc: string,
  sau: string,
  hauQua: string,
): number {
  const re = new RegExp(
    `chanDatBaoLuuNgoaiHoSo\\(\\{\\s*duong:\\s*"${duong}",\\s*truoc:\\s*${truoc},\\s*sau:\\s*${sau},?\\s*\\}\\);\\s*${hauQua}`,
    "g",
  );
  return ma.match(re)?.length ?? 0;
}

describe("[BL1-CD-W] dây nối: mọi đường ghi PAUSED ngoài hồ sơ đều gọi phép chặn", () => {
  const GHI_DANH = maThat("app/(admin)/admin/enrollments/_actions.ts");
  const HOC_VIEN = maThat("app/(admin)/admin/students/_actions.ts");
  const IMPORT = maThat("app/api/admin/import/students/route.ts");
  const TRA_LOI = String.raw`if \(loiBaoLuu\) return \{ error: loiBaoLuu \};`;

  it("[BL1-CD-W1] hộp đổi trạng thái ghi danh (changeEnrollmentStatus): trạng thái HIỆN CÓ → trạng thái ĐÍCH, và trả lỗi", () => {
    expect(
      demCuocGoi(
        GHI_DANH,
        "DOI_TRANG_THAI_GHI_DANH",
        String.raw`enrollment\.status`,
        String.raw`data\.newStatus`,
        String.raw`if \(loiBaoLuu\) return \{ ok: false, error: loiBaoLuu \};`,
      ),
    ).toBe(1);
  });

  it("[BL1-CD-W2] form ghi danh cũ: TẠO (truoc=null) + SỬA (truoc=trạng thái hiện có) — mỗi cái ĐÚNG 1", () => {
    expect(demCuocGoi(GHI_DANH, "FORM_GHI_DANH", "null", String.raw`e\.status`, TRA_LOI)).toBe(1);
    expect(
      demCuocGoi(GHI_DANH, "FORM_GHI_DANH", String.raw`existing\.status`, String.raw`e\.status`, TRA_LOI),
    ).toBe(1);
  });

  it("[BL1-CD-W3] form học viên: TẠO (truoc=null) + SỬA (truoc=before.status) — mỗi cái ĐÚNG 1", () => {
    expect(demCuocGoi(HOC_VIEN, "FORM_HOC_VIEN", "null", String.raw`data\.status`, TRA_LOI)).toBe(1);
    expect(
      demCuocGoi(HOC_VIEN, "FORM_HOC_VIEN", String.raw`before\.status`, String.raw`data\.status`, TRA_LOI),
    ).toBe(1);
  });

  it("[BL1-CD-W4] import Excel: truoc=null (từ chối MỌI dòng PAUSED) và dòng bị loại khỏi tập hợp lệ", () => {
    expect(
      demCuocGoi(IMPORT, "IMPORT_EXCEL", "null", String.raw`r\.data\.status`, String.raw`if \(loiBaoLuu\) \{`),
    ).toBe(1);
    expect(IMPORT).toMatch(/stageOne\.push\(\{ ok: false, row: i \+ 2, error: loiBaoLuu \}\);\s*continue;/);
  });
});
