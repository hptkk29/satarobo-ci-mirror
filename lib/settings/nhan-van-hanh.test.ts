/**
 * Lớp ngôn ngữ người vận hành của trang Cấu hình vận hành.
 *
 * ── VÌ SAO BỘ NÀY ĐÁNG CÓ ────────────────────────────────────────────────────────────────
 * Trang cấu hình dựng danh sách từ BẢNG TAB, không từ `SETTING_KEYS`. Đó là lựa chọn có chủ
 * đích (key thiếu nhãn thì thà vắng mặt còn hơn hiện ra dưới dạng tên biến), nhưng nó đẻ ra
 * đúng một lớp lỗi câm: thêm một tham số vào `registry.ts` mà quên khai nhãn ⇒ tham số đó
 * KHÔNG BAO GIỜ hiện trên giao diện. Không lỗi, không cảnh báo, không ai biết — cho tới lúc có
 * người hỏi "sao tôi không sửa được X".
 *
 * Ca đầu tiên dưới đây bịt đúng lỗ đó, và nó là lý do chính bộ này tồn tại.
 */
import { describe, expect, it } from "vitest";
import { SETTING_KEYS, SETTINGS, validateSettingValue } from "./registry";
import { NHAN_VAN_HANH, TAB_CAU_HINH, keyCuaTab, nhanCuaKey } from "./nhan-van-hanh";

const ID_TAB = TAB_CAU_HINH.map((t) => t.id);

describe("[CFG-T01] mọi tham số đều có chỗ đứng trên giao diện", () => {
  it("mỗi key trong registry có đúng một nhãn vận hành", () => {
    const thieu = SETTING_KEYS.filter((k) => !NHAN_VAN_HANH[k]);
    expect(
      thieu,
      `Thêm dòng cho ${thieu.length} key này vào lib/settings/nhan-van-hanh.ts, ` +
        "nếu không chúng sẽ biến mất khỏi trang Cấu hình vận hành:\n  - " +
        thieu.join("\n  - "),
    ).toEqual([]);
  });

  it("không có nhãn thừa trỏ tới key đã xoá", () => {
    const co = new Set<string>(SETTING_KEYS);
    const thua = Object.keys(NHAN_VAN_HANH).filter((k) => !co.has(k));
    expect(thua, `Nhãn không còn key tương ứng:\n  - ${thua.join("\n  - ")}`).toEqual([]);
  });

  it("mọi nhãn trỏ vào một tab CÓ THẬT", () => {
    // Gõ sai id tab là tham số rơi khỏi mọi tab mà vẫn "có nhãn" — ca đầu tiên ở trên không
    // bắt được, vì nó chỉ hỏi "có dòng không".
    const sai = Object.entries(NHAN_VAN_HANH)
      .filter(([, n]) => !ID_TAB.includes(n.tab))
      .map(([k, n]) => `${k} → "${n.tab}"`);
    expect(sai, `Tab không tồn tại:\n  - ${sai.join("\n  - ")}`).toEqual([]);
  });

  it("tổng số key trải trên các tab = tổng số key của registry", () => {
    // Phép cộng này bắt được ca mà ba ca trên bỏ lọt: một key bị khai hai lần ở hai tab.
    const tong = ID_TAB.reduce((s, id) => s + keyCuaTab(id).length, 0);
    expect(tong).toBe(SETTING_KEYS.length);
  });

  it("không tab nào rỗng", () => {
    // Tab rỗng là một nút bấm vào không có gì — người dùng sẽ tưởng trang hỏng.
    //
    // NGOẠI LỆ: tab có NỘI DUNG RIÊNG thay vì danh sách ô cấu hình. Chúng không rỗng —
    // chỉ là thứ chúng bày ra không phải một key trong registry. `page.tsx` truyền nội
    // dung cho chúng qua `noiDungRieng`, và `khung-cau-hinh.tsx` dựng nội dung đó thay
    // cho bảng ô. Mỗi dòng dưới đây phải nêu bày cái gì.
    const CO_NOI_DUNG_RIENG: Record<string, string> = {
      "nick-zalo":
        "bảng giao nick Zalo cho người (dời từ màn riêng /zalo-crm/nick ngày 24/09) — " +
        "dữ liệu nằm ở bảng `ZaloCrmNick`, không phải SystemSetting",
      "phuong-thuc-tt":
        "bảng danh mục phương thức thanh toán (gộp từ /payment-methods 14/09/2026) — " +
        "dữ liệu nằm ở bảng `PaymentMethod`, không phải SystemSetting",
      "hoa-hong":
        "bảng khai chính sách hoa hồng — key `crm.commissionPolicies` CÓ trong registry " +
        "nhưng cố ý không hiện thành ô nhập JSON (nó là một danh sách, sửa bằng bảng riêng)",
    };
    const rong = ID_TAB.filter(
      (id) => keyCuaTab(id).length === 0 && !CO_NOI_DUNG_RIENG[id],
    );
    expect(rong, `Tab rỗng: ${rong.join(", ")}`).toEqual([]);
  });

  it("id tab không trùng nhau", () => {
    expect(new Set(ID_TAB).size).toBe(ID_TAB.length);
  });
});

