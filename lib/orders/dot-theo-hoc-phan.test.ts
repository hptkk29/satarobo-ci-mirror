// Ca [DHP-*] — kế hoạch đợt theo HỌC PHẦN. Thuần, không DB.
//
// Phạm vi chủ dự án chốt 28/09/2026: CHỈ khoá 48 buổi (sata3→7), tiền chia theo SỐ BUỔI
// của từng học phần.
//
// ⚠️ Thứ bộ ca này canh KHÔNG phải "hàm chia đúng số" — `chiaDotHocPhi` đã có ca riêng.
// Nó canh ba điều dễ mất:
//   · PHẠM VI (khoá ≠ 48 buổi thì KHÔNG đề xuất gì);
//   · đơn LỆCH MỐC thì cũng không đề xuất — kẻo che mất cái lệch người duyệt cần thấy;
//   · bất biến **Σ đợt = học phí**, kể cả khi số tiền không chia hết.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  goiYKeHoachDon,
  keHoachDotTheoHocPhan,
  phamViBuoiDangKy,
} from "./dot-theo-hoc-phan";
import { xetDuyetDon } from "./nguong-duyet";
import { lyDoSoBuoi, xetSoBuoiDong } from "./so-buoi-hoc-phan";

describe("[DHP-01] PHẠM VI — chỉ khoá 48 buổi", () => {
  it.each([
    ["RoboSim 9 buổi", 9],
    ["Sata 1 (11)", 11],
    ["Sata 2/3/4 trên DB dev (12)", 12],
    ["Combo 1&2 (23)", 23],
    ["khoá 60 buổi nếu có ngày mở", 60],
  ])("%s ⇒ KHÔNG đề xuất gì", (_ten, tong) => {
    // 🔴 Vế phạm vi là vế giữ cho luật không nổ. Form lấy `totalSessions` làm mặc định cho
    // ô "Số buổi mua", nên bỏ vế này là MỌI đơn của MỌI khoá bị ép về "n đợt theo học
    // phần" — kể cả khoá không chia học phần.
    expect(keHoachDotTheoHocPhan({ tongSoBuoiKhoa: tong, soBuoiMua: null, hocPhi: 1_000_000 }))
      .toEqual({ apLuat: false, dot: null });
  });

  it("khoá chưa khai số buổi (null) ⇒ KHÔNG đề xuất", () => {
    expect(
      keHoachDotTheoHocPhan({ tongSoBuoiKhoa: null, soBuoiMua: 48, hocPhi: 1_000_000 }).apLuat,
    ).toBe(false);
  });
});

describe("[DHP-02] trong phạm vi: mỗi học phần MỘT đợt, tiền theo số buổi", () => {
  it("mua đủ khoá (không khai số buổi) ⇒ 4 đợt × 12 buổi, HP1→HP4", () => {
    const r = keHoachDotTheoHocPhan({
      tongSoBuoiKhoa: 48,
      soBuoiMua: null,
      hocPhi: 20_800_000,
    });
    expect(r.apLuat).toBe(true);
    expect(r.dot).toEqual([
      { hocPhan: 1, soBuoi: 12, soTien: 5_200_000 },
      { hocPhan: 2, soBuoi: 12, soTien: 5_200_000 },
      { hocPhan: 3, soBuoi: 12, soTien: 5_200_000 },
      { hocPhan: 4, soBuoi: 12, soTien: 5_200_000 },
    ]);
  });

  // 🔴 MUA ÍT HƠN CẢ KHOÁ = HỌC PHẦN **CUỐI**, không phải phần đầu.
  // Chủ dự án 28/09: *"đăng ký 2 học phần 24 buổi thì sẽ học bắt đầu từ học phần 3"*.
  // Bản đầu của tôi đánh số 1..k — sai theo cách KHÓ THẤY: mã vẫn chạy, tiền vẫn đúng,
  // chỉ có phiếu thu ghi "Học phần 1" cho buổi 25–36.
  it.each([
    [12, [4]],
    [24, [3, 4]],
    [36, [2, 3, 4]],
    [48, [1, 2, 3, 4]],
  ])("mua %i buổi ⇒ mang nhãn học phần %j", (soBuoiMua, nhan) => {
    const r = keHoachDotTheoHocPhan({ tongSoBuoiKhoa: 48, soBuoiMua, hocPhi: 12_000_000 });
    expect(r.dot).toHaveLength(nhan.length);
    expect(r.dot?.map((d) => d.hocPhan)).toEqual(nhan);
  });
});

