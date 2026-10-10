// [HN2-MP-01..06] — luật QUYỀN, ĐƯỜNG DẪN và CHỮ của mục "Máy POS quẹt thẻ" ở màn Cơ sở
// (docs/pos-hai-nut-khai-may.md §2, Việc 2 — 09/10/2026). THUẦN: không DB, không React.
//
// Đây là chỗ DUY NHẤT quyết "ai xem / ai sửa / ai thêm" mục máy POS, và "ai được thấy link khai máy" ở trang đơn. Hai nơi cùng
// hỏi MỘT hàm (`duocKhaiMayPos`) nên không lệch nhau được — ca `[HN2-MP-04]` quét hết tổ hợp để ghim điều đó.
//
// ⚠️ Tên ca mang tiền tố `HN2-MP` chứ không phải `HN2` trần: `HN2-01..` đã là phụ lục rà đối kháng của Việc 1 (V27).
import { describe, expect, it } from "vitest";
import {
  CAU_NHAC_IMPORT_LAI,
  LY_DO_CO_SO_DONG,
  NEO_MAY_POS,
  TIEU_DE_MUC_MAY_POS,
  duocKhaiMayPos,
  duongKhaiMay,
  khaiMayChoDon,
  lienKetKhaiMay,
  nhanLinkKhaiMay,
  quyenMayPos,
  type DauVaoQuyenMayPos,
} from "./may-o-co-so";

/** Kế toán Hội sở: `payments:*` neo tại HO ⇒ nhìn mọi cơ sở, có `import-pos`. */
const KE_TOAN_HO: DauVaoQuyenMayPos = {
  trongPhamVi: true,
  coQuyenXem: true,
  coQuyenGhi: true,
  phamViGhiMoiCoSo: true,
  coSoDangHoatDong: true,
};
/** Quản lý cơ sở mở trang CƠ SỞ CỦA MÌNH: có `payments:view`, không `import-pos`, chỉ nhìn cơ sở mình. */
const QLCS_CO_SO_MINH: DauVaoQuyenMayPos = {
  trongPhamVi: true,
  coQuyenXem: true,
  coQuyenGhi: false,
  phamViGhiMoiCoSo: false,
  coSoDangHoatDong: true,
};
/** Cùng người đó mở trang cơ sở KHÁC: quyền chức năng vẫn `true` (seed GLOBAL), nhưng cơ sở nằm ngoài tầm nhìn. */
const QLCS_CO_SO_KHAC: DauVaoQuyenMayPos = { ...QLCS_CO_SO_MINH, trongPhamVi: false };

describe("[HN2-MP-01] quyenMayPos — ma trận người xem × cơ sở", () => {
  it("Kế toán HO: thấy, sửa và thêm — ở cơ sở nào cũng vậy (đối chứng dương)", () => {
    expect(quyenMayPos(KE_TOAN_HO)).toEqual({ xem: true, sua: true, them: true, lyDoKhongThem: null });
  });

  it("Quản lý cơ sở ở CƠ SỞ CỦA MÌNH: thấy máy, KHÔNG có đường sửa / thêm", () => {
    expect(quyenMayPos(QLCS_CO_SO_MINH)).toEqual({ xem: true, sua: false, them: false, lyDoKhongThem: null });
  });

  it("Quản lý cơ sở mở trang cơ sở KHÁC: KHÔNG thấy gì — dù `payments:view` vẫn là true (bẫy GLOBAL của [PTTT-11])", () => {
    // Mã TRƯỚC khi có `trongPhamVi`: gác bằng `checkPermission("payments:view", {centerId})` — quyền seed GLOBAL nên đích bị
    // `can()` vứt, và mục sẽ hiện máy của cơ sở khác. Ca này ghim: quyền đúng KHÔNG đủ, cơ sở phải nằm trong tầm nhìn.
    expect(QLCS_CO_SO_KHAC.coQuyenXem).toBe(true);
    expect(quyenMayPos(QLCS_CO_SO_KHAC)).toEqual({ xem: false, sua: false, them: false, lyDoKhongThem: null });
  });

  it("không quyền nào ⇒ không thấy, kể cả khi cơ sở nằm trong tầm nhìn", () => {
    expect(
      quyenMayPos({ ...QLCS_CO_SO_MINH, coQuyenXem: false }),
    ).toEqual({ xem: false, sua: false, them: false, lyDoKhongThem: null });
  });

  it("người chỉ có `import-pos` (không `payments:view`) vẫn thấy — giữ tập người từng thấy tab cũ (V29)", () => {
    expect(quyenMayPos({ ...KE_TOAN_HO, coQuyenXem: false }).xem).toBe(true);
    // …nhưng `import-pos` mà cơ sở nằm ngoài tầm nhìn thì vẫn không thấy.
    expect(quyenMayPos({ ...KE_TOAN_HO, coQuyenXem: false, trongPhamVi: false }).xem).toBe(false);
  });
});

