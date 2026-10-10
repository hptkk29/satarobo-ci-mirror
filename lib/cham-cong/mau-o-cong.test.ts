/**
 * lib/cham-cong/mau-o-cong.test.ts — luật tô màu ô của Bảng công tháng.
 *
 * Vì sao luật này cần test riêng: nó là thứ DUY NHẤT người quản lý đọc khi lướt lưới. Sai
 * một nhánh là bôi đen oan một người suốt cả tháng, và không có gì báo lỗi — trang vẫn
 * render, console vẫn sạch. Đúng họ với luật 12 (affordance phải nói thật).
 */
import { describe, expect, it } from "vitest";
import {
  MAU_O,
  demTheoMau,
  phanLoaiO,
  type ONgayVao,
} from "./mau-o-cong";

/** Ô mặc định: có ca, ngày đã qua, không cờ — tức một ngày làm việc bình thường. */
const o = (p: Partial<ONgayVao> = {}): ONgayVao => ({
  coCa: true,
  daQua: true,
  daTinh: true,
  dayType: "WORK",
  flags: [],
  absenceStatus: null,
  overrideUnits: null,
  locked: false,
  ...p,
});

const mau = (p: Partial<ONgayVao> = {}) => phanLoaiO(o(p)).mau;
const dau = (p: Partial<ONgayVao> = {}) => phanLoaiO(o(p)).dauHieu;

describe("phanLoaiO — nền ô", () => {
  it("không xếp ca ⇒ TRONG, dù ngày đã qua hay chưa", () => {
    expect(mau({ coCa: false, daQua: true, dayType: null })).toBe("TRONG");
    expect(mau({ coCa: false, daQua: false, dayType: null })).toBe("TRONG");
  });

  it("có ca nhưng CHƯA tới ngày ⇒ CHUA_TOI — kể cả khi chưa có lượt quét nào", () => {
    // Đây là vế dễ sai nhất: ngày mai chưa ai quét, nên `flags` rỗng hoặc mang
    // KHONG_CO_LUOT tuỳ engine. Cả hai đều KHÔNG được thành đỏ hay đen.
    expect(mau({ daQua: false })).toBe("CHUA_TOI");
    expect(mau({ daQua: false, flags: ["KHONG_CO_LUOT"] })).toBe("CHUA_TOI");
    expect(mau({ daQua: false, flags: ["DI_MUON"] })).toBe("CHUA_TOI");
  });

  it("ngày ĐÃ QUA, có ca, nhưng CHƯA có dòng bảng công ⇒ CHUA_TINH, KHÔNG phải xanh", () => {
    // Đo prod-like 25/09/2026: **155/378 ô ca của ngày đã qua chưa có dòng bảng công**, dính
    // cả 18 người — và trước bản vá cả 155 ngày ấy hiện "Đi làm, đúng giờ" MÀU XANH với 0
    // công. Nhìn thì yên tâm, số thì rỗng; chốt kỳ lúc đó là chốt ở 0 công.
    expect(mau({ daTinh: false, dayType: null })).toBe("CHUA_TINH");
    expect(mau({ daTinh: false, dayType: null })).not.toBe("DU_CONG");
  });

  it("chưa tới ngày thắng chưa tính — ngày mai chưa tính là bình thường", () => {
    expect(mau({ daQua: false, daTinh: false, dayType: null })).toBe("CHUA_TOI");
  });

  it("nghỉ theo lịch (lễ · nghỉ tuần · nghỉ phép) ⇒ NGHI", () => {
    expect(mau({ dayType: "HOLIDAY" })).toBe("NGHI");
    expect(mau({ dayType: "WEEKLY_OFF" })).toBe("NGHI");
    expect(mau({ dayType: "LEAVE" })).toBe("NGHI");
  });

  it("đủ công, không cờ nặng ⇒ DU_CONG", () => {
    expect(mau()).toBe("DU_CONG");
  });

  it("DEN_SAT_GIO vẫn là DU_CONG — engine coi nó CHỈ NHẮC, không tính muộn", () => {
    // Nếu ca này đỏ lên thì lưới đỏ lòm vì những người đến sớm 1 phút so với dung sai,
    // và "đỏ = vi phạm" mất nghĩa ngay tháng đầu.
    expect(mau({ flags: ["DEN_SAT_GIO"] })).toBe("DU_CONG");
  });

  it("PHÂN ĐỊNH RÕ đi muộn với về sớm — hai ô khác nhau (chốt 25/09)", () => {
    expect(mau({ flags: ["DI_MUON"] })).toBe("DI_MUON");
    expect(mau({ flags: ["VE_SOM"] })).toBe("VE_SOM");
  });

  it("vừa muộn vừa sớm ⇒ ô lấy ĐI MUỘN (hỏng trước trong ngày)", () => {
    // Cột đếm bên phải đếm theo CỜ chứ không theo màu, nên ngày này vẫn vào cả hai cột —
    // xem `soDiMuon`/`soVeSom` ở `bang-cong-thang-db.ts`.
    expect(mau({ flags: ["VE_SOM", "DI_MUON"] })).toBe("DI_MUON");
  });

  it("THIEU_GIO đứng MỘT MÌNH ⇒ có ô riêng, KHÔNG bị nuốt", () => {
    // Chủ dự án nói "có muộn/sớm thì 100% thiếu giờ nên không cần hiện thiếu giờ" — đúng ở
    // chiều đó. Nhưng đo tháng 9/2026: **7/15 ngày thiếu giờ KHÔNG hề muộn cũng không sớm**
    // (ra giữa ngày rồi vào lại). Gỡ hẳn là 7 ngày ấy hoá XANH "đi làm đúng giờ".
    expect(mau({ flags: ["THIEU_GIO"] })).toBe("THIEU_GIO");
  });

  it("THIEU_GIO đi KÈM muộn/sớm ⇒ KHÔNG chen vào, ô là muộn/sớm", () => {
    expect(mau({ flags: ["DI_MUON", "THIEU_GIO"] })).toBe("DI_MUON");
    expect(mau({ flags: ["VE_SOM", "THIEU_GIO"] })).toBe("VE_SOM");
  });

  it("THIEU_GIO KHÔNG tính vào nội quy (khác muộn/sớm)", () => {
    // `noi-quy.ts` đếm `soLanTre` từ DI_MUON, không từ THIEU_GIO — giữ cho khớp.
    expect(MAU_O.THIEU_GIO.nang).toBe(false);
    expect(MAU_O.DI_MUON.nang).toBe(true);
    expect(MAU_O.VE_SOM.nang).toBe(true);
  });

  it("thiếu mốc quét ⇒ THIEU_LUOT, KHÔNG phải VI_PHAM_GIO", () => {
    // Chốt của chủ dự án gộp hai thứ này vào "đỏ". Tách ra có chủ đích: quên bấm nút ra thì
    // nộp đơn chỉnh công là xong, còn đi muộn 40′ là vi phạm nội quy. Gộp lại thì người
    // quên bấm nút trông y hệt người hay đi trễ — đúng thứ làm "đỏ lòm" mất nghĩa.
    for (const f of [
      "THIEU_LUOT_RA",
      "RA_KHONG_CO_VAO",
      "THIEU_BUOI_SANG",
      "THIEU_BUOI_CHIEU",
      "THIEU_LUOT_GIUA_CA",
    ]) {
      expect(mau({ flags: [f] }), `${f} phải là THIEU_LUOT`).toBe("THIEU_LUOT");
    }
  });

  it("vừa đi muộn vừa thiếu lượt ⇒ lấy mức NẶNG HƠN (đi muộn)", () => {
    expect(mau({ flags: ["THIEU_LUOT_RA", "DI_MUON"] })).toBe("DI_MUON");
  });

  it("thiếu lượt quét NẶNG HƠN thiếu giờ — thiếu mốc là chưa biết giờ thật", () => {
    expect(mau({ flags: ["THIEU_LUOT_RA", "THIEU_GIO"] })).toBe("THIEU_LUOT");
  });
});