describe("[CFG-T02] chữ viết cho người vận hành, không phải cho người viết mã", () => {
  /**
   * Danh sách hẹp và có lý do: đây đều là từ ĐÃ TỪNG nằm trong nhãn cũ và người dùng không
   * đoán được nghĩa. Cố ý KHÔNG cấm những từ mà người vận hành thật sự dùng hằng ngày — "Zalo",
   * "ZNS", "OTP", "QR" là tên sản phẩm họ gọi hằng ngày, cấm đi là làm chữ khó hiểu hơn.
   */
  const TU_KY_THUAT = [
    "cron",
    "rate-limit",
    "rate limit",
    "signed url",
    "presign",
    "idempot",
    "geofence",
    "cutover",
    "orgunit",
    "centerid",
    "template id",
    "sla-",
    "endpoint",
    "webhook",
    "payload",
    "boolean",
    "json",
    "api",
    "url",
    "lib/",
    ".ts",
    "qđ-",
    "r7-",
  ];

  it("tên và giải thích không chứa từ kỹ thuật người vận hành không đoán được", () => {
    const pham: string[] = [];
    for (const [key, n] of Object.entries(NHAN_VAN_HANH)) {
      const chu = `${n.ten} ${n.giaiThich} ${n.donVi ?? ""}`.toLowerCase();
      for (const t of TU_KY_THUAT) {
        if (chu.includes(t)) pham.push(`${key}: "${t}"`);
      }
    }
    expect(pham, `Viết lại bằng chữ thường ngày:\n  - ${pham.join("\n  - ")}`).toEqual([]);
  });

  it("tên không phải là tên khoá", () => {
    // Chép `key` làm `ten` là cách "hoàn thành" nhanh nhất và cũng vô dụng nhất.
    const luoi = Object.entries(NHAN_VAN_HANH).filter(([k, n]) => n.ten === k || n.ten.includes("."));
    expect(luoi.map(([k]) => k)).toEqual([]);
  });

  it("giải thích đủ dài để nói được điều gì đó", () => {
    const cut = Object.entries(NHAN_VAN_HANH)
      .filter(([, n]) => n.giaiThich.trim().length < 25)
      .map(([k, n]) => `${k}: "${n.giaiThich}"`);
    expect(cut, `Giải thích quá ngắn:\n  - ${cut.join("\n  - ")}`).toEqual([]);
  });

  it("tham số là con số thì phải có đơn vị", () => {
    // Một ô ghi "5" mà không nói 5 gì thì người dùng phải đoán — và họ sẽ đoán sai với những
    // ô tính bằng phút trong khi ô bên cạnh tính bằng ngày.
    const thieu = SETTING_KEYS.filter(
      (k) => typeof SETTINGS[k].default === "number" && !nhanCuaKey(k).donVi,
    );
    expect(thieu, `Thiếu đơn vị:\n  - ${thieu.join("\n  - ")}`).toEqual([]);
  });

  it("tham số bật/tắt thì KHÔNG gắn đơn vị", () => {
    const thua = SETTING_KEYS.filter(
      (k) => typeof SETTINGS[k].default === "boolean" && nhanCuaKey(k).donVi,
    );
    expect(thua).toEqual([]);
  });
});