describe("[HN2-MP-02] ghi đòi CẢ quyền `import-pos` LẪN tầm nhìn mọi cơ sở (cổng của ba action)", () => {
  it("có `import-pos` nhưng chỉ nhìn một cơ sở ⇒ XEM được, SỬA không (khớp [MPOS-06])", () => {
    const q = quyenMayPos({ ...QLCS_CO_SO_MINH, coQuyenGhi: true });
    expect(q.xem).toBe(true);
    expect(q.sua).toBe(false);
    expect(q.them).toBe(false);
  });

  it("nhìn mọi cơ sở nhưng KHÔNG có `import-pos` ⇒ không sửa", () => {
    expect(quyenMayPos({ ...KE_TOAN_HO, coQuyenGhi: false }).sua).toBe(false);
  });

  it("đối chứng dương: đủ cả hai vế thì sửa được", () => {
    expect(quyenMayPos({ ...QLCS_CO_SO_MINH, coQuyenGhi: true, phamViGhiMoiCoSo: true }).sua).toBe(true);
  });
});

describe("[HN2-MP-03] cơ sở đã ĐÓNG — `kiemCoSoDich` từ chối khai thêm, sửa / tắt-bật vẫn chạy", () => {
  const DONG: DauVaoQuyenMayPos = { ...KE_TOAN_HO, coSoDangHoatDong: false };

  it("người ghi được: sửa được nhưng KHÔNG thêm được, và có lý do để in lên màn", () => {
    expect(quyenMayPos(DONG)).toEqual({ xem: true, sua: true, them: false, lyDoKhongThem: LY_DO_CO_SO_DONG });
  });

  it("lý do nói rõ cả hai nửa: không thêm được · máy đã có vẫn sửa / tắt / bật được", () => {
    expect(LY_DO_CO_SO_DONG).toMatch(/không khai thêm/);
    expect(LY_DO_CO_SO_DONG).toMatch(/sửa, tắt, bật/);
  });

  it("đối chứng dương: cùng người ở cơ sở ĐANG HOẠT ĐỘNG thì thêm được, không có lý do", () => {
    expect(quyenMayPos(KE_TOAN_HO)).toMatchObject({ them: true, lyDoKhongThem: null });
  });

  it("người KHÔNG sửa được thì không có 'lý do không thêm' — câu đó chỉ dành cho người đáng lẽ thêm được", () => {
    expect(quyenMayPos({ ...QLCS_CO_SO_MINH, coSoDangHoatDong: false }).lyDoKhongThem).toBeNull();
  });
});

