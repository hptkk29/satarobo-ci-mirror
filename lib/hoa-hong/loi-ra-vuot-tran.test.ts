// @vitest-environment node
/**
 * [LRT-*] — LỐI RA khi tổng hoa hồng VƯỢT TRẦN, theo QUYỀN của người đang xem (chủ dự án chốt 09/10/2026: nâng trần là THAO TÁC của admin ở Cấu hình vận hành;
 * hệ thống không tự nâng, không tự cắt). THUẦN.
 *
 * Một liên kết «Nâng trần tại Cấu hình vận hành» mà người xem bấm vào chỉ để gặp màn chỉ-đọc / bị từ chối là lời hứa suông (luật 12). Cổng LƯU của ô trần là `settings:edit`
 * (`app/(admin)/admin/cau-hinh-van-hanh/actions.ts`) — nên liên kết chỉ vẽ cho người có ĐÚNG khoá đó; người khác thấy câu nói AI nâng được.
 *
 *   [LRT-01] có quyền ∧ nâng trần đủ để qua ⇒ liên kết + câu «mở … để nâng trần, hoặc chỉnh tỉ lệ rồi kích hoạt lại»
 *   [LRT-02] KHÔNG quyền ⇒ KHÔNG liên kết; câu nêu Quản trị hệ thống nâng — đối chứng dương của [LRT-01]
 *   [LRT-03] nâng trần không đủ (tổng vượt giới hạn của ô) ⇒ không liên kết kể cả có quyền; chỉ còn chỉnh tỉ lệ
 *   [LRT-04] khoá quyền = khoá THẬT mà màn Cấu hình vận hành hỏi khi lưu; không có bản thứ hai
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DUONG_CAU_HINH_TRAN, dungHuongXuLyTran } from "./huong-xu-ly-tran";
import { QUYEN_SUA_TRAN, quyetDinhLoiRaTran } from "./loi-ra-vuot-tran";

const DUONG = { href: DUONG_CAU_HINH_TRAN.href, nhan: DUONG_CAU_HINH_TRAN.nhan };

describe("[LRT-01] có quyền sửa trần ∧ nâng trần đủ để qua", () => {
  it("trả liên kết ĐÚNG đường dẫn của F; câu chữ nêu hai lối (nâng trần · chỉnh tỉ lệ) và «kích hoạt lại»", () => {
    const h = dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 });
    const r = quyetDinhLoiRaTran({ duongDan: h.duongDan, coQuyenSuaTran: true });
    expect(r.lienKet).toEqual(DUONG);
    expect(r.cauChu).toContain("Cấu hình vận hành");
    expect(r.cauChu).toMatch(/nâng trần/);
    expect(r.cauChu).toMatch(/chỉnh lại tỉ lệ/);
    expect(r.cauChu).toContain("kích hoạt lại");
    expect(r.cauChu).not.toContain("Quản trị hệ thống");
  });
});

describe("[LRT-02] KHÔNG có quyền sửa trần", () => {
  it("không liên kết; nói người nào nâng được; vẫn nêu lối chỉnh tỉ lệ (đối chứng dương: cùng đầu vào, có quyền ⇒ có liên kết)", () => {
    const h = dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 });
    const khong = quyetDinhLoiRaTran({ duongDan: h.duongDan, coQuyenSuaTran: false });
    expect(khong.lienKet).toBeNull();
    expect(khong.cauChu).toContain("Quản trị hệ thống");
    expect(khong.cauChu).toContain("Cấu hình vận hành");
    expect(khong.cauChu).toMatch(/chỉnh lại tỉ lệ/);
    expect(khong.cauChu).toContain("kích hoạt lại");
    // đối chứng dương
    expect(quyetDinhLoiRaTran({ duongDan: h.duongDan, coQuyenSuaTran: true }).lienKet).not.toBeNull();
  });
});

describe("[LRT-03] nâng trần không đủ", () => {
  it("tổng vượt giới hạn trên của ô ⇒ không liên kết dù có quyền; câu nói thẳng «nâng trần cũng không đủ» và KHÔNG mời nâng trần", () => {
    const h = dungHuongXuLyTran({ tongToiDa: 0.25, tran: 0.09 });
    expect(h.duongDan).toBeNull();
    for (const coQuyen of [true, false]) {
      const r = quyetDinhLoiRaTran({ duongDan: h.duongDan, coQuyenSuaTran: coQuyen });
      expect(r.lienKet).toBeNull();
      expect(r.cauChu).toMatch(/nâng trần (cũng )?không đủ/i);
      expect(r.cauChu).toMatch(/chỉnh lại tỉ lệ/);
      expect(r.cauChu).not.toContain("Quản trị hệ thống");
    }
  });
});

describe("[LRT-04] khoá quyền không gõ thành bản thứ hai", () => {
  it("bằng đúng khoá mà action lưu cấu hình hỏi ở đầu hàm (đọc từ mã nguồn của action, bỏ chú thích)", () => {
    expect(QUYEN_SUA_TRAN).toBe("settings:edit");
    const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/cau-hinh-van-hanh/actions.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src.split(`checkPermission("${QUYEN_SUA_TRAN}")`).length - 1).toBeGreaterThanOrEqual(1);
  });
});
