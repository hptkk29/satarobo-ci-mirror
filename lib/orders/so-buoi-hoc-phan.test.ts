// Ca [SBH-*] — luật "số buổi phải rơi đúng mốc học phần". Thuần, không DB.
//
// 🔴 Chủ dự án 25/09/2026: *"khi sale tạo đơn, nếu buổi học khác 12 24 36 48 tức 1 học
// phần, 2 học phần, 3 học phần, 4 học phần thì phải qua quản lý duyệt"*, thu hẹp ngay
// sau đó: *"ở prod có các khoá sata 3,4,5,6,7 có 48 buổi thì mới áp luật này, còn các
// khoá khác thì không"*.
//
// Bộ này khoá BA thứ, và cả ba đều hỏng CÂM nếu mất:
//   · PHẠM VI — khoá 9/11/23 buổi KHÔNG được kéo vào hàng chờ duyệt;
//   · MẶC ĐỊNH khi không khai số buổi — ba đường convert không ghi `soBuoi` bao giờ;
//   · tập mốc phải SUY RA từ hằng, không gõ tay hai lần.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  xetSoBuoiDong,
  lyDoSoBuoi,
  nhanSoBuoiDong,
  moTaMocHopLe,
  SO_BUOI_HOP_LE,
  SO_BUOI_MOI_HOC_PHAN,
  SO_HOC_PHAN_TOI_DA,
  TONG_SO_BUOI_KHOA_AP_LUAT,
} from "./so-buoi-hoc-phan";

describe("[SBH-01] hằng số — suy ra, không gõ tay", () => {
  it("bốn mốc đúng là 12 / 24 / 36 / 48", () => {
    expect([...SO_BUOI_HOP_LE]).toEqual([12, 24, 36, 48]);
  });

  it("phạm vi áp luật = 48, và nó BẰNG tích của hai hằng", () => {
    // ⚠️ Khẳng định thứ hai mới là cái có răng. Nếu ai đó gõ thẳng `= 48` thì ca một vẫn
    // xanh, nhưng đổi `SO_HOC_PHAN_TOI_DA` thành 5 sẽ làm tập mốc có 60 trong khi phạm vi
    // vẫn 48 — khoá 60 buổi khi ấy vừa "ngoài phạm vi" vừa "mốc hợp lệ", tuỳ chỗ hỏi.
    expect(TONG_SO_BUOI_KHOA_AP_LUAT).toBe(48);
    expect(TONG_SO_BUOI_KHOA_AP_LUAT).toBe(SO_BUOI_MOI_HOC_PHAN * SO_HOC_PHAN_TOI_DA);
    expect(SO_BUOI_HOP_LE[SO_BUOI_HOP_LE.length - 1]).toBe(TONG_SO_BUOI_KHOA_AP_LUAT);
  });

  it("mô tả mốc in ra đủ bốn số", () => {
    expect(moTaMocHopLe()).toBe("12 / 24 / 36 / 48 buổi");
  });
});

describe("[SBH-02] PHẠM VI — khoá không đủ 4 học phần thì KHÔNG xét", () => {
  // ⚠️ Ca đắt nhất của bộ, và nó dựng từ SỐ ĐO THẬT (`satarobo_local`, 25/09/2026), không
  // phải số tròn trịa bịa ra (luật 9). Bỏ vế phạm vi đi là mọi đơn của bốn khoá dưới đây
  // rơi vào hàng chờ duyệt trong khi sale không gõ sai gì — và hàng chờ đầy đơn bình
  // thường là hàng chờ không ai đọc nữa.
  it.each([
    ["Luyện thi RoboSim", 9],
    ["Sata 1 — Nhập môn Robotics", 11],
    ["Lập trình Robot", 11],
    ["Sata 2 / 3 / 4 (seed local)", 12],
    ["Combo Sata 1 & 2", 23],
  ])("%s (%i buổi) — ngoài phạm vi, kể cả khi số buổi mua lẻ", (_ten, tong) => {
    const r = xetSoBuoiDong({ tongSoBuoiKhoa: tong, soBuoiMua: 7 });
    expect(r.apLuat).toBe(false);
    expect(r.canDuyet).toBe(false);
  });

  it("khoá không khai tổng số buổi (null) — ngoài phạm vi", () => {
    expect(xetSoBuoiDong({ tongSoBuoiKhoa: null, soBuoiMua: 20 }).canDuyet).toBe(false);
  });

  it("dòng SẢN PHẨM / kỳ thi (không có khoá) — ngoài phạm vi", () => {
    // Nếu không có vế này thì "số buổi" của một cái hộp LEGO bị đem ra so với mốc học
    // phần, và mọi đơn bán sản phẩm vào hàng chờ duyệt.
    expect(xetSoBuoiDong({ tongSoBuoiKhoa: null, soBuoiMua: null }).apLuat).toBe(false);
  });

  it("khoá 60 buổi (5 học phần, nếu có ngày mở) — ngoài phạm vi, KHÔNG tự suy", () => {
    // Luật chủ dự án nói đúng bốn mốc của khoá 48. Khoá 5 học phần là một quyết định
    // nghiệp vụ chưa ai ký — im lặng nới ra là tự ký hộ.
    expect(xetSoBuoiDong({ tongSoBuoiKhoa: 60, soBuoiMua: 60 }).apLuat).toBe(false);
  });
});

