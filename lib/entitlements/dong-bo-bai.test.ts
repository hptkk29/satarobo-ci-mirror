import { describe, expect, it } from "vitest";
import { ABSENT_STATUSES, PRESENT_STATUSES } from "@/lib/labels";
import type { NguonSoCai } from "./tieu-thu";
import {
  quyetDinhDongBoBai,
  type BangChungBai,
  type DongSoCaiHienCo,
  type QuyetDinhDongBoBai,
} from "./dong-bo-bai";

const NGAY_HUY = new Date("2026-10-05T03:00:00Z");

const khong: BangChungBai = { trangThaiDiemDanh: [], hocBuHoanTat: false, hocVuotHoanTat: false };
const bc = (o: Partial<BangChungBai> = {}): BangChungBai => ({ ...khong, ...o });
const dang = (source: NguonSoCai): DongSoCaiHienCo => ({ source, voidedAt: null });
const daHuy = (source: NguonSoCai): DongSoCaiHienCo => ({ source, voidedAt: NGAY_HUY });

const q = (dong: DongSoCaiHienCo | null, bangChung: BangChungBai) => quyetDinhDongBoBai({ dong, bangChung });

describe("[SCP] quyetDinhDongBoBai — bài L của bé có được ĐẾM không, tính lại từ BẰNG CHỨNG (hội tụ, không tăng/giảm theo sự kiện)", () => {
  it("[SCP-01] có mặt hoặc đi muộn ở một buổi lớp, chưa có dòng ⇒ GHI nguồn CLASS", () => {
    for (const s of PRESENT_STATUSES) expect(q(null, bc({ trangThaiDiemDanh: [s] })), s).toEqual({ hanhDong: "GHI", nguon: "CLASS" });
  });

  it("[SCP-02] vắng (đủ bốn nhãn vắng), chưa có dòng, không bằng chứng nào khác ⇒ BO_QUA", () => {
    for (const s of ABSENT_STATUSES) expect(q(null, bc({ trangThaiDiemDanh: [s] })), s).toEqual({ hanhDong: "BO_QUA", lyDo: "KHONG_CO_BANG_CHUNG" });
    expect(q(null, khong)).toEqual({ hanhDong: "BO_QUA", lyDo: "KHONG_CO_BANG_CHUNG" });
  });

  it("[SCP-03] có mặt rồi bị SỬA thành vắng ⇒ dòng CLASS đang hiệu lực bị HUY", () => {
    expect(q(dang("CLASS"), bc({ trangThaiDiemDanh: ["ABSENT_UNEXCUSED"] }))).toEqual({ hanhDong: "HUY" });
    expect(q(dang("CLASS"), khong)).toEqual({ hanhDong: "HUY" }); // điểm danh bị gỡ hẳn
  });

  it("[SCP-04] VẮNG → bù xong (dòng MAKEUP) → sửa thành CÓ MẶT → hoàn bù ⇒ VẪN ĐẾM (không huỷ): còn bằng chứng có mặt", () => {
    expect(q(dang("MAKEUP"), bc({ trangThaiDiemDanh: ["PRESENT"], hocBuHoanTat: false }))).toEqual({ hanhDong: "GIU" });
  });

  it("[SCP-05] bù xong rồi giáo viên lưu lại lưới điểm danh vẫn VẮNG ⇒ KHÔNG huỷ dòng MAKEUP (bù là bằng chứng độc lập)", () => {
    expect(q(dang("MAKEUP"), bc({ trangThaiDiemDanh: ["ABSENT_EXCUSED"], hocBuHoanTat: true }))).toEqual({ hanhDong: "GIU" });
  });

  it("[SCP-06] hai buổi cùng số bài (buổi huỷ + buổi thay thế, hoặc chuyển lớp): MỘT quyết định, không sinh hai dòng", () => {
    const hai = bc({ trangThaiDiemDanh: ["ABSENT_UNEXCUSED", "PRESENT"] });
    expect(q(null, hai)).toEqual({ hanhDong: "GHI", nguon: "CLASS" });
    expect(q(dang("CLASS"), hai)).toEqual({ hanhDong: "GIU" });
    // Một buổi vắng + một buổi có mặt: có mặt thắng, thứ tự trong mảng không quan trọng
    expect(q(null, bc({ trangThaiDiemDanh: ["PRESENT", "ABSENT_UNEXCUSED"] }))).toEqual({ hanhDong: "GHI", nguon: "CLASS" });
  });

  it("[SCP-07] học vượt (không có Attendance) ⇒ GHI nguồn CATCH_UP; mất bằng chứng thì HUY", () => {
    expect(q(null, bc({ hocVuotHoanTat: true }))).toEqual({ hanhDong: "GHI", nguon: "CATCH_UP" });
    expect(q(dang("CATCH_UP"), bc({ hocVuotHoanTat: true }))).toEqual({ hanhDong: "GIU" });
    expect(q(dang("CATCH_UP"), khong)).toEqual({ hanhDong: "HUY" });
  });

  it("[SCP-08] học bù hoàn tất mà chưa có dòng ⇒ GHI nguồn MAKEUP", () => {
    expect(q(null, bc({ trangThaiDiemDanh: ["ABSENT_UNEXCUSED"], hocBuHoanTat: true }))).toEqual({ hanhDong: "GHI", nguon: "MAKEUP" });
  });

  it("[SCP-09] nhiều bằng chứng cùng lúc: CLASS > MAKEUP > CATCH_UP (có mặt ở lớp chính là nguồn gốc)", () => {
    expect(q(null, bc({ trangThaiDiemDanh: ["PRESENT"], hocBuHoanTat: true, hocVuotHoanTat: true }))).toEqual({ hanhDong: "GHI", nguon: "CLASS" });
    expect(q(null, bc({ hocBuHoanTat: true, hocVuotHoanTat: true }))).toEqual({ hanhDong: "GHI", nguon: "MAKEUP" });
  });

  it("[SCP-10] dòng đang hiệu lực mà bằng chứng nay đến từ NGUỒN KHÁC ⇒ GIU, KHÔNG đổi nguồn của dòng", () => {
    const r = q(dang("CLASS"), bc({ hocBuHoanTat: true }));
    expect(r).toEqual({ hanhDong: "GIU" });
    expect("nguon" in r).toBe(false);
  });

  it("[SCP-11] dòng đã bị vô hiệu mà bằng chứng QUAY LẠI ⇒ BAT_LAI (đúng một dòng theo khoá (quyền học, bài))", () => {
    expect(q(daHuy("CLASS"), bc({ trangThaiDiemDanh: ["LATE"] }))).toEqual({ hanhDong: "BAT_LAI", nguon: "CLASS" });
    expect(q(daHuy("CLASS"), bc({ hocBuHoanTat: true }))).toEqual({ hanhDong: "BAT_LAI", nguon: "MAKEUP" });
  });

  it("[SCP-12] dòng đã vô hiệu và vẫn không có bằng chứng ⇒ BO_QUA (không làm gì)", () => {
    expect(q(daHuy("CLASS"), bc({ trangThaiDiemDanh: ["ABSENT_UNEXCUSED"] }))).toEqual({ hanhDong: "BO_QUA", lyDo: "KHONG_CO_BANG_CHUNG" });
  });

  it("[SCP-13] dòng MANUAL / GRACE không do bằng chứng sinh ra ⇒ KHÔNG BAO GIỜ huỷ chỉ vì thiếu bằng chứng điểm danh", () => {
    for (const nguon of ["MANUAL", "GRACE"] as const) {
      expect(q(dang(nguon), khong), nguon).toEqual({ hanhDong: "GIU" });
      expect(q(dang(nguon), bc({ trangThaiDiemDanh: ["ABSENT_UNEXCUSED"] })), nguon).toEqual({ hanhDong: "GIU" });
    }
  });

  it("[SCP-14] dòng MANUAL / GRACE đã vô hiệu: KHÔNG bật lại dù có bằng chứng (người/ngưỡng ân hạn đã quyết)", () => {
    for (const nguon of ["MANUAL", "GRACE"] as const) {
      expect(q(daHuy(nguon), bc({ trangThaiDiemDanh: ["PRESENT"] })), nguon).toEqual({ hanhDong: "BO_QUA", lyDo: "DONG_THU_CONG" });
    }
  });

  it("[SCP-15] trạng thái lạ trong điểm danh (CANCELLED, MADE_UP, rác) KHÔNG phải bằng chứng có mặt", () => {
    for (const s of ["CANCELLED", "MADE_UP", "NEEDS_MAKEUP", "present", ""]) {
      expect(q(null, bc({ trangThaiDiemDanh: [s] })), s).toEqual({ hanhDong: "BO_QUA", lyDo: "KHONG_CO_BANG_CHUNG" });
    }
  });

  it("[SCP-16] HỘI TỤ: với mọi tổ hợp (dòng hiện có × bằng chứng), áp quyết định rồi hỏi lại luôn ra GIU hoặc BO_QUA — và dòng đếm ⇔ có bằng chứng", () => {
    const dongCoThe: (DongSoCaiHienCo | null)[] = [null, dang("CLASS"), dang("MAKEUP"), dang("CATCH_UP"), daHuy("CLASS"), daHuy("MAKEUP"), daHuy("CATCH_UP")];
    const trangThai = [[], ["PRESENT"], ["ABSENT_UNEXCUSED"], ["ABSENT_UNEXCUSED", "LATE"]];
    for (const dong of dongCoThe) {
      for (const ds of trangThai) {
        for (const hocBu of [false, true]) {
          for (const hocVuot of [false, true]) {
            const b = bc({ trangThaiDiemDanh: ds, hocBuHoanTat: hocBu, hocVuotHoanTat: hocVuot });
            const co = ds.includes("PRESENT") || ds.includes("LATE") || hocBu || hocVuot;
            const sau = apDung(dong, q(dong, b));
            const nhan = JSON.stringify({ dong, b });
            expect(sau !== null && sau.voidedAt === null, nhan).toBe(co);
            const lanHai: QuyetDinhDongBoBai = q(sau, b);
            expect(["GIU", "BO_QUA"], nhan).toContain(lanHai.hanhDong);
          }
        }
      }
    }
  });
});

/** Mô phỏng phép ghi: kết quả của một quyết định lên một dòng sổ cái. */
function apDung(dong: DongSoCaiHienCo | null, qd: QuyetDinhDongBoBai): DongSoCaiHienCo | null {
  switch (qd.hanhDong) {
    case "GHI":
    case "BAT_LAI":
      return { source: qd.nguon, voidedAt: null };
    case "HUY":
      return dong ? { ...dong, voidedAt: NGAY_HUY } : null;
    case "GIU":
    case "BO_QUA":
      return dong;
  }
}
