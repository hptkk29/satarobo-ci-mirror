"use client";

import { useState } from "react";

// Ô "Thử một câu" — CHÉP từ artifact "Disc" (khối `.card.dtry`): MỘT câu minh hoạ để khách hình dung cách chọn mức — KHÔNG lưu, KHÔNG chấm,
// KHÔNG gửi đi đâu (chỉ giữ trong bộ nhớ của trang). Nhãn thang đọc từ động cơ (bộ ba/mẹ) do trang truyền xuống.
export function ThuMotCau({ thang, soCau }: { thang: string[]; soCau: number }) {
  const [chon, setChon] = useState(0);
  return (
    <div className="card dtry sv d2 a-pop">
      <span className="tag dtag" style={{ justifySelf: "start" }}>
        Thử một câu
      </span>
      <p className="dq-dan">Chọn mức đúng với bạn nhất. Không có câu nào đúng hay sai.</p>
      <p className="q">Trong nhà, tôi là người ra quyết định cuối cùng</p>
      <div className="dopts n5 mini" role="radiogroup" aria-label="Mức độ đúng với bạn">
        {thang.map((t, i) => (
          <button key={t} type="button" role="radio" aria-checked={chon === i + 1} className={"dopt" + (chon === i + 1 ? " on" : "")} onClick={() => setChon(i + 1)}>
            <span className="nb">{i + 1}</span>
            <span>{t}</span>
          </button>
        ))}
      </div>
      {chon > 0 && (
        <p className="dnote mi">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M8 12l3 3 5-6"></path>
          </svg>
          <span>
            Bạn chọn “{thang[chon - 1]}”. Không có câu nào đúng hay sai{soCau > 0 ? ` — bài thật có ${soCau} câu như vậy cho ba/mẹ` : ""}.
          </span>
        </p>
      )}
    </div>
  );
}