describe("[DHP-07] PHẠM VI BUỔI — mua ít thì vào học muộn, kết thúc cùng lớp", () => {
  it("ví dụ của chủ dự án: 39 buổi ⇒ buổi 10 → 48", () => {
    expect(phamViBuoiDangKy({ tongSoBuoiKhoa: 48, soBuoiMua: 39 })).toEqual({
      buoiBatDau: 10,
      buoiKetThuc: 48,
      soBuoi: 39,
    });
  });

  it("ví dụ của chủ dự án: 24 buổi ⇒ buổi 25 → 48, tức đầu HỌC PHẦN 3", () => {
    const p = phamViBuoiDangKy({ tongSoBuoiKhoa: 48, soBuoiMua: 24 });
    expect(p).toEqual({ buoiBatDau: 25, buoiKetThuc: 48, soBuoi: 24 });
    // Đối chiếu chéo với nhãn học phần: buổi 25 phải là buổi đầu của HP3.
    const r = keHoachDotTheoHocPhan({ tongSoBuoiKhoa: 48, soBuoiMua: 24, hocPhi: 1_000_000 });
    expect(r.dot?.[0]?.hocPhan).toBe(3);
    expect((r.dot![0]!.hocPhan - 1) * 12 + 1).toBe(p!.buoiBatDau);
  });

  it("mua đủ khoá ⇒ buổi 1, và không khai số buổi cũng vậy", () => {
    expect(phamViBuoiDangKy({ tongSoBuoiKhoa: 48, soBuoiMua: 48 })?.buoiBatDau).toBe(1);
    expect(phamViBuoiDangKy({ tongSoBuoiKhoa: 48, soBuoiMua: null })?.buoiBatDau).toBe(1);
  });

  it("KHÔNG gác theo mốc học phần — 39 buổi lệch mốc vẫn có phạm vi", () => {
    // Hai luật khác nhau: "được học từ buổi nào" luôn áp; "có phải duyệt không" là
    // `xetSoBuoiDong`. Gác phạm vi theo mốc nghĩa là đơn 39 buổi đã được QLCS duyệt rồi
    // mà vẫn không biết bắt đầu từ đâu.
    expect(phamViBuoiDangKy({ tongSoBuoiKhoa: 48, soBuoiMua: 39 })).not.toBeNull();
    expect(keHoachDotTheoHocPhan({ tongSoBuoiKhoa: 48, soBuoiMua: 39, hocPhi: 1 }).apLuat).toBe(
      false,
    );
  });

  it("ÁP CHO MỌI KHOÁ, không riêng khoá 48 buổi", () => {
    // Khác `keHoachDotTheoHocPhan`: phạm vi buổi không phải luật học phần, nó là luật
    // "vào học muộn". Khoá 11 buổi mua 5 thì cũng học 5 buổi cuối.
    expect(phamViBuoiDangKy({ tongSoBuoiKhoa: 11, soBuoiMua: 5 })).toEqual({
      buoiBatDau: 7,
      buoiKetThuc: 11,
      soBuoi: 5,
    });
  });

  it.each([
    ["khoá chưa khai số buổi", null, 10],
    ["mua nhiều hơn cả khoá", 48, 49],
    ["mua 0 buổi", 48, 0],
    ["mua số âm", 48, -5],
  ])("%s ⇒ null, KHÔNG bịa buổi bắt đầu", (_ten, tong, mua) => {
    expect(phamViBuoiDangKy({ tongSoBuoiKhoa: tong, soBuoiMua: mua })).toBeNull();
  });
});

