/**
 * HTL-09 — GIÁ GHI DANH LẤY TỪ DÒNG ĐƠN. Phần THUẦN.
 *
 * Bộ này canh bốn thứ mà một bản hiện thực "hợp lý" rất dễ làm hỏng, và cả bốn đều là
 * đường TIỀN:
 *
 *  1. **Mơ hồ thì KHÔNG đoán.** Hai dòng cùng con + cùng khoá ⇒ `null`, rơi về giá khoá.
 *     Chọn bừa một dòng là ghi một con số tiền không ai truy được vì sao.
 *  2. **Giá 0 là giá.** `??` chứ không `||` — học bổng toàn phần cho ra 0đ, và `||` biến
 *     nó thành giá niêm yết.
 *  3. **Không có cầu nối thì không tra.** Bé không khai `leadChildId` (đơn walk-in, đơn
 *     trước 15/09) ⇒ `null`, không được khớp theo tên hay theo thứ tự.
 *  4. **Khoá phải khớp.** Cùng một bé học hai khoá thì hai dòng, và lấy nhầm dòng là ghi
 *     học phí khoá này vào ghi danh khoá kia.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { giaTuDongDon, listPriceChoGhiDanh, type DongDonChoGhiDanh } from "./gia-tu-dong-don";
import { computeEnrollmentPrice } from "./pricing";

const CON_A = "lc_a";
const CON_B = "lc_b";
const SATA3 = "course_sata3";
const SATA4 = "course_sata4";

/** Đơn Coach 1-1 Sata3: giá nhóm 5.200.000đ × hệ số 2 = 10.400.000đ (ca thật của HTL-09). */
const COACH_1_1: DongDonChoGhiDanh = {
  // `soBuoi` BẮT BUỘC từ 28/09 — cố ý để `null` (mua đủ khoá) ở fixture gốc, các ca cần
  // phạm vi buổi thì tự ghi đè, để không ca nào phụ thuộc ngầm vào một con số ở đây.
  soBuoi: null,
  leadChildId: CON_A,
  courseId: SATA3,
  totalPrice: 10_400_000,
};