describe("[HN2-MP-04] MỘT định nghĩa của 'ghi được': mục máy POS và link ở trang đơn không lệch nhau", () => {
  const BOOL = [false, true] as const;

  it("duocKhaiMayPos = import-pos ∧ tầm nhìn mọi cơ sở (4 tổ hợp)", () => {
    const kq = BOOL.flatMap((coQuyenGhi) =>
      BOOL.map((phamViGhiMoiCoSo) => [coQuyenGhi, phamViGhiMoiCoSo, duocKhaiMayPos({ coQuyenGhi, phamViGhiMoiCoSo })] as const),
    );
    expect(kq).toEqual([
      [false, false, false],
      [false, true, false],
      [true, false, false],
      [true, true, true],
    ]);
  });

  it("quyenMayPos.sua === xem ∧ duocKhaiMayPos — trên TOÀN BỘ 32 tổ hợp đầu vào", () => {
    let dem = 0;
    for (const trongPhamVi of BOOL)
      for (const coQuyenXem of BOOL)
        for (const coQuyenGhi of BOOL)
          for (const phamViGhiMoiCoSo of BOOL)
            for (const coSoDangHoatDong of BOOL) {
              const v = { trongPhamVi, coQuyenXem, coQuyenGhi, phamViGhiMoiCoSo, coSoDangHoatDong };
              const q = quyenMayPos(v);
              expect(q.sua, JSON.stringify(v)).toBe(q.xem && duocKhaiMayPos(v));
              expect(q.them, JSON.stringify(v)).toBe(q.sua && coSoDangHoatDong);
              dem += 1;
            }
    expect(dem).toBe(32);
  });

  it("thêm / sửa KHÔNG BAO GIỜ bật mà không xem được (không có nút trên một mục không vẽ)", () => {
    for (const trongPhamVi of BOOL)
      for (const coQuyenXem of BOOL)
        for (const coQuyenGhi of BOOL)
          for (const phamViGhiMoiCoSo of BOOL) {
            const q = quyenMayPos({ trongPhamVi, coQuyenXem, coQuyenGhi, phamViGhiMoiCoSo, coSoDangHoatDong: true });
            if (!q.xem) expect(q.sua || q.them).toBe(false);
          }
  });
});

describe("[HN2-MP-05] duongKhaiMay — đường tới mục máy POS", () => {
  it("biết cơ sở ⇒ trang cơ sở + neo #may-pos", () => {
    expect(NEO_MAY_POS).toBe("may-pos");
    expect(duongKhaiMay("cs_abc")).toBe("/centers/cs_abc/edit#may-pos");
  });

  it("không biết cơ sở ⇒ danh sách cơ sở (đừng bịa một id)", () => {
    expect(duongKhaiMay(null)).toBe("/centers");
    expect(duongKhaiMay(undefined)).toBe("/centers");
    expect(duongKhaiMay("")).toBe("/centers");
  });

  it("id có ký tự lạ được mã hoá, không làm vỡ đường dẫn", () => {
    expect(duongKhaiMay("a/b c")).toBe("/centers/a%2Fb%20c/edit#may-pos");
  });
});

describe("[HN2-MP-06] lienKetKhaiMay — chữ `title` + link của ô 'Chưa khai máy POS' trên dòng đợt", () => {
  it("title đúng nguyên văn đặc tả; có quyền ghi ⇒ có link tới ĐÚNG trang đó", () => {
    expect(lienKetKhaiMay({ centerId: "cs2", tenCoSo: "CS2 - 114 Hoàng Diệu", duocKhai: true })).toEqual({
      title: "Khai máy ở Cơ sở → CS2 - 114 Hoàng Diệu → Máy POS quẹt thẻ",
      href: "/centers/cs2/edit#may-pos",
    });
  });

  it("KHÔNG có quyền ghi ⇒ cùng title nhưng KHÔNG link (luật 12) — đối chứng của ca trên", () => {
    const l = lienKetKhaiMay({ centerId: "cs2", tenCoSo: "CS2 - 114 Hoàng Diệu", duocKhai: false });
    expect(l.title).toBe("Khai máy ở Cơ sở → CS2 - 114 Hoàng Diệu → Máy POS quẹt thẻ");
    expect(l.href).toBeNull();
  });

  it("đơn không có cơ sở ⇒ bỏ cụm tên, link về danh sách cơ sở (khi ghi được)", () => {
    expect(lienKetKhaiMay({ centerId: null, tenCoSo: null, duocKhai: true })).toEqual({
      title: "Khai máy ở Cơ sở → Máy POS quẹt thẻ",
      href: "/centers",
    });
    expect(lienKetKhaiMay({ centerId: null, tenCoSo: null, duocKhai: false }).href).toBeNull();
  });

  it("có id mà chưa có tên ⇒ title không bịa tên, link vẫn tới đúng cơ sở", () => {
    expect(lienKetKhaiMay({ centerId: "cs9", tenCoSo: null, duocKhai: true })).toEqual({
      title: "Khai máy ở Cơ sở → Máy POS quẹt thẻ",
      href: "/centers/cs9/edit#may-pos",
    });
  });

  it("tiêu đề mục + câu nhắc import đúng chữ chủ dự án chốt", () => {
    expect(TIEU_DE_MUC_MAY_POS).toBe("Máy POS quẹt thẻ");
    expect(CAU_NHAC_IMPORT_LAI).toBe(
      "Khai máy xong, import lại file để khớp các giao dịch đang 'Thiết bị chưa gán cơ sở'.",
    );
  });
});