describe("[DHP-03] BẤT BIẾN Σ đợt = học phí, kể cả khi không chia hết", () => {
  // 🔴 Đây là bất biến mà `kiemKeHoachDot` và các cổng tiền đang dựa vào. Một phép chia
  // làm tròn xuống ở cả 4 đợt sẽ hụt tiền đơn mà không lỗi nào báo — chỉ công nợ lệch.
  it.each([20_800_000, 12_345_678, 1, 3, 999_999_999])("học phí %i", (hocPhi) => {
    const r = keHoachDotTheoHocPhan({ tongSoBuoiKhoa: 48, soBuoiMua: 48, hocPhi });
    const tong = (r.dot ?? []).reduce((s, d) => s + d.soTien, 0);
    expect(tong).toBe(hocPhi);
  });

  it("học phí 0 ⇒ vẫn 4 đợt, mỗi đợt 0 (không ném, không bịa tiền)", () => {
    const r = keHoachDotTheoHocPhan({ tongSoBuoiKhoa: 48, soBuoiMua: 48, hocPhi: 0 });
    expect(r.dot?.map((d) => d.soTien)).toEqual([0, 0, 0, 0]);
  });
});

describe("[DHP-04] số buổi LỆCH mốc ⇒ KHÔNG đề xuất — đừng che cái lệch", () => {
  it.each([1, 11, 13, 20, 47, 49])("mua %i buổi ⇒ không đề xuất", (soBuoiMua) => {
    // Đơn lệch mốc là đơn đang chờ QLCS duyệt. Đề xuất một kế hoạch "gần đúng" cho nó là
    // che mất chính cái lệch mà người duyệt cần nhìn thấy.
    expect(
      keHoachDotTheoHocPhan({ tongSoBuoiKhoa: 48, soBuoiMua, hocPhi: 10_000_000 }),
    ).toEqual({ apLuat: false, dot: null });
  });
});

describe("[DHP-08] gợi ý cho CẢ ĐƠN — chia tổng đơn, và chỉ khi mọi dòng đồng ý", () => {
  const DU = { tongSoBuoiKhoa: 48, soBuoiMua: 48 };
  const HAI_PHAN = { tongSoBuoiKhoa: 48, soBuoiMua: 24 };

  it("một dòng mua đủ khoá ⇒ 4 đợt chia TỔNG ĐƠN", () => {
    const r = goiYKeHoachDon([DU], 20_000_000);
    expect(r.dot?.map((d) => d.soTien).reduce((a, b) => a + b, 0)).toBe(20_000_000);
    expect(r.dot?.map((d) => d.hocPhan)).toEqual([1, 2, 3, 4]);
  });

  it("HAI con CÙNG mua đủ khoá ⇒ vẫn 4 đợt, vẫn chia tổng đơn", () => {
    // Ca thật hay gặp nhất: đơn hai bé, mỗi bé một khoá đủ. Cả hai ra k=4 ⇒ có câu trả lời.
    const r = goiYKeHoachDon([DU, DU], 40_000_000);
    expect(r.dot).toHaveLength(4);
    expect(r.dot?.map((d) => d.soTien).reduce((a, b) => a + b, 0)).toBe(40_000_000);
  });

  it("hai con MUA KHÁC NHAU ⇒ KHÔNG gợi ý (im lặng còn hơn gợi ý sai)", () => {
    // 4 đợt thì con mua 24 buổi trả cho học phần nó không học; 2 đợt thì con kia trả thiếu.
    // Không có câu trả lời đúng ở cấp đơn ⇒ đừng đưa ra một con số để sale bấm theo.
    expect(goiYKeHoachDon([DU, HAI_PHAN], 30_000_000)).toEqual({ apLuat: false, dot: null });
  });

  it("có MỘT dòng ngoài phạm vi ⇒ không gợi ý", () => {
    expect(
      goiYKeHoachDon([DU, { tongSoBuoiKhoa: 11, soBuoiMua: null }], 25_000_000),
    ).toEqual({ apLuat: false, dot: null });
  });

  it("đơn RỖNG hoặc dòng lệch mốc ⇒ không gợi ý", () => {
    expect(goiYKeHoachDon([], 1_000_000)).toEqual({ apLuat: false, dot: null });
    expect(
      goiYKeHoachDon([{ tongSoBuoiKhoa: 48, soBuoiMua: 39 }], 1_000_000),
    ).toEqual({ apLuat: false, dot: null });
  });

  it("nhãn học phần theo PHẠM VI, không phải 1..k — đơn mua 24 buổi ra HP3+HP4", () => {
    expect(goiYKeHoachDon([HAI_PHAN], 10_000_000).dot?.map((d) => d.hocPhan)).toEqual([3, 4]);
  });
});

