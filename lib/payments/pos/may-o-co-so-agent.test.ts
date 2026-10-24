// [HN2-MP-A01..] — dòng trạng thái POS Agent cạnh mỗi máy ở màn Cơ sở (docs/pos-hai-nut-khai-may.md §2, V34). THUẦN.
//
// LUẬT: một máy chỉ được in "POS Agent: sẵn sàng" khi giao dịch của máy QUY ĐƯỢC về agent đó — tức CÙNG cơ sở, CÙNG merchant
// (`chuanMa`) và máy có `maQuay` (đúng điều kiện `mayKhaiDu` / `phanGiaiMay` đã dùng để gán cơ sở cho dòng agent). Cố ý KHÔNG
// dùng nhánh dự phòng "agent đang bật DUY NHẤT" của `chonAgentChoPhieu`: nhánh đó đúng cho việc CHỌN NGUỒN của phiếu thẻ, nhưng in
// "Đang làm việc" cạnh một máy mà dòng agent gửi về sẽ không quy về nó được là nói dối (ca `[HN2-MP-A05]`).
//
// Luật 19: đồng hồ đóng băng — mọi mốc trong fixture tính từ `NOW` (12:00 giờ VN, 09/10/2026).
import { describe, expect, it } from "vitest";
import { chonAgentChoPhieu } from "./agent/suc-khoe";
import { dongAgentCuaMay, type AgentChoMay, type MayChoDongAgent } from "./may-o-co-so-agent";

const NOW = new Date("2026-10-09T05:00:00Z"); // 12:00 giờ VN
const truoc = (ms: number) => new Date(NOW.getTime() - ms);

const AGENT: AgentChoMay = {
  id: "ag1",
  centerId: "cs1",
  coSo: "CS1",
  merchantCode: "NCCPH6KE",
  active: true,
  sessionState: "READY",
  sessionDoiLuc: null,
  sessionExpiresAt: new Date("2026-10-09T14:30:00Z"), // 21:30 giờ VN — sau mốc 21:00 nên chưa phải việc gấp
  lastHeartbeatAt: truoc(30_000),
  matKetNoiTuLuc: null,
  lastSyncedAt: truoc(60_000),
};

const MAY: MayChoDongAgent = { centerId: "cs1", active: true, maNhaCungCap: "NCCPH6KE", maQuay: "QTT45XWQT" };

describe("[HN2-MP-A01] ghép CHẶT ⇒ in trạng thái đúng của agent đó", () => {
  it("đủ merchant + quầy, cùng cơ sở ⇒ KHOP, nhãn 'Đang làm việc' và hạn phiên", () => {
    expect(dongAgentCuaMay(MAY, [AGENT], NOW)).toEqual({
      kieu: "KHOP",
      agentId: "ag1",
      nhan: "Đang làm việc",
      tone: "success",
      phien: "Sống · hết hạn 21:30",
      phienTone: null,
    });
  });

  it("so mã không phân biệt hoa thường / khoảng trắng đầu cuối (cùng `chuanMa` với phần gán cơ sở)", () => {
    const r = dongAgentCuaMay({ ...MAY, maNhaCungCap: "  ncCph6ke ", maQuay: " qtt45xwqt" }, [AGENT], NOW);
    expect(r).toMatchObject({ kieu: "KHOP", agentId: "ag1" });
  });

  it("phiên sắp hết (trước 21:00 hôm nay) ⇒ `phienTone: warning` — dòng này là thứ 'phiên hết hạn lúc hh:mm' của đặc tả", () => {
    const sapHet = { ...AGENT, sessionExpiresAt: new Date("2026-10-09T13:00:00Z") }; // 20:00 giờ VN
    expect(dongAgentCuaMay(MAY, [sapHet], NOW)).toMatchObject({
      kieu: "KHOP",
      phien: "Sống · hết hạn 20:00",
      phienTone: "warning",
    });
  });
});

describe("[HN2-MP-A02] mỗi trạng thái xấu của agent hiện đúng như màn Sức khoẻ POS Agent (cùng `trangThaiThe`)", () => {
  it("hết phiên ⇒ nhãn 'Hết phiên', tone danger, nói từ lúc nào", () => {
    const het = { ...AGENT, sessionState: "EXPIRED" as const, sessionDoiLuc: new Date("2026-10-09T01:15:00Z") }; // 08:15 giờ VN
    expect(dongAgentCuaMay(MAY, [het], NOW)).toMatchObject({
      kieu: "KHOP",
      nhan: "Hết phiên",
      tone: "danger",
      phien: "Hết phiên · từ 08:15",
      phienTone: "danger",
    });
  });

  it("im quá 3 phút ⇒ 'Mất kết nối', tone danger", () => {
    const mat = { ...AGENT, lastHeartbeatAt: truoc(10 * 60_000), matKetNoiTuLuc: truoc(7 * 60_000) };
    expect(dongAgentCuaMay(MAY, [mat], NOW)).toMatchObject({ kieu: "KHOP", nhan: "Mất kết nối", tone: "danger" });
  });

  it("agent TẮT mà ghép được ⇒ vẫn là KHOP với nhãn 'Đã tắt' (sự thật: thẻ của cơ sở đọc file nhập tay) và KHÔNG in phiên cũ", () => {
    expect(dongAgentCuaMay(MAY, [{ ...AGENT, active: false }], NOW)).toMatchObject({
      kieu: "KHOP",
      nhan: "Đã tắt",
      tone: "muted",
      // Phiên còn lưu của agent đã tắt là dữ liệu cũ: "Sống · hết hạn …" cạnh "Đã tắt" là hai vế nói ngược nhau.
      phien: "",
      phienTone: null,
    });
  });
});

