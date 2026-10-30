/**
 * Bảng giải thích loại đơn (chữ "i") — `WR_KIND_GIAI_THICH` trong `lib/work-request.ts`.
 *
 * Hai lớp:
 *  1. ĐỦ: mọi loại trong `WORK_REQUEST_KINDS` có đủ mục, không loại nào thiếu "i".
 *  2. ĐÚNG (luật 12, lưới ghim mã nguồn): mục "Khi quản lý duyệt" là LỜI HỨA. Nó được viết từ
 *     mã đường duyệt đo ngày 06/10/2026; nếu đường duyệt mọc nhánh mới (vd OT bắt đầu cộng giờ)
 *     mà chữ không đổi theo, màn hình nói dối im lặng. Các ca `[GT-W*]` neo vào đúng các nhánh
 *     đó — đỏ nghĩa là "đọc lại `khiDuyet` của loại liên quan", không phải "sửa regex".
 *
 * Mã TRƯỚC bản này: không có lời giải thích nào; form chỉ có nhãn 2–3 chữ.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  WORK_REQUEST_KINDS,
  WR_CATEGORIES,
  WR_KIND_GIAI_THICH,
  WR_KIND_LABEL,
  WR_LUU_Y_CHUNG,
  maNghiTrenLuoi,
} from "./work-request";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Bỏ chú thích trước khi soi — chú thích giải thích bản vá hay chứa đúng chuỗi đang tìm (luật 11). */
function boChuThich(x: string): string {
  return x.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

describe("[GT] mọi loại đơn, không loại nào thiếu chữ 'i'", () => {
  it("[GT-01] khoá của bảng = đúng tập WORK_REQUEST_KINDS (không thiếu, không thừa)", () => {
    expect(Object.keys(WR_KIND_GIAI_THICH).sort()).toEqual([...WORK_REQUEST_KINDS].sort());
    // 10 loại gốc + nghỉ bù (đợt 8) + làm ngày nghỉ / lễ (đợt 9) + chấm ngoài địa điểm (đợt 10).
    // Thêm loại thì sửa con số này CÓ CHỦ ĐÍCH.
    expect(WORK_REQUEST_KINDS).toHaveLength(13);
  });

  it("[GT-01b] mỗi loại thuộc ĐÚNG MỘT nhóm — `wrCategoryOf(k)!` ném lúc chạy với loại không có nhóm", () => {
    for (const k of WORK_REQUEST_KINDS) {
      expect(WR_CATEGORIES.filter((c) => c.kinds.includes(k)), k).toHaveLength(1);
    }
  });

  it.each(WORK_REQUEST_KINDS)("[GT-02] %s có đủ mục, chữ không rỗng", (k) => {
    const g = WR_KIND_GIAI_THICH[k];
    for (const v of [g.moTaNgan, g.dungKhi, g.canDien, g.khiDuyet, g.goiYLyDo]) {
      expect(v.trim().length).toBeGreaterThan(5);
    }
    // "Mô tả 1 dòng" ở thẻ chọn loại: ≤ 40 ký tự để không xuống dòng ở 375px.
    expect(g.moTaNgan.length).toBeLessThanOrEqual(40);
    // "Dùng khi" phải có ví dụ đời thường.
    expect(g.dungKhi).toMatch(/ví dụ/);
    for (const l of g.luuY) expect(l.trim().length).toBeGreaterThan(5);
    // Nhãn ngắn vẫn sống ở bảng nhãn cũ — bảng giải thích không thay nó.
    expect(WR_KIND_LABEL[k].length).toBeGreaterThan(0);
  });

  it("[GT-03] lưu ý chung nói đúng: nộp muộn CHỈ gắn cờ, không chặn", () => {
    expect(WR_LUU_Y_CHUNG).toContain("vẫn gửi được");
    const src = boChuThich(doc("lib/cham-cong/requests.ts"));
    // `submittedLate` chỉ là cột được ghi — không có `return { ok: false` nào gắn với nó.
    expect(src).toMatch(/const submittedLate = from \? isSubmittedLate\(from, now, noticeDays\) : false;/);
    expect(src).not.toMatch(/if \(submittedLate\)/);
  });

  it("[GT-04] maNghiTrenLuoi: có lương ⇒ P, không lương/không khai ⇒ X", () => {
    expect(maNghiTrenLuoi(1)).toBe("P");
    expect(maNghiTrenLuoi(0.5)).toBe("P");
    expect(maNghiTrenLuoi(0)).toBe("X");
    expect(maNghiTrenLuoi(null)).toBe("X");
    expect(maNghiTrenLuoi(undefined)).toBe("X");
  });
});

describe("[GT-W] lời hứa 'Khi quản lý duyệt' khớp mã đường duyệt", () => {
  // Đợt 3 đơn từ (08/10/2026): hệ quả từng loại nằm ở HANDLER (`lib/cham-cong/don/*`), bảng
  // loại → handler ở `registry.ts`. Lưới đọc bảng đó thay cho các nhánh `req.kind === …` cũ của
  // `decideRequest` — LÝ LẼ giữ nguyên: chữ "i" phải nói đúng việc handler làm.
  const requests = boChuThich(doc("lib/cham-cong/requests.ts"));
  const registry = boChuThich(doc("lib/cham-cong/don/registry.ts"));
  const caNghi = boChuThich(doc("lib/cham-cong/don/ca-nghi-cong.ts"));
  const lopHoc = boChuThich(doc("lib/cham-cong/don/lop-hoc.ts"));
  const handlerOf = new Map([...registry.matchAll(/^\s+([A-Z_]+): (\w+),$/gm)].map((m) => [m[1], m[2]]));

  it("[GT-W1] loại 'chỉ căn cứ' = đúng các loại map vào duyetChiGhiNhan; chữ 'i' của chúng nói KHÔNG tự", () => {
    expect(handlerOf.size).toBe(WORK_REQUEST_KINDS.length);
    const chiGhiNhan = [...handlerOf].filter(([, h]) => h === "duyetChiGhiNhan").map(([k]) => k).sort();
    expect(chiGhiNhan).toEqual(["CLASS_CHANGE"]);
    for (const k of chiGhiNhan as "CLASS_CHANGE"[]) {
      expect(WR_KIND_GIAI_THICH[k].khiDuyet, k).toMatch(/KHÔNG tự/);
    }
    // duyetChiGhiNhan thật sự không ghi gì: không đụng tx.
    const than = caNghi.slice(caNghi.indexOf("export const duyetChiGhiNhan"));
    expect(than).not.toMatch(/tx\./);
    // LATE_EARLY có hệ quả từ đợt 2: lời hứa phải nói miễn trừ, không nói "KHÔNG tự".
    expect(handlerOf.get("LATE_EARLY")).toBe("duyetMuonSom");
    expect(WR_KIND_GIAI_THICH.LATE_EARLY.khiDuyet).toMatch(/không bị tính vi phạm/);
    expect(WR_KIND_GIAI_THICH.LATE_EARLY.khiDuyet).not.toMatch(/KHÔNG tự/);
    // OT có hệ quả từ đợt 4: đối chiếu chấm công thực tế (BA §16).
    expect(handlerOf.get("OT")).toBe("duyetTangCa");
    expect(WR_KIND_GIAI_THICH.OT.khiDuyet).toMatch(/đối chiếu với chấm công thực tế/);
    expect(WR_KIND_GIAI_THICH.OT.khiDuyet).not.toMatch(/KHÔNG tự/);
    // Làm từ xa / công tác có hệ quả từ đợt 5–6 — lời hứa theo đúng câu BA §16.
    expect(handlerOf.get("REMOTE")).toBe("duyetLamTuXa");
    expect(handlerOf.get("BUSINESS_TRIP")).toBe("duyetCongTac");
    expect(WR_KIND_GIAI_THICH.REMOTE.khiDuyet).toMatch(/không bị yêu cầu chấm tại văn phòng trong thời gian được duyệt/);
    expect(WR_KIND_GIAI_THICH.BUSINESS_TRIP.khiDuyet).toMatch(/tự ghi nhận lịch công tác; không cần quản lý xếp thêm ca công tác/);
    // decideRequest không còn tự rẽ nhánh theo loại — mọi loại đi qua bảng.
    expect(requests).not.toMatch(/req\.kind === "/);
    expect(requests.match(/HANDLER_DON\[req\.kind/g)).toHaveLength(1);
  });

  it("[GT-W2] đơn lớp: chỉ HUỶ BUỔI và DẠY THAY tác động lịch; dạy thay thiếu người ⇒ không duyệt được", () => {
    expect(handlerOf.get("CLASS_OFF")).toBe("duyetNghiBuoiDay");
    expect(handlerOf.get("SUB_TEACH")).toBe("duyetDayThay");
    expect(lopHoc).toContain("if (!don.targetUserId) throw new DecideError(");
    // Áp không được ⇒ NÉM (không `return { ok: false`) ⇒ cả giao dịch rollback, đơn giữ PENDING.
    expect(lopHoc.match(/if \(!r\.ok\) throw new DecideError\(/g)).toHaveLength(2);
    expect(lopHoc).not.toMatch(/return \{ ok: false/);
    expect(WR_KIND_GIAI_THICH.SUB_TEACH.luuY.join(" ")).toMatch(/Bắt buộc chọn người dạy thay/);
    expect(WR_KIND_GIAI_THICH.CLASS_OFF.khiDuyet).toMatch(/buổi bù/);
  });

  it("[GT-W3] người nhận / làm thay CHỈ được xếp ca khi đơn chọn ca cho họ", () => {
    expect(caNghi.match(/if \(don\.targetUserId && don\.targetNewTemplateId\) \{/g)).toHaveLength(2);
    expect(WR_KIND_GIAI_THICH.SHIFT_SWAP.luuY.join(" ")).toMatch(/giữ nguyên/);
    expect(WR_KIND_GIAI_THICH.LEAVE.khiDuyet).toMatch(/KÈM ca của họ/);
    // Nghỉ: người làm thay chỉ ngày ĐẦU (`workDate: don.fromDate`, không lặp theo khoảng).
    expect(caNghi).toContain("note: `Làm thay theo đơn nghỉ ${don.id}`");
    expect(WR_KIND_GIAI_THICH.LEAVE.khiDuyet).toMatch(/ngày đầu tiên/);
  });

  it("[GT-W4] mã nghỉ ghi lên lưới đi qua maNghiTrenLuoi — một luật, hai nơi đọc", () => {
    expect(caNghi.match(/maNghiTrenLuoi\(lt\?\.paidRatio\)/g)).toHaveLength(1);
    expect(caNghi).not.toMatch(/paidRatio > 0 \? "P" : "X"/);
  });

  it("[GT-W5] không có quỹ phép ⇒ nói KHÔNG trừ phép; maxDaysPerYear chưa ai chặn", () => {
    expect(WR_KIND_GIAI_THICH.LEAVE.luuY.join(" ")).toMatch(/KHÔNG tự trừ/);
    expect(requests).not.toContain("maxDaysPerYear");
    expect(caNghi).not.toContain("maxDaysPerYear");
  });

  it("[GT-W6] chỉnh công: đủ bộ mốc ⇒ ghi đè, thiếu ⇒ ghi thêm (cheDoChoDon)", () => {
    expect(caNghi).toContain("const cheDo = cheDoChoDon(moc, soMocCuaCa(a?.soCapQuetKyVong));");
    expect(WR_KIND_GIAI_THICH.TIMESHEET_FIX.khiDuyet).toMatch(/ĐỦ mốc của ca/);
    expect(WR_KIND_GIAI_THICH.TIMESHEET_FIX.khiDuyet).toMatch(/khai thiếu thì chỉ thêm mốc/);
  });

  it("[GT-W7] làm ngày nghỉ / lễ: chặn ngày có ca làm bình thường; chỉ phút chấm thật trong khung, cột riêng", () => {
    const lnn = boChuThich(doc("lib/cham-cong/don/lam-ngay-nghi.ts"));
    expect(handlerOf.get("HOLIDAY_WORK")).toBe("duyetLamNgayNghi");
    expect(lnn).toMatch(/if \(coCaLam && !laLe\) \{\s*throw new DecideError/);
    expect(WR_KIND_GIAI_THICH.HOLIDAY_WORK.khiDuyet).toMatch(/KHÔNG tự cộng đủ giờ/);
    expect(WR_KIND_GIAI_THICH.HOLIDAY_WORK.luuY.join(" ")).toMatch(/có ca làm việc bình thường thì dùng đơn “Tăng ca”/);
    // Engine: phút = giao cặp đã đóng với khung (không phải độ dài khung).
    const engine = boChuThich(doc("lib/cham-cong/engine.ts"));
    expect(engine).toContain("tong(giao(pairedIntervals, [x.khung]))");
  });

  it("[GT-W8] chấm ngoài địa điểm: chỉ TRONG khung (± dung sai), đơn thiếu khung không mở cả ngày", () => {
    const cn = boChuThich(doc("lib/cham-cong/cham-ngoai.ts"));
    expect(handlerOf.get("OUTSIDE_ATTENDANCE")).toBe("duyetChamNgoai");
    expect(cn).toMatch(/d\.kind !== "OUTSIDE_ATTENDANCE"\) continue;\s*if \(trongKhung\(d, opts\.phut, opts\.dungSaiPhut\) === true\)/);
    expect(WR_KIND_GIAI_THICH.OUTSIDE_ATTENDANCE.khiDuyet).toMatch(/trong khung giờ được duyệt/);
    expect(WR_KIND_GIAI_THICH.OUTSIDE_ATTENDANCE.luuY.join(" ")).toMatch(/Không tự tính đủ công/);
  });
});