describe("[CFG-T03] những thứ đổi sai thì tốn tiền hoặc ảnh hưởng rộng đều được đánh dấu", () => {
  it("các tham số nguy hiểm đã biết đều mang cờ cần cân nhắc", () => {
    // Không phải trang trí: dấu tam giác là thứ duy nhất phân biệt "đổi thoải mái" với "đổi
    // sai là gửi tin thật cho phụ huynh / lệch tiền / đổi ai nhìn thấy dữ liệu của ai".
    for (const k of [
      "zalo.znsLive",
      "push.webPushEnabled",
      "orgScope.cutoverEnabled",
      "crm.commissionMaxTotalRate",
      "payment.roundingToleranceVnd",
      "shift.geofenceRadiusMeters",
      "chat.znsMaxPerRun",
      "otp.globalKillSwitch",
    ] as const) {
      expect(nhanCuaKey(k).canThan, k).toBe(true);
    }
  });
});

describe("[CFG-T04] hai khoá của thông báo đẩy nằm cùng một tab", () => {
  it("công tắc tổng và danh sách loại không bị tách ra hai nơi", () => {
    // Tách ra là người dùng bật danh sách ở một tab rồi ngồi chờ, trong khi công tắc tổng ở
    // tab khác vẫn tắt.
    expect(nhanCuaKey("push.webPushEnabled").tab).toBe("thong-bao-day");
    expect(nhanCuaKey("push.tienToDuocDay").tab).toBe("thong-bao-day");
  });
});

describe("[CFG-T05] danh sách chọn khớp KHÍT với giá trị mà máy chủ nhận", () => {
  // ⚠️ Lưới này sinh ra cùng lúc với `chon` và nó canh một lỗi CÂM: quản lý chọn một mục
  // trong danh sách, máy chủ từ chối, và người ta kết luận "màn cấu hình hỏng". Khai lệch
  // một chữ giữa nhãn và `z.enum` là đủ để ra đúng cảnh đó.
  const coChon = SETTING_KEYS.filter((k) => nhanCuaKey(k).chon);

  it("có ít nhất một tham số dùng danh sách chọn", () => {
    // Ca chống TAUTOLOGY: hai ca dưới quét `coChon`, nên danh sách rỗng là chúng xanh vĩnh
    // viễn mà không kiểm gì. Đã đo: xoá hết `chon` thì chỉ ca này đỏ.
    expect(coChon.length).toBeGreaterThan(0);
  });

  it("mọi giá trị trong danh sách chọn đều được máy chủ CHẤP NHẬN", () => {
    const hong: string[] = [];
    for (const k of coChon) {
      for (const c of nhanCuaKey(k).chon!) {
        const kq = validateSettingValue(k, c.giaTri);
        if (!kq.ok) hong.push(`${k} → "${c.giaTri}"`);
      }
    }
    expect(hong, `Máy chủ từ chối giá trị mà màn hình mời chọn:\n  - ${hong.join("\n  - ")}`).toEqual([]);
  });

  it("không giá trị nào của máy chủ BỊ BỎ SÓT khỏi danh sách chọn", () => {
    // Chiều ngược lại, và nó mới là chiều âm thầm: thêm một lựa chọn vào `z.enum` mà quên
    // khai nhãn thì quản lý KHÔNG BAO GIỜ chọn được nó, và tính năng coi như không tồn tại.
    const thieu: string[] = [];
    for (const k of coChon) {
      const schema = SETTINGS[k].schema as unknown as { options?: readonly string[] };
      const cuaMay = schema.options;
      if (!cuaMay) {
        thieu.push(`${k}: khai \`chon\` nhưng schema không phải danh sách giá trị cố định`);
        continue;
      }
      const cuaMan = new Set(nhanCuaKey(k).chon!.map((c) => c.giaTri));
      for (const v of cuaMay) if (!cuaMan.has(v)) thieu.push(`${k} → thiếu "${v}"`);
    }
    expect(thieu, `Thiếu nhãn cho lựa chọn:\n  - ${thieu.join("\n  - ")}`).toEqual([]);
  });

  it("mỗi lựa chọn nói được HỆ QUẢ của nó, không chỉ cái tên", () => {
    // Một danh sách gồm "Con có học phí thấp hơn" / "Con đăng ký sau" không giúp quản lý
    // quyết định gì: hai cái đều nghe hợp lý. Thứ giúp họ chọn là câu nói ra cái GIÁ.
    const cut: string[] = [];
    for (const k of coChon) {
      for (const c of nhanCuaKey(k).chon!) {
        if ((c.hauQua ?? "").trim().length < 25) cut.push(`${k} → "${c.nhan}"`);
      }
    }
    expect(cut, `Lựa chọn chưa nói hệ quả:\n  - ${cut.join("\n  - ")}`).toEqual([]);
  });
});
