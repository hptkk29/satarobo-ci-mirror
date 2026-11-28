"use client";

import { useEffect, useState } from "react";
import { SU_KIEN_CHON_CHUYEN_MUC } from "@/components/blog/tin-tuc-chip";
import { TinTucThe } from "@/components/blog/tin-tuc-the";
import { TrangThaiRong } from "@/components/blog/trang-thai-rong";
import {
  chuyenMucCoBai,
  locTheoChuyenMuc,
  phanDangHien,
  SO_BAI_MOI_LAN,
  type TinTucItem,
} from "@/components/blog/tin-tuc-thuan";

/**
 * Danh sách bài + tab chuyên mục (`.pill-tabs` của artifact). Tab dựng từ chuyên mục CÓ BÀI THẬT
 * trong dữ liệu — chuyên mục do quản trị nhập tự do nên không có danh sách cố định. Chỉ có 0–1
 * chuyên mục thì không vẽ thanh tab (không có gì để lọc).
 * Mọi chuỗi (ngày, phút đọc) đã chuẩn bị ở server: client không tự định dạng nên không lệch hydrate.
 */
export function TinTucDanhSach({ posts }: { posts: TinTucItem[] }) {
  const chuyenMuc = chuyenMucCoBai(posts);
  const [tab, setTab] = useState<string | null>(null);
  const [soLan, setSoLan] = useState(1);

  const locDuoc = locTheoChuyenMuc(posts, tab);
  const hien = phanDangHien(locDuoc, soLan);
  const conLai = locDuoc.length - hien.length;

  // Chip chuyên mục ở hero (liên kết lọc) báo qua sự kiện; chỉ nhận khoá chuyên mục có thật.
  useEffect(() => {
    const nghe = (e: Event) => {
      const khoa = (e as CustomEvent<string>).detail;
      if (typeof khoa === "string" && chuyenMuc.some((c) => c.key === khoa)) {
        setTab(khoa);
        setSoLan(1);
      }
    };
    window.addEventListener(SU_KIEN_CHON_CHUYEN_MUC, nghe);
    return () => window.removeEventListener(SU_KIEN_CHON_CHUYEN_MUC, nghe);
  });

  const chon = (key: string | null) => {
    setTab(key);
    setSoLan(1);
  };

  // paddingTop 15px: khoảng cách giữa tiêu đề mục và thanh tab của artifact (nằm sau dòng chú thích mẫu — dòng đó KHÔNG đưa vào site thật).
  return (
    <div style={{ paddingTop: "15px" }}>
      {chuyenMuc.length >= 2 && (
        <div className="pill-tabs" role="tablist" aria-label="Chuyên mục">
          <button type="button" role="tab" aria-selected={tab === null} className={tab === null ? "pill on" : "pill"} onClick={() => chon(null)}>
            Tất cả
          </button>
          {chuyenMuc.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={tab === c.key}
              className={tab === c.key ? "pill on" : "pill"}
              onClick={() => chon(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {hien.length > 0 ? (
        <>
          <div className="g3" role="tabpanel">
            {hien.map((p) => (
              <TinTucThe key={p.slug} post={p} />
            ))}
          </div>
          {conLai > 0 && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
              <button type="button" className="btn btn-line" onClick={() => setSoLan((n) => n + 1)}>
                Xem thêm {Math.min(conLai, SO_BAI_MOI_LAN)} bài viết
              </button>
            </div>
          )}
        </>
      ) : (
        <TrangThaiRong tieuDe={posts.length === 0 ? "Chưa có bài viết nào" : "Chưa có bài viết trong chuyên mục này"}>
          Ba mẹ quay lại sau nhé!
        </TrangThaiRong>
      )}
    </div>
  );
}
