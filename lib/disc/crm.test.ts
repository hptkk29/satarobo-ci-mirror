import { describe, expect, it, vi } from "vitest";
import { dungLeadMoiDisc, eventIdCuaBai, maLoiAnToan, taoCongCrm, taoGhiReferralSauNhan, taoXacNhanTiepThi, tachTokenTuCookie, tenChienDichAnToan, type CrmPorts, type ReferralSauNhanPorts, type TiepThiPorts } from "./crm";

// Dữ liệu GIẢ. Điểm/năm sinh xuất hiện trong đầu vào giả để chứng minh chúng KHÔNG lọt ra ngoài.
const D = {
  submissionId: "sub1",
  soDienThoai: "84905000111",
  tenPhuHuynh: "Phụ Huynh Giả",
  email: "gia@example.invalid",
  tenCon: "Bé Giả",
  tiepThi: false,
  chienDich: "DISC",
  diaChi: { thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: "12 Lê Duẩn", coSoGanNha: "CS2" },
};

function taoPorts(o: { leadTheoEvent?: string | null; trung?: string | null } = {}) {
  const goi: string[] = [];
  const leadMoi = vi.fn(async (_p: unknown) => ({ leadId: "lead-moi", centerId: null as string | null }));
  const chuanBi = vi.fn(async (_p: unknown) => ({ nguon: "n" }));
  const ghiTrung = vi.fn(async (_p: unknown) => {});
  const ports: CrmPorts<{ nguon: string }> = {
    timLeadTheoEventId: async () => (o.leadTheoEvent ? { id: o.leadTheoEvent } : null),
    timLeadTrung: async () => (o.trung ? { id: o.trung } : null),
    chuanBi: async (p) => (goi.push("chuanBi"), chuanBi(p)),
    taoLeadMoi: async (p) => (goi.push("taoLeadMoi"), leadMoi(p)),
    ghiLeadTrung: async (p) => (goi.push("ghiLeadTrung"), ghiTrung(p)),
    hoanTatLeadMoi: async () => void goi.push("hoanTat"),
    datLeadChoBai: async (s, l) => void goi.push(`dat:${s}:${l}`),
  };
  return { ports, goi, leadMoi, chuanBi, ghiTrung };
}

describe("[DISC-CRM-01] một bài = tối đa một lead (idempotent)", () => {
  it("gọi lần đầu tạo lead; eventId theo bài", async () => {
    const t = taoPorts();
    expect(await taoCongCrm(t.ports)(D)).toEqual({ leadId: "lead-moi" });
    expect(t.leadMoi.mock.calls[0]![0]).toMatchObject({ eventId: eventIdCuaBai("sub1") });
    expect(t.goi).toEqual(["chuanBi", "taoLeadMoi", "dat:sub1:lead-moi", "hoanTat"]);
  });
  it("đã có lead cho eventId này ⇒ không tạo, không tra nguồn, không ghi gì thêm", async () => {
    const t = taoPorts({ leadTheoEvent: "lead-cu" });
    expect(await taoCongCrm(t.ports)(D)).toEqual({ leadId: "lead-cu" });
    expect(t.goi).toEqual(["dat:sub1:lead-cu"]);
  });
});

describe("[DISC-CRM-02] SĐT đã có lead ⇒ không tạo lead, không đổi nguồn", () => {
  it("chỉ ghi dấu vết lên lead cũ", async () => {
    const t = taoPorts({ trung: "lead-cu" });
    expect(await taoCongCrm(t.ports)(D)).toEqual({ leadId: "lead-cu" });
    expect(t.goi).toContain("ghiLeadTrung");
    expect(t.goi).not.toContain("taoLeadMoi");
    expect(t.goi).not.toContain("hoanTat");
    expect(t.ghiTrung.mock.calls[0]![0]).toMatchObject({ leadId: "lead-cu", nhan: "disc" });
  });
});

