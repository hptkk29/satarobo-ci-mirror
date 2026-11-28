// @vitest-environment node
/**
 * [ONL-DTO-*] Hợp đồng DTO + ánh xạ lỗi → HTTP của lớp học viên. Lưới ghim mã bỏ chú thích trước khi quét (luật 11/14).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HTTP_THEO_MA_LOI, baiRequest, ghiTienDoRequest, httpTheoMaLoi, khoaCuaHocVienRequest, nopBaiRequest, veMediaRequest } from "./hoc-vien-dto";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("[ONL-DTO] DTO học viên", () => {
  it("[ONL-DTO-01] 🔴 `parentUserId` KHÔNG bao giờ có trong DTO — phiên quyết, client không gửi (trường lạ bị từ chối)", () => {
    for (const s of [khoaCuaHocVienRequest, baiRequest, ghiTienDoRequest, nopBaiRequest, veMediaRequest]) {
      const mau: Record<string, unknown> = { studentId: "s1", courseId: "c1", lessonStableId: "l1", attemptId: "a1", traLoi: {} };
      expect(s.safeParse({ ...mau, parentUserId: "ke-la" }).success).toBe(false);
    }
    expect(baiRequest.safeParse({ studentId: "s1", courseId: "c1", lessonStableId: "l1" }).success).toBe(true); // đối chứng dương
  });

  it("[ONL-DTO-02] thiếu/trắng `studentId` bị từ chối; `percent` nằm 0–100; `ttlGiay` có trần 300", () => {
    expect(khoaCuaHocVienRequest.safeParse({ studentId: "  " }).success).toBe(false);
    expect(khoaCuaHocVienRequest.safeParse({}).success).toBe(false);
    expect(ghiTienDoRequest.safeParse({ studentId: "s", courseId: "c", lessonStableId: "l", percent: 101 }).success).toBe(false);
    expect(ghiTienDoRequest.safeParse({ studentId: "s", courseId: "c", lessonStableId: "l", percent: 100 }).success).toBe(true);
    expect(veMediaRequest.safeParse({ studentId: "s", courseId: "c", lessonStableId: "l", ttlGiay: 301 }).success).toBe(false);
  });
});

describe("[ONL-HTTP] ánh xạ mã lỗi → HTTP", () => {
  it("[ONL-HTTP-01] 🔴 sai phụ huynh ⇒ 404 (không lộ học viên có thật); hết hạn/thu hồi/chưa có quyền ⇒ 403; cấu hình hỏng ⇒ 503 (đóng); mã LẠ ⇒ 500", () => {
    expect(httpTheoMaLoi("SAI_PHU_HUYNH")).toBe(404);
    for (const m of ["HET_HAN", "DA_THU_HOI", "KHONG_CO_QUYEN", "BAI_CHUA_MO", "DA_HOAN_THANH_KHONG_XEM_LAI"]) expect(httpTheoMaLoi(m), m).toBe(403);
    expect(httpTheoMaLoi("CAI_DAT_KHONG_HOP_LE")).toBe(503);
    expect(httpTheoMaLoi("MA_MOI_CHUA_AI_KHAI")).toBe(500);
  });

  it("[ONL-HTTP-02] 🔴 LƯỚI: mọi mã lỗi mà hàm học viên có thể trả ĐỀU có trong bảng ánh xạ — thêm mã mới ở hàm mà quên ánh xạ ⇒ đỏ (nếu không client nhận 500 không lý do)", () => {
    // `quyen-hoc.ts` có cả mã của đường CẤP/THU HỒI (quản trị/đơn hàng — không phải lỗi học viên): chỉ lấy union cổng truy cập `MaTuChoiTruyCap`.
    const nguon = ["lib/elearning-online/hoc-tap.ts", "lib/elearning-online/ve-media.ts", "lib/elearning-online/noi-dung-hoc-vien.ts"].map(doc).join("\n") + "\n" + ["lib/elearning-online/quyen-hoc.ts", "lib/elearning-online/quyen-hoc-db.ts"].map((f) => doc(f).replace(/\bma: "[A-Z_]+"/g, "")).join("\n");
    // Mọi hằng `ma: "X"` và literal trong các union `MaTuChoiTruyCap`/`MaTruyCapDb`/`MaSoHuu`/… — loại trạng thái tiến độ (không phải mã lỗi).
    const ma = new Set<string>();
    for (const m of nguon.matchAll(/\bma: "([A-Z][A-Z_]{3,})"/g)) ma.add(m[1]!);
    for (const m of nguon.matchAll(/export type (?:MaTuChoiTruyCap|MaSoHuu|MaTruyCapDb)\s*=\s*([^;]+);/g)) for (const l of m[1]!.matchAll(/"([A-Z][A-Z_]{3,})"/g)) ma.add(l[1]!);
    for (const bo of ["COMPLETED", "IN_PROGRESS", "NOT_STARTED", "THU_HOI", "CON_HAN", "SAP_HET_HAN", "TAO_MOI", "GIA_HAN"]) ma.delete(bo);
    expect(ma.size, "lưới phải đọc được mã lỗi — nếu 0 là regex đã chết").toBeGreaterThan(12);
    const chuaKhai = [...ma].filter((x) => !(x in HTTP_THEO_MA_LOI)).sort();
    expect(chuaKhai, `mã lỗi chưa có ánh xạ HTTP: ${chuaKhai.join(", ")}`).toEqual([]);
  });

  it("[ONL-HTTP-04] 🔴 mã lỗi LÀM BÀI/THI (học viên gặp) có ánh xạ và còn tồn tại ở nguồn — `danh-gia-db.ts` trộn mã quản trị nên lưới không quét tự động, ghim danh sách tường minh", () => {
    const nguon = doc("lib/elearning-online/danh-gia-db.ts");
    for (const ma of ["BAI_KHONG_PHAI_DANH_GIA", "CHUA_GAN_DE", "DE_KHONG_HOAT_DONG", "DE_RONG", "HET_GIO", "LUOT_KHONG_TON_TAI"]) {
      expect(ma in HTTP_THEO_MA_LOI, `${ma} chưa có ánh xạ HTTP`).toBe(true);
      expect(nguon, `${ma} không còn ở danh-gia-db.ts — gỡ khỏi bảng + lưới này nếu mã đã bỏ`).toContain(`fail("${ma}"`);
    }
  });

  it("[ONL-HTTP-03] mọi mã trong bảng là chuỗi hằng ổn định và trạng thái HTTP hợp lệ (4xx/5xx)", () => {
    for (const [ma, st] of Object.entries(HTTP_THEO_MA_LOI)) {
      expect(ma).toMatch(/^[A-Z][A-Z_]+$/);
      expect(st).toBeGreaterThanOrEqual(400);
      expect(st).toBeLessThan(600);
    }
  });
});
