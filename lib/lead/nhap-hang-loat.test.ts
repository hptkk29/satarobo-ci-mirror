/**
 * NHẬP LEAD HÀNG LOẠT — hai sự cố prod ngày 15/09/2026, cùng một lượt nhập Excel.
 *
 * ── SỰ CỐ 1: lead nhập xong KHÔNG hiện ở /leads ──────────────────────────────────────────
 * Quản lý cơ sở nhập Excel. Sổ chia lead nhảy số đúng, tìm theo SĐT hay theo nguồn thì lead
 * hiện ra — nhưng mở `/leads` thì không thấy.
 *
 * Nguyên nhân: danh sách sắp theo `lastInboundAt` với `nulls: 'last'`
 * (`app/(admin)/admin/leads/page.tsx`), mà đường import KHÔNG ghi cột đó. Lead có
 * `lastInboundAt = null` bị đẩy xuống SAU toàn bộ lead cũ — tức những trang cuối cùng.
 *
 * Hai triệu chứng khớp nhau ở đúng chỗ này: lọc theo SĐT/nguồn làm tập kết quả co lại còn
 * vài dòng nên lead null lọt vào trang 1; bỏ lọc ra thì nó chìm.
 *
 * ⚠️ Rà cả repo tìm ra 5/7 nơi tạo lead thiếu cột này — không riêng đường import. Cột là
 * `DateTime?` không có `@default`, nên quên là null, và null thì im lặng.
 *
 * ── SỰ CỐ 2: nhập 40 lead thì bắn 40 chuông ──────────────────────────────────────────────
 * Chủ dự án chốt: "nhập nhiều thì báo là có bao nhiêu lead mới chứ không gửi nhiều thông báo".
 * Đây cũng là điều đúng về kỹ thuật — 40 lần rung máy liên tiếp là "bão push" mà
 * `lib/push/allowlist.ts` nói là cái giá không lấy lại được.
 *
 * ── ĐỢT HAI: BA ĐƯỜNG DÙNG CHUNG MỘT PHÉP BÁO ────────────────────────────────────────────
 * Chủ dự án chốt tiếp: nối tin gộp vào cả BÀN GIAO và CHIA LẠI KHI SALE NGHỈ — hai đường
 * trước đó im hoàn toàn với người nhận (họ được giao lead mà không ai đánh động).
 *
 * Ba đường nay đi qua đúng một hàm `baoLoLeadMoi`. Gom vào một chỗ vì lần trước lỗi đúng kiểu
 * ngược lại: bốn đường đổi chủ ra đời bốn thời điểm, mỗi đường quên cùng một bước.
 *
 * Nhưng CÂU CHỮ thì không được gom: lead bàn giao là lead đang chạy dở, có lịch sử trao đổi,
 * khách đã nói chuyện với người khác. Nói y hệt lead nhập mới là một affordance nói dối.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  notifyStaff: vi.fn(async (_p: Record<string, unknown>) => 1),
  thuHoiThongBao: vi.fn(async () => 1),
  broadcastNotificationBump: vi.fn(async () => undefined),
}));
vi.mock("@/lib/notifications/notify", () => ({
  notifyStaff: h.notifyStaff,
  thuHoiThongBao: h.thuHoiThongBao,
  broadcastNotificationBump: h.broadcastNotificationBump,
}));

import {
  baoSaleNhieuLeadMoi,
  lenKeHoachBaoLoLead,
  moTaLoLead,
  nguonGanCuaLo,
} from "./assign-lead";

/** Nguồn mặc định của bộ này — ca nào quan tâm tới nguồn thì tự truyền cái khác. */
const NHAP = { kieu: "nhap_danh_sach" } as const;

const tinCuoi = () => {
  const c = h.notifyStaff.mock.calls.at(-1)?.[0];
  if (!c) throw new Error("notifyStaff chưa được gọi lần nào");
  return c;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.notifyStaff.mockResolvedValue(1);
});

