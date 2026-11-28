// lib/nguon/khoa-setting.ts — KHOÁ SETTING của module "Nguồn lead". LÁ: KHÔNG import gì (lưới `[FIX-F3-03]`).
//
// Vì sao tách khỏi `feature.ts`: `feature.ts` đọc setting qua `lib/settings/service.ts`, còn `service.ts` → `kiem-theo-db.ts` cần các khoá này lúc LƯU. Để khoá nằm trong `feature.ts`
// là tạo vòng `feature → service → kiem-theo-db → feature` (dependency-cruiser `no-circular` đỏ). Khoá ở lá thì cả hai phía nhập nó mà không nhập nhau.
// `feature.ts` XUẤT LẠI `KHOA_NGUON`, nên mọi nơi cũ vẫn `import { KHOA_NGUON } from "@/lib/nguon/feature"`; lưới `[NHH-FLG-05]` cho tệp này đứng ngoài danh sách cấm như `feature.ts`.

export const KHOA_NGUON = {
  enabled: "nguon.enabled",
  autoAttribution: "nguon.autoAttribution",
  pageMapping: "nguon.pageMapping",
  referral: "nguon.referral",
  manualReview: "nguon.manualReview",
  epChonNguon: "nguon.epChonNguon",
  cuaSoGhiCongNgay: "nguon.cuaSoGhiCongNgay",
  bangNguonTheoPage: "nguon.bangNguonTheoPage",
  nhomNhanSuMacDinh: "nguon.nhomNhanSuMacDinh",
} as const;