describe("[GTD] giá từ dòng đơn", () => {
  it("[GTD-01] khớp đúng con + đúng khoá ⇒ trả giá của DÒNG, không phải giá khoá", () => {
    expect(giaTuDongDon([COACH_1_1], { leadChildId: CON_A, courseId: SATA3 })).toBe(10_400_000);
  });

  it("[GTD-02] bé KHÁC không được lấy giá của bé này", () => {
    expect(giaTuDongDon([COACH_1_1], { leadChildId: CON_B, courseId: SATA3 })).toBeNull();
  });

  it("[GTD-03] khoá KHÁC không được lấy giá của khoá này", () => {
    // Một bé học hai khoá là ca thật (Sata3 rồi lên Sata4). Bỏ vế khoá đi thì ghi danh
    // Sata4 nhận học phí của Sata3 — sai một con số tiền mà không lỗi nào nổ.
    expect(giaTuDongDon([COACH_1_1], { leadChildId: CON_A, courseId: SATA4 })).toBeNull();
  });

  it("[GTD-04] KHÔNG có `leadChildId` ⇒ null, KHÔNG khớp theo thứ tự hay theo tên", () => {
    // Đơn walk-in và mọi đơn trước 15/09 đều rơi vào đây. Đoán bừa "dòng duy nhất chắc là
    // của em này" là đúng thứ `hoc-vien-dong-don.ts` dựng ra để tránh.
    expect(giaTuDongDon([COACH_1_1], { leadChildId: null, courseId: SATA3 })).toBeNull();
    expect(giaTuDongDon([COACH_1_1], { leadChildId: "  ", courseId: SATA3 })).toBeNull();
    const khongCauNoi: DongDonChoGhiDanh = { ...COACH_1_1, leadChildId: null };
    expect(giaTuDongDon([khongCauNoi], { leadChildId: CON_A, courseId: SATA3 })).toBeNull();

    // ⚠️ CA NÀY MỚI LÀ CA CỔNG `if (!conId) return null` BẢO VỆ — và bản đầu của bộ này
    // THIẾU nó. Phép cấy 23/09 (gỡ cổng, để `conId` rơi về `null`) ra **0 ĐỎ**: ba khẳng
    // định trên đều đi qua nhánh "không dòng nào khớp" nên không đụng tới cổng.
    //
    // Không có cổng thì `null === null` KHỚP: một dòng đơn KHÔNG khai con (đơn walk-in,
    // mọi đơn trước 15/09) sẽ được gán cho một ghi danh cũng không khai con — tức lấy giá
    // của một suất học không ai chứng minh được là của em nào.
    expect(giaTuDongDon([khongCauNoi], { leadChildId: null, courseId: SATA3 })).toBeNull();
    const rong: DongDonChoGhiDanh = { ...COACH_1_1, leadChildId: "" };
    expect(giaTuDongDon([rong], { leadChildId: "  ", courseId: SATA3 })).toBeNull();
  });

  it("[GTD-05] HAI dòng cùng con + cùng khoá ⇒ null, KHÔNG chọn bừa", () => {
    const hai = [COACH_1_1, { ...COACH_1_1, totalPrice: 5_200_000 }];
    expect(giaTuDongDon(hai, { leadChildId: CON_A, courseId: SATA3 })).toBeNull();
  });

  it("[GTD-06] giá 0 là MỘT GIÁ, không phải 'không có giá'", () => {
    // Học bổng toàn phần bán ở đơn ⇒ dòng 0đ. Viết `|| giaKhoa` thì ca này ra 5.200.000đ
    // và gia đình được ghi một khoản nợ mà họ không nợ.
    const mienPhi: DongDonChoGhiDanh = { ...COACH_1_1, totalPrice: 0 };
    expect(giaTuDongDon([mienPhi], { leadChildId: CON_A, courseId: SATA3 })).toBe(0);
    expect(
      listPriceChoGhiDanh([mienPhi], { leadChildId: CON_A, courseId: SATA3 }, 5_200_000),
    ).toBe(0);
  });

  it("[GTD-07] giá ÂM / không phải số ⇒ rơi về giá khoá, không ghi số lạ", () => {
    const hong: DongDonChoGhiDanh = { ...COACH_1_1, totalPrice: -1 };
    expect(giaTuDongDon([hong], { leadChildId: CON_A, courseId: SATA3 })).toBeNull();
    const nan: DongDonChoGhiDanh = { ...COACH_1_1, totalPrice: Number.NaN };
    expect(giaTuDongDon([nan], { leadChildId: CON_A, courseId: SATA3 })).toBeNull();
  });

  it("[GTD-08] không tra được ⇒ `listPriceChoGhiDanh` trả ĐÚNG giá khoá (hành vi cũ)", () => {
    expect(listPriceChoGhiDanh([], { leadChildId: CON_A, courseId: SATA3 }, 5_200_000)).toBe(
      5_200_000,
    );
  });
});

