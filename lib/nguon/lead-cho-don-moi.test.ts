// lib/nguon/lead-cho-don-moi.test.ts — [LCD-*] luật nối `Order.leadId` cho đơn MỚI (PR0b, doc 03 §5.4). Thuần: client giả trong bộ nhớ.
import { describe, expect, it } from "vitest";
import { leadChoDonMoi, type DocLead } from "@/lib/nguon/lead-cho-don-moi";

type L = { id: string; phone: string; centerId: string | null; deletedAt: Date | null; convertedAt: Date | null };
type S = { id: string; leadId: string | null };

/** Client giả: hiểu đúng hai dạng `where` mà `leadChoDonMoi` dùng (KHÔNG lọc cơ sở ở đây — đó là việc của hàm đang test). */
function gia(leads: L[], students: S[] = []): DocLead {
  return {
    student: {
      findMany: async (a: { where: { id: { in: string[] } } }) =>
        students.filter((s) => a.where.id.in.includes(s.id)).map((s) => ({ leadId: s.leadId })),
    },
    lead: {
      findMany: async (a: { where: { id?: { in: string[] }; phone?: { in: string[] }; deletedAt: null; convertedAt?: { not: null } } }) =>
        leads
          .filter((l) => l.deletedAt === null)
          .filter((l) => (a.where.id ? a.where.id.in.includes(l.id) : true))
          .filter((l) => (a.where.convertedAt ? l.convertedAt !== null : true))
          .filter((l) => (a.where.phone ? a.where.phone.in.includes(l.phone) : true))
          .map((l) => ({ id: l.id, phone: l.phone, centerId: l.centerId })),
    },
  } as unknown as DocLead;
}
const lead = (id: string, phone: string, o: Partial<L> = {}): L => ({ id, phone, centerId: "C1", deletedAt: null, convertedAt: new Date(), ...o });
const CS = "C1";