describe("[HN2-MP-A03] máy KHÔNG ghép được ⇒ nói thiếu gì, không im lặng", () => {
  it("thiếu mã nhà cung cấp", () => {
    const r = dongAgentCuaMay({ ...MAY, maNhaCungCap: null }, [AGENT], NOW);
    expect(r).toEqual({ kieu: "CHUA_KHOP", cau: expect.stringContaining("mã nhà cung cấp") });
  });

  it("thiếu mã quầy", () => {
    const r = dongAgentCuaMay({ ...MAY, maQuay: "  " }, [AGENT], NOW);
    expect(r).toEqual({ kieu: "CHUA_KHOP", cau: expect.stringContaining("mã quầy") });
    expect(r).not.toEqual({ kieu: "CHUA_KHOP", cau: expect.stringContaining("mã nhà cung cấp") });
  });

  it("thiếu cả hai ⇒ nêu cả hai", () => {
    const r = dongAgentCuaMay({ ...MAY, maNhaCungCap: null, maQuay: null }, [AGENT], NOW);
    expect(r).toMatchObject({ kieu: "CHUA_KHOP", cau: expect.stringMatching(/mã nhà cung cấp.*mã quầy/) });
  });

  it("đủ mã nhưng cơ sở này KHÔNG có agent mang merchant của máy ⇒ nêu merchant đang tìm", () => {
    const r = dongAgentCuaMay({ ...MAY, maNhaCungCap: "NCCQYY4D" }, [AGENT], NOW);
    expect(r).toEqual({ kieu: "CHUA_KHOP", cau: expect.stringContaining("NCCQYY4D") });
  });
});

describe("[HN2-MP-A04] KHÔNG in gì khi không có gì để nói", () => {
  it("cơ sở không có agent nào ⇒ null (không có gì để khớp — đừng báo 'chưa khớp' cho cơ sở chưa dùng agent)", () => {
    expect(dongAgentCuaMay(MAY, [], NOW)).toBeNull();
  });

  it("máy đã TẮT ⇒ null, kể cả khi có agent hợp lệ (máy tắt không còn được khớp giao dịch)", () => {
    expect(dongAgentCuaMay({ ...MAY, active: false }, [AGENT], NOW)).toBeNull();
  });

  it("agent của CƠ SỞ KHÁC không bao giờ được ghép, dù trùng merchant — và coi như cơ sở này không có agent", () => {
    const cs2 = { ...AGENT, id: "ag2", centerId: "cs2", coSo: "CS2" };
    expect(dongAgentCuaMay(MAY, [cs2], NOW)).toBeNull();
    // Có thêm một agent của CHÍNH cơ sở nhưng merchant khác ⇒ có agent để khớp mà không khớp: 'chưa khớp', không phải KHOP.
    const khac = { ...AGENT, id: "ag3", merchantCode: "NCCKHAC1" };
    expect(dongAgentCuaMay(MAY, [cs2, khac], NOW)).toMatchObject({ kieu: "CHUA_KHOP" });
  });
});

describe("[HN2-MP-A05] KHÔNG dùng nhánh dự phòng 'agent đang bật duy nhất' của chonAgentChoPhieu", () => {
  const MAY_CHUA_KHAI_MERCHANT: MayChoDongAgent = { ...MAY, maNhaCungCap: null };

  it("đối chứng: `chonAgentChoPhieu` CÓ chọn agent duy nhất cho máy chưa khai merchant (đúng cho việc chọn nguồn của phiếu)", () => {
    expect(chonAgentChoPhieu({ agentsCuaCoSo: [AGENT], maNhaCungCapCuaMay: null })?.id).toBe("ag1");
  });

  it("…nhưng dòng trạng thái KHÔNG được theo: máy chưa khai merchant ⇒ 'chưa khớp', không phải 'Đang làm việc'", () => {
    const r = dongAgentCuaMay(MAY_CHUA_KHAI_MERCHANT, [AGENT], NOW);
    expect(r?.kieu).toBe("CHUA_KHOP");
    expect(JSON.stringify(r)).not.toContain("Đang làm việc");
  });
});