describe("phanLoaiO — vắng mặt: hai ô KHÁC NHAU, đây là chỗ dễ bôi đen oan", () => {
  it("KHONG_CO_LUOT mà CHƯA ai kết luận ⇒ CHO_KET_LUAN, KHÔNG phải nghỉ không phép", () => {
    // Đo prod/dev tháng 9/2026: 19 ngày mang KHONG_CO_LUOT, 0 ngày có `absenceStatus`.
    // Tô đen thẳng từ cờ này là bôi đen 19 lượt trong khi không ngày nào bị trừ công.
    // Cờ đó còn do quên quét, quầy hỏng, đi công tác — chốt 06/09 nói rõ không tự suy.
    const r = phanLoaiO(o({ flags: ["KHONG_CO_LUOT"] }));
    expect(r.mau).toBe("CHO_KET_LUAN");
    expect(r.mau).not.toBe("NGHI_KHONG_PHEP");
  });

  it("quản lý kết luận UNAUTHORISED ⇒ NGHI_KHONG_PHEP", () => {
    expect(mau({ flags: ["KHONG_CO_LUOT"], absenceStatus: "UNAUTHORISED" })).toBe(
      "NGHI_KHONG_PHEP",
    );
  });

  it("quản lý kết luận EXCUSED ⇒ NGHI (có lý do, không trừ)", () => {
    expect(mau({ flags: ["KHONG_CO_LUOT"], absenceStatus: "EXCUSED" })).toBe("NGHI");
  });

  it("kết luận của NGƯỜI thắng mọi cờ của máy", () => {
    // `absenceStatus` do quản lý ghi và sống sót qua mỗi lần engine tính lại — nên nó phải
    // thắng, kẻo màn hình nói ngược kết luận vừa bấm.
    expect(mau({ flags: ["DI_MUON", "THIEU_GIO"], absenceStatus: "UNAUTHORISED" })).toBe(
      "NGHI_KHONG_PHEP",
    );
    expect(mau({ flags: ["DI_MUON", "THIEU_GIO"], absenceStatus: "EXCUSED" })).toBe("NGHI");
  });
});

