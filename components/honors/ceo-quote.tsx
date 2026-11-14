import Image from "next/image";
import { Quote } from "lucide-react";

interface HonorCEOQuoteProps {
  quote: string;
  name: string;
  title: string;
  avatarUrl?: string;
}

export function HonorCEOQuote({ quote, name, title, avatarUrl }: HonorCEOQuoteProps) {
  if (!quote) return null;

  return (
    <section className="container max-w-4xl mx-auto px-4 py-16">
      <div className="bg-white rounded-2xl shadow-lg p-8 md:p-12 border-l-4 border-orange-500">
        <Quote className="w-12 h-12 text-orange-200 mb-4" aria-hidden="true" />
        <p className="text-xl md:text-2xl text-gray-800 leading-relaxed font-light italic mb-8">
          {quote}
        </p>

        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-orange-300">
              <Image
                src={avatarUrl}
                alt={name}
                width={56}
                height={56}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-600 to-orange-500 flex items-center justify-center text-white font-bold text-xl">
              {name.charAt(0)}
            </div>
          )}
          <div>
            <p className="font-bold text-gray-900">{name}</p>
            <p className="text-sm text-gray-600">{title}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
