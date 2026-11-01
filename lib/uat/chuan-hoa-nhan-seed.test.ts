// [CHS-*] Lưới của bảng đổi nhãn seed UAT (lib/uat/chuan-hoa-nhan-seed.ts). Công cụ này GHI lên DB test, nên mỗi ca khoá một luật của bảng:
// nhãn đích phải hợp lệ · không bao giờ đụng nhãn hợp lệ · các nhãn seed cũ khớp tài liệu seed · kế hoạch chỉ chứa nhãn trong bảng.
import { describe, it, expect } from "vitest";
import { BANG_ANH_XA_0610, chuanHoaNhanNguon } from "@/lib/nguon/anh-xa-nhan-cu";
import { NHAN_NGUON_CRM, NHAN_NGUON_NOI_LEAD } from "../../prisma/seed-uat/nhan-nguon";
import { BANG_DOI_NHAN_SEED, dungKeHoachDoiNhan, khoaNhan } from "./chuan-hoa-nhan-seed";

const HOP_LE = new Set(BANG_ANH_XA_0610.map((r) => chuanHoaNhanNguon(r.nhan)));

describe("[CHS] bảng đổi nhãn seed UAT", () => {
  it("[CHS-01] MỌI nhãn đích nằm trong bảng 28 nhãn đã chốt (đổi xong không còn INVALID)", () => {
    for (const d of BANG_DOI_NHAN_SEED) expect(HOP_LE.has(khoaNhan(d.moi)), `${d.cu} → ${d.moi}`).toBe(true);
  });

  it("[CHS-02] KHÔNG nhãn nguồn nào của bảng là nhãn hợp lệ — công cụ không bao giờ viết lại một nhãn đã chốt", () => {
    for (const d of BANG_DOI_NHAN_SEED) expect(HOP_LE.has(khoaNhan(d.cu)), d.cu).toBe(false);
  });

  it("[CHS-03] mỗi nhãn nguồn xuất hiện một lần; nhãn đích không trùng nhãn nguồn nào (đổi một lượt là xong, chạy lại là 0 dòng)", () => {
    const cu = BANG_DOI_NHAN_SEED.map((d) => khoaNhan(d.cu));
    expect(new Set(cu).size).toBe(cu.length);
    for (const d of BANG_DOI_NHAN_SEED) expect(cu, d.moi).not.toContain(khoaNhan(d.moi));
  });

  it("[CHS-04] 8 nhãn seed cũ đổi sang đúng nhãn mà hai mảng seed MỚI đang dùng (bảng này không lệch tài liệu seed)", () => {
    const seedMoi = new Set([...NHAN_NGUON_CRM, ...NHAN_NGUON_NOI_LEAD].map((s) => khoaNhan(s)));
    const taiLieuSeed = BANG_DOI_NHAN_SEED.filter((d) => d.cu !== "NTPOS");
    expect(taiLieuSeed.map((d) => d.cu)).toEqual(["Facebook Ads", "Messenger Page HO", "Vãng lai", "Google", "Zalo OA", "Sự kiện trường học", "Tờ rơi", "Quà tặng"]);
    for (const d of taiLieuSeed) expect(seedMoi.has(khoaNhan(d.moi)), `${d.cu} → ${d.moi}`).toBe(true);
  });

  it("[CHS-05] kế hoạch chỉ chứa nhãn có trong bảng và có ≥1 lead; nhãn hợp lệ / nhãn lạ khác bị bỏ qua; số lead giữ nguyên", () => {
    const dem = new Map<string, number>([
      ["Facebook Ads", 46],
      ["Zalo OA", 57],
      ["NTPOS", 15],
      ["Website", 45], // hợp lệ — không được đụng
      ["Giới thiệu", 43], // hợp lệ
      ["Nhãn lạ chưa ai biết", 3], // lạ nhưng không nằm trong bảng đổi ⇒ vẫn INVALID, để người ta THẤY chứ không đoán
      ["Google", 0],
    ]);
    const kh = dungKeHoachDoiNhan(dem);
    expect(kh.map((k) => k.cu)).toEqual(["Facebook Ads", "Zalo OA", "NTPOS"]);
    expect(kh.map((k) => k.soLead)).toEqual([46, 57, 15]);
    expect(dungKeHoachDoiNhan(new Map())).toEqual([]);
  });

  it("[CHS-06] khớp CHÍNH XÁC chữ trong DB (không chuẩn hoá): 'facebook ads' viết thường không bị kéo vào", () => {
    expect(dungKeHoachDoiNhan(new Map([["facebook ads", 9]]))).toEqual([]);
  });
});