describe("[DISC-CRM-03] mã giới thiệu chỉ từ cookie phía server", () => {
  it("N4: LÚC LƯU cổng chuẩn bị KHÔNG nhận cookie giới thiệu lẫn email (chưa có gì xác thực chủ số)", async () => {
    const t = taoPorts();
    await taoCongCrm(t.ports)(D);
    const p = t.chuanBi.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(["eventId", "phone"]);
    expect(p.eventId).toBe("disc:sub1");
    expect(JSON.stringify(t.leadMoi.mock.calls[0]![0])).not.toContain("gia@example.invalid"); // email chưa xác minh không vào lead
    expect((t.leadMoi.mock.calls[0]![0] as { data: { email: unknown } }).data.email).toBeNull();
  });
  it("tachTokenTuCookie", () => {
    expect(tachTokenTuCookie("ABC123.1700000000000")).toBe("ABC123");
    expect(tachTokenTuCookie("ABC123")).toBe("ABC123");
    expect(tachTokenTuCookie("")).toBeNull();
    expect(tachTokenTuCookie(null)).toBeNull();
    expect(tachTokenTuCookie("x".repeat(200))).toBeNull();
  });
  it("đầu vào CongCrm KHÔNG có chỗ cho sourceId/commissionRate/ownerId — thêm trường lạ cũng không đi tiếp", async () => {
    const t = taoPorts();
    await taoCongCrm(t.ports)({ ...D, sourceId: "x", commissionRate: 0.5, ownerId: "y" } as typeof D);
    expect(JSON.stringify(t.leadMoi.mock.calls[0]![0])).not.toMatch(/sourceId|commissionRate|ownerId/);
  });
});

describe("[DISC-CRM-04] đồng ý tiếp thị: lúc tạo lead LUÔN false (người gõ SĐT ≠ chủ SĐT)", () => {
  it("dù khách tích true, lead mới vẫn false — chỉ luồng nhận sau OTP mới bật", () => {
    expect(dungLeadMoiDisc({ ...D, tiepThi: false }).consentMarketing).toBe(false);
    expect(dungLeadMoiDisc({ ...D, tiepThi: true }).consentMarketing).toBe(false);
    expect(dungLeadMoiDisc({ ...D, tiepThi: "true" as unknown as boolean }).consentMarketing).toBe(false);
    expect(dungLeadMoiDisc({ ...D, tiepThi: undefined as unknown as boolean }).consentMarketing).toBe(false);
  });
  it("đi qua taoCongCrm: dữ liệu đưa vào cổng taoLeadMoi mang consentMarketing=false dù tiepThi=true", async () => {
    const t = taoPorts();
    await taoCongCrm(t.ports)({ ...D, tiepThi: true });
    expect((t.leadMoi.mock.calls[0]![0] as { data: { consentMarketing: boolean } }).data.consentMarketing).toBe(false);
  });
});