describe("[DHP-06] LƯỚI GHIM MÃ NGUỒN — trọng số và phạm vi", () => {
  // 🔴 HAI LUẬT DƯỚI ĐÂY **KHÔNG CHỨNG MINH ĐƯỢC BẰNG TEST HÀNH VI**, và phép cấy 27/09 đã
  // đo đúng điều đó. Ghi lại để người sau không tưởng đây là ca thừa:
  //
  //   · **trọng số** — cấy "bỏ `soBuoiMoiPhan`, gọi `chiaDotHocPhi(tong, n)` trần" ra
  //     **0 dòng đỏ**. Đúng như đã lường: trong phạm vi đã chốt cả 4 học phần đều 12 buổi
  //     nên chia-theo-buổi và chia-đều **trùng kết quả**. Không có đầu vào nào phân biệt
  //     được, nên chỉ còn cách ghim ở tầng mã nguồn.
  //
  //   · **phạm vi** — cấy "bỏ vế `!xet.apLuat`" cũng ra **0 đỏ**, vì `xetSoBuoiDong` trả
  //     `soHocPhan: null` mỗi khi ngoài phạm vi ⇒ hai điều kiện chồng nhau. Tức thứ thật
  //     sự giữ phạm vi là **việc uỷ thác cho `xetSoBuoiDong`**, không phải dòng `if`. Ghim
  //     đúng cái uỷ thác ấy: ngày ai đó tự tính `tongSoBuoiKhoa / 12` tại chỗ thì đỏ.
  //
  // Khuôn: CLAUDE.md mục "Mẫu test: LƯỚI GHIM MÃ NGUỒN".
  const ma = readFileSync(resolve(process.cwd(), "lib/orders/dot-theo-hoc-phan.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("tiền chia CÓ TRỌNG SỐ — `chiaDotHocPhi` được gọi với mảng số buổi", () => {
    // Neo vào LỜI GỌI có tham số thứ ba, không vào tên hàm trần (bài học `[S-1]`: chuỗi
    // tên hàm có mặt cả trong dòng `import`, nên gỡ lời gọi mà quên gỡ import vẫn xanh).
    expect(ma).toMatch(/chiaDotHocPhi\(\s*d\.hocPhi\s*,\s*xet\.soHocPhan\s*,\s*\w+\s*\)/);
    // ⚠️ Đếm LỜI GỌI, đừng viết một khẳng định PHỦ ĐỊNH "không có bản gọi trần hai tham
    // số": bản đầu của tôi viết `not.toMatch(/chiaDotHocPhi\([^)]*,[^,)]*\)/)` và nó khớp
    // luôn chính lời gọi ĐÚNG (ba tham số) — ca đỏ ngay lượt chạy đầu, vì regex tham.
    // Đúng một lời gọi + lời gọi ấy có ba tham số ⇒ không còn chỗ cho bản trần.
    expect(ma.match(/chiaDotHocPhi\(/g) ?? []).toHaveLength(1);
  });

  it("phạm vi + số học phần UỶ THÁC cho `xetSoBuoiDong`, không tự tính tại chỗ", () => {
    // HAI lời gọi — một cho mỗi lối vào: `keHoachDotTheoHocPhan` · `goiYKeHoachDon`.
    //
    // ⚠️ Con số CỨNG là chủ đích, không phải lười. Thêm một lối vào mới thì ca này ĐỎ và
    // buộc người thêm phải dừng lại một nhịp để trả lời: *lối mới có uỷ thác phạm vi cho
    // `xetSoBuoiDong` không, hay nó tự suy?* Đổi thành `toBeGreaterThan` là gỡ đúng câu
    // hỏi ấy.
    //
    // Nó đã cắn HAI lần, và cả hai đều đúng việc:
    //   · 3 khi `goiYKeHoachDon` ra đời (thêm lối vào);
    //   · 2 ngày 28/09 khi `lechHocPhan` bị GỠ (bớt lối vào) — hàm đó mã hoá luật "số đợt
    //     phải bằng số học phần", một ràng buộc không văn bản nào ban hành.
    expect(ma.match(/xetSoBuoiDong\(/g) ?? []).toHaveLength(2);
    // Không nơi nào chia cho hằng số buổi để tự suy ra số học phần — đó là dựng nguồn
    // thứ hai cho cùng một sự thật.
    expect(ma).not.toMatch(/\/\s*SO_BUOI_MOI_HOC_PHAN/);
    expect(ma).not.toMatch(/tongSoBuoiKhoa\s*[/%]/);
  });
});

/** `XetSoBuoi` → khuôn mà `xetDuyetDon` nhận. Cùng phép dịch mà `_actions.ts` dùng. */
function deXet(soBuoiMua: number) {
  const x = xetSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua });
  return { viPham: x.canDuyet, cau: lyDoSoBuoi(x, "Bé An") };
}