describe("[SBH-03] MỐC — khoá 48 buổi thì số buổi mua phải rơi đúng mốc", () => {
  const KHOA48 = { tongSoBuoiKhoa: TONG_SO_BUOI_KHOA_AP_LUAT };

  it.each([
    [12, 1],
    [24, 2],
    [36, 3],
    [48, 4],
  ])("%i buổi = %i học phần ⇒ KHÔNG cần duyệt", (mua, hocPhan) => {
    const r = xetSoBuoiDong({ ...KHOA48, soBuoiMua: mua });
    expect(r.apLuat).toBe(true);
    expect(r.hopLe).toBe(true);
    expect(r.canDuyet).toBe(false);
    expect(r.soHocPhan).toBe(hocPhan);
  });

  it.each([1, 6, 11, 13, 20, 30, 47, 49, 60, 96])(
    "%i buổi ⇒ CẦN DUYỆT",
    (mua) => {
      const r = xetSoBuoiDong({ ...KHOA48, soBuoiMua: mua });
      expect(r.apLuat).toBe(true);
      expect(r.hopLe).toBe(false);
      expect(r.canDuyet).toBe(true);
      expect(r.soBuoiXet).toBe(mua);
      expect(r.soHocPhan).toBeNull();
    },
  );
});

describe("[SBH-04] KHÔNG KHAI số buổi ⇒ suy về MUA ĐỦ KHOÁ, không phải fail-closed", () => {
  it("khoá 48, không khai ⇒ xét như 48 ⇒ không cần duyệt", () => {
    // ⚠️ Quyết định có hệ quả, nên nó có ca riêng. Ba đường tạo đơn ngoài form
    // (`convert-lead`, `backfill-order`, `ghi-giao-dich-cu`) KHÔNG ghi `soBuoi` bao giờ.
    // Fail-closed ở đây là đẩy MỌI đơn convert của khoá Sata 3–7 vào hàng chờ duyệt.
    const r = xetSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua: null });
    expect(r.canDuyet).toBe(false);
    expect(r.soBuoiXet).toBe(48);
    expect(r.soHocPhan).toBe(4);
  });

  it("đối chứng dương: cùng khoá ấy, KHAI 20 buổi thì CẦN duyệt", () => {
    // Không có ca này thì ca trên đạt được bằng một hàm luôn trả `canDuyet: false`
    // (luật 11 — "ca khẳng định SỰ VẮNG MẶT luôn ĐẠT khi tính năng hỏng hoàn toàn").
    expect(xetSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua: 20 }).canDuyet).toBe(true);
  });
});

describe("[SBH-05] câu lý do nói ĐÚNG con số đã dùng để xét", () => {
  it("in cả số buổi lẫn tập mốc, và gọi đúng tên con", () => {
    const r = xetSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua: 20 });
    const cau = lyDoSoBuoi(r, "Bé An");
    expect(cau).toContain("Bé An");
    expect(cau).toContain("20 buổi");
    expect(cau).toContain("12 / 24 / 36 / 48");
  });

  it("không có tên thì nói 'Dòng đơn', KHÔNG in chuỗi rỗng", () => {
    expect(lyDoSoBuoi(xetSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua: 5 }), "  ")).toContain(
      "Dòng đơn",
    );
  });

  it("dòng KHÔNG vi phạm ⇒ null, để chỗ gọi lọc bỏ", () => {
    expect(lyDoSoBuoi(xetSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua: 24 }), "Bé An")).toBeNull();
    expect(lyDoSoBuoi(xetSoBuoiDong({ tongSoBuoiKhoa: 11, soBuoiMua: 5 }), "Bé An")).toBeNull();
  });
});