// ─── RÀ ĐỐI KHÁNG VIỆC 2 (09/10/2026) ────────────────────────────────────────────────────────────────────────────────
describe("[HN2-RD-02] nhanLinkKhaiMay — chữ của link ở màn POS Agent nói thật việc làm được ở đó (luật 12)", () => {
  // Trước bản vá nhãn ngồi inline trong JSX của `pos-agent/page.tsx` (`khaiMayDuoc ? "Khai máy POS" : "Xem máy POS"`) và KHÔNG lưới nào
  // canh: cấy "luôn Khai máy POS" hay "bỏ truyền khaiMayDuoc" đều 0 ca đỏ — vai chỉ-xem đọc một lời hứa suông.
  it("ghi được ⇒ 'Khai máy POS'; không ghi được ⇒ 'Xem máy POS' (đủ CẢ HAI nhánh)", () => {
    expect(nhanLinkKhaiMay(true)).toBe("Khai máy POS");
    expect(nhanLinkKhaiMay(false)).toBe("Xem máy POS");
  });

  it("khớp `duocKhaiMayPos` trên toàn bộ tổ hợp quyền × tầm nhìn: chỉ ô (ghi ∧ mọi cơ sở) mới ra 'Khai máy POS'", () => {
    const ra: string[] = [];
    for (const coQuyenGhi of [true, false]) {
      for (const phamViGhiMoiCoSo of [true, false]) {
        ra.push(`${coQuyenGhi}/${phamViGhiMoiCoSo}=${nhanLinkKhaiMay(duocKhaiMayPos({ coQuyenGhi, phamViGhiMoiCoSo }))}`);
      }
    }
    expect(ra).toEqual([
      "true/true=Khai máy POS",
      "true/false=Xem máy POS",
      "false/true=Xem máy POS",
      "false/false=Xem máy POS",
    ]);
  });
});

describe("[HN2-RD-03] khaiMayChoDon — link ở trang đơn đi theo cơ sở của ĐƠN, KHÔNG phải cơ sở người xem", () => {
  // Trước bản vá phép dựng ngồi inline trong `orders/[id]/page.tsx` (`centerId: order.centerId ?? null`); đổi nó thành
  // `session.user.centerId ?? null` không làm ca unit nào đỏ (chỉ e2e E5 bắt phép thay thẳng). Nay là một hàm nhận NGUYÊN ĐƠN —
  // không có tham số "người xem" để lẫn vào.
  const DON_CS2 = { centerId: "cs2", center: { name: "Cơ sở 2" } };

  it("đơn ở CS2 ⇒ link tới /centers/cs2/edit#may-pos kèm tên CS2 (người xem là ai cũng không đổi)", () => {
    const kq = khaiMayChoDon({ don: DON_CS2, coQuyenGhi: true, phamViGhiMoiCoSo: true });
    expect(kq.href).toBe("/centers/cs2/edit#may-pos");
    expect(kq.title).toBe("Khai máy ở Cơ sở → Cơ sở 2 → Máy POS quẹt thẻ");
  });

  it("không ghi được (thiếu quyền HOẶC không nhìn mọi cơ sở) ⇒ KHÔNG link, vẫn có `title` chỉ đường", () => {
    for (const [coQuyenGhi, phamViGhiMoiCoSo] of [
      [false, true],
      [true, false],
      [false, false],
    ] as const) {
      const kq = khaiMayChoDon({ don: DON_CS2, coQuyenGhi, phamViGhiMoiCoSo });
      expect(kq.href).toBeNull();
      expect(kq.title).toContain("Cơ sở 2");
    }
  });

  it("đơn chưa gán cơ sở / chưa include cơ sở ⇒ rơi về danh sách /centers, title không có tên", () => {
    const kq = khaiMayChoDon({ don: { centerId: null }, coQuyenGhi: true, phamViGhiMoiCoSo: true });
    expect(kq.href).toBe("/centers");
    expect(kq.title).toBe("Khai máy ở Cơ sở → Máy POS quẹt thẻ");
  });
});