describe("[DISC-CRM-04b] sau khi chủ số xác thực mới bật đồng ý tiếp thị", () => {
  const SDT = "84905000111";
  function taoTiepThi(bai: { consentMarketing: boolean; leadId: string | null } | null, datOk = true) {
    const dat = vi.fn(async (_l: string, _s: string, _r: { chiLeadCuaBai?: string }) => datOk);
    const ports: TiepThiPorts = { docBai: async () => bai, datTiepThiChoLead: dat };
    return { fn: taoXacNhanTiepThi(ports), dat };
  }
  it("bài có ô tích + có lead + đúng SĐT ⇒ bật, nhưng CHỈ lead do chính bài này tạo (ràng eventId) — N7", async () => {
    const t = taoTiepThi({ consentMarketing: true, leadId: "lead-1" });
    expect(await t.fn({ submissionId: "sub1", sdtChuan: SDT })).toBe("DA_BAT");
    expect(t.dat).toHaveBeenCalledWith("lead-1", SDT, { chiLeadCuaBai: "disc:sub1" });
  });
  it("N7: chủ số TỰ tích ở form nhận ⇒ đồng ý của chính họ, không ràng eventId; có tích mà bài không tích vẫn bật", async () => {
    const t = taoTiepThi({ consentMarketing: false, leadId: "lead-1" });
    expect(await t.fn({ submissionId: "sub1", sdtChuan: SDT, chuSoDongY: true })).toBe("DA_BAT");
    expect(t.dat).toHaveBeenCalledWith("lead-1", SDT, {});
    // đối chứng: chuSoDongY false/không khai + bài không tích ⇒ không bật gì
    const k = taoTiepThi({ consentMarketing: false, leadId: "lead-1" });
    expect(await k.fn({ submissionId: "sub1", sdtChuan: SDT, chuSoDongY: false })).toBe("KHONG_DOI");
    expect(await k.fn({ submissionId: "sub1", sdtChuan: SDT })).toBe("KHONG_DOI");
    expect(k.dat).not.toHaveBeenCalled();
  });
  it("đối chứng: bài KHÔNG tích · chưa có lead · bài lạ ⇒ không bật gì", async () => {
    for (const bai of [{ consentMarketing: false, leadId: "lead-1" }, { consentMarketing: true, leadId: null }, null]) {
      const t = taoTiepThi(bai);
      expect(await t.fn({ submissionId: "sub1", sdtChuan: SDT })).toBe("KHONG_DOI");
      expect(t.dat).not.toHaveBeenCalled();
    }
  });
  it("SĐT không phải dạng chuẩn hoá (vd chuỗi HMAC) ⇒ không bật", async () => {
    const t = taoTiepThi({ consentMarketing: true, leadId: "lead-1" });
    expect(await t.fn({ submissionId: "sub1", sdtChuan: "a".repeat(64) })).toBe("KHONG_DOI");
    expect(await t.fn({ submissionId: "sub1", sdtChuan: "0905000111" })).toBe("KHONG_DOI");
    expect(t.dat).not.toHaveBeenCalled();
  });
  it("cổng ghi từ chối (lead khác SĐT / đã bật) ⇒ KHONG_DOI; lỗi hạ tầng không ném", async () => {
    expect(await taoTiepThi({ consentMarketing: true, leadId: "lead-1" }, false).fn({ submissionId: "s", sdtChuan: SDT })).toBe("KHONG_DOI");
    const hong = taoXacNhanTiepThi({
      docBai: async () => {
        throw new Error("db down");
      },
      datTiepThiChoLead: async () => true,
    });
    expect(await hong({ submissionId: "s", sdtChuan: SDT })).toBe("KHONG_DOI");
  });
});

