// [XVL-*] — luật xếp học viên vào lớp theo SỐ BUỔI ĐÃ MUA. Thuần.
import { describe, it, expect } from "vitest";
import {
  TRAN_BUOI_HOC_VUOT,
  demBuoiDaQua,
  duocXep,
  xetXepVaoLop,
} from "./xep-vao-lop";

/** Khoá 48 buổi — phạm vi chủ dự án nói tới. */
const K48 = 48;

describe("[XVL-01] MUA ĐỦ KHOÁ (S=1) — trần học vượt là 4", () => {
  it("lớp chưa học buổi nào ⇒ vào bình thường", () => {
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 48, soBuoiDaQua: 0 });
    expect(x.loai).toBe("binh_thuong");
    expect(x.xepDuoc).toBe(true);
    expect(x.soBuoiHocVuot).toBe(0);
    expect(x.buoiBatDau).toBe(1);
  });

  it.each([1, 2, 3, 4])("lớp đã học %i buổi ⇒ vào được, học vượt đúng %i buổi", (P) => {
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 48, soBuoiDaQua: P });
    expect(x.loai).toBe("hoc_vuot");
    expect(x.xepDuoc).toBe(true);
    expect(x.chiAdmin).toBe(false);
    expect(x.soBuoiHocVuot).toBe(P);
  });

  it("🔴 lớp đã học 5 buổi ⇒ CHẶN, chỉ Quản trị tối cao", () => {
    // Đây là con số chủ dự án chốt lại sau khi tôi hỏi: *"nếu đăng ký 48 mà lớp đã học
    // >4 buổi thì tất cả các role khác không thêm vào được nữa"*. Câu đầu tiên của họ
    // nói "vượt quá 5 buổi", hai câu lệch nhau ĐÚNG MỘT BUỔI — ca này ghim câu chốt.
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 48, soBuoiDaQua: 5 });
    expect(x.loai).toBe("qua_xa");
    expect(x.xepDuoc).toBe(false);
    expect(x.chiAdmin).toBe(true);
  });

  it("lớp đã học 25 buổi ⇒ vẫn chỉ Quản trị tối cao (không có nấc thứ hai)", () => {
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 48, soBuoiDaQua: 25 });
    expect(x.loai).toBe("qua_xa");
    expect(x.chiAdmin).toBe(true);
  });

  it("`soBuoiMua` bỏ trống ⇒ suy về MUA ĐỦ KHOÁ, xét như S=1", () => {
    // Cùng luật suy mặc định với `phamViBuoiDangKy`/`xetSoBuoiDong`. Ba nơi suy khác nhau
    // là ba câu trả lời khác nhau cho cùng một ghi danh.
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: null, soBuoiDaQua: 3 });
    expect(x.buoiBatDau).toBe(1);
    expect(x.loai).toBe("hoc_vuot");
    expect(x.soBuoiHocVuot).toBe(3);
  });

  it("trần là HẰNG, không gõ lại số 4 trong thân hàm", () => {
    expect(TRAN_BUOI_HOC_VUOT).toBe(4);
    const tran = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 48, soBuoiDaQua: TRAN_BUOI_HOC_VUOT });
    const qua = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 48, soBuoiDaQua: TRAN_BUOI_HOC_VUOT + 1 });
    expect(tran.xepDuoc).toBe(true);
    expect(qua.xepDuoc).toBe(false);
  });
});

describe("[XVL-02] MUA ÍT HƠN CẢ KHOÁ — KHÔNG học vượt", () => {
  it("🔴 ca chủ dự án nêu: mua 24 buổi, lớp đã học 24 buổi ⇒ vào, bắt đầu buổi 25", () => {
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 24, soBuoiDaQua: 24 });
    expect(x.buoiBatDau).toBe(25);
    expect(x.buoiKeTiepCuaLop).toBe(25);
    expect(x.loai).toBe("binh_thuong");
    expect(x.xepDuoc).toBe(true);
    expect(x.soBuoiHocVuot).toBe(0);
  });

  it("🔴 KHÔNG BAO GIỜ học vượt, kể cả khi lớp mới đi 1-4 buổi", () => {
    // *"trường hợp học vượt chỉ khi đăng ký 48 buổi"*. Bé mua 24 buổi vào một lớp mới
    // chạy 3 buổi thì bé KHÔNG nợ buổi nào — bé chỉ chờ tới buổi 25.
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 24, soBuoiDaQua: 3 });
    expect(x.soBuoiHocVuot).toBe(0);
    expect(x.loai).toBe("cho_toi_luot");
    expect(x.xepDuoc).toBe(true);
  });

  it("lớp CHƯA tới buổi bắt đầu ⇒ giữ chỗ, nói rõ chờ mấy buổi", () => {
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 24, soBuoiDaQua: 10 });
    expect(x.loai).toBe("cho_toi_luot");
    expect(x.xepDuoc).toBe(true);
    // Lớp ở buổi 11, bé bắt đầu buổi 25 ⇒ chờ 14 buổi.
    expect(x.cau).toContain("14 buổi");
  });

  it("🔴 lớp đã QUA buổi bắt đầu ⇒ bé MẤT buổi đã trả tiền, chỉ Quản trị tối cao", () => {
    // Mua 24 (bắt đầu buổi 25) mà lớp đã ở buổi 27 ⇒ mất 2 buổi đã trả tiền. Đây là ca
    // tiền, không phải ca tiến độ — nên nó KHÔNG rơi vào nhóm "học vượt".
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 24, soBuoiDaQua: 26 });
    expect(x.loai).toBe("mat_buoi_da_tra");
    expect(x.xepDuoc).toBe(false);
    expect(x.chiAdmin).toBe(true);
    expect(x.soBuoiMatTrang).toBe(2);
    expect(x.cau).toContain("MẤT 2 buổi đã trả tiền");
  });

  it("mua 36 buổi ⇒ bắt đầu buổi 13; mua 12 ⇒ buổi 37", () => {
    expect(xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 36, soBuoiDaQua: 0 }).buoiBatDau).toBe(13);
    expect(xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 12, soBuoiDaQua: 0 }).buoiBatDau).toBe(37);
  });

  it("mua 44–47 buổi (S = 2..5) vẫn theo nhóm KHÔNG học vượt", () => {
    // Khoảng chủ dự án chưa nói tới. Theo câu *"học vượt chỉ khi đăng ký 48 buổi"* thì
    // chúng thuộc nhóm dưới. Ghim ở đây để nếu chốt lại thì có đúng một chỗ phải sửa.
    for (const [mua, S] of [[47, 2], [46, 3], [45, 4], [44, 5]] as const) {
      const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: mua, soBuoiDaQua: 0 });
      expect(x.buoiBatDau, `mua ${mua}`).toBe(S);
      expect(x.soBuoiHocVuot, `mua ${mua} không được học vượt`).toBe(0);
    }
  });
});

