export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" role="presentation">
        <rect width="64" height="64" rx="18" fill="#0f543a" />
        <circle cx="23" cy="23" r="11" fill="#d8e953" />
        <circle cx="23" cy="23" r="5.5" fill="#0f543a" />
        <path
          d="m31 31 18 18M38.5 38.5l6-6M44 44l6-6"
          fill="none"
          stroke="#d8e953"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="7"
        />
        <path
          d="m19.5 23 2.5 2.5 5-6.5"
          fill="none"
          stroke="#ff6847"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.8"
        />
        <circle cx="49" cy="49" r="3.5" fill="#ff6847" />
      </svg>
    </span>
  );
}