describe("[DISC-CRM-05] lưới PII: không điểm/câu trả lời/năm sinh trẻ vào lead", () => {
  it("danh sách trường của lead được GHIM", () => {
    const lead = dungLeadMoiDisc({
      ...D,
      // các trường nguy hiểm lọt vào đầu vào nhưng không được đi ra
      ...({ diem: { D: 90, I: 10, S: 5, C: 1 }, namSinh: 2015, ketQua: "GIA-NHOM-D", cauTraLoi: [1, 2, 3] } as object),
    });
    // Bốn khoá địa chỉ (05/11/2026) là địa chỉ nơi ở của PHỤ HUYNH — cố ý thêm để chia lead về cơ sở gần nhà; KHÔNG phải dữ liệu của con.
    expect(Object.keys(lead).sort()).toEqual(
      ["addressLine", "city", "consentMarketing", "coSoMongMuon", "email", "landingPage", "note", "parentName", "phone", "source", "ward"].sort(),
    );
    const s = JSON.stringify(lead);
    expect(s).not.toMatch(/2015|GIA-NHOM|cauTraLoi|namSinh|diem/);
  });
  it("F-13: TÊN CON không vào lead, ghi chú, và không đi qua bất kỳ cổng CRM nào", async () => {
    const lead = dungLeadMoiDisc(D);
    expect(JSON.stringify(lead)).not.toContain(D.tenCon);
    expect(Object.keys(lead)).not.toContain("childName");
    const t = taoPorts({ trung: undefined });
    await taoCongCrm(t.ports)(D);
    const tatCa = JSON.stringify([t.leadMoi.mock.calls, t.chuanBi.mock.calls, t.ghiTrung.mock.calls]);
    expect(tatCa).not.toContain(D.tenCon);
    const t2 = taoPorts({ trung: "lead-cu" });
    await taoCongCrm(t2.ports)(D);
    expect(JSON.stringify([t2.chuanBi.mock.calls, t2.ghiTrung.mock.calls])).not.toContain(D.tenCon);
  });
  it("ghi chú chỉ nói đã làm bài + tên chiến dịch đã lọc", () => {
    expect(dungLeadMoiDisc(D).note).toBe("Làm bài DISC (chiến dịch DISC).");
    expect(tenChienDichAnToan("QC_T11-A")).toBe("QC_T11-A");
    expect(tenChienDichAnToan("điểm 90 năm sinh 2015")).toBe("DISC");
    expect(dungLeadMoiDisc({ ...D, chienDich: "<script>" }).note).toBe("Làm bài DISC (chiến dịch DISC).");
  });
  it("địa chỉ: đi vào lead đúng ô; không khai (bản máy khách cũ) ⇒ bốn ô đều null", () => {
    const co = dungLeadMoiDisc(D);
    expect([co.city, co.ward, co.addressLine, co.coSoMongMuon]).toEqual(["Tp Đà Nẵng", "Phường Hải Châu", "12 Lê Duẩn", "CS2"]);
    const khong = dungLeadMoiDisc({ ...D, diaChi: null });
    expect([khong.city, khong.ward, khong.addressLine, khong.coSoMongMuon]).toEqual([null, null, null, null]);
  });
  it("DISC không phải nguồn mới: Lead.source cố định là khoá định tuyến cũ 'web', không có utm", () => {
    const lead = dungLeadMoiDisc(D);
    expect(lead.source).toBe("web");
    expect(Object.keys(lead).some((k) => k.startsWith("utm"))).toBe(false);
  });
});

describe("[DISC-CRM-06] lỗi hoàn tất không làm mất lead", () => {
  it("hoanTatLeadMoi ném ⇒ vẫn trả leadId", async () => {
    const t = taoPorts();
    t.ports.hoanTatLeadMoi = async () => {
      throw new Error("chia lead lỗi");
    };
    expect(await taoCongCrm(t.ports)(D)).toEqual({ leadId: "lead-moi" });
  });
});

describe("[DISC-CRM-08] SĐT vào lead phải là SĐT chuẩn hoá thô — không bao giờ chuỗi băm (D2)", () => {
  it("soDienThoai dạng HMAC/hex hoặc dạng 0… ⇒ không tạo lead, không chạm cổng nào", async () => {
    for (const soDienThoai of ["a".repeat(64), "0905000111", "", "84905000111x"]) {
      const t = taoPorts();
      expect(await taoCongCrm(t.ports)({ ...D, soDienThoai })).toEqual({ leadId: null });
      expect(t.goi).toEqual([]);
    }
  });
  it("đối chứng dương: SĐT chuẩn hoá vẫn tạo lead", async () => {
    const t = taoPorts();
    expect(await taoCongCrm(t.ports)(D)).toEqual({ leadId: "lead-moi" });
  });
});

describe("[DISC-CRM-09] maLoiAnToan — mã lỗi, không bao giờ nội dung", () => {
  it("lấy code/name; thông điệp chứa SĐT không lọt", () => {
    const e = Object.assign(new Error("Unique constraint failed on phone 84905000111"), { code: "P2002" });
    expect(maLoiAnToan(e)).toBe("P2002");
    expect(maLoiAnToan(new TypeError("84905000111"))).toBe("TypeError");
    for (const x of [null, undefined, "84905000111", 42, { code: "có dấu cách 0905" }, { name: "x y" }]) {
      expect(maLoiAnToan(x)).toBe("UNKNOWN");
    }
    expect(maLoiAnToan(e)).not.toMatch(/\d{9}/);
  });
});