describe("[LCD] leadChoDonMoi — luật D8 siết cho đơn mới", () => {
  it("[LCD-01] đơn CÓ học viên, học viên có Student.leadId còn sống ⇒ MOT theo HOC_VIEN, KỂ CẢ khi SĐT khớp một lead khác", async () => {
    const c = gia([lead("L-hv", "0900000001"), lead("L-sdt", "0911111111")], [{ id: "S1", leadId: "L-hv" }]);
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: ["S1"], phamVi: { coSo: CS } })).toEqual({ loai: "MOT", leadId: "L-hv", nguon: "HOC_VIEN" });
  });

  it("[LCD-02] đơn CÓ học viên mà Student.leadId trỏ lead ĐÃ XOÁ ⇒ KHONG — KHÔNG lùi về SĐT dù SĐT khớp một lead sống", async () => {
    const c = gia([lead("L-cu", "0900000001", { deletedAt: new Date() }), lead("L-sdt", "0911111111")], [{ id: "S1", leadId: "L-cu" }]);
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: ["S1"], phamVi: { coSo: CS } })).toEqual({ loai: "KHONG", lyDo: "HOC_VIEN_CHUA_NOI_LEAD" });
  });

  it("[LCD-03] đơn KHÔNG học viên (khách lẻ): lead lưu `0…`, đơn khai `+84…` ⇒ vẫn khớp đúng MỘT lead", async () => {
    const c = gia([lead("L1", "0911111111")]);
    expect(await leadChoDonMoi(c, { customerPhone: "+84 911 111 111", hocVienIds: [], phamVi: { coSo: CS } })).toEqual({ loai: "MOT", leadId: "L1", nguon: "SDT" });
  });

  it("[LCD-04] khách lẻ: HAI lead khác nhau cùng SĐT ⇒ NHIEU, KHÔNG có leadId để gắn", async () => {
    const c = gia([lead("L1", "0911111111"), lead("L2", "84911111111")]);
    const r = await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: [], phamVi: { coSo: CS } });
    expect(r.loai).toBe("NHIEU");
    expect("leadId" in r).toBe(false);
    if (r.loai === "NHIEU") expect(r.leadIds).toEqual(["L1", "L2"]);
  });

  it("[LCD-05] hai học viên trên đơn thuộc hai lead khác nhau ⇒ NHIEU theo HOC_VIEN", async () => {
    const c = gia([lead("L1", "0900000001"), lead("L2", "0900000002")], [
      { id: "S1", leadId: "L1" },
      { id: "S2", leadId: "L2" },
    ]);
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: ["S1", "S2"], phamVi: { coSo: CS } })).toMatchObject({ loai: "NHIEU", nguon: "HOC_VIEN" });
  });

  it("[LCD-06] SĐT không chuẩn hoá được (rỗng / số cố định) ⇒ KHONG, KHÔNG lùi về so chuỗi thô", async () => {
    const c = gia([lead("L-bàn", "02363123456")]);
    for (const sdt of ["02363123456", "", null]) {
      expect(await leadChoDonMoi(c, { customerPhone: sdt, hocVienIds: [], phamVi: { coSo: CS } })).toEqual({ loai: "KHONG", lyDo: "SDT_KHONG_CHUAN_HOA" });
    }
  });

  it("[LCD-07] khách lẻ không có lead nào (hoặc chỉ lead đã xoá) ⇒ KHONG KHONG_CO_LEAD", async () => {
    const c = gia([lead("L-xoa", "0911111111", { deletedAt: new Date() })]);
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: [], phamVi: { coSo: CS } })).toEqual({ loai: "KHONG", lyDo: "KHONG_CO_LEAD" });
  });

  it("[LCD-08] CÁCH LY CƠ SỞ: lead của cơ sở KHÁC không được xét ở cả hai đường; lead chưa có cơ sở thì được xét; đơn chưa có cơ sở (null) thì không có gì để cách ly", async () => {
    const c = gia([lead("L-khac", "0911111111", { centerId: "C2" }), lead("L-hv-khac", "0900000001", { centerId: "C2" }), lead("L-chua", "0922222222", { centerId: null })], [{ id: "S1", leadId: "L-hv-khac" }]);
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: [], phamVi: { coSo: CS } })).toEqual({ loai: "KHONG", lyDo: "KHONG_CO_LEAD" });
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: ["S1"], phamVi: { coSo: CS } })).toEqual({ loai: "KHONG", lyDo: "HOC_VIEN_CHUA_NOI_LEAD" });
    expect(await leadChoDonMoi(c, { customerPhone: "0922222222", hocVienIds: [], phamVi: { coSo: CS } })).toMatchObject({ loai: "MOT", leadId: "L-chua" }); // đối chứng dương
    // Đơn KHÔNG khai cơ sở: FAIL-CLOSED — chỉ lead chưa có cơ sở; chỉ người nhìn thấy MỌI cơ sở mới không bị cách ly.
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: [], phamVi: { coSo: null } })).toEqual({ loai: "KHONG", lyDo: "KHONG_CO_LEAD" });
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: ["S1"], phamVi: { coSo: null } })).toEqual({ loai: "KHONG", lyDo: "HOC_VIEN_CHUA_NOI_LEAD" });
    expect(await leadChoDonMoi(c, { customerPhone: "0922222222", hocVienIds: [], phamVi: { coSo: null } })).toMatchObject({ loai: "MOT", leadId: "L-chua" }); // đối chứng dương: lead chưa có cơ sở
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: [], phamVi: "TAT_CA" })).toMatchObject({ loai: "MOT", leadId: "L-khac" });
    expect(await leadChoDonMoi(c, { customerPhone: "0900000009", hocVienIds: ["S1"], phamVi: "TAT_CA" })).toMatchObject({ loai: "MOT", leadId: "L-hv-khac" });
  });

  it("[LCD-09] CA LỖI HIGH CỦA REVIEW ĐỘC LẬP: đơn CÓ học viên chưa có Student.leadId mà SĐT phụ huynh khớp một lead (bé C, cùng phụ huynh) ⇒ KHONG, KHÔNG nối theo SĐT", async () => {
    const c = gia([lead("L-be-C", "0911111111")], [{ id: "S-B", leadId: null }]);
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: ["S-B"], phamVi: { coSo: CS } })).toEqual({ loai: "KHONG", lyDo: "HOC_VIEN_CHUA_NOI_LEAD" });
  });

  it("[LCD-11] Student.leadId trỏ lead CHƯA CONVERT ⇒ KHONG (convert sau đó sẽ gom khoản của học viên này về ghi danh của bé khác); đối chứng: cùng lead đã convert ⇒ MOT", async () => {
    const c = gia([lead("L-chua-convert", "0900000001", { convertedAt: null }), lead("L-da-convert", "0900000002")], [{ id: "S-B", leadId: "L-chua-convert" }, { id: "S-C", leadId: "L-da-convert" }]);
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: ["S-B"], phamVi: { coSo: CS } })).toEqual({ loai: "KHONG", lyDo: "HOC_VIEN_CHUA_NOI_LEAD" });
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: ["S-C"], phamVi: { coSo: CS } })).toEqual({ loai: "MOT", leadId: "L-da-convert", nguon: "HOC_VIEN" });
  });

  it("[LCD-10] id học viên rỗng/khoảng trắng bị bỏ ⇒ coi như đơn KHÔNG học viên (khách lẻ) và đi đường SĐT", async () => {
    const c = gia([lead("L1", "0911111111")]);
    expect(await leadChoDonMoi(c, { customerPhone: "0911111111", hocVienIds: [" ", ""], phamVi: { coSo: CS } })).toMatchObject({ loai: "MOT", leadId: "L1", nguon: "SDT" });
  });
});
