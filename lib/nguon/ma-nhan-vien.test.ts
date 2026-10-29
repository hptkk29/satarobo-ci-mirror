/**
 * Ca [NHH-SRC-13] — giải MÃ NHÂN VIÊN trong `Lead.note` theo NGÀY (D12, 07 §2.6.3).
 *
 * Fixture mang hình dạng dữ liệu thật: mã chữ thường, dạng đảo đoạn `NV.SR.002`, và đợt đổi mã
 * 04/09/2026 18:08–18:11 giờ VN (= 11:08–11:11Z). Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, expect, it } from "vitest";
import {
  bocMaNhanVienTuNote,
  chuanHoaMaNhanVien,
  giaiMaNhanVienTheoNgay,
  type DoiMa,
} from "./ma-nhan-vien";
import { mapInternalForm } from "../lead/intake/map-internal-form";

const d = (iso: string) => new Date(iso);

describe("[NHH-SRC-13] (a) đợt đổi mã 04/09 — hoán vị SR.NV.002 ↔ 004", () => {
  const lichSu: DoiMa[] = [
    { employeeId: "E_LINH", maCu: "SR.NV.002", maMoi: "SR.NV.006", luc: d("2026-09-04T11:08:30.000Z") },
    { employeeId: "E_HUE", maCu: "SR.NV.004", maMoi: "SR.NV.002", luc: d("2026-09-04T11:09:10.000Z") },
  ];
  // Bảng HÔM NAY: E_HUE giữ 002, E_LINH giữ 006.
  const hienTai = new Map([
    ["SR.NV.002", "E_HUE"],
    ["SR.NV.006", "E_LINH"],
  ]);

  it("SR.NV.002 trước đợt đổi ⇒ E_LINH; sau đợt đổi ⇒ E_HUE", () => {
    expect(giaiMaNhanVienTheoNgay("SR.NV.002", d("2026-09-01T03:00:00.000Z"), lichSu, hienTai)).toBe("E_LINH");
    expect(giaiMaNhanVienTheoNgay("SR.NV.002", d("2026-09-05T03:00:00.000Z"), lichSu, hienTai)).toBe("E_HUE");
  });

  it("tra bằng dạng chữ thường nv.sr.002 (qua chuẩn hoá) cũng ra E_LINH @ 01/09", () => {
    const ma = chuanHoaMaNhanVien("nv.sr.002");
    expect(ma).toBe("SR.NV.002");
    expect(giaiMaNhanVienTheoNgay(ma, d("2026-09-01T03:00:00.000Z"), lichSu, hienTai)).toBe("E_LINH");
  });

  it("BIÊN: mã đổi ĐÚNG lúc t ⇒ từ t trở đi đã là mã MỚI; sớm hơn 1ms ⇒ còn mã CŨ", () => {
    // d1 (E_LINH rời 002) lúc 11:08:30.000Z; d2 (E_HUE nhận 002) lúc 11:09:10.000Z.
    expect(giaiMaNhanVienTheoNgay("SR.NV.002", d("2026-09-04T11:08:29.999Z"), lichSu, hienTai)).toBe("E_LINH");
    expect(giaiMaNhanVienTheoNgay("SR.NV.002", d("2026-09-04T11:08:30.000Z"), lichSu, hienTai)).toBeNull();
    expect(giaiMaNhanVienTheoNgay("SR.NV.002", d("2026-09-04T11:09:09.999Z"), lichSu, hienTai)).toBeNull();
    expect(giaiMaNhanVienTheoNgay("SR.NV.002", d("2026-09-04T11:09:10.000Z"), lichSu, hienTai)).toBe("E_HUE");
  });

  it("mã chưa từng tồn tại ⇒ null; sự kiện CREATE (maCu = null) SAU ngày tra ⇒ null", () => {
    expect(giaiMaNhanVienTheoNgay("SR.NV.022", d("2026-09-01T03:00:00.000Z"), lichSu, hienTai)).toBeNull();
    const taoSau: DoiMa[] = [
      { employeeId: "E_MOI", maCu: null, maMoi: "SR.NV.050", luc: d("2026-09-20T03:00:00.000Z") },
    ];
    const bang = new Map([["SR.NV.050", "E_MOI"]]);
    expect(giaiMaNhanVienTheoNgay("SR.NV.050", d("2026-09-10T03:00:00.000Z"), taoSau, bang)).toBeNull();
    // Đối chứng dương: sau ngày tạo thì giải được.
    expect(giaiMaNhanVienTheoNgay("SR.NV.050", d("2026-09-21T03:00:00.000Z"), taoSau, bang)).toBe("E_MOI");
  });
});

describe("[NHH-SRC-13] (b) PB-11 — MỘT người đổi mã HAI lần (phép cấy thứ tự giảm dần)", () => {
  const lichSu: DoiMa[] = [
    { employeeId: "E1", maCu: "SR.NV.010", maMoi: "SR.NV.011", luc: d("2026-09-04T11:08:00.000Z") },
    { employeeId: "E1", maCu: "SR.NV.011", maMoi: "SR.NV.012", luc: d("2026-09-04T11:10:00.000Z") },
    { employeeId: "E2", maCu: "SR.NV.013", maMoi: "SR.NV.011", luc: d("2026-09-04T11:11:00.000Z") },
  ];
  const hienTai = new Map([
    ["SR.NV.012", "E1"],
    ["SR.NV.011", "E2"],
  ]);
  // Cố tình đảo thứ tự mảng đầu vào: hàm phải TỰ sắp, không tin thứ tự gọi.
  const dao = [...lichSu].reverse();

  it("SR.NV.011 @ 01/09 ⇒ null (lúc đó chưa ai giữ 011)", () => {
    expect(giaiMaNhanVienTheoNgay("SR.NV.011", d("2026-09-01T03:00:00.000Z"), lichSu, hienTai)).toBeNull();
    expect(giaiMaNhanVienTheoNgay("SR.NV.011", d("2026-09-01T03:00:00.000Z"), dao, hienTai)).toBeNull();
  });

  it("đối chứng: 011 @ 04/09 11:09Z ⇒ E1; 010 @ 01/09 ⇒ E1; 013 @ 01/09 ⇒ E2", () => {
    expect(giaiMaNhanVienTheoNgay("SR.NV.011", d("2026-09-04T11:09:00.000Z"), lichSu, hienTai)).toBe("E1");
    expect(giaiMaNhanVienTheoNgay("SR.NV.010", d("2026-09-01T03:00:00.000Z"), lichSu, hienTai)).toBe("E1");
    expect(giaiMaNhanVienTheoNgay("SR.NV.013", d("2026-09-01T03:00:00.000Z"), lichSu, hienTai)).toBe("E2");
  });

  it("không đổi các đầu vào", () => {
    const truoc = JSON.stringify([lichSu, [...hienTai]]);
    giaiMaNhanVienTheoNgay("SR.NV.011", d("2026-09-01T03:00:00.000Z"), lichSu, hienTai);
    expect(JSON.stringify([lichSu, [...hienTai]])).toBe(truoc);
  });
});

describe("[NHH-SRC-13] bocMaNhanVienTuNote · chuanHoaMaNhanVien", () => {
  it("lấy đúng dòng 'Nhân viên nhập:' giữa các dòng khác", () => {
    const note = ["Khách hỏi lịch học thử", "  Nhân viên nhập: nv.sr.002 ", "Nhân viên nhập: SR.NV.099 (dòng sau không tính)"].join(
      "\n",
    );
    expect(bocMaNhanVienTuNote(note)).toBe("nv.sr.002");
    expect(bocMaNhanVienTuNote("Không có dòng nào")).toBeNull();
    expect(bocMaNhanVienTuNote(null)).toBeNull();
    // Chữ 'Nhân viên nhập' nằm GIỮA dòng thì không phải dòng nhãn.
    expect(bocMaNhanVienTuNote("ghi chú Nhân viên nhập: SR.NV.001")).toBeNull();
  });

  it("[F2] nhãn KHÔNG kèm mã trên cùng dòng ⇒ null, KHÔNG lấy token của dòng kế", () => {
    expect(bocMaNhanVienTuNote("Nhân viên nhập:\nSR.NV.002")).toBeNull();
    expect(bocMaNhanVienTuNote("Nhân viên nhập:   \r\nSR.NV.002 gọi lại chiều")).toBeNull();
    expect(bocMaNhanVienTuNote("Nhân viên nhập:\n\nKhách hỏi học thử")).toBeNull();
    // Đối chứng dương: cùng mã nhưng nằm trên dòng của nhãn ⇒ bóc được (kể cả đuôi CRLF).
    expect(bocMaNhanVienTuNote("Nhân viên nhập: SR.NV.002\r\nKhách hỏi")).toBe("SR.NV.002");
    expect(bocMaNhanVienTuNote("Nhân viên nhập:\tCS2.TVV.007")).toBe("CS2.TVV.007");
  });

  it("[F2] dòng do map-internal-form ghi khi chưa có mã ('<tên> (chưa gắn mã nhân viên)') ⇒ null, không bóc họ làm mã", () => {
    const dong = (ten: string) => `Nhân viên nhập: ${ten} (chưa gắn mã nhân viên)`;
    expect(bocMaNhanVienTuNote(dong("Nguyễn Thị Diệu"))).toBeNull();
    expect(bocMaNhanVienTuNote(dong("Trần Văn A"))).toBeNull();
    // Tên KHÔNG dấu cũng không phải mã (không có chữ số) — chính ca mà `\S+` + kiểm ASCII đơn thuần sẽ lọt.
    expect(bocMaNhanVienTuNote(dong("Linh"))).toBeNull();
    expect(bocMaNhanVienTuNote(dong("Linh Nguyen"))).toBeNull();
    // Dòng tên đứng TRƯỚC một dòng mã thật ⇒ vẫn bóc được dòng mã thật (không dừng ở dòng tên).
    expect(bocMaNhanVienTuNote(`${dong("Linh")}\nNhân viên nhập: SR.NV.002`)).toBe("SR.NV.002");
  });

  it("[F2] ĐƯỜNG THẬT: note do mapInternalForm ghi — có mã ⇒ bóc đúng mã; chưa gắn mã ⇒ null", () => {
    const base = {
      parentName: "Chị Hương",
      phone: "0905123456",
      childName: null,
      source: null,
      facebookUrl: null,
      centerCode: "CS1",
      note: null,
    };
    const ghi = (staff: { employeeCode: string | null; displayName: string }) => {
      const r = mapInternalForm(base as never, staff);
      if (!r.ok) throw new Error("mapper từ chối");
      return r.lead.noteLines.join("\n");
    };
    expect(bocMaNhanVienTuNote(ghi({ employeeCode: "CS1.TVV.007", displayName: "Nguyễn Thị Diệu" }))).toBe("CS1.TVV.007");
    expect(bocMaNhanVienTuNote(ghi({ employeeCode: null, displayName: "Nguyễn Thị Diệu" }))).toBeNull();
  });

  it("[F2] dạng mã được nhận: đoạn chấm, chữ thường, có gạch — nhưng phải có chữ số", () => {
    for (const ma of ["SR.NV.002", "nv.sr.002", "CS1.TVV.007", "NGH.NV.001", "SR.NV.E005", "NV-TEST-1", "A1"]) {
      expect(bocMaNhanVienTuNote(`Nhân viên nhập: ${ma}`)).toBe(ma);
    }
    // Không chữ số ⇒ không phải mã.
    expect(bocMaNhanVienTuNote("Nhân viên nhập: SR.NV.ABC")).toBeNull();
  });

  it("đảo đoạn NV.<ĐOẠN>.<SỐ> → <ĐOẠN>.NV.<SỐ> (bỏ là mất 21 phiếu — 06/10 §8.2)", () => {
    expect(chuanHoaMaNhanVien("nv.sr.002")).toBe("SR.NV.002");
    expect(chuanHoaMaNhanVien(" NV.CS2.001 ")).toBe("CS2.NV.001");
    // Dạng đã đúng thì giữ nguyên (chỉ trim + hoa).
    expect(chuanHoaMaNhanVien("cs2.nv.001")).toBe("CS2.NV.001");
    expect(chuanHoaMaNhanVien("CS2.TTS.008")).toBe("CS2.TTS.008");
  });
});
