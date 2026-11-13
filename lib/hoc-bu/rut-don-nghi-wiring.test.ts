// @vitest-environment node
// [RDW] — dây nối của luồng xin nghỉ / xin bù phụ huynh (13/11/2026). Hành vi đã có test thật ở `tests/hoc-bu/rut-don-nghi.test.ts` (Postgres); thứ KHÔNG ca hành vi nào chạm tới
// là dây nối giữa các lớp (server action ↔ lõi, trang ↔ hộp xếp case) — ghim bằng văn bản mã nguồn ĐÃ BỎ CHÚ THÍCH, neo vào BIỂU THỨC.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("[RDW] luồng xin nghỉ · rút đơn · xin bù của phụ huynh", () => {
  const admin = doc("app/(admin)/admin/parent-requests/actions.ts");
  const portal = doc("app/(portal)/portal/yeu-cau/actions.ts");

  it("[RDW-01] «Tiếp nhận» ghi VẮNG CÓ PHÉP với lý do = lời phụ huynh, qua CÙNG hàm mà lúc rút đơn dùng để nhận ra bản ghi nguyên bản", () => {
    expect(admin).toMatch(/input\.action === "MAKEUP" \|\| input\.action === "TIEP_NHAN" \? "EXCUSED"/);
    expect(admin).toContain("const absenceReason = lyDoDiemDanhTuDon(req.content);");
    // Hai đầu lệch nhau (một bên cắt 1000 ký tự bằng cách khác) ⇒ rút đơn không bao giờ nhận ra bản ghi nguyên bản.
    expect(admin).not.toContain("req.content.slice(0, 1000)");
    expect(doc("lib/hoc-bu/rut-don-nghi.ts")).toContain("absenceReason === lyDoDiemDanhTuDon(don.content)");
  });

  it("[RDW-02] phụ huynh rút đơn ĐÃ TIẾP NHẬN đi qua lõi `rutDonXinNghiDaTiepNhan` — và đứng TRƯỚC phép huỷ đơn thường (không thì đơn APPROVED chỉ báo «chỉ huỷ được đơn đang chờ»)", () => {
    const t = portal.slice(portal.indexOf("export async function cancelParentRequest"));
    const iRut = t.indexOf("rutDonXinNghiDaTiepNhan({ requestId, studentId: req.studentId })");
    expect(iRut).toBeGreaterThan(-1);
    expect(t).toContain('req.type === "ABSENCE" && req.status === "APPROVED"');
    expect(iRut).toBeLessThan(t.indexOf("pdb.parentRequest.updateMany("));
    // Quyền sở hữu kiểm TRƯỚC lõi.
    expect(t.indexOf("assertOwnsStudent(req.studentId)")).toBeLessThan(iRut);
  });

  it("[RDW-03] xin học bù: máy chủ từ chối đề xuất thiếu/đã qua (không còn lặng lẽ lưu đơn không có mốc cho Sale)", () => {
    expect(portal).toContain('if (!preferredDate) return { ok: false, error: "Ba mẹ chọn giúp ngày và giờ mong muốn nhé." };');
    expect(portal).toMatch(/preferredDate\.getTime\(\) < Date\.now\(\) - 60_000/);
    expect(doc("components/portal/yeu-cau/man-hoc-bu.tsx")).not.toContain("GIO_DE_XUAT_BU");
    expect(doc("components/portal/yeu-cau/man-hoc-bu.tsx")).toContain('type="time"');
  });

  it("[RDW-04] liên kết «Xếp học bù» chỉ vẽ khi người xem có quyền xếp; trang Học bù chỉ mở hộp sẵn cho người có quyền xếp, dựng ở MÁY CHỦ (không effect), gỡ tham số khi đóng", () => {
    const trang = doc("app/(admin)/admin/parent-requests/page.tsx");
    expect(trang).toContain('checkPermission("makeup:manage")');
    expect(trang).toContain("needXep: coTheXep ? needXep : null,");
    expect(doc("app/(admin)/admin/parent-requests/_components/request-card.tsx")).toContain("`/hoc-bu?xep=${encodeURIComponent(item.needXep)}`");
    const hb = doc("app/(admin)/admin/hoc-bu/page.tsx");
    expect(hb).toContain("const xepId = coTheXep && sp.xep &&");
    expect(hb).toContain("await taiHopXep([xepId])");
    const hop = doc("app/(admin)/admin/hoc-bu/_components/hop-xep-tu-lien-ket.tsx");
    expect(hop).toContain("router.replace(hrefDong");
    expect(hop).not.toContain("useEffect");
    expect(doc("app/(admin)/admin/hoc-bu/_components/hop-xep-tai.ts")).not.toContain('"use client"');
  });

  it("[RDW-05] «Xếp học bù» KHÔNG tự duyệt/đóng đơn xin bù: đơn tự đóng khi dòng được xếp lịch (`dongYeuCauPhuHuynh`), nên liên kết chỉ MỞ hộp", () => {
    const card = doc("app/(admin)/admin/parent-requests/_components/request-card.tsx");
    const i = card.indexOf("/hoc-bu?xep=");
    expect(card.slice(i - 200, i + 200)).not.toMatch(/handleParentRequest|resolveAbsence/);
  });
});
