import Link from "next/link";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { Ic } from "@/components/public/disc/bieu-tuong";

/** Trạng thái khi chưa có động cơ DISC: nói thật, KHÔNG dựng bài giả. Server-safe (không state). Markup CHÉP từ artifact "Disc-LamBai" (`.dsoon`). */
export function ManDangHoanThien() {
  return (
    <section data-testid="disc-dang-hoan-thien" aria-labelledby="disc-dht-t" className="dj-card dsoon">
      <PubAnh id="87e9462c8a5ae12b7e41aa3b68ced3cc" alt="" aria-hidden="true" sizes="130px" style={{ width: "130px", height: "auto", filter: "drop-shadow(0 14px 18px rgba(0,0,0,.3))" }} />
      <span className="ico" style={{ background: "rgba(124,58,237,.14)", borderColor: "rgba(124,58,237,.4)", color: "var(--purT)" }}>
        <Ic ten="bua" size={22} />
      </span>
      <h2 id="disc-dht-t">Bài khám phá đang được hoàn thiện</h2>
      <p className="dj-lead" style={{ margin: "0" }}>
        Chúng tôi chưa mở bài làm để đảm bảo bộ câu hỏi và kết quả đúng chuẩn. Bạn chưa cần làm gì lúc này — bài sẽ mở sớm.
      </p>
      <Link href="/disc" className="btn btn-line">
        Về trang giới thiệu DISC
      </Link>
    </section>
  );
}
