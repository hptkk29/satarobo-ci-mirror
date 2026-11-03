/**
 * MA TRẬN QUYẾT ĐỊNH của việc chia lead — 11 dòng, mỗi dòng một ca.
 *
 * Viết TRƯỚC phần hiện thực (luật cứng Nền Hệ thống #5). Đây là chỗ duy nhất trả lời
 * "lead này về tay ai, và lượt có bị tiêu không" — nên nó phải là hàm THUẦN: không DB,
 * không auth, không giờ hệ thống. Mọi thứ cần biết đều do caller tra sẵn rồi truyền vào.
 *
 * Vì sao tách khỏi Server Action: câu "ai tiêu lượt" là câu người vận hành cãi nhau
 * nhiều nhất (cột "Lượt đã nhận" luôn thấp hơn "Tổng lead đang giữ"). Logic đó nằm
 * trong action thì không kiểm được nó bằng gì ngoài cách dựng cả một request thật.
 */
import { describe, it, expect } from "vitest";
import { resolveAssignment } from "./assign-resolve";

const CS1 = "center-cs1";
const CS2 = "center-cs2";
const SALE_CS1 = "user-sale-cs1";
const SALE_CS2 = "user-sale-cs2";
const MKT = "user-marketing";

/** Ca nền: người lạ POST từ landing page, không mã aff → chia tự động. */
const nen = {
  targetCenterId: CS1,
  createdById: null,
  createdByCenterId: null,
  createdByIsSale: false,
  entryPoint: "LANDING" as const,
};