describe("[GTD] nối với phép tính giá ghi danh", () => {
  it("[GTD-09] Coach 1-1: ghi danh nhận 10,4tr — đúng số trên đơn", () => {
    // ĐÂY LÀ CA CỦA `[HTL-09]`. Trước bản vá, ghi danh nhận 5.200.000đ (giá NHÓM) ⇒
    // ZNS báo ~10,4tr · portal in 5,2tr · /cong-no ra −5,2tr ("đóng thừa") · hoàn tiền
    // 6/12 buổi chi dư ~2,6tr.
    const gia = computeEnrollmentPrice({
      listPrice: listPriceChoGhiDanh(
        [COACH_1_1],
        { leadChildId: CON_A, courseId: SATA3 },
        5_200_000,
      ),
      discount: null,
    });
    expect(gia.finalPrice).toBe(10_400_000);
  });

  it("[GTD-10] học bổng khai lúc convert VẪN áp lên giá đơn, không bị nuốt", () => {
    // Vì sao thay ĐẦU VÀO `listPrice` thay vì gán thẳng `finalPrice = totalPrice`: gán
    // thẳng thì một suất học bổng khai ở màn convert biến mất im lặng — một lỗ tiền MỚI
    // thay cho lỗ đang vá.
    const gia = computeEnrollmentPrice({
      listPrice: listPriceChoGhiDanh(
        [COACH_1_1],
        { leadChildId: CON_A, courseId: SATA3 },
        5_200_000,
      ),
      discount: { type: "SCHOLARSHIP", value: 100 },
    });
    expect(gia.finalPrice).toBe(0);
    expect(gia.discountAmount).toBe(10_400_000);
  });

  it("[GTD-11] lớp NHÓM bán đúng giá niêm yết ⇒ không đổi gì so với trước", () => {
    // Đối chứng: đa số đơn là lớp nhóm, và bản vá KHÔNG được làm chúng lệch đi một đồng.
    const nhom: DongDonChoGhiDanh = { ...COACH_1_1, totalPrice: 5_200_000 };
    const gia = computeEnrollmentPrice({
      listPrice: listPriceChoGhiDanh(
        [nhom],
        { leadChildId: CON_A, courseId: SATA3 },
        5_200_000,
      ),
      discount: null,
    });
    expect(gia.finalPrice).toBe(5_200_000);
  });
});

describe("[GTD] DÂY NỐI — lưới ghim mã nguồn", () => {
  // LƯỚI GHIM MÃ NGUỒN (CLAUDE.md). Luật ở đây có dạng "đường convert phải TRUYỀN giá đơn
  // vào `computeEnrollmentPrice`", và test hành vi KHÔNG chứng minh được: `convertLeadV2`
  // chạm DB nên mọi ca kiểm nó là test tích hợp, và không ai viết đủ ca.
  //
  // Gỡ lời gọi đi thì hàm vẫn chạy, vẫn trả giá, mọi ca thuần vẫn xanh — chỉ có ghi danh
  // lặng lẽ quay về GIÁ NHÓM. Đúng lớp lỗi CÂM mà cả HTL-09 sinh ra để vá, nên phải có một
  // lưới neo vào chính dây nối.
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("[GTD-12] `convertLeadV2` truyền giá dòng đơn vào phép tính giá ghi danh", () => {
    const src = doc("lib/crm/convert-lead-v2.ts");
    // Neo theo LỜI GỌI, không theo tên trần: chú thích giải thích bản vá cũng chứa tên hàm,
    // và neo vào tên là lưới đỏ giả / xanh giả tuỳ hôm (luật 11).
    expect(src.match(/listPriceChoGhiDanh\(/g) ?? []).toHaveLength(1);
    expect(src.match(/dongDonCuaLead\(/g) ?? []).toHaveLength(1);
    // Và nó phải nằm ở vị trí `listPrice` của `computeEnrollmentPrice`, không phải một biến
    // tính rồi bỏ đó — đúng lỗi "tính được `còn thiếu` mà không in ra đâu cả" từng mắc.
    expect(src).toMatch(/listPrice:\s*listPriceChoGhiDanh\(/);
  });

  it("[GTD-13] màn XEM TRƯỚC đo ưu đãi trên CÙNG con số với đường ghi", () => {
    // Hai bên lệch thì cổng "ưu đãi có ăn tiền thật không" đo một số, còn số ghi vào sổ là
    // số khác — màn hình nói một đằng, sổ ghi một nẻo.
    const src = doc("app/(admin)/admin/leads/[id]/convert/actions.ts");
    expect(src.match(/listPriceChoGhiDanh\(/g) ?? []).toHaveLength(1);
  });
});
