// @vitest-environment node
// [YCL] «Gửi yêu cầu đến trung tâm» (12/11/2026) — danh mục loại, ghép ngày giờ, dây nối các màn.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOAI_YEU_CAU, ghepNgayGio, loaiTheoSlug, loiDeXuatBu, noiDungYeuCau } from "./yeu-cau-loai";
import { REQUEST_TYPE_LABEL } from "./request-labels";
import { parseVnDateTimeLocal, parseVnYmd } from "@/lib/time/vn";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("[YCL] danh mục loại yêu cầu", () => {
  it("[YCL-01] sáu loại, mỗi loại một màn có thật và ánh xạ một ParentRequestType sẵn có", () => {
    expect(LOAI_YEU_CAU.map((l) => l.slug)).toEqual(["hoc-bu", "nghi", "bao-luu", "doi-lop", "doi-co-so", "khac"]);
    for (const l of LOAI_YEU_CAU) {
      expect(existsSync(resolve(process.cwd(), `app/(portal)/portal/yeu-cau/${l.slug}/page.tsx`)), l.slug).toBe(true);
      expect(REQUEST_TYPE_LABEL[l.type], l.type).toBeTruthy();
    }
    expect(new Set(LOAI_YEU_CAU.map((l) => l.type)).size).toBe(6);
    expect(loaiTheoSlug("nghi")?.type).toBe("ABSENCE");
    expect(loaiTheoSlug("khong-co")).toBeUndefined();
  });

  it("[YCL-02] ghép ngày + giờ: chỉ nhận đúng khuôn, thiếu một nửa ⇒ null", () => {
    expect(ghepNgayGio("2026-11-20", "19:00")).toBe("2026-11-20T19:00");
    expect(ghepNgayGio("", "19:00")).toBeNull();
    expect(ghepNgayGio("2026-11-20", "")).toBeNull();
    expect(ghepNgayGio("20/11/2026", "19:00")).toBeNull();
    // 13/11/2026: giờ do phụ huynh TỰ nhập — mọi giờ đúng dạng đều ghép được, không còn danh sách khung giờ cố định.
    for (const g of ["07:15", "13:40", "20:05"]) expect(ghepNgayGio("2026-11-20", g)).not.toBeNull();
  });

  it("[YCL-03] giờ đề xuất được đọc theo ĐỒNG HỒ VN, không theo múi giờ máy chủ (19:00 VN = 12:00 UTC)", () => {
    expect(parseVnDateTimeLocal("2026-11-20T19:00")?.toISOString()).toBe("2026-11-20T12:00:00.000Z");
    // Chỉ-ngày: 00:00 giờ VN = 17:00 UTC hôm trước (không phải nửa đêm UTC).
    expect(parseVnYmd("2026-11-20")?.toISOString()).toBe("2026-11-19T17:00:00.000Z");
  });

  it("[YCL-05] đề xuất bù tự nhập: thiếu / sai dạng / ngày đã qua / giờ ngoài 06:00–22:00 ⇒ báo lỗi; giờ lẻ bất kỳ trong khung ⇒ hợp lệ", () => {
    const homNay = "2026-11-13";
    expect(loiDeXuatBu("", "18:30", homNay)).toMatch(/ngày/);
    expect(loiDeXuatBu("2026-11-20", "", homNay)).toMatch(/giờ/);
    expect(loiDeXuatBu("20/11/2026", "18:30", homNay)).toMatch(/đúng dạng/);
    expect(loiDeXuatBu("2026-11-12", "18:30", homNay)).toMatch(/đã qua/);
    expect(loiDeXuatBu("2026-11-20", "03:00", homNay)).toMatch(/06:00/);
    expect(loiDeXuatBu("2026-11-20", "22:30", homNay)).toMatch(/06:00/);
    expect(loiDeXuatBu("2026-11-13", "18:30", homNay)).toBeNull(); // hôm nay vẫn được đề xuất
    expect(loiDeXuatBu("2026-11-20", "17:45", homNay)).toBeNull(); // 17:45 không nằm trong bất kỳ khung cố định nào cũ
  });

  it("[YCL-04] nội dung gửi lên gộp các ý, bỏ ý rỗng/false", () => {
    expect(noiDungYeuCau(["Xin bảo lưu.", "", false, undefined, "  Ghi chú: ốm  "])).toBe("Xin bảo lưu. Ghi chú: ốm");
  });
});

describe("[YCL-W] dây nối", () => {
  it("[YCL-W1] action đọc ngày đề xuất qua lib/time/vn (strict ngày trước, rồi ngày-giờ), không `new Date(chuỗi)`", () => {
    const s = doc("app/(portal)/portal/yeu-cau/actions.ts");
    expect(s).toContain("parseVnYmd(d.preferredDate) ?? parseVnDateTimeLocal(d.preferredDate)");
    expect(s).not.toMatch(/new Date\(d\.preferredDate\)/);
  });

  it("[YCL-W2] màn Học bù: nút gửi CHỈ ở buổi 'Cần bù'; gửi kèm makeupNeedId + ngày-giờ; lượt bù đọc từ sổ lượt", () => {
    const m = doc("components/portal/yeu-cau/man-hoc-bu.tsx");
    expect(m).toContain('b.trangThai === "CAN_BU" ? (');
    expect(m).toMatch(/type:\s*"MAKEUP",\s*makeupNeedId:\s*buoi\.id,\s*preferredDate:\s*dx/);
    const p = doc("app/(portal)/portal/yeu-cau/hoc-bu/page.tsx");
    expect(p).toContain("docLuotBuChoCon(studentId)");
    expect(doc("lib/portal/yeu-cau-hub.ts")).toContain("docSoLuot(db,");
  });

  it("[YCL-W3] màn đầu liệt kê đủ loại và liên kết liên cũ ?bu= chuyển sang màn Học bù", () => {
    expect(doc("components/portal/yeu-cau/trung-tam-yeu-cau.tsx")).toContain("LOAI_YEU_CAU.map(");
    expect(doc("app/(portal)/portal/yeu-cau/page.tsx")).toContain("redirect(`/portal/yeu-cau/hoc-bu?bu=");
  });

  it("[YCL-W4] mọi màn con đều gác chế độ học sinh qua requireActiveStudent (trực tiếp hoặc qua docTuyChon)", () => {
    expect(doc("app/(portal)/portal/yeu-cau/_lib-tuy-chon.ts")).toContain("requireActiveStudent()");
    expect(doc("app/(portal)/portal/yeu-cau/hoc-bu/page.tsx")).toContain("requireActiveStudent()");
  });
});