describe("phanLoaiO — dấu hiệu góc ô: KHÔNG được đổi nền", () => {
  it("kỳ đã chốt ⇒ dấu KHOA, nền giữ nguyên", () => {
    const r = phanLoaiO(o({ locked: true }));
    expect(r.dauHieu).toContain("KHOA");
    expect(r.mau).toBe("DU_CONG");
  });

  it("quản lý ghi đè công ⇒ dấu GHI_DE, kể cả khi ghi đè 0", () => {
    expect(dau({ overrideUnits: 0.5 })).toContain("GHI_DE");
    // `0` là giá trị THẬT (ghi đè về 0 công), không phải "chưa ghi đè" — `??`/falsy ở đây
    // là bug im lặng: người bị ghi đè về 0 mất dấu hiệu duy nhất nói vì sao.
    expect(dau({ overrideUnits: 0 })).toContain("GHI_DE");
    expect(dau({ overrideUnits: null })).not.toContain("GHI_DE");
  });

  it("ngoài vùng / sai nơi làm ⇒ dấu SAI_CHO", () => {
    expect(dau({ flags: ["NGOAI_VUNG"] })).toContain("SAI_CHO");
    expect(dau({ flags: ["SAI_NOI_LAM"] })).toContain("SAI_CHO");
  });

  it("chấm ngoài lịch ⇒ dấu NGOAI_LICH", () => {
    expect(dau({ flags: ["CHAM_NGOAI_LICH"] })).toContain("NGOAI_LICH");
  });

  it("ngoài vùng KHÔNG tự làm ô đỏ — vị trí là chuyện khác với giờ giấc", () => {
    expect(mau({ flags: ["NGOAI_VUNG"] })).toBe("DU_CONG");
  });
});

describe("MAU_O — bảng nhãn là NGUỒN DUY NHẤT cho cả tô màu lẫn chú giải", () => {
  it("mọi màu `phanLoaiO` trả về đều có nhãn trong MAU_O", () => {
    // Chú giải dựng TỪ bảng này. Thiếu một khoá là ô có màu mà chú giải không giải thích —
    // loại lỗi mà mắt không bắt được vì trang vẫn render bình thường.
    const moiMau = [
      mau({ coCa: false, dayType: null }),
      mau({ daQua: false }),
      mau({ daTinh: false, dayType: null }),
      mau({ dayType: "HOLIDAY" }),
      mau(),
      mau({ flags: ["THIEU_LUOT_RA"] }),
      mau({ flags: ["THIEU_GIO"] }),
      mau({ flags: ["VE_SOM"] }),
      mau({ flags: ["DI_MUON"] }),
      mau({ flags: ["KHONG_CO_LUOT"] }),
      mau({ absenceStatus: "UNAUTHORISED" }),
    ];
    expect(new Set(moiMau).size).toBe(11); // anti-vacuity: đủ 11 trạng thái khác nhau
    for (const m of moiMau) {
      expect(MAU_O[m], `thiếu nhãn cho ${m}`).toBeTruthy();
      expect(MAU_O[m].nhan.length).toBeGreaterThan(0);
      expect(MAU_O[m].moTa.length).toBeGreaterThan(0);
    }
  });

  it("mỗi màu có một lớp nền riêng — hai trạng thái trùng lớp là hai ô không phân biệt được", () => {
    const lop = Object.values(MAU_O).map((m) => m.lopO);
    expect(new Set(lop).size).toBe(lop.length);
  });
});

describe("demTheoMau — để xếp ai vi phạm nhiều lên đầu", () => {
  it("đếm đúng theo từng màu, bỏ qua ô chưa tới ngày", () => {
    const cells = [
      o({ flags: ["DI_MUON"] }),
      o({ flags: ["VE_SOM"] }),
      o({ flags: ["THIEU_LUOT_RA"] }),
      o({ absenceStatus: "UNAUTHORISED" }),
      o({ daQua: false }),
      o(),
    ].map(phanLoaiO);
    const d = demTheoMau(cells);
    expect(d.DI_MUON).toBe(1);
    expect(d.VE_SOM).toBe(1);
    expect(d.THIEU_LUOT).toBe(1);
    expect(d.NGHI_KHONG_PHEP).toBe(1);
    expect(d.CHUA_TOI).toBe(1);
    expect(d.DU_CONG).toBe(1);
  });

  it("nặng = đỏ + đen, và đó là thứ dùng để xếp hàng", () => {
    const nhieu = [o({ flags: ["DI_MUON"] }), o({ absenceStatus: "UNAUTHORISED" })].map(phanLoaiO);
    const it_ = [o({ flags: ["THIEU_LUOT_RA"] }), o()].map(phanLoaiO);
    expect(demTheoMau(nhieu).nang).toBe(2);
    expect(demTheoMau(it_).nang).toBe(0);
  });
});
