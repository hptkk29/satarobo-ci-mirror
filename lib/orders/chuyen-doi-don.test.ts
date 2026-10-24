// [CDD-*] — LƯỚI GHIM MÃ NGUỒN cho bộ nạp màn Chuyển đổi.
//
// Thứ cần khoá ở đây là HÌNH DẠNG các câu tra và các phép nối, không phải một giá trị trả
// về: "lớp bày ra có lọc đúng cơ sở của đơn không", "phụ huynh lấy từ đơn hay từ lead
// trước", "lớp đầy có bị loại không". Test thuần không chạm tới tầng ấy; test chạm DB thì
// xanh nhờ fixture may mắn. Cùng mẫu với `[GLD-*]` và `[DS-01b]` (CLAUDE.md).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MA = readFileSync(resolve(process.cwd(), "lib/orders/chuyen-doi-don.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split(/\r?\n/)
  .map((d) => d.replace(/^\s*\/\/.*$/, ""))
  .join("\n");

describe("[CDD-01] ĐƠN là nguồn chính, lead chỉ bù chỗ trống", () => {
  it("phụ huynh lấy `order.*` TRƯỚC, `lead.*` sau", () => {
    // 🔴 Đảo thứ tự là ghi đè dữ liệu MỚI (khách vừa ký đơn) bằng dữ liệu CŨ (lead từ
    // lúc tư vấn). Và 96,3% đơn không có lead nên lỗi này chỉ lộ ở 4% ca — tức nó sống
    // rất lâu trước khi có ai thấy.
    expect(MA).toMatch(/ten:\s*order\.customerName\s*\|\|\s*order\.lead\?\.parentName/);
    expect(MA).toMatch(/sdt:\s*order\.customerPhone\s*\|\|\s*order\.lead\?\.phone/);
    expect(MA).toMatch(/email:\s*order\.customerEmail\s*\|\|\s*order\.lead\?\.email/);
  });
});