describe("[CHIA-LEAD] ma trận quyết định — 11 ca", () => {
  it("[1] sale nhập ở form, khách chọn ĐÚNG cơ sở của sale → chính sale đó, KHÔNG tiêu lượt", () => {
    const d = resolveAssignment({
      ...nen,
      entryPoint: "FORM",
      targetCenterId: CS1,
      createdById: SALE_CS1,
      createdByCenterId: CS1,
      createdByIsSale: true,
    });
    expect(d).toEqual({ kind: "OWNER", ownerId: SALE_CS1, source: "SELF", consumedTurn: false });
  });

  it("[2] sale nhập nhưng khách chọn cơ sở KHÁC → chia theo pool cơ sở khách chọn, CÓ tiêu lượt", () => {
    // Cơ sở đích luôn là cơ sở KHÁCH chọn, không phải cơ sở người nhập.
    const d = resolveAssignment({
      ...nen,
      entryPoint: "FORM",
      targetCenterId: CS2,
      createdById: SALE_CS1,
      createdByCenterId: CS1,
      createdByIsSale: true,
    });
    expect(d).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("[3] vai KHÁC sale (marketing/QLCS/admin) nhập ở form → chia tự động, CÓ tiêu lượt", () => {
    const d = resolveAssignment({
      ...nen,
      entryPoint: "FORM",
      targetCenterId: CS1,
      createdById: MKT,
      createdByCenterId: CS1,
      createdByIsSale: false,
    });
    expect(d).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("[4] quản lý giao tay / đổi chủ → người được giao, KHÔNG tiêu lượt", () => {
    const d = resolveAssignment({
      ...nen,
      entryPoint: "MANAGER",
      createdById: MKT,
      explicitOwnerId: SALE_CS1,
    });
    expect(d).toEqual({ kind: "OWNER", ownerId: SALE_CS1, source: "MANAGER", consumedTurn: false });
  });

  it("[5] import Excel, dòng CÓ cột sale hợp lệ → sale trong file, KHÔNG tiêu lượt", () => {
    const d = resolveAssignment({ ...nen, entryPoint: "IMPORT", explicitOwnerId: SALE_CS1 });
    expect(d).toEqual({ kind: "OWNER", ownerId: SALE_CS1, source: "IMPORT", consumedTurn: false });
  });

  it("[6] import Excel, dòng KHÔNG có cột sale (hoặc tên không khớp tài khoản nào) → chia tự động", () => {
    // Caller đã tra tên trong file ra tài khoản; không khớp thì truyền null —
    // hàm này KHÔNG tự đoán ai là ai.
    const d = resolveAssignment({ ...nen, entryPoint: "IMPORT", explicitOwnerId: null });
    expect(d).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("[7] landing aff, mã NV hợp lệ, người đó LÀ sale và ĐÚNG cơ sở khách chọn → chính người đó", () => {
    const d = resolveAssignment({
      ...nen,
      targetCenterId: CS1,
      aff: { userId: SALE_CS1, centerId: CS1, isSale: true },
    });
    expect(d).toEqual({ kind: "OWNER", ownerId: SALE_CS1, source: "AFFILIATE", consumedTurn: false });
  });

  it("[8] landing aff, sale hợp lệ nhưng khách chọn cơ sở KHÁC → chia trong pool cơ sở khách chọn", () => {
    // Chống rò lead xuyên cơ sở: người CS1 phát link không kéo được lead CS2 về mình.
    const d = resolveAssignment({
      ...nen,
      targetCenterId: CS2,
      aff: { userId: SALE_CS1, centerId: CS1, isSale: true },
    });
    expect(d).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("[9] landing aff, mã NV hợp lệ nhưng người đó KHÔNG phải sale (marketing/GV) → chia tự động", () => {
    const d = resolveAssignment({
      ...nen,
      targetCenterId: CS1,
      aff: { userId: MKT, centerId: CS1, isSale: false },
    });
    expect(d).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("[10] landing KHÔNG có mã aff / mã sai → chia tự động", () => {
    expect(resolveAssignment({ ...nen, aff: null })).toEqual({
      kind: "AUTO",
      source: "AUTO",
      consumedTurn: true,
    });
    expect(resolveAssignment(nen)).toEqual({
      kind: "AUTO",
      source: "AUTO",
      consumedTurn: true,
    });
  });

  it("[11] trùng SĐT với lead cũ chưa xoá → GIỮ NGUYÊN chủ cũ, KHÔNG tiêu lượt", () => {
    const d = resolveAssignment({
      ...nen,
      duplicateOf: { leadId: "lead-cu", ownerId: SALE_CS2 },
    });
    expect(d).toEqual({
      kind: "DUPLICATE",
      leadId: "lead-cu",
      ownerId: SALE_CS2,
      source: "DUPLICATE",
      consumedTurn: false,
    });
  });
});

describe("[CHIA-LEAD] thứ tự ưu tiên và các mép", () => {
  it("quy tắc trùng SĐT chạy TRƯỚC tất cả — kể cả khi chính sale đó nhập đúng cơ sở mình", () => {
    // Nếu để ca [1] thắng thì mỗi lần khách gọi lại, sale nào nhập lại phiếu sẽ CƯỚP
    // được lead khỏi tay người đang giữ — chỉ cần gõ lại số điện thoại.
    const d = resolveAssignment({
      ...nen,
      entryPoint: "FORM",
      targetCenterId: CS1,
      createdById: SALE_CS1,
      createdByCenterId: CS1,
      createdByIsSale: true,
      duplicateOf: { leadId: "lead-cu", ownerId: SALE_CS2 },
    });
    expect(d).toMatchObject({ kind: "DUPLICATE", source: "DUPLICATE", ownerId: SALE_CS2 });
  });

  it("lead cũ đang CHƯA PHÂN CÔNG thì trùng vẫn là trùng — không nhân dịp chia luôn", () => {
    // Chia ở đây là lặng lẽ đổi hành vi: người vận hành thấy "trùng" mà lượt lại bị
    // tiêu. Muốn giao thì QLCS giao tay (ca 4), có vết.
    const d = resolveAssignment({ ...nen, duplicateOf: { leadId: "lead-cu", ownerId: null } });
    expect(d).toEqual({
      kind: "DUPLICATE",
      leadId: "lead-cu",
      ownerId: null,
      source: "DUPLICATE",
      consumedTurn: false,
    });
  });

  it("quản lý giao tay mà KHÔNG chỉ định người → ném lỗi, không âm thầm chia máy", () => {
    // Rơi xuống AUTO ở đây nghĩa là nút "Giao cho…" bấm hụt vẫn báo thành công, còn
    // lead đi đâu thì không ai biết.
    expect(() =>
      resolveAssignment({ ...nen, entryPoint: "MANAGER", explicitOwnerId: null }),
    ).toThrow(/người nhận/i);
  });

  it("form nội bộ mà không biết người nhập là ai → chia tự động, không gán bừa", () => {
    const d = resolveAssignment({
      ...nen,
      entryPoint: "FORM",
      createdById: null,
      createdByIsSale: true,
      createdByCenterId: CS1,
    });
    expect(d).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("sale nhập đúng cơ sở mình nhưng cơ sở người nhập BỎ TRỐNG → chia tự động", () => {
    // `User.centerId` null là dữ liệu thật đang có trên prod. So `null === null` với
    // `targetCenterId` null sẽ ra "cùng cơ sở" — gán lead cho người không thuộc cơ sở nào.
    const d = resolveAssignment({
      ...nen,
      entryPoint: "FORM",
      targetCenterId: CS1,
      createdById: SALE_CS1,
      createdByCenterId: null,
      createdByIsSale: true,
    });
    expect(d).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("aff trỏ đúng người nhưng cơ sở của người đó BỎ TRỐNG → chia tự động", () => {
    const d = resolveAssignment({
      ...nen,
      targetCenterId: CS1,
      aff: { userId: SALE_CS1, centerId: null, isSale: true },
    });
    expect(d).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("import có cột sale THÌ cột sale thắng, kể cả khi có mã aff", () => {
    const d = resolveAssignment({
      ...nen,
      entryPoint: "IMPORT",
      explicitOwnerId: SALE_CS1,
      aff: { userId: SALE_CS2, centerId: CS1, isSale: true },
    });
    expect(d).toEqual({ kind: "OWNER", ownerId: SALE_CS1, source: "IMPORT", consumedTurn: false });
  });

  it("mã aff chỉ có nghĩa ở landing — gửi kèm ở form nội bộ thì bỏ qua", () => {
    // Không bỏ qua thì ai cũng ép được lead về tay mình bằng cách thêm ?ref= vào
    // đường dẫn của biểu mẫu nội bộ.
    const d = resolveAssignment({
      ...nen,
      entryPoint: "FORM",
      targetCenterId: CS1,
      createdById: MKT,
      createdByCenterId: CS1,
      createdByIsSale: false,
      aff: { userId: SALE_CS1, centerId: CS1, isSale: true },
    });
    expect(d).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });
});

describe("RESHUFFLE — nút \"Chia lại lead\" (03/09/2026)", () => {
  // Lỗi đã gặp: nút gọi `autoAssignNewLead`, hàm đó bỏ qua lead đã có chủ và trả
  // `ok: true` kèm `skipped`, nên giao diện báo "đã chia lại" mà lead không đổi tay.
  // Nhánh này sinh ra để LUÔN về vòng chia, không có ngoại lệ nào.

  it("luôn về VÒNG CHIA, kể cả khi người bấm là sale ĐÚNG cơ sở", () => {
    // Khác hẳn `FORM`: ở đó sale đúng cơ sở tự nhập thì được giữ phiếu (ca [1]).
    // Nếu RESHUFFLE cũng xử vậy thì quản lý là sale bấm nút sẽ tự gán cho chính
    // mình — và nút "chia lại" thành nút "cướp lead".
    expect(
      resolveAssignment({
        targetCenterId: CS1,
        createdById: SALE_CS1,
        createdByCenterId: CS1,
        createdByIsSale: true,
        entryPoint: "RESHUFFLE",
        explicitOwnerId: null,
        aff: null,
        duplicateOf: null,
      }),
    ).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("bỏ qua mã giới thiệu — không ép được lead về tay mình bằng ?ref=", () => {
    expect(
      resolveAssignment({
        targetCenterId: CS1,
        createdById: MKT,
        createdByCenterId: CS1,
        createdByIsSale: false,
        entryPoint: "RESHUFFLE",
        explicitOwnerId: null,
        aff: { userId: SALE_CS1, isSale: true, centerId: CS1 },
        duplicateOf: null,
      }).kind,
    ).toBe("AUTO");
  });

  it("bỏ qua cả người nhận chỉ định — chia lại nghĩa là RÚT THĂM LẠI", () => {
    expect(
      resolveAssignment({
        targetCenterId: CS1,
        createdById: MKT,
        createdByCenterId: CS1,
        createdByIsSale: false,
        entryPoint: "RESHUFFLE",
        explicitOwnerId: SALE_CS2,
        aff: null,
        duplicateOf: null,
      }).kind,
    ).toBe("AUTO");
  });

  it("TIÊU LƯỢT — nếu không thì chia lại nhiều lần là dồn lead miễn phí cho một người", () => {
    const r = resolveAssignment({
      targetCenterId: CS1,
      createdById: null,
      createdByCenterId: null,
      createdByIsSale: false,
      entryPoint: "RESHUFFLE",
      explicitOwnerId: null,
      aff: null,
      duplicateOf: null,
    });
    expect(r.consumedTurn).toBe(true);
  });
});

describe("GÁN TAY KHÔNG TIÊU LƯỢT (chủ dự án chốt 03/09/2026)", () => {
  // Chốt: chỉ định sẵn chủ LÚC TẠO lead (cột sale trong file Excel, quản lý giao
  // tay trên phiếu) thì KHÔNG tiêu lượt của vòng.
  //
  // Vì sao khoá bằng test chứ không chỉ ghi chú: cùng đợt đó đường gán tay trên
  // lead ĐÃ CÓ (`manualAssignLead`) lại được đổi thành CÓ tiêu lượt. Hai luật
  // ngược nhau nằm cạnh nhau là thứ dễ bị "dọn cho nhất quán" bởi người đọc sau,
  // và dọn nhầm chiều thì lượt của sale bị trừ oan mỗi lần nhập file.
  //
  // Ranh giới đúng là: TẠO lead mà đã biết chủ ⇒ không có lượt nào được rút, nên
  // không có gì để trừ. Còn ĐỔI CHỦ một lead đã nằm trong vòng ⇒ người nhận vừa
  // thêm một việc, phải tính vào sổ.

  it("IMPORT có cột sale → giao đúng người đó, KHÔNG tiêu lượt", () => {
    expect(
      resolveAssignment({
        targetCenterId: CS1,
        createdById: MKT,
        createdByCenterId: CS1,
        createdByIsSale: false,
        entryPoint: "IMPORT",
        explicitOwnerId: SALE_CS1,
        aff: null,
        duplicateOf: null,
      }),
    ).toEqual({
      kind: "OWNER",
      ownerId: SALE_CS1,
      source: "IMPORT",
      consumedTurn: false,
    });
  });

  it("IMPORT KHÔNG có cột sale → về vòng chia, CÓ tiêu lượt", () => {
    // Đây là ca đang chạy thật: mẫu file nhập lead hiện không có cột sale
    // (`LEAD_IMPORT_COLUMNS`), nên mọi dòng rơi vào nhánh này.
    expect(
      resolveAssignment({
        targetCenterId: CS1,
        createdById: MKT,
        createdByCenterId: CS1,
        createdByIsSale: false,
        entryPoint: "IMPORT",
        explicitOwnerId: null,
        aff: null,
        duplicateOf: null,
      }),
    ).toEqual({ kind: "AUTO", source: "AUTO", consumedTurn: true });
  });

  it("quản lý giao tay lúc TẠO phiếu → KHÔNG tiêu lượt", () => {
    expect(
      resolveAssignment({
        targetCenterId: CS1,
        createdById: MKT,
        createdByCenterId: CS1,
        createdByIsSale: false,
        entryPoint: "MANAGER",
        explicitOwnerId: SALE_CS1,
        aff: null,
        duplicateOf: null,
      }).consumedTurn,
    ).toBe(false);
  });
});
