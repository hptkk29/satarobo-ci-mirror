// Hai cổng quanh kỳ công (08/09/2026). THUẦN — chạy trong `pnpm test:unit`, không cần DB.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { chanChotKyThieuBuoi, chanSuaKyDaChot } from "./ky-gac";

const GOC = join(__dirname, "..", "..");
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");

describe("chanChotKyThieuBuoi — chặn chốt kỳ khi chưa buổi nào được chốt", () => {
  it("có buổi mà 0 buổi xong → CHẶN", () => {
    expect(chanChotKyThieuBuoi({ duKien: 287, xong: 0 })).toContain(
      "287 buổi học",
    );
  });

  it("chỉ cần MỘT buổi đã chốt là cho qua — cổng này chống 'trắng trơn', không phải KPI", () => {
    expect(chanChotKyThieuBuoi({ duKien: 287, xong: 1 })).toBeNull();
  });

  // ⚠️ CA QUAN TRỌNG NHẤT của cổng này.
  //
  // Hội sở (`hoi-so`) là Center MỒ CÔI — không lớp nào trỏ tới, nên kỳ nào của nó cũng
  // có `duKien = 0`. Nếu ngưỡng là `xong === 0` thì Hội sở KHOÁ VĨNH VIỄN, không bao
  // giờ chốt được kỳ. Đừng "đơn giản hoá" điều kiện.
  it("kỳ KHÔNG có buổi nào (Hội sở) → cho qua, KHÔNG khoá vĩnh viễn", () => {
    expect(chanChotKyThieuBuoi({ duKien: 0, xong: 0 })).toBeNull();
  });

  it("mọi buổi đều đã chốt → cho qua", () => {
    expect(chanChotKyThieuBuoi({ duKien: 42, xong: 42 })).toBeNull();
  });
});

describe("chanSuaKyDaChot — chặn xếp lại khung ca vào kỳ đã chốt", () => {
  it("LOCKED → CHẶN, và câu chặn nói rõ kỳ nào", () => {
    expect(
      chanSuaKyDaChot({ status: "LOCKED", periodKey: "2026-09" }),
    ).toContain("2026-09");
  });

  it("OPEN / REOPENED / CLOSING / chưa có kỳ → cho qua", () => {
    for (const st of ["OPEN", "REOPENED", "CLOSING", null]) {
      expect(
        chanSuaKyDaChot({ status: st, periodKey: "2026-09" }),
        `status=${st}`,
      ).toBeNull();
    }
  });
});