describe("[XVL-03] thiếu dữ kiện ⇒ FAIL-OPEN, không khoá luồng ghi danh", () => {
  it("khoá không khai số buổi ⇒ `khong_xet`, vẫn xếp được", () => {
    const x = xetXepVaoLop({ tongSoBuoiKhoa: null, soBuoiMua: 24, soBuoiDaQua: 30 });
    expect(x.loai).toBe("khong_xet");
    expect(x.xepDuoc).toBe(true);
    expect(x.buoiBatDau).toBeNull();
  });

  it("mua NHIỀU HƠN khoá ⇒ dữ liệu vô nghĩa, `khong_xet`", () => {
    expect(xetXepVaoLop({ tongSoBuoiKhoa: 48, soBuoiMua: 60, soBuoiDaQua: 0 }).loai).toBe("khong_xet");
  });

  it("`soBuoiDaQua` âm / rác ⇒ coi như 0, không ném", () => {
    for (const rac of [-5, Number.NaN]) {
      const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 48, soBuoiDaQua: rac });
      expect(x.loai, `P = ${String(rac)}`).toBe("binh_thuong");
    }
  });
});

describe("[XVL-04] `duocXep` — Quản trị tối cao qua được MỌI ca", () => {
  it("ca thường: cả hai vai đều xếp được", () => {
    const x = xetXepVaoLop({ tongSoBuoiKhoa: K48, soBuoiMua: 48, soBuoiDaQua: 2 });
    expect(duocXep(x, false)).toBe(true);
    expect(duocXep(x, true)).toBe(true);
  });

  it("🔴 ca chặn: vai thường KHÔNG, Quản trị tối cao CÓ", () => {
    // *"chỉ admin vẫn toàn quyền thêm được cho tất cả các trường hợp"*.
    for (const vao of [
      { tongSoBuoiKhoa: K48, soBuoiMua: 48, soBuoiDaQua: 20 },
      { tongSoBuoiKhoa: K48, soBuoiMua: 24, soBuoiDaQua: 40 },
    ]) {
      const x = xetXepVaoLop(vao);
      expect(duocXep(x, false), JSON.stringify(vao)).toBe(false);
      expect(duocXep(x, true), JSON.stringify(vao)).toBe(true);
    }
  });
});

describe("[XVL-05] `demBuoiDaQua` — đếm theo NGÀY, kể cả buổi đã huỷ", () => {
  const bayGio = new Date("2026-09-29T12:00:00Z");
  const buoi = [
    { date: new Date("2026-09-01T10:00:00Z") },
    { date: new Date("2026-09-15T10:00:00Z") },
    { date: new Date("2026-09-29T10:00:00Z") }, // sáng nay — đã qua
    { date: new Date("2026-09-29T18:00:00Z") }, // tối nay — CHƯA qua
    { date: new Date("2026-10-06T10:00:00Z") },
  ];

  it("đếm đúng số buổi có ngày ≤ bây giờ", () => {
    expect(demBuoiDaQua(buoi, bayGio)).toBe(3);
  });

  it("mảng rỗng ⇒ 0", () => {
    expect(demBuoiDaQua([], bayGio)).toBe(0);
  });

  it("ngày rác ⇒ không tính, không ném", () => {
    expect(demBuoiDaQua([{ date: "khong-phai-ngay" }], bayGio)).toBe(0);
  });

  it("🔴 KHÔNG đọc đồng hồ máy — `bayGio` là tham số BẮT BUỘC", () => {
    // Luật 19: test không được đọc đồng hồ thật, và hàm có mặc định `new Date()` là ca
    // hẹn giờ nổ. Ca này đo bằng cách dời mốc: cùng dữ liệu, hai mốc, hai kết quả.
    expect(demBuoiDaQua(buoi, new Date("2026-09-02T00:00:00Z"))).toBe(1);
    expect(demBuoiDaQua(buoi, new Date("2026-12-31T00:00:00Z"))).toBe(5);
  });
});
