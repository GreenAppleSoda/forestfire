type Props = {
  subtitle?: string;
};

/** 1번 영역: 지도 열 상단 타이틀만 (Records는 우측 패널) */
export function SiteHeader({ subtitle }: Props) {
  return (
    <header className="shrink-0 border-b border-[#d7d0c4] bg-[#F4EFE6] px-6 py-3.5 sm:px-8">
      <p className="text-[10px] font-medium tracking-[0.22em] text-[#6b6358] uppercase sm:text-[11px]">
        South Korea Wildfire Atlas
      </p>
      <h1 className="mt-0.5 font-[family-name:var(--font-display)] text-[1.65rem] leading-tight tracking-tight text-[#1c1917] sm:text-3xl">
        산불맵
      </h1>
      <p className="mt-1 max-w-xl text-[13px] leading-snug text-[#57534e]">
        {subtitle ??
          "스크롤로 행정단위 세분화 · 산 검색으로 위험 예측·산 정보를 볼 수 있습니다."}
      </p>
    </header>
  );
}