// ── Cổng TĨNH: hai cổng phải được CẮM ĐÚNG CHỖ ────────────────────────────────
//
// Hàm thuần đúng mà cắm sai chỗ thì vô dụng — và "sai chỗ" ở đây có một hình dạng cụ
// thể: đặt SAU bước ghi, thành "chặn nhưng vẫn ghi".
describe("hai cổng được cắm đúng chỗ", () => {
  it("chốt kỳ: cổng đứng TRƯỚC recomputeRange", () => {
    const src = doc("lib/cham-cong/period.ts");
    const iGate = src.indexOf("chanChotKyThieuBuoi({");
    const iWrite = src.indexOf("await recomputeRange(");
    expect(iGate, "cổng phải tồn tại").toBeGreaterThan(-1);
    // Đặt sau `recomputeRange` là đã tính lại + ghi đè hàng loạt StaffAttendanceDay
    // rồi mới báo lỗi — chặn nhưng vẫn ghi.
    expect(iGate).toBeLessThan(iWrite);
  });

  it("chốt kỳ: KHÔNG gác bằng summary.totals.teachingSessions", () => {
    // Số đó cộng theo HÀNG nên rụng buổi của giáo viên không có ca trong kỳ, và truy
    // vấn sinh ra nó bị bỏ hẳn khi danh sách người rỗng.
    const src = doc("lib/cham-cong/period.ts");
    const than = src.slice(
      src.indexOf("if (!input.boQuaBuoiChuaChot)"),
      src.indexOf("await recomputeRange("),
    );
    expect(than).toContain("classSession.count");
    expect(than).not.toContain("teachingSessions");
  });

  it("xếp lại khung ca: cổng đứng TRƯỚC generateMonthAssignments", () => {
    const src = doc("app/(admin)/admin/cham-cong/khung-ca/_actions.ts");
    const iGate = src.indexOf("chanSuaKyDaChot({");
    const iWrite = src.indexOf("await generateMonthAssignments({");
    expect(iGate).toBeGreaterThan(-1);
    expect(iGate).toBeLessThan(iWrite);
  });

  // Cổng chặn mà không có đường vượt là tự khoá mình; đường vượt ở cấp CƠ SỞ thì cổng
  // không tồn tại. Cả hai phải là HO + lý do bắt buộc, cùng khuôn `reopenPeriodAction`.
  it("cả hai đường vượt đều ở cấp HỘI SỞ và bắt buộc lý do", () => {
    for (const f of [
      "app/(admin)/admin/cham-cong/ky-cong/_actions.ts",
      "app/(admin)/admin/cham-cong/khung-ca/_actions.ts",
    ]) {
      const src = doc(f);
      expect(src, `${f}: đường vượt phải hỏi quyền tại HO`).toContain(
        "centerId: HO_CENTER_ID",
      );
      expect(src, `${f}: đường vượt phải bắt buộc lý do`).toContain(
        "tối thiểu 5 ký tự",
      );
    }
  });

  // ── CỔNG THỨ BA: DUYỆT đơn vào kỳ đã chốt (09/09/2026) ────────────────────
  //
  // Hai cổng cũ canh đường GHI của quản lý (chốt kỳ, xếp lại khung ca). Đường thứ ba đi
  // qua ĐƠN TỪ và trước 09/09 KHÔNG ai canh: `createRequest` chặn NỘP vào kỳ đã chốt,
  // nhưng `decideRequest` không kiểm gì. Đơn nộp TRƯỚC khi chốt, duyệt SAU khi chốt thì
  // nhánh TIMESHEET_FIX `createMany` thẳng `StaffTimeLog` vào kỳ đã đóng băng.
  //
  // Hỏng câm: `summaryJson` là ảnh chụp lúc khoá nên số trên màn Kỳ công KHÔNG đổi — sổ
  // đã chốt và dữ liệu sống lệch nhau mà không có gì báo.
  it("decideRequest có cổng kỳ đã chốt, và nó đứng TRƯỚC mọi đường ghi", () => {
    const src = doc("lib/cham-cong/requests.ts");
    // 08/10/2026 (đợt 11): điều kiện kỳ chốt DỜI vào hàm dùng chung `loiKyDaChotCuaDon` vì duyệt HUỶ
    // đơn (`huy-don.ts`) cũng ghi vào kỳ và phải hỏi cùng một cổng. Lý lẽ của ba lưới dưới KHÔNG đổi
    // — chỉ chỗ đặt chữ đổi — nên neo vào LỜI GỌI cổng trong nhánh DUYỆT thay cho văn bản cũ.
    const GATE = /if \(input\.decision === "APPROVED"\) \{\s+const loi = await loiKyDaChotCuaDon\(req\);/;
    const iGate = src.search(GATE);
    expect(iGate, "phải có cổng trong decideRequest").toBeGreaterThan(-1);
    // Ba đường ghi hệ quả nằm sau cổng.
    //
    // 06/10/2026: nhánh TIMESHEET_FIX không còn gọi thẳng `tx.staffTimeLog.createMany(` — nó
    // đi qua lõi dùng chung `ghiDongChinhTay(tx, …)` (đánh dấu lượt cũ khi ghi đè + tạo dòng
    // mới). Lý lẽ của lưới ("phép ghi lượt quét đứng SAU cổng kỳ chốt") không đổi; chỉ chỗ đặt
    // chữ đổi, nên neo vào LỜI GỌI ghi của bản mới thay vì cách viết cũ.
    //
    // 08/10/2026 (đợt 3 đơn từ): mọi phép ghi hệ quả DỜI vào handler (`lib/cham-cong/don/*`), gọi
    // qua `HANDLER_DON[req.kind…]` bên trong `db.$transaction`. Lý lẽ không đổi — neo vào điểm
    // VÀO của đường ghi (giao dịch + lời gọi handler), và khẳng định `requests.ts` không còn gọi
    // thẳng phép ghi nào (kẻo một nhánh mới chen vào trước cổng).
    const than = src.slice(src.indexOf("export async function decideRequest"));
    for (const dau of ["db.$transaction(", "HANDLER_DON[req.kind"]) {
      const i = than.indexOf(dau);
      expect(i, `${dau} phải tồn tại trong decideRequest`).toBeGreaterThan(-1);
      expect(than.search(GATE), `cổng phải đứng trước ${dau}`).toBeLessThan(i);
      expect(than.search(GATE), "cổng phải nằm trong decideRequest").toBeGreaterThan(-1);
    }
    for (const ghiThang of ["setAssignmentCell(", "ghiDongChinhTay(", "markAttendanceDayDirty("]) {
      expect(src, `${ghiThang} không được gọi thẳng trong requests.ts`).not.toContain(ghiThang);
    }
  });

  it("chỉ chặn khi DUYỆT — TỪ CHỐI đơn cũ vẫn làm được", () => {
    // Từ chối không ghi gì vào kỳ; chặn cả từ chối là khoá luôn hàng chờ của quản lý.
    // Cổng nằm TRONG nhánh duyệt — gọi nó ngoài nhánh là khoá luôn từ chối.
    const src = doc("lib/cham-cong/requests.ts");
    expect(src).toMatch(/if \(input\.decision === "APPROVED"\) \{\s+const loi = await loiKyDaChotCuaDon\(req\);/);
    expect(src.match(/loiKyDaChotCuaDon\(/g)).toHaveLength(2); // định nghĩa + đúng một lời gọi
  });

  it("đơn LỚP không đi qua cổng này — hệ quả của nó không nằm trong kỳ công", () => {
    // CLASS_OFF/SUB_TEACH ghi vào `lib/classes/adjust.ts`, không đụng StaffAttendanceDay.
    const src = doc("lib/cham-cong/requests.ts");
    const i = src.indexOf("export async function loiKyDaChotCuaDon");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 300)).toContain("isClassKind(req.kind as WorkRequestKindV)) return null;");
  });

  it("đường vượt của đơn từ cũng ở cấp HỘI SỞ và bắt buộc lý do", () => {
    const src = doc("lib/cham-cong/request-actions.ts");
    expect(src).toContain("centerId: HO_CENTER_ID");
    expect(src).toContain("tối thiểu 5 ký tự");
    // Quyền phải kiểm ở ACTION, không ở lib — lib tự hỏi quyền là cơ sở tự vượt cổng.
    expect(doc("lib/cham-cong/requests.ts")).not.toContain("checkPermission");
  });

  // ── CỔNG THỨ TƯ: quản lý GHI ĐÈ giờ chấm công (06/10/2026) ────────────────
  //
  // Ghi đè đánh dấu `DISMISSED` lượt cũ + tạo mốc mới trong MỘT transaction. Cổng kỳ chốt
  // phải đứng TRƯỚC lời gọi ghi trong chính hàm action — đặt sau là "chặn nhưng lượt cũ đã
  // bị đánh dấu", và `return` trong `$transaction` KHÔNG rollback (luật rollback CLAUDE.md),
  // nên từ chối bên trong phải là `throw`.
  it("ghi đè giờ tay: cổng kỳ chốt đứng TRƯỚC phép ghi, và từ chối trong tx là THROW", () => {
    const src = doc("app/(admin)/admin/cham-cong/_actions.ts");
    const than = src.slice(src.indexOf("export async function suaGioQuetTayAction"));
    const iGate = than.indexOf("chanSuaKyDaChot({");
    const iWrite = than.indexOf("ghiDongChinhTay(tx,");
    const iTx = than.indexOf(".$transaction(");
    expect(iGate, "phải có cổng kỳ chốt").toBeGreaterThan(-1);
    expect(iWrite, "phải ghi qua lõi dùng chung").toBeGreaterThan(-1);
    expect(iGate).toBeLessThan(iWrite);
    // Cổng nằm TRONG transaction (đọc kỳ bằng `tx`), nên câu chặn phải là `throw new …`.
    expect(iTx).toBeGreaterThan(-1);
    expect(iTx).toBeLessThan(iGate);
    const doanCong = than.slice(iGate, iWrite);
    expect(doanCong).toContain("throw new TuChoiSuaGio(loi!)");
    expect(doanCong).not.toMatch(/return \{ ok: false/);
  });

  it("audit ghi rõ lượt duyệt có VƯỢT cổng hay không", () => {
    // Không ghi thì sau này không trả lời được "ai đã ghi vào kỳ đã chốt, vì sao".
    expect(doc("lib/cham-cong/request-actions.ts")).toContain(
      "boQuaKyDaChot: boQua",
    );
  });
});
