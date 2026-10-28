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
  it("`daDay` đếm ghi danh CÒN HỌC so với `maxStudents`, và được trả ra để màn ẩn lớp đầy", () => {
    // [27/10/2026] `xet`/`chonDuoc` đã chuyển sang phép tính THUẦN `xep-lop-theo-buoi-bat-dau.ts` (client và máy chủ cùng gọi). Lý lẽ không đổi:
    // `enrollStudent` từ chối `CLASS_FULL` VÔ ĐIỀU KIỆN, vẽ một lựa chọn chắc chắn ăn từ chối là lời hứa suông — nên cờ `daDay` phải ra khỏi bộ nạp.
    expect(MA).toMatch(/const daDay = c\._count\.enrollments >= c\.maxStudents/);
    expect(MA).toMatch(/\bdaDay,/);
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

describe("[CDD-05] mỗi DÒNG một khoảng buổi bắt đầu riêng", () => {
  it("`khoangBuoiBatDau` gọi với `soBuoiMua` CỦA DÒNG; dòng SCOPE không hỏi buổi bắt đầu", () => {
    // Chủ dự án: *"mỗi con xếp riêng"*. Dùng một `soBuoiMua` chung cho cả đơn là hai con mua khác nhau mà nhận cùng một khoảng.
    expect(MA).toMatch(/soBuoiMua:\s*ht\.soBuoi/);
    expect((MA.match(/khoangBuoiBatDau\(/g) ?? []).length).toBe(1);
    expect(MA).toMatch(/khoangBuoi:\s*laPhamVi\s*\?\s*null\s*:\s*khoangBuoiBatDau\(/);
    // Luật cũ "học các buổi cuối" (`xetXepVaoLop`) không còn ở bộ nạp: buổi bắt đầu do Sale nhập.
    expect(MA).not.toMatch(/xetXepVaoLop\(/);
  });

  it("chỉ dòng KHOÁ HỌC được trả về — con không có dòng đơn (chưa đăng ký) ẩn luôn", () => {
    expect(MA).toMatch(/if \(!ht\.courseId\) return \[\];/);
  });

  it("lớp theo VAI: Sale/QLCS chỉ lớp cùng cơ sở đơn; Quản trị tối cao mọi cơ sở", () => {
    expect(MA).toMatch(/boiCanh\.vai !== "ADMIN" && order\.centerId \? \{ centerId: order\.centerId \} : \{\}/);
  });

  it("ô phụ huynh lấy từ LEAD chỉ khi `xemPiiLead` — thiếu quyền thì TRỐNG, không phải bản che ([S-1])", () => {
    expect((MA.match(/boiCanh\.xemPiiLead/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("dấu đã chuyển đổi đọc từ `OrderItem.enrollmentId`", () => {
    // Cột ĐÃ CÓ SẴN (493/525 dòng local đang dùng) và ở đúng cấp DÒNG — một cột cấp ĐƠN không diễn đạt được ca "con A đã xếp, con B để sau".
    expect(MA).toMatch(/enrollmentId:\s*it\.enrollmentId/);
  });
});

// ── [CDD-06..10] LƯỚI GHIM cho SERVER ACTION + PHẦN GHI ──────────────────────────────
// [27/10/2026] Phần GHI dời sang `lib/orders/chuyen-doi-ghi.ts`; action giữ CỔNG. Lý lẽ các lưới không đổi — chỉ trỏ đúng tệp.
const bocChuThich = (duong: string) =>
  readFileSync(resolve(process.cwd(), duong), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((d) => d.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
const ACT = bocChuThich("app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts");
const GHI = bocChuThich("lib/orders/chuyen-doi-ghi.ts");
const HOC_VUOT = bocChuThich("lib/orders/hoc-vuot-chuyen-doi.ts");

describe("[CDD-06] MỌI CỔNG ĐỨNG TRƯỚC giao dịch ghi", () => {
  it("cổng tiền · cổng dòng · cổng lớp · cổng buổi bắt đầu đều nằm TRƯỚC `ghiChuyenDoi(`", () => {
    // 🔴 Luật rollback của repo: trong callback `$transaction`, `return` KHÔNG rollback. Một phép từ chối đặt giữa chừng là để lại nửa lượt chuyển đổi
    // (đã tạo học viên, chưa tạo ghi danh) KÈM thông báo "không thành công" — đúng sự cố `goGanTheoCon` 17/09.
    const iGhi = ACT.indexOf("await ghiChuyenDoi(");
    expect(iGhi).toBeGreaterThan(0);
    for (const cong of ["duocChuyenDoiDon(tien,", "goc.enrollmentId", "lop.daDay", "vaiChonDuoc(vai, x)", "kiemBuoiBatDau(", "kiemSoBuoiBu("]) {
      const i = ACT.indexOf(cong);
      expect(i, `không thấy cổng \`${cong}\``).toBeGreaterThan(0);
      expect(i, `cổng \`${cong}\` phải đứng TRƯỚC giao dịch ghi`).toBeLessThan(iGhi);
    }
  });

  it("không có `return { ok: false` nào BÊN TRONG transaction của phần ghi", () => {
    const sau = GHI.slice(GHI.indexOf("db.$transaction("));
    expect(sau).not.toMatch(/return\s*\{\s*ok:\s*false/);
  });
});

describe("[CDD-07] SĨ SỐ không ai vượt được, TIẾN ĐỘ theo VAI", () => {
  it("`daDay` chặn vô điều kiện, KHÔNG nhận vai", () => {
    // `enrollStudent` từ chối `CLASS_FULL` vô điều kiện. Cho Quản trị tối cao vượt ở đây là hai đường ghi danh nói hai câu khác nhau về cùng một lớp.
    expect(ACT).toMatch(/if \(lop\.daDay\) return/);
    const i = ACT.indexOf("if (lop.daDay) return");
    const j = ACT.indexOf("\n", i);
    expect(ACT.slice(i, j)).not.toMatch(/vai|laAdmin/);
  });

  it("luật tiến độ đi qua `vaiChonDuoc(vai, x)`, vai suy từ HAI quyền sẵn có (không đẻ quyền mới, không so role tại chỗ)", () => {
    expect(ACT).toMatch(/vaiChonDuoc\(vai, x\)/);
    expect(ACT).toMatch(/checkPermission\("enrollments:override-progress"\)/);
    expect(ACT).toMatch(/checkPermission\("makeup:waive"\)/);
    expect(ACT).not.toMatch(/=== "SUPER_ADMIN"/);
  });
});

describe("[CDD-08] học vượt ⇒ YÊU CẦU chờ QLCS duyệt; duyệt mới sinh dòng cần bù", () => {
  it("phần ghi KHÔNG tự tạo dòng cần bù: chỉ tạo yêu cầu, tự duyệt khi người bấm là QLCS / Quản trị tối cao", () => {
    expect(GHI).toMatch(/taoYeuCauHocVuot\(/);
    expect(GHI).toMatch(/if \(p\.tuDuyet\)/);
    expect(GHI).not.toMatch(/taoDongHocBu\(/);
    expect(GHI).not.toMatch(/makeupNeed\./);
  });

  it("dòng cần bù sinh qua `taoDongHocBu` (nguồn ORDER_CONVERSION, idempotent), cắt từ buổi `startLesson`", () => {
    expect(HOC_VUOT).toMatch(/taoDongHocBu\(tx,/);
    expect(HOC_VUOT).not.toMatch(/makeupNeed\.create\(/);
    expect(HOC_VUOT).toMatch(/nguon:\s*"ORDER_CONVERSION"/);
    expect(HOC_VUOT).toMatch(/\.slice\(Math\.max\(0, r\.startLesson - 1\)\)/);
    expect(HOC_VUOT).toMatch(/if \(k\.ket === "TAO"\) dem\+\+/);
  });

  it("chỉ tạo yêu cầu khi lớp đòi học vượt", () => {
    expect(GHI).toMatch(/if \(k\.hocVuot && duLieu\.centerId\)/);
  });
});

describe("[CDD-09] dấu đã chuyển đổi + phạm vi buổi được ghi", () => {
  it("ghi `OrderItem.enrollmentId` — dòng đã xếp thì lần sau bị chặn", () => {
    expect(GHI).toMatch(/tx\.orderItem\.update\(/);
    expect(GHI).toMatch(/enrollmentId:\s*gd\.id/);
  });

  it("ghi `Enrollment.buoiBatDau` — cổng điểm danh đọc cột này", () => {
    // Quên cột này là bé mua 24 buổi vẫn điểm danh được từ buổi 1.
    // Neo vào ĐÚNG khối `enrollment.create` và khoá cả SỐ LẦN (bản đầu của ca này từng khớp nhầm vết audit — phép cấy ra 0 đỏ).
    const i = GHI.indexOf("tx.enrollment.create(");
    const j = GHI.indexOf("select: { id: true }", i);
    expect(i, "không thấy lời gọi tạo ghi danh").toBeGreaterThan(0);
    expect(GHI.slice(i, j)).toMatch(/buoiBatDau:\s*k\.buoiBatDauLuu/);
    expect((GHI.match(/k\.buoiBatDauLuu/g) ?? []).length, "đúng 2: một ở ghi danh, một ở vết audit").toBe(2);
  });

  it("phụ huynh trùng hai hồ sơ (`conflict`) ⇒ CHẶN, không tự chọn một bên", () => {
    // Tự chọn là gắn con vào nhầm gia đình. `convertLeadV2` cũng chặn đúng ca này.
    expect(ACT).toMatch(/khop\.kind === "conflict"/);
  });
});

describe("[CDD-10] hồ sơ bé + phụ huynh ghi vào học viên và ĐỒNG BỘ về lead", () => {
  it("giao dịch KHÔNG scope (`db.$transaction`) và gọi `dongBoTuHocVien` sau lượt ghi hồ sơ", () => {
    // `dongBoTuHocVien` đọc phiếu lead + anh/chị/em ở mọi cơ sở: qua `scopedDb` chúng bị bỏ qua IM LẶNG (CLAUDE.md, 26/09/2026).
    expect(GHI).toMatch(/db\.\$transaction\(/);
    expect(GHI).not.toMatch(/scopedDb/);
    expect((GHI.match(/dongBoTuHocVien\(/g) ?? []).length).toBe(1);
    expect(GHI.indexOf("dongBoTuHocVien(")).toBeGreaterThan(GHI.indexOf("tx.student.create("));
  });
});
