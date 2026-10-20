/**
 * KHOÁ QUAN TÂM CỦA LEAD — con được ghi đè khi nào.
 *
 * Bộ này canh đúng MỘT lời hứa, và nó là lời hứa mà bản vá 17/09/2026 vừa đưa ra: ô "Khoá
 * quan tâm" ở màn sửa lead nay BẤM ĐƯỢC, và giá trị gõ vào GIỮ ĐƯỢC.
 *
 * Vế thứ hai mới là chỗ khó. Mở ô ra chỉ mất một dòng; nhưng `syncLeadCourseFromChildren`
 * chạy ở BA chỗ (`addLeadChild` · `updateLeadChild` · `deleteLeadChild`) và bản trước ghi đè
 * VÔ ĐIỀU KIỆN. Không siết nó lại thì Sale gõ đúng, lưu, thấy đã lưu — rồi lần sau ai đó
 * đụng một đứa con là giá trị biến mất, không thông báo, không dấu vết. Một ô mở ra mà không
 * giữ được giá trị còn tệ hơn một ô khoá có giải thích (luật 12).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  conTheoLeadDoi,
  dongBoKhoaTuCon,
  khoaHieuLucCuaBe,
  leadTheoConDoi,
} from "./khoa-quan-tam";

describe("[KHOA-T10] con ĐƯỢC ghi đè khi khoá của lead trông như do con đặt", () => {
  it("lead chưa có khoá ⇒ điền theo con", () => {
    const r = dongBoKhoaTuCon({ khoaLead: null, khoaCacCon: ["kh_a"] });
    expect(r).toEqual({ doiKhoa: true, khoaMoi: "kh_a", vi: "chua-co" });
  });

  it("chuỗi rỗng cũng là chưa có", () => {
    expect(dongBoKhoaTuCon({ khoaLead: "  ", khoaCacCon: ["kh_a"] }).doiKhoa).toBe(true);
  });

  it("khoá của lead = khoá con vừa sửa (bản CŨ) ⇒ cập nhật theo con", () => {
    // Luồng thường: lead đang lấy theo con A, người dùng đổi khoá của A.
    const r = dongBoKhoaTuCon({
      khoaLead: "kh_cu",
      khoaCacCon: ["kh_moi"],
      khoaConTruocKhiSua: "kh_cu",
    });
    expect(r).toEqual({ doiKhoa: true, khoaMoi: "kh_moi", vi: "cua-con-nay" });
  });

  it("⚠️ THIẾU `khoaConTruocKhiSua` thì luồng thường GÃY — nên ca trên phải còn", () => {
    // Cùng dữ liệu, bỏ vế "khoá con trước khi sửa": khoá cũ của lead không khớp con nào
    // nữa ⇒ luật tưởng là người dùng đặt tay và GIỮ NGUYÊN, tức sửa con mà lead không đổi.
    const r = dongBoKhoaTuCon({ khoaLead: "kh_cu", khoaCacCon: ["kh_moi"] });
    expect(r.doiKhoa).toBe(false);
  });

  it("khoá của lead = khoá của MỘT con khác ⇒ vẫn là của đám con, cập nhật", () => {
    const r = dongBoKhoaTuCon({ khoaLead: "kh_b", khoaCacCon: ["kh_a", "kh_b"] });
    expect(r).toEqual({ doiKhoa: true, khoaMoi: "kh_a", vi: "cua-mot-con" });
  });

  it("chọn con ĐẦU danh sách — giữ đúng thứ tự `updatedAt desc` của bản cũ", () => {
    expect(dongBoKhoaTuCon({ khoaLead: null, khoaCacCon: [null, "kh_b", "kh_c"] }).khoaMoi).toBe(
      "kh_b",
    );
  });

  it("không con nào có khoá ⇒ xoá trắng khoá của lead (hành vi cũ)", () => {
    const r = dongBoKhoaTuCon({
      khoaLead: "kh_cu",
      khoaCacCon: [null, null],
      khoaConTruocKhiSua: "kh_cu",
    });
    expect(r).toEqual({ doiKhoa: true, khoaMoi: null, vi: "cua-con-nay" });
  });
});

describe("[KHOA-T11] ⚠️ con KHÔNG được đè giá trị người dùng đặt tay", () => {
  it("khoá của lead khác MỌI con ⇒ GIỮ NGUYÊN", () => {
    // Đây là toàn bộ điểm của bản vá. Không đoán ý ai — chỉ nói: một giá trị không khớp
    // con nào thì không thể do con sinh ra.
    const r = dongBoKhoaTuCon({ khoaLead: "kh_tay", khoaCacCon: ["kh_a", "kh_b"] });
    expect(r.doiKhoa).toBe(false);
    expect(r.vi).toBe("nguoi-dung-dat-tay");
  });

  it("giữ nguyên kể cả khi con vừa sửa có khoá mới", () => {
    const r = dongBoKhoaTuCon({
      khoaLead: "kh_tay",
      khoaCacCon: ["kh_moi"],
      khoaConTruocKhiSua: "kh_khac",
    });
    expect(r.doiKhoa).toBe(false);
  });

  it("giữ nguyên kể cả khi KHÔNG con nào có khoá", () => {
    // Xoá khoá của con cuối cùng không được kéo theo khoá người dùng tự đặt cho lead.
    const r = dongBoKhoaTuCon({ khoaLead: "kh_tay", khoaCacCon: [null] });
    expect(r.doiKhoa).toBe(false);
    expect(r.khoaMoi).toBe("kh_tay");
  });

  it("lead không có con nào ⇒ cũng giữ nguyên", () => {
    expect(dongBoKhoaTuCon({ khoaLead: "kh_tay", khoaCacCon: [] }).doiKhoa).toBe(false);
  });

  it("khoảng trắng hai đầu không làm lệch phép so", () => {
    const r = dongBoKhoaTuCon({ khoaLead: " kh_a ", khoaCacCon: ["kh_a", "kh_b"] });
    expect(r.doiKhoa).toBe(true);
  });
});

describe("[KHOA-T12] ⚠️ luật này phải được NỐI, và ô phải THẬT SỰ mở", () => {
  const doc = (p: string) => {
    const duong = path.join(process.cwd(), p);
    expect(fs.existsSync(duong), `${duong} không còn ở chỗ cũ`).toBe(true);
    return fs.readFileSync(duong, "utf8");
  };
  const goChuThich = (s: string) =>
    s
      .split("\n")
      .filter((d) => {
        const t = d.trim();
        return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
      })
      .join("\n");

  const ACTIONS = goChuThich(doc("app/(admin)/admin/leads/actions.ts"));
  const FORM = goChuThich(doc("app/(admin)/admin/leads/_components/lead-form.tsx"));

  it("phép quét tự kiểm: bộ gỡ chú thích không ăn lem vào mã", () => {
    const tho = doc("app/(admin)/admin/leads/actions.ts");
    expect(ACTIONS.length / tho.length).toBeGreaterThan(0.3);
    expect(FORM.length).toBeGreaterThan(1000);
  });

  it("⚠️ ô Khoá quan tâm KHÔNG còn bị `disabled` theo `courseFromChildren`", () => {
    // Nếu không có ca này, ai đó "dọn dẹp" trả lại `disabled` là quay về đúng màn hình chủ
    // dự án đã chụp, và bộ test vẫn xanh vì luật thuần chẳng liên quan gì tới cái ô.
    expect(FORM).not.toContain("disabled={courseFromChildren}");
  });

  it("đường đồng bộ đi qua luật thuần, không tự ghép tay", () => {
    // 26/09/2026 — phép đồng bộ dời sang `lib/lead/khoa-quan-tam-con.ts` vì màn lớp trial
    // cũng ghi khoá quan tâm của con. Lưới neo vào nơi nó SỐNG, không vào chỗ cũ.
    const DONG_BO = goChuThich(doc("lib/lead/khoa-quan-tam-con.ts"));
    expect(DONG_BO).toContain("dongBoKhoaTuCon(");
    // Và phải TÔN TRỌNG quyết định — gọi hàm rồi ghi bừa thì gọi để làm gì.
    expect(DONG_BO).toContain("if (!quyet.doiKhoa) return");
    // Màn lead phải dùng ĐÚNG bản đó — tự định nghĩa lại một bản riêng là hai luật đồng
    // bộ cho một cột, đúng lỗi mà tệp luật này sinh ra để chặn.
    expect(ACTIONS).toContain("from '@/lib/lead/khoa-quan-tam-con'");
    expect(ACTIONS).not.toMatch(/function syncLeadCourseFromChildren\s*\(/);
  });

  it("⚠️ hai chỗ biết khoá con TRƯỚC lượt sửa phải TRUYỀN nó xuống", () => {
    // Quên truyền ⇒ luồng thường gãy (xem [KHOA-T10]): sửa khoá của con mà lead không đổi
    // theo. Đây là kiểu hỏng im lặng — không lỗi, không cảnh báo, chỉ sai số.
    // 26/09 — đường SỬA con nay đi qua `khoaConDaDoi` và truyền giá trị cũ ở `khoaConCu`;
    // đường GỠ con vẫn truyền thẳng cho `syncLeadCourseFromChildren`.
    expect((ACTIONS.match(/child\.leadId, child\.interestedCourseId/g) ?? []).length).toBe(1);
    expect((ACTIONS.match(/khoaConCu: child\.interestedCourseId/g) ?? []).length).toBe(1);
  });
});

describe("[KHOA-2C] đồng bộ hai chiều (chốt 26/09/2026)", () => {
  it("[KHOA-2C-01] khoá bé ĐỔI sang khoá mới ⇒ lead nhận đúng khoá đó", () => {
    expect(leadTheoConDoi({ khoaConCu: null, khoaConMoi: "sata2" })).toEqual({ ghi: true, khoa: "sata2" });
    expect(leadTheoConDoi({ khoaConCu: "sata1", khoaConMoi: "sata3" })).toEqual({ ghi: true, khoa: "sata3" });
  });

  it("[KHOA-2C-02] Lưu mà khoá bé KHÔNG đổi ⇒ không đụng lead (sửa tên bé không đè khoá)", () => {
    expect(leadTheoConDoi({ khoaConCu: "sata2", khoaConMoi: "sata2" })).toEqual({ ghi: false });
    expect(leadTheoConDoi({ khoaConCu: "sata2", khoaConMoi: " sata2 " })).toEqual({ ghi: false });
  });

  it("[KHOA-2C-03] gỡ trắng khoá bé ⇒ hàm này không ghi (bên gọi tính lại theo luật cũ)", () => {
    expect(leadTheoConDoi({ khoaConCu: "sata2", khoaConMoi: null })).toEqual({ ghi: false });
  });

  it("[KHOA-2C-04] lead đổi khoá ⇒ bé trống + bé mang khoá cũ của lead đổi theo; bé khoá khác GIỮ", () => {
    expect(
      conTheoLeadDoi({
        khoaLeadCu: "sata1",
        khoaLeadMoi: "sata2",
        con: [
          { id: "trong", khoa: null },
          { id: "theo-lead", khoa: "sata1" },
          { id: "rieng", khoa: "combo" },
          { id: "da-dung", khoa: "sata2" },
        ],
      }),
    ).toEqual(["trong", "theo-lead"]);
  });

  it("[KHOA-2C-05] lead một con, đổi khoá ⇒ bé đổi theo (ca phổ biến nhất)", () => {
    expect(
      conTheoLeadDoi({ khoaLeadCu: null, khoaLeadMoi: "sata4", con: [{ id: "c", khoa: null }] }),
    ).toEqual(["c"]);
  });

  it("[KHOA-2C-06] gỡ trắng khoá lead, hoặc Lưu không đổi ⇒ KHÔNG bé nào đổi", () => {
    const con = [{ id: "c", khoa: "sata1" }];
    expect(conTheoLeadDoi({ khoaLeadCu: "sata1", khoaLeadMoi: null, con })).toEqual([]);
    expect(conTheoLeadDoi({ khoaLeadCu: "sata1", khoaLeadMoi: "sata1", con })).toEqual([]);
  });
});

describe("[KHOA-HL] khoá hiệu lực của bé", () => {
  it("[KHOA-HL-01] bé có khoá riêng ⇒ khoá của bé thắng khoá của lead", () => {
    expect(khoaHieuLucCuaBe({ interestedCourseId: "sata2", lead: { courseId: "sata5" } })).toBe("sata2");
  });
  it("[KHOA-HL-02] bé trống ⇒ lấy khoá quan tâm của lead", () => {
    expect(khoaHieuLucCuaBe({ interestedCourseId: null, lead: { courseId: "sata5" } })).toBe("sata5");
    expect(khoaHieuLucCuaBe({ interestedCourseId: "  ", lead: { courseId: "sata5" } })).toBe("sata5");
  });
  it("[KHOA-HL-03] cả hai trống ⇒ null (màn in \"Chưa chọn khoá\")", () => {
    expect(khoaHieuLucCuaBe({ interestedCourseId: null, lead: { courseId: null } })).toBeNull();
    expect(khoaHieuLucCuaBe({ interestedCourseId: null, lead: null })).toBeNull();
  });
});

describe("[KHOA-2C-W] dây nối của đồng bộ hai chiều (26/09)", () => {
  const doc = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  const bo = (s: string) =>
    s
      .split("\n")
      .filter((d) => {
        const t = d.trim();
        return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
      })
      .join("\n");

  it("[KHOA-2C-W1] sửa khoá LEAD dội xuống bé — `khoaLeadDaDoi` gọi TRONG giao dịch của updateLead", () => {
    const a = bo(doc("app/(admin)/admin/leads/actions.ts"));
    const dau = a.indexOf("await db.$transaction(async (txRaw) => {", a.indexOf("updateLeadFieldsSchema.safeParse"));
    expect(dau).toBeGreaterThan(-1);
    const khoiTx = a.slice(dau, a.indexOf("\n    })", dau));
    expect(khoiTx).toContain("khoaLeadDaDoi(tx");
  });

  it("[KHOA-2C-W2] site GV + màn trial phía Sale đọc KHOÁ HIỆU LỰC, không đọc thẳng cột của bé", () => {
    for (const f of ["lib/lms/teacher-schedule.ts", "lib/trial/sale-roster.ts"]) {
      const s = bo(doc(f));
      expect(s, `${f} còn đọc thẳng interestedCourseId`).not.toMatch(/leadChild\.interestedCourseId/);
      expect(s, `${f} không gọi khoaHieuLucCuaBe`).toContain("khoaHieuLucCuaBe(");
    }
  });
});