describe("[DISC-CRM-10] N4/M-2: referral CHỈ ghi sau khi chủ số xác thực, bằng cookie của người đang nhận", () => {
  const SDT = "84905000111";
  type G = { ghi: string };
  function tao(o: { cookie?: string | null; lead?: { leadId: string; centerId: string | null; doBaiTao: boolean } | null; chuanBiOk?: boolean } = {}) {
    const moi = vi.fn(async (_p: unknown) => {});
    const cu = vi.fn(async (_p: unknown) => {});
    const chuanBi = vi.fn(async (_p: { token: string; phone: string; eventId: string }): Promise<G | null> => (o.chuanBiOk === false ? null : { ghi: "g" }));
    const ports: ReferralSauNhanPorts<G> = {
      docRefCookie: async () => (o.cookie === undefined ? "TOKEN1.1700000000000" : o.cookie),
      docLeadCuaBai: async () => (o.lead === undefined ? { leadId: "lead-1", centerId: "cs1", doBaiTao: true } : o.lead),
      chuanBi,
      ghiChoLeadMoi: moi,
      ghiChoLeadCu: cu,
    };
    return { fn: taoGhiReferralSauNhan(ports), moi, cu, chuanBi };
  }
  it("lead do bài tạo ⇒ ghi kiểu lead mới; SĐT truyền vào là SĐT chủ số, KHÔNG có email", async () => {
    const t = tao();
    expect(await t.fn({ submissionId: "sub1", sdtChuan: SDT })).toBe("DA_GHI");
    expect(t.chuanBi.mock.calls[0]![0]).toEqual({ token: "TOKEN1", phone: SDT, eventId: "disc:sub1" });
    expect(t.moi).toHaveBeenCalledWith({ ghi: { ghi: "g" }, leadId: "lead-1", centerId: "cs1" });
    expect(t.cu).not.toHaveBeenCalled();
  });
  it("lead có sẵn (không phải bài này tạo) ⇒ ghi kiểu lead cũ, không đổi nguồn lead", async () => {
    const t = tao({ lead: { leadId: "lead-cu", centerId: null, doBaiTao: false } });
    expect(await t.fn({ submissionId: "sub1", sdtChuan: SDT })).toBe("DA_GHI");
    expect(t.cu).toHaveBeenCalledWith({ ghi: { ghi: "g" }, leadId: "lead-cu" });
    expect(t.moi).not.toHaveBeenCalled();
  });
  it("đối chứng: không cookie · token hỏng · chưa có lead · SĐT không chuẩn · chuẩn bị trả null ⇒ không ghi gì", async () => {
    for (const o of [{ cookie: null }, { cookie: "x".repeat(200) }, { lead: null }, { chuanBiOk: false }]) {
      const t = tao(o);
      expect(await t.fn({ submissionId: "sub1", sdtChuan: SDT })).toBe("KHONG_DOI");
      expect(t.moi).not.toHaveBeenCalled();
      expect(t.cu).not.toHaveBeenCalled();
    }
    const t = tao();
    expect(await t.fn({ submissionId: "sub1", sdtChuan: "0905000111" })).toBe("KHONG_DOI");
    expect(t.chuanBi).not.toHaveBeenCalled();
  });
  it("lỗi hạ tầng không ném", async () => {
    const fn = taoGhiReferralSauNhan<G>({
      docRefCookie: async () => {
        throw new Error("x");
      },
      docLeadCuaBai: async () => null,
      chuanBi: async () => null,
      ghiChoLeadMoi: async () => {},
      ghiChoLeadCu: async () => {},
    });
    expect(await fn({ submissionId: "s", sdtChuan: SDT })).toBe("KHONG_DOI");
  });
});