describe("[SBH-06] LƯỚI GHIM MÃ NGUỒN — tập mốc phải SUY RA, không gõ tay", () => {
  // ⚠️ Mọi ca ở trên vẫn xanh nếu ai đó viết `SO_BUOI_HOP_LE = [12, 24, 36, 48]` cứng.
  // Hôm nay thì đúng; cái hỏng là NGÀY MAI, khi một người đổi `SO_HOC_PHAN_TOI_DA` và
  // chỉ một trong hai nguồn đi theo. Cùng họ `[DS-01b]` (CLAUDE.md, "lưới ghim mã nguồn").
  function boChuThich(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const SRC = boChuThich(
    readFileSync(resolve(process.cwd(), "lib/orders/so-buoi-hoc-phan.ts"), "utf8"),
  );

  it("KHÔNG có mảng mốc gõ tay trong mã", () => {
    expect(SRC).not.toMatch(/\[\s*12\s*,\s*24\s*,\s*36\s*,\s*48\s*\]/);
  });

  it("KHÔNG có số 48 gõ tay — nó phải là tích của hai hằng", () => {
    // Đếm SỐ LẦN chứ không chỉ "có/không": chú thích giải thích bản vá cũng chứa số 48,
    // nên bộ so khớp phải chạy trên mã ĐÃ BỎ CHÚ THÍCH (luật 11).
    expect(SRC.match(/\b48\b/g) ?? []).toHaveLength(0);
  });

  it("tập mốc dựng bằng SO_BUOI_MOI_HOC_PHAN và SO_HOC_PHAN_TOI_DA", () => {
    expect(SRC).toMatch(/SO_BUOI_HOP_LE[\s\S]{0,200}SO_HOC_PHAN_TOI_DA/);
    expect(SRC).toMatch(/SO_BUOI_HOP_LE[\s\S]{0,200}SO_BUOI_MOI_HOC_PHAN/);
  });
});

describe("[SBH-07] nhãn số buổi — LUÔN có chữ, không bao giờ im", () => {
  // 🔴 Chủ dự án 26/09/2026: *"không hiển thị bao nhiêu buổi thì sao biết mà duyệt"*.
  //
  // Bản trước in số buổi CHỈ khi `metadata.soBuoi` có giá trị — mà cột đó trống trên mọi
  // đơn cũ và mọi đơn đi đường convert/backfill. Quản lý mở thẻ duyệt và thấy
  // `Sata 4 · SL 1 · 10.400.003đ`: được hỏi "gật hay không" về một con số KHÔNG có trên
  // màn. Luật 12 — vắng mặt phải NÓI RA.
  it("người bán KHAI ⇒ in trần con số, nguồn `khai`", () => {
    expect(nhanSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua: 24 })).toEqual({
      chu: "24 buổi",
      nguon: "khai",
      lech: false,
    });
  });

  it("KHÔNG khai mà khoá biết tổng ⇒ nói RÕ là suy ra, không in trần", () => {
    // ⚠️ Ca đắt nhất. "48 buổi" và "48 buổi (đủ khoá)" là HAI sự thật khác nhau: cái đầu
    // là cam kết của sale, cái sau là mặc định của hệ thống vì không ai gõ. Người ký cần
    // phân biệt — gộp hai câu là để họ tưởng sale đã xác nhận con số.
    const n = nhanSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua: null });
    expect(n.nguon).toBe("du-khoa");
    expect(n.chu).toContain("48 buổi");
    expect(n.chu).toContain("đủ khoá");
  });

  it("KHÔNG biết gì ⇒ vẫn có chữ, KHÔNG trả chuỗi rỗng", () => {
    // Chuỗi rỗng ở đây là quay lại đúng con bug: màn hình im, người ký không biết mình
    // đang thiếu thông tin hay dòng này vốn không có số buổi.
    const n = nhanSoBuoiDong({ tongSoBuoiKhoa: null, soBuoiMua: null });
    expect(n.nguon).toBe("khong-ro");
    expect(n.chu.length).toBeGreaterThan(0);
    expect(n.chu).toContain("chưa rõ");
  });

  it("cờ `lech` khớp ĐÚNG với `xetSoBuoiDong` — không phải phép so thứ hai", () => {
    // Hai nguồn cho một sự thật là chỗ bug nằm: nhãn nói "lệch" mà cột DB nói "không",
    // hoặc ngược lại. Quét đủ tổ hợp thay vì tin một ca.
    for (const tong of [null, 9, 11, 12, 23, 48, 60]) {
      for (const mua of [null, 1, 12, 20, 24, 30, 36, 48, 60]) {
        const d = { tongSoBuoiKhoa: tong, soBuoiMua: mua };
        expect(nhanSoBuoiDong(d).lech, `tong=${tong} mua=${mua}`).toBe(xetSoBuoiDong(d).canDuyet);
      }
    }
  });

  it("khoá 48 bán 20 buổi ⇒ vừa in số, vừa bật cờ lệch", () => {
    expect(nhanSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua: 20 })).toEqual({
      chu: "20 buổi",
      nguon: "khai",
      lech: true,
    });
  });

  it("khoá NGOÀI phạm vi (11 buổi) bán lẻ ⇒ in số nhưng KHÔNG báo lệch", () => {
    // Đối chứng: luật chỉ áp cho khoá đủ 4 học phần. Báo lệch ở đây là kéo Sata 1 /
    // RoboSim / Combo vào hàng chờ — đúng tai nạn mà vế phạm vi sinh ra để tránh.
    expect(nhanSoBuoiDong({ tongSoBuoiKhoa: 11, soBuoiMua: 5 }).lech).toBe(false);
  });
});

