import { describe, expect, it } from "vitest";

import { NGAN_HANG } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { docVe } from "@/lib/disc/ngan-hang/de-ky";
import { oKhungCua } from "@/lib/disc/ngan-hang/nap";

import { CAU_LOI_NOP, dePhatRaTuVe, laDeGoc, nganHangDangBat, nopBaiChoThanhVien, phatDeChoThanhVien, deGoc } from "./bai-lam";

const KHOA = "khoa-thu-nghiem-chi-dung-cho-test-32-ky-tu-tro-len";
const BAY_GIO = new Date("2026-11-02T03:00:00.000Z");

/** Câu trả lời KHÔNG phẳng, tất định: giá trị thay đổi theo vị trí. */
function traLoiMau(soCau: number, mucToiDa: number): Record<string, number> {
  const r: Record<string, number> = {};
  for (let i = 0; i < soCau; i++) r[String(i)] = ((i * 7) % mucToiDa) + 1;
  return r;
}

function phat(boDe: "PH" | "TH" | "MN", o: { nganHang: boolean; daThay?: string[]; hat?: string; nguoi?: string }) {
  return phatDeChoThanhVien({ boDe, thanhVienId: o.nguoi ?? "tv1", daThay: o.daThay ?? [], hat: o.hat ?? "hat-1", khoa: KHOA, bayGio: BAY_GIO, dungNganHang: o.nganHang });
}

