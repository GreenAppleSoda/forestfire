"use client";

import type { MountainInfo } from "@/lib/types";
import { useState } from "react";

type Props = {
  mountain: MountainInfo;
  className?: string;
  rounded?: string;
};

function Glyph({ className, rounded }: { className: string; rounded: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center bg-[#e5e7eb] text-[#6b7280] ${rounded} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[45%] w-[45%]"
        fill="currentColor"
        aria-hidden
      >
        <path d="M3 18h18l-5.5-8-3.2 4.6L9.5 10 3 18z" />
      </svg>
    </span>
  );
}

export function MountainThumb({
  mountain,
  className = "h-11 w-11",
  rounded = "rounded-lg",
}: Props) {
  const src = mountain.image_url;
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <Glyph className={className} rounded={rounded} />;
  }

  return (
    <span
      className={`relative block shrink-0 overflow-hidden bg-[#e5e7eb] ${rounded} ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