describe("[LEAD-T60] chuông GỘP khi nhập hàng loạt", () => {
  it("nhận nhiều lead ⇒ ĐÚNG MỘT chuông, nói rõ số lượng", async () => {
    await baoSaleNhieuLeadMoi({ ownerId: "sale_a", soLead: 12, mocLuot: 1789400000000, nguon: NHAP });
    expect(h.notifyStaff).toHaveBeenCalledTimes(1);
    expect(String(tinCuoi().title)).toContain("12");
  });

  it("chỉ tới ĐÚNG người nhận, không ai khác", async () => {
    await baoSaleNhieuLeadMoi({ ownerId: "sale_a", soLead: 5, mocLuot: 1, nguon: NHAP });
    expect(tinCuoi().userIds).toEqual(["sale_a"]);
  });

  it("⚠️ đúng MỘT lead ⇒ KHÔNG dùng tin gộp", async () => {
    // Một lead thì `baoSaleCoLeadMoi` tốt hơn hẳn: nó trỏ thẳng trang chi tiết, bấm là đọc
    // được số điện thoại. Tin gộp chỉ trỏ về danh sách.
    await baoSaleNhieuLeadMoi({ ownerId: "sale_a", soLead: 1, mocLuot: 1, nguon: NHAP });
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("không lead nào ⇒ im", async () => {
    await baoSaleNhieuLeadMoi({ ownerId: "sale_a", soLead: 0, mocLuot: 1, nguon: NHAP });
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("hai lượt nhập khác nhau ⇒ hai khoá khác nhau (không bị nuốt mất tin thứ hai)", async () => {
    // `@@unique([userId, dedupeKey])` nuốt lượt thứ hai nếu khoá trùng — sale sẽ không biết
    // mình vừa nhận thêm lead. Đây là lý do khoá CÓ mốc thời gian, ngược với luật chung.
    await baoSaleNhieuLeadMoi({ ownerId: "sale_a", soLead: 3, mocLuot: 1_000, nguon: NHAP });
    const k1 = tinCuoi().dedupeKey;
    await baoSaleNhieuLeadMoi({ ownerId: "sale_a", soLead: 4, mocLuot: 2_000, nguon: NHAP });
    expect(tinCuoi().dedupeKey).not.toBe(k1);
  });

  it("CÙNG một lượt ⇒ mỗi người một khoá riêng", async () => {
    await baoSaleNhieuLeadMoi({ ownerId: "sale_a", soLead: 3, mocLuot: 7, nguon: NHAP });
    const kA = tinCuoi().dedupeKey;
    await baoSaleNhieuLeadMoi({ ownerId: "sale_b", soLead: 2, mocLuot: 7, nguon: NHAP });
    expect(tinCuoi().dedupeKey).not.toBe(kA);
  });

  it("khoá mang đúng tiền tố đã khai trong danh mục", async () => {
    // Sai tiền tố thì thông báo rơi về nhóm "Hệ thống / P3" — nằm chót panel, không ai thấy.
    await baoSaleNhieuLeadMoi({ ownerId: "sale_a", soLead: 3, mocLuot: 1, nguon: NHAP });
    expect(String(tinCuoi().dedupeKey).startsWith("lead.moi_nhieu:")).toBe(true);
  });

  it("chuông hỏng ⇒ KHÔNG ném (lượt nhập vẫn phải thành công)", async () => {
    h.notifyStaff.mockRejectedValue(new Error("DB chập"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      baoSaleNhieuLeadMoi({ ownerId: "sale_a", soLead: 3, mocLuot: 1, nguon: NHAP }),
    ).resolves.toBeUndefined();
  });
});

describe("[LEAD-T62] gom tin theo NGƯỜI NHẬN", () => {
  // Phần lớn ca không quan tâm người thao tác ⇒ truyền null cho gọn.
  const ke = (ds: readonly { leadId: string; ownerId: string }[]) =>
    lenKeHoachBaoLoLead(ds, null);

  it("⚠️ mỗi người một tin — KHÔNG phải một tin chung cho cả lượt", () => {
    // Đây là chỗ lỗi dễ lọt nhất: đếm tổng số lead của lượt rồi bắn một tin. Sale nhận
    // "bạn có 40 lead mới" trong khi thực nhận 7.
    const kq = ke([
      { leadId: "l1", ownerId: "a" },
      { leadId: "l2", ownerId: "b" },
      { leadId: "l3", ownerId: "a" },
      { leadId: "l4", ownerId: "b" },
      { leadId: "l5", ownerId: "a" },
    ]);
    expect(kq).toEqual([
      { kieu: "gop", ownerId: "a", soLead: 3 },
      { kieu: "gop", ownerId: "b", soLead: 2 },
    ]);
  });

  it("người chỉ nhận MỘT lead ⇒ tin thường, mang đúng lead đó", () => {
    const kq = ke([
      { leadId: "l1", ownerId: "a" },
      { leadId: "l2", ownerId: "b" },
      { leadId: "l3", ownerId: "b" },
    ]);
    expect(kq).toEqual([
      { kieu: "mot", ownerId: "a", leadId: "l1" },
      { kieu: "gop", ownerId: "b", soLead: 2 },
    ]);
  });

  it("ngưỡng gộp đúng ở HAI, không phải ba", () => {
    expect(ke([{ leadId: "l1", ownerId: "a" }, { leadId: "l2", ownerId: "a" }])).toEqual([
      { kieu: "gop", ownerId: "a", soLead: 2 },
    ]);
  });

  it("mỗi người xuất hiện ĐÚNG MỘT lần trong kế hoạch", () => {
    const kq = ke(
      Array.from({ length: 20 }, (_, i) => ({ leadId: `l${i}`, ownerId: i % 3 === 0 ? "a" : "b" })),
    );
    expect(new Set(kq.map((t: { ownerId: string }) => t.ownerId)).size).toBe(kq.length);
  });

  it("cùng một lead lọt hai lần ⇒ đếm MỘT", () => {
    // Con số trong tin là thứ người nhận đối chiếu với danh sách của họ. Lệch một cái là
    // họ ngừng tin cả cơ chế.
    expect(ke([
      { leadId: "l1", ownerId: "a" },
      { leadId: "l1", ownerId: "a" },
    ])).toEqual([{ kieu: "mot", ownerId: "a", leadId: "l1" }]);
  });

  it("lượt nhập không chia được cho ai ⇒ không tin nào", () => {
    expect(ke([])).toEqual([]);
  });

  it("dòng thiếu chủ hoặc thiếu lead bị bỏ, không đẻ tin rỗng", () => {
    expect(ke([
      { leadId: "l1", ownerId: "" },
      { leadId: "", ownerId: "a" },
      { leadId: "l2", ownerId: "a" },
    ])).toEqual([{ kieu: "mot", ownerId: "a", leadId: "l2" }]);
  });
});

describe("[LEAD-T63] ba đường nói ba câu khác nhau", () => {
  const BAN_GIAO = { kieu: "ban_giao", tuNguoi: "Chị Lan" } as const;
  const SALE_NGHI = { kieu: "sale_nghi", tuNguoi: "Anh Hùng" } as const;

  it("⚠️ tin BÀN GIAO nói rõ lead đang chạy dở và của ai", async () => {
    // Nếu câu này giống hệt tin nhập mới thì người nhận gọi khách như lead nguội — trong khi
    // khách vừa nói chuyện với một tư vấn viên khác tuần trước.
    await baoSaleNhieuLeadMoi({ ownerId: "b", soLead: 9, mocLuot: 1, nguon: BAN_GIAO });
    const body = String(tinCuoi().body);
    expect(body).toContain("Chị Lan");
    expect(body).toContain("9");
    expect(body).toContain("lịch sử trao đổi");
  });

  it("tin SALE NGHỈ nói tên người đã nghỉ", async () => {
    await baoSaleNhieuLeadMoi({ ownerId: "b", soLead: 4, mocLuot: 1, nguon: SALE_NGHI });
    expect(String(tinCuoi().body)).toContain("Anh Hùng");
  });

  it("ba nguồn ⇒ ba câu KHÁC NHAU, không câu nào rỗng", () => {
    const cau = [NHAP, BAN_GIAO, SALE_NGHI].map((n) => moTaLoLead(n, 5));
    expect(new Set(cau).size, `ba câu bị trùng nhau: ${cau.join(" | ")}`).toBe(3);
    for (const c of cau) expect(c.length).toBeGreaterThan(20);
  });

  it("mọi câu đều mang đúng con số truyền vào", () => {
    for (const n of [NHAP, BAN_GIAO, SALE_NGHI]) {
      expect(moTaLoLead(n, 37)).toContain("37");
    }
  });

  it("⚠️ nguồn gán của ca MỘT lead phải khác nhau theo đường", () => {
    // `baoSaleCoLeadMoi` bỏ qua `source === "SELF"`, và nguồn còn đi vào audit/thống kê —
    // trả bừa một giá trị là làm hỏng cả hai chỗ.
    expect(nguonGanCuaLo(NHAP)).toBe("IMPORT");
    expect(nguonGanCuaLo(BAN_GIAO)).toBe("MANAGER");
    expect(nguonGanCuaLo(SALE_NGHI)).toBe("AUTO");
  });

  it("KHÔNG đường nào trả `SELF` — nó sẽ nuốt im chuông", () => {
    // `SELF` là nhánh thoát sớm của `baoSaleCoLeadMoi`. Một đường hàng loạt mà rơi vào đó thì
    // người nhận đúng một lead sẽ không được báo gì, và không ca nào khác đỏ.
    for (const n of [NHAP, BAN_GIAO, SALE_NGHI]) {
      expect(nguonGanCuaLo(n)).not.toBe("SELF");
    }
  });
});

describe("[LEAD-T64] không tự báo cho người vừa bấm nút", () => {
  it("⚠️ quản lý bàn giao lead về cho CHÍNH MÌNH ⇒ không tự báo", () => {
    // Cùng luật với nhánh `source === "SELF"` của `baoSaleCoLeadMoi`: không ai cần một cái
    // chuông kể lại việc mình vừa làm xong.
    expect(lenKeHoachBaoLoLead([
      { leadId: "l1", ownerId: "quanly" },
      { leadId: "l2", ownerId: "quanly" },
    ], "quanly")).toEqual([]);
  });

  it("người khác trong cùng lượt VẪN được báo", () => {
    // Bỏ sót vế này là đổi một lỗi ồn ào thành một lỗi im lặng.
    expect(lenKeHoachBaoLoLead([
      { leadId: "l1", ownerId: "quanly" },
      { leadId: "l2", ownerId: "sale_a" },
    ], "quanly")).toEqual([{ kieu: "mot", ownerId: "sale_a", leadId: "l2" }]);
  });

  it("lead của chính người thao tác KHÔNG tính vào con số của người khác", () => {
    const kq = lenKeHoachBaoLoLead([
      { leadId: "l1", ownerId: "quanly" },
      { leadId: "l2", ownerId: "sale_a" },
      { leadId: "l3", ownerId: "sale_a" },
    ], "quanly");
    expect(kq).toEqual([{ kieu: "gop", ownerId: "sale_a", soLead: 2 }]);
  });

  it("máy chạy (không có người thao tác) ⇒ báo đủ mọi người", () => {
    expect(lenKeHoachBaoLoLead([{ leadId: "l1", ownerId: "sale_a" }], null)).toEqual([
      { kieu: "mot", ownerId: "sale_a", leadId: "l1" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Cổng chống tái phát cho SỰ CỐ 1.
// ─────────────────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

/**
 * ⚠️ GỠ CHÚ THÍCH TRƯỚC KHI SO KHỚP.
 *
 * Bản đầu của cổng này KHÔNG BITE, và phép cấy lỗi bắt được ngay ở ca đầu tiên: gỡ hẳn dòng
 * `lastInboundAt: new Date()` khỏi đường nhập mà cổng vẫn XANH — vì ngay phía trên nó là khối
 * chú thích GIẢI THÍCH bản vá, và khối đó chứa đúng chữ `lastInboundAt`.
 *
 * Đây là cái bẫy luật 11 nêu đích danh, và là lần thứ tư nó cắn trong repo này. Chú thích
 * càng viết kỹ thì cổng càng dễ tự ru ngủ.
 */
function goChuThich(s: string): string {
  return s.replace(/\/\*[^]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Cắt đúng đối số của một lời gọi bắt đầu tại dấu `(`. */
function khoiGoi(src: string, i: number): string {
  let sau = 0;
  for (let k = i; k < Math.min(src.length, i + 20000); k++) {
    if (src[k] === "(") sau++;
    else if (src[k] === ")") {
      sau--;
      if (sau === 0) return src.slice(i, k + 1);
    }
  }
  return src.slice(i, i + 4000);
}

function quetTep(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ten of fs.readdirSync(dir)) {
    const p = path.join(dir, ten);
    if (fs.statSync(p).isDirectory()) {
      if (ten === "node_modules" || ten === ".next") continue;
      quetTep(p, out);
    } else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const NOI_TAO_LEAD: { tep: string; coCot: boolean }[] = [];
for (const p of [...quetTep(path.join(ROOT, "lib")), ...quetTep(path.join(ROOT, "app"))]) {
  const src = fs.readFileSync(p, "utf8");
  for (const m of src.matchAll(/\blead\.create\s*(?=\()/g)) {
    const i = src.indexOf("(", m.index! + m[0].length - 1);
    NOI_TAO_LEAD.push({
      tep: path.relative(ROOT, p).split(path.sep).join("/"),
      // Không chỉ gỡ chú thích — còn đòi ĐÚNG hình dạng gán trường (`lastInboundAt:`), để
      // một chuỗi trần lọt vào đâu đó cũng không đánh lừa được.
      coCot: /\blastInboundAt\s*:/.test(goChuThich(khoiGoi(src, i))),
    });
  }
}

describe("[LEAD-T61] mọi nơi TẠO lead đều phải ghi `lastInboundAt`", () => {
  it("phép quét tự kiểm: tìm được nơi tạo lead", () => {
    // Regex hỏng thì danh sách rỗng và ca dưới xanh giả.
    expect(NOI_TAO_LEAD.length, "không tìm thấy lời gọi `lead.create` nào").toBeGreaterThanOrEqual(5);
  });

  it("⚠️ không nơi nào bỏ trống cột quyết định thứ tự danh sách", () => {
    // Cột là `DateTime?` KHÔNG có `@default`, mà `/leads` sắp theo nó với `nulls: 'last'`.
    // Quên ghi ⇒ lead chìm xuống trang cuối ⇒ "nhập xong không thấy lead đâu".
    //
    // Đo 15/09/2026 TRƯỚC bản vá: 5/7 nơi thiếu — gồm cả form công khai và màn nhập tay,
    // không riêng đường import. Tức đây là lớp lỗi lặp lại, không phải một lần sơ ý.
    const thieu = NOI_TAO_LEAD.filter((x) => !x.coCot).map((x) => x.tep);
    expect(
      thieu,
      "Thêm `lastInboundAt: new Date()` vào khối `data` — xem chú thích ở " +
        "`lib/tables/lead-columns.ts` về quy ước lúc tạo:\n  - " + thieu.join("\n  - "),
    ).toEqual([]);
  });
});