describe("phát đề + nộp bài của một thành viên", () => {
  it("[SG-BL-01] cờ ngân hàng TẮT ⇒ đề GỐC đúng thứ tự gốc; chấm xong ghi phiên bản 1.1", () => {
    const de = phat("PH", { nganHang: false });
    const goc = NGAN_HANG.PH;
    expect(de.cau).toHaveLength(goc.cau.length);
    // Thứ tự HIỂN THỊ là thứ tự ô khung (THU_TU), không phải thứ tự mảng `cau` của engine.
    const theoMa = new Map(goc.cau.map((c) => [c.ma, c.noiDung]));
    expect(de.cau.map((c) => c.noiDung)).toEqual(oKhungCua("PH").map((m) => theoMa.get(m)));
    const kq = nopBaiChoThanhVien({ ve: de.ve, theoViTri: traLoiMau(de.cau.length, goc.mucToiDa), thanhVienId: "tv1", boDeMongDoi: "PH", khoa: KHOA, bayGio: BAY_GIO });
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.phienBanBoDe).toBe("1.1");
    expect(kq.laDeGoc).toBe(true);
    for (const k of ["D", "I", "S", "C"] as const) {
      expect(kq.ketQua.diem[k]).toBeGreaterThanOrEqual(0);
      expect(kq.ketQua.diem[k]).toBeLessThanOrEqual(100);
    }
  });

  it("[SG-BL-02] cờ BẬT ⇒ đề từ ngân hàng, phiên bản nh:nh1, cùng số câu với đề gốc", () => {
    const de = phat("TH", { nganHang: true });
    expect(de.cau).toHaveLength(NGAN_HANG.TH.cau.length);
    const kq = nopBaiChoThanhVien({ ve: de.ve, theoViTri: traLoiMau(de.cau.length, NGAN_HANG.TH.mucToiDa), thanhVienId: "tv1", boDeMongDoi: "TH", khoa: KHOA, bayGio: BAY_GIO });
    expect(kq.ok && kq.phienBanBoDe).toBe("nh:nh1");
    expect(kq.ok && kq.laDeGoc).toBe(false);
  });

  it("[SG-BL-03] bốc không trùng: lần làm thứ hai không lặp MỘT câu nào của lần đầu", () => {
    const d1 = phat("PH", { nganHang: true, hat: "a" });
    const v1 = docVe(d1.ve, KHOA, "tv1", BAY_GIO);
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const d2 = phat("PH", { nganHang: true, hat: "b", daThay: [...v1.de.maCau] });
    const v2 = docVe(d2.ve, KHOA, "tv1", BAY_GIO);
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    const chung = v2.de.maCau.filter((m) => v1.de.maCau.includes(m));
    expect(chung).toEqual([]);
    // Đối chứng: KHÔNG có lịch sử thì cùng hạt cho cùng đề (tái hiện được).
    const d3 = phat("PH", { nganHang: true, hat: "a" });
    expect(d3.cau.map((c) => c.noiDung)).toEqual(d1.cau.map((c) => c.noiDung));
  });

  it("[SG-BL-04] đề phát ra cho trình duyệt KHÔNG chứa khoá chấm (trục, chiều đảo, mã câu)", () => {
    for (const nh of [false, true]) {
      const de = phat("PH", { nganHang: nh });
      const json = JSON.stringify(de);
      expect(json).not.toMatch(/"truc"|"dao"|"maCau"|"oKhung"/);
      expect(json).not.toMatch(/PH-[DISC]\d/);
      expect(Object.keys(de.cau[0]!).sort()).toEqual(["noiDung", "viTri"]);
    }
  });

  it("[SG-BL-05] vé gắn NGƯỜI LÀM: nộp cho người khác ⇒ SAI_NGUOI_LAM; vé sửa ⇒ VE_HONG; quá 24 giờ ⇒ HET_HAN", () => {
    const de = phat("PH", { nganHang: true });
    const tl = traLoiMau(de.cau.length, NGAN_HANG.PH.mucToiDa);
    const nop = (o: Partial<Parameters<typeof nopBaiChoThanhVien>[0]>) =>
      nopBaiChoThanhVien({ ve: de.ve, theoViTri: tl, thanhVienId: "tv1", boDeMongDoi: "PH", khoa: KHOA, bayGio: BAY_GIO, ...o });
    expect(nop({ thanhVienId: "tv2" })).toEqual({ ok: false, lyDo: "SAI_NGUOI_LAM" });
    expect(nop({ ve: de.ve.slice(0, -2) + "xx" })).toEqual({ ok: false, lyDo: "VE_HONG" });
    expect(nop({ bayGio: new Date(BAY_GIO.getTime() + 25 * 3_600_000) })).toEqual({ ok: false, lyDo: "HET_HAN" });
    expect(nop({ bayGio: new Date(BAY_GIO.getTime() + 23 * 3_600_000) }).ok).toBe(true);
  });

  it("[SG-BL-06] bộ đề do SERVER định tuyến: vé phát cho bộ khác ⇒ SAI_BO_DE (client không tự chọn bộ)", () => {
    const de = phat("TH", { nganHang: false });
    const tl = traLoiMau(de.cau.length, NGAN_HANG.TH.mucToiDa);
    expect(nopBaiChoThanhVien({ ve: de.ve, theoViTri: tl, thanhVienId: "tv1", boDeMongDoi: "PH", khoa: KHOA, bayGio: BAY_GIO })).toEqual({ ok: false, lyDo: "SAI_BO_DE" });
  });

  it("[SG-BL-07] câu trả lời: thiếu câu · giá trị lẻ · ngoài thang · trả lời phẳng ⇒ từ chối, mỗi lỗi một lý do", () => {
    const de = phat("PH", { nganHang: false });
    const max = NGAN_HANG.PH.mucToiDa;
    const tl = traLoiMau(de.cau.length, max);
    const nop = (t: unknown) => nopBaiChoThanhVien({ ve: de.ve, theoViTri: t, thanhVienId: "tv1", boDeMongDoi: "PH", khoa: KHOA, bayGio: BAY_GIO });
    const thieu = { ...tl };
    delete thieu["3"];
    expect(nop(thieu)).toEqual({ ok: false, lyDo: "THIEU_CAU_TRA_LOI" });
    expect(nop({ ...tl, "0": 2.5 })).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
    expect(nop({ ...tl, "0": max + 1 })).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
    expect(nop({ ...tl, "999": 3 })).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
    expect(nop(Object.fromEntries(Object.keys(tl).map((k) => [k, 3])))).toEqual({ ok: false, lyDo: "TRA_LOI_PHANG" });
    expect(nop(null)).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
    expect(nop([])).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
    for (const c of Object.values(CAU_LOI_NOP)) expect(c.length).toBeGreaterThan(10);
  });

  it("[SG-BL-08] làm tiếp từ bản nháp: dựng lại ĐÚNG đề từ vé; vé sai người/hết hạn bị từ chối", () => {
    const de = phat("PH", { nganHang: true });
    const lai = dePhatRaTuVe({ ve: de.ve, thanhVienId: "tv1", khoa: KHOA, bayGio: BAY_GIO });
    expect(lai.ok && lai.de.cau.map((c) => c.noiDung)).toEqual(de.cau.map((c) => c.noiDung));
    expect(dePhatRaTuVe({ ve: de.ve, thanhVienId: "tv2", khoa: KHOA, bayGio: BAY_GIO })).toEqual({ ok: false, lyDo: "SAI_NGUOI_LAM" });
    expect(dePhatRaTuVe({ ve: de.ve, thanhVienId: "tv1", khoa: KHOA, bayGio: new Date(BAY_GIO.getTime() + 30 * 3_600_000) })).toEqual({ ok: false, lyDo: "HET_HAN" });
  });

  it("[SG-BL-09] nhận diện đề gốc: đúng thứ tự gốc mới là gốc; đổi chỗ hai câu thì không", () => {
    const g = deGoc("PH");
    expect(laDeGoc("PH", g.maCau)).toBe(true);
    const doi = [...g.maCau];
    [doi[0], doi[1]] = [doi[1]!, doi[0]!];
    expect(laDeGoc("PH", doi)).toBe(false);
    expect(laDeGoc("PH", g.maCau.slice(1))).toBe(false);
  });

  it("[SG-BL-10] cờ ngân hàng mặc định TẮT; chỉ chuỗi «true» mới bật", () => {
    expect(nganHangDangBat({} as NodeJS.ProcessEnv)).toBe(false);
    expect(nganHangDangBat({ DISC_NGAN_HANG_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(nganHangDangBat({ DISC_NGAN_HANG_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