describe("[CDD-02] lớp ứng viên lọc ĐÚNG ba điều kiện", () => {
  it("cùng khoá · còn nhận ghi danh · CÙNG CƠ SỞ với đơn", () => {
    // Cơ sở là vế hay bị quên nhất, và quên nó thì màn bày ra lớp mà `enrollStudent`
    // chắc chắn từ chối (`crossCenterError`) — affordance nói dối, luật 12.
    expect(MA).toMatch(/courseId:\s*\{\s*in:\s*courseIds\s*\}/);
    expect(MA).toMatch(/status:\s*\{\s*in:\s*\[\.\.\.TRANG_THAI_LOP_NHAN\]\s*\}/);
    expect(MA).toMatch(/order\.centerId\s*\?\s*\{\s*centerId:\s*order\.centerId\s*\}/);
  });

  it("trạng thái lớp lấy từ HẰNG, không gõ lại chuỗi", () => {
    expect(MA).toMatch(/TRANG_THAI_LOP_NHAN = \["PLANNED", "RECRUITING", "ACTIVE"\]/);
    // Gõ lại là hai danh sách sẵn sàng lệch với `enrollStudent`.
    expect((MA.match(/"RECRUITING"/g) ?? []).length).toBe(1);
  });

  it("sĩ số đếm ghi danh CÒN HỌC, không đếm tất", () => {
    // Đếm cả ghi danh đã rút/đã xong là lớp trông đầy trong khi còn chỗ — người dùng
    // không xếp được vào lớp đúng và không hiểu vì sao.
    expect(MA).toMatch(/enrollments:\s*\{\s*where:\s*\{\s*status:\s*\{\s*in:\s*\["STUDYING", "ACTIVE"\]/);
  });
});

describe("[CDD-03] LỚP ĐẦY không ai chọn được, kể cả Quản trị tối cao", () => {
  it("`chonDuoc` gồm cả vế `!daDay`", () => {
    // `duocXep(xet, true)` cho Quản trị tối cao qua luật TIẾN ĐỘ, nhưng `enrollStudent`
    // từ chối `CLASS_FULL` VÔ ĐIỀU KIỆN. Vẽ một lựa chọn chắc chắn ăn từ chối là lời
    // hứa suông.
    expect(MA).toMatch(/chonDuoc:\s*!daDay && duocXep\(xet, false\)/);
  });
});

describe("[CDD-04] tiến độ lớp đếm theo NGÀY, qua đúng một hàm", () => {
  it("dùng `demBuoiDaQua`, không tự đếm tại chỗ", () => {
    expect(MA).toMatch(/demBuoiDaQua\(c\.sessions, bayGio\)/);
    // Không có phép lọc `COMPLETED` nào lẻn vào — chủ dự án đã chốt đếm theo ngày sau
    // khi thấy số đo 0 `COMPLETED` / 25 buổi đã qua.
    expect(MA).not.toMatch(/COMPLETED/);
  });

  it("`bayGio` là THAM SỐ, hàm không đọc đồng hồ máy (luật 19)", () => {
    expect(MA).toMatch(/bayGio:\s*Date,/);
    expect(MA).not.toMatch(/new Date\(\)/);
  });
});

describe("[CDD-05] mỗi DÒNG một phán quyết riêng", () => {
  it("`xetXepVaoLop` gọi với `soBuoiMua` CỦA DÒNG", () => {
    // Chủ dự án: *"mỗi con xếp riêng"*. Dùng một `soBuoiMua` chung cho cả đơn là hai
    // con mua khác nhau mà nhận cùng một phán quyết.
    expect(MA).toMatch(/soBuoiMua:\s*ht\.soBuoi/);
    expect((MA.match(/xetXepVaoLop\(/g) ?? []).length).toBe(2);
  });

  it("dấu đã chuyển đổi đọc từ `OrderItem.enrollmentId`", () => {
    // Cột ĐÃ CÓ SẴN (493/525 dòng local đang dùng) và ở đúng cấp DÒNG — một cột cấp ĐƠN
    // không diễn đạt được ca "con A đã xếp, con B để sau".
    expect(MA).toMatch(/enrollmentId:\s*it\.enrollmentId/);
  });
});

// ── [CDD-06..09] LƯỚI GHIM cho SERVER ACTION ────────────────────────────────────────
const ACT = readFileSync(
  resolve(process.cwd(), "app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split(/\r?\n/)
  .map((d) => d.replace(/^\s*\/\/.*$/, ""))
  .join("\n");

describe("[CDD-06] MỌI CỔNG ĐỨNG TRƯỚC `$transaction`", () => {
  it("cổng tiền · cổng dòng · cổng lớp đều nằm TRƯỚC transaction", () => {
    // 🔴 Luật rollback của repo: trong callback `$transaction`, `return` KHÔNG rollback.
    // Một phép từ chối đặt giữa chừng là để lại nửa lượt chuyển đổi (đã tạo học viên,
    // chưa tạo ghi danh) KÈM thông báo "không thành công" — đúng sự cố `goGanTheoCon`
    // 17/09 đã ghi trong CLAUDE.md.
    const iTx = ACT.indexOf("$transaction");
    expect(iTx).toBeGreaterThan(0);
    for (const cong of [
      "duocChuyenDoi(tien)",
      "goc.enrollmentId",
      "lop.daDay",
      "duocXep(lop.xet, laAdmin)",
    ]) {
      const i = ACT.indexOf(cong);
      expect(i, `không thấy cổng \`${cong}\``).toBeGreaterThan(0);
      expect(i, `cổng \`${cong}\` phải đứng TRƯỚC transaction`).toBeLessThan(iTx);
    }
  });

  it("không có `return { ok: false` nào BÊN TRONG transaction", () => {
    const sau = ACT.slice(ACT.indexOf("$transaction"));
    const thanTx = sau.slice(0, sau.indexOf("} catch"));
    expect(thanTx).not.toMatch(/return\s*\{\s*ok:\s*false/);
  });
});

describe("[CDD-07] SĨ SỐ không ai vượt được, TIẾN ĐỘ thì Quản trị tối cao vượt", () => {
  it("`daDay` chặn vô điều kiện, KHÔNG nhận `laAdmin`", () => {
    // `enrollStudent` từ chối `CLASS_FULL` vô điều kiện. Cho admin vượt ở đây là hai
    // đường ghi danh nói hai câu khác nhau về cùng một lớp.
    expect(ACT).toMatch(/if \(lop\.daDay\) \{/);
    // ⚠️ Cắt ĐÚNG khối `daDay`, không cắt theo số ký tự: cửa sổ 220 ký tự của bản đầu
    // ăn sang cổng KẾ BÊN (`duocXep(..., laAdmin)`) và làm ca này đỏ oan. Luật 11 —
    // neo vào ranh giới cú pháp, đừng neo vào độ dài.
    const i = ACT.indexOf("if (lop.daDay) {");
    const j = ACT.indexOf("if (!duocXep", i);
    expect(i).toBeGreaterThan(0);
    expect(j, "không thấy cổng tiến độ ngay sau cổng sĩ số").toBeGreaterThan(i);
    expect(ACT.slice(i, j)).not.toMatch(/laAdmin/);
  });

  it("luật tiến độ đi qua `duocXep(..., laAdmin)`, không tự so vai", () => {
    expect(ACT).toMatch(/duocXep\(lop\.xet, laAdmin\)/);
    // Luật cứng #1: cấm so role tại chỗ. Quyền đi qua `checkPermission`.
    expect(ACT).toMatch(/checkPermission\("enrollments:override-progress"\)/);
    expect(ACT).not.toMatch(/=== "SUPER_ADMIN"/);
  });
});

describe("[CDD-08] học vượt ⇒ phiếu học bù, đúng số buổi", () => {
  it("tạo `makeupNeed` và cắt đúng `soBuoiHocVuot` buổi đầu", () => {
    // T05: qua `taoDongHocBu` (nguồn ORDER_CONVERSION, idempotent) — không còn `tx.makeupNeed.create` trần ném P2002 khi bé đã có dòng.
    expect(ACT).toMatch(/taoDongHocBu\(tx,/);
    expect(ACT).not.toMatch(/makeupNeed\.create\(/);
    expect(ACT).toMatch(/nguon:\s*"ORDER_CONVERSION"/);
    expect(ACT).toMatch(/\.slice\(0, k\.soBuoiHocVuot\)/);
    // Chỉ dòng MỚI tạo mới được đếm vào `soPhieuHocBu`.
    expect(ACT).toMatch(/if \(r\.ket === "TAO"\) soPhieuHocBu\+\+/);
  });

  it("chỉ chạy khi CÓ học vượt", () => {
    expect(ACT).toMatch(/if \(k\.soBuoiHocVuot > 0\)/);
  });
});

describe("[CDD-09] dấu đã chuyển đổi + phạm vi buổi được ghi", () => {
  it("ghi `OrderItem.enrollmentId` — dòng đã xếp thì lần sau bị chặn", () => {
    expect(ACT).toMatch(/tx\.orderItem\.update\(/);
    expect(ACT).toMatch(/enrollmentId:\s*gd\.id/);
  });

  it("ghi `Enrollment.buoiBatDau` — cổng điểm danh đọc cột này", () => {
    // Quên cột này là bé mua 24 buổi vẫn điểm danh được từ buổi 1.
    //
    // 🔴 BẢN ĐẦU CỦA CA NÀY VÔ DỤNG, và phép cấy chứng minh: nó chỉ hỏi
    // `ACT.toMatch(/buoiBatDau:\s*k\.buoiBatDau/)`, mà chuỗi ấy xuất hiện HAI lần —
    // một ở `enrollment.create`, một ở vết audit. Gỡ hẳn ở chỗ ghi danh vẫn khớp chỗ
    // kia ⇒ cấy vào ra **0 đỏ** trên mã đã hỏng.
    // Nay neo vào ĐÚNG khối `enrollment.create` và khoá cả SỐ LẦN.
    const i = ACT.indexOf("tx.enrollment.create(");
    const j = ACT.indexOf("select: { id: true }", i);
    expect(i, "không thấy lời gọi tạo ghi danh").toBeGreaterThan(0);
    expect(ACT.slice(i, j)).toMatch(/buoiBatDau:\s*k\.buoiBatDau/);
    expect((ACT.match(/buoiBatDau:\s*k\.buoiBatDau/g) ?? []).length,
      "đúng 2: một ở ghi danh, một ở vết audit").toBe(2);
  });

  it("phụ huynh trùng hai hồ sơ (`conflict`) ⇒ CHẶN, không tự chọn một bên", () => {
    // Tự chọn là gắn con vào nhầm gia đình. `convertLeadV2` cũng chặn đúng ca này.
    expect(ACT).toMatch(/khop\.kind === "conflict"/);
  });
});
