// Đơn đi muộn / về sớm ĐÃ DUYỆT ⇒ khung miễn trừ (đợt 2 đơn từ, chốt Q-5 08/10/2026).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gomMuonSomDaDuyet } from "./muon-som-da-duyet";
import { NOI_QUY_MAC_DINH, thongKeNguoi, type NgayCong } from "./noi-quy";

describe("[MSG] gomMuonSomDaDuyet", () => {
  it("[MSG-01] đi muộn ⇒ denLuc; về sớm ⇒ veLuc (phút từ 00:00)", () => {
    expect(gomMuonSomDaDuyet([{ detail: "Đi muộn", startTime: "08:30" }])).toEqual({ denLuc: 510, veLuc: null });
    expect(gomMuonSomDaDuyet([{ detail: "Về sớm", startTime: "16:00" }])).toEqual({ denLuc: null, veLuc: 960 });
  });

  it("[MSG-02] nhiều đơn cùng chiều ⇒ khung RỘNG nhất (đến muộn nhất / về sớm nhất)", () => {
    expect(
      gomMuonSomDaDuyet([
        { detail: "Đi muộn", startTime: "08:15" },
        { detail: "Đi muộn", startTime: "09:00" },
        { detail: "Về sớm", startTime: "16:30" },
        { detail: "Về sớm", startTime: "15:45" },
      ]),
    ).toEqual({ denLuc: 540, veLuc: 945 });
  });

  it("[MSG-03] không rõ chiều / giờ sai ⇒ BỎ QUA, không đoán", () => {
    expect(
      gomMuonSomDaDuyet([
        { detail: null, startTime: "08:30" },
        { detail: "Đi muộn", startTime: null },
        { detail: "Đi muộn", startTime: "25:00" },
      ]),
    ).toEqual({ denLuc: null, veLuc: null });
  });
});

const capDong = [{ inId: "a", outId: "b", start: 480, end: 1020, open: false }];
function ngay(p: Partial<NgayCong> = {}): NgayCong {
  return {
    dayType: "WORK",
    dayCreditExpected: 1,
    arrivalDeltaMinutes: 0,
    lateApprovedMinutes: 0,
    pairs: capDong,
    flags: [],
    absenceStatus: null,
    templateCode: "S",
    ...p,
  };
}

describe("[MSN] nội quy: đi muộn đã duyệt KHÔNG tính lần trễ (Q-5 miễn trừ)", () => {
  it("[MSN-01] trễ 40′ trong khung đã xin ⇒ 0 lần trễ, 0% trừ", () => {
    const t = thongKeNguoi([ngay({ arrivalDeltaMinutes: 40, lateApprovedMinutes: 40 })], NOI_QUY_MAC_DINH);
    expect(t.soLanTre).toBe(0);
    expect(t.phanTramTru).toBe(0);
  });

  it("[MSN-02] xin 30′ mà trễ 70′ ⇒ phần vượt 40′ > ngưỡng 15′ ⇒ VẪN 1 lần trễ", () => {
    const t = thongKeNguoi([ngay({ arrivalDeltaMinutes: 70, lateApprovedMinutes: 30 })], NOI_QUY_MAC_DINH);
    expect(t.soLanTre).toBe(1);
  });

  it("[MSN-03] xin 30′ mà trễ 40′ ⇒ phần vượt 10′ dưới ngưỡng ⇒ không tính", () => {
    const t = thongKeNguoi([ngay({ arrivalDeltaMinutes: 40, lateApprovedMinutes: 30 })], NOI_QUY_MAC_DINH);
    expect(t.soLanTre).toBe(0);
  });
});

describe("[MSD-W] dây nối: tính lại công phải đọc đơn đã duyệt", () => {
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  const recompute = doc("lib/cham-cong/recompute.ts");
  const loader = doc("lib/cham-cong/don-trong-ngay-db.ts");
  const nguCanh = doc("lib/cham-cong/don-trong-ngay.ts");

  it("[MSD-W1] recompute đọc ngữ cảnh đơn bằng MỘT lời gọi và truyền nguyên khối vào computeDay", () => {
    // Test hành vi của engine dựng tay đầu vào nên KHÔNG chứng minh được recompute có đọc đơn —
    // gỡ khối đọc đơn ở đây thì mọi ca [MSD-*] vẫn xanh (luật 9).
    expect(recompute.match(/dungNguCanhDon\(await docDonHieuLucNgay\(client, userId, workDate\)\)/g)?.length).toBe(1);
    expect(recompute.match(/^\s+nguCanhDon,$/gm)?.length).toBe(1);
    // Đi muộn / về sớm là một vế của ngữ cảnh.
    expect(nguCanh).toMatch(/muonSom: gomMuonSomDaDuyet\(dons\.filter\(\(d\) => d\.kind === "LATE_EARLY"\)\)/);
  });

  it("[MSD-W2] chỉ đơn CÒN HIỆU LỰC và mang DẤU duyệt mới (effectVersion) mới tác động bảng công", () => {
    // Không có vế effectVersion ⇒ mọi đơn OT / đi muộn đã duyệt TRƯỚC bản này trên prod bắt đầu
    // đổi công các kỳ đang mở ở lần tính lại kế tiếp.
    expect(loader).toMatch(/status: \{ in: \[\.\.\.TRANG_THAI_CON_HIEU_LUC\] \}/);
    expect(loader).toMatch(/effectVersion: \{ gte: 1 \}/);
    expect(loader).toMatch(/fromDate: \{ lte: workDate \}/);
    expect(loader).toMatch(/toDate: \{ gte: workDate \}/);
  });
});