describe("[SBH-08] DÂY NỐI — nhãn số buổi phải THẬT SỰ tới được màn hình", () => {
  // ⚠️ `[SBH-07]` là hàm thuần: nó xanh y nguyên kể cả khi KHÔNG AI GỌI `nhanSoBuoiDong`,
  // hoặc khi chỗ gọi cho nó ăn sai đầu vào. Con bug 26/09 nằm đúng ở tầng dây nối, không
  // ở hàm — và nó câm tuyệt đối: không lỗi biên dịch, không ca đỏ, chỉ là màn hình trống.
  function boChuThich(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

  const NAP = doc("lib/orders/du-lieu-the-duyet.ts");
  const THE = doc("app/(admin)/admin/orders/duyet/_components/order-approval-card.tsx");

  it("`laKhoaHoc` đọc từ CỘT `type`, KHÔNG suy từ `courseId`", () => {
    // 🔴 Đo `satarobo_local` 26/09: 523/523 dòng là COURSE_ENROLLMENT, nhưng chỉ **5** dòng
    // có `courseId` trong metadata. Suy bằng `courseId` ⇒ 518 dòng khoá học bị xếp nhầm
    // thành hàng hoá ⇒ nhãn số buổi biến mất. Đúng lời chủ dự án: *"không hiển thị bao
    // nhiêu buổi thì sao biết mà duyệt"*.
    expect(NAP).toMatch(/laKhoaHoc:\s*it\.type === "COURSE_ENROLLMENT"/);
    expect(NAP).not.toMatch(/laKhoaHoc:\s*\w+\.courseId/);
    // Và cột ấy phải được `select` — quên là `it.type` thành `undefined`, mọi dòng hoá
    // hàng hoá, và TypeScript không kêu vì Prisma trả kiểu hẹp theo select.
    expect(NAP).toMatch(/\btype: true\b/);
  });

  it("khoá của dòng tra qua `khoaCuaDong` — có đường lùi sang ghi danh", () => {
    // Chỉ đọc `metadata.courseId` là tra ra khoá cho 5/523 dòng; thêm `Enrollment.courseId`
    // lên 498/523. Mất lời gọi này thì `tongSoBuoiKhoa` null hàng loạt ⇒ nhãn rơi về
    // "chưa rõ số buổi" cho gần như mọi đơn, và luật mốc học phần cũng hết áp được.
    expect(NAP.match(/khoaCuaDong\(/g) ?? []).toHaveLength(2); // gom id + dựng từng dòng
    expect(NAP).toMatch(/courseIdGhiDanh:\s*it\.enrollment\?\.courseId/);
    expect(NAP).toMatch(/enrollment:\s*\{\s*select:\s*\{\s*courseId: true/);
  });

  it("thẻ duyệt gọi `nhanSoBuoiDong`, và chỉ cho dòng khoá học", () => {
    expect(THE.match(/nhanSoBuoiDong\(/g) ?? []).toHaveLength(1);
    expect(THE).toMatch(/it\.laKhoaHoc/);
  });
});