describe("[DHP-05] SỐ ĐỢT TỰ DO — không bị số học phần trói", () => {
  // 🔴 CA NÀY THAY CHO `lechHocPhan`, ĐÃ GỠ 28/09/2026.
  //
  // Chủ dự án: *"học phần khác đợt... tôi đăng ký 36 buổi còn lại của khoá sata3 thì
  // tôi muốn thanh toán 1, 2 hay 3 đợt đều được chứ?"* — đúng.
  //
  // Bản cũ có một hàm `lechHocPhan` báo "lệch" khi số đợt ≠ số học phần, và form in
  // *"Đơn sẽ cần quản lý cơ sở duyệt"*. Câu đó SAI: `xetDuyetDon` không nhận đầu vào
  // nào của học phần × đợt. Ca dưới ghim chính điều đó, bằng HÀNH VI chứ không bằng
  // sự vắng mặt của một hàm.
  it.each([1, 2, 3, 4])("mua 36 buổi (3 học phần) · chia %i đợt ⇒ KHÔNG phần nào phải duyệt", (soDot) => {
    const kq = xetDuyetDon({
      keHoach: [{ soDot }],
      uuDaiTheoDong: [{ soUuDai: 0 }],
      // 36 rơi ĐÚNG mốc học phần ⇒ không vi phạm luật số buổi.
      soBuoiTheoDong: [deXet(36)],
      nguong: { tranSoDot: 4, tranUuDaiMoiDong: 1 },
    });
    expect(kq.phan.soBuoi, `chia ${soDot} đợt không được đụng cổng SỐ BUỔI`).toBe(false);
    expect(kq.phan.traGop, `chia ${soDot} đợt ≤ trần 4 thì không phải duyệt trả góp`).toBe(false);
  });

  it("vượt TRẦN số đợt thì mới phải duyệt — và đó là cổng DUY NHẤT liên quan tới đợt", () => {
    const kq = xetDuyetDon({
      keHoach: [{ soDot: 5 }],
      uuDaiTheoDong: [{ soUuDai: 0 }],
      soBuoiTheoDong: [deXet(36)],
      nguong: { tranSoDot: 4, tranUuDaiMoiDong: 1 },
    });
    expect(kq.phan.traGop).toBe(true);
    // Và nó KHÔNG được kéo theo cổng số buổi: hai luật khác nhau, hai cờ khác nhau.
    expect(kq.phan.soBuoi).toBe(false);
  });

  it("lưới ghim: `lechHocPhan` KHÔNG được dựng lại", () => {
    // Nó mã hoá một ràng buộc không văn bản nào ban hành. Ai thấy nút "Đặt N đợt theo
    // học phần" rồi nghĩ "chắc phải có hàm kiểm lệch" thì ca này chặn lại.
    const ma = readFileSync(resolve(process.cwd(), "lib/orders/dot-theo-hoc-phan.ts"), "utf8");
    expect(ma).not.toMatch(/export function lechHocPhan/);
  });
});
