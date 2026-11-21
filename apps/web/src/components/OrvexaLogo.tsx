import React from "react";

export function OrvexaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg
        width="34"
        height="34"
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="ORVEXA Logo"
        className="shrink-0"
      >
        <rect width="36" height="36" rx="9" fill="#18181B" />
        <path
          d="M18 7.5L27 12.75V23.25L18 28.5L9 23.25V12.75L18 7.5Z"
          stroke="#E4E4E7"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M18 12.5L23 15.4V20.6L18 23.5L13 20.6V15.4L18 12.5Z"
          fill="#0F766E"
        />
        <circle cx="18" cy="18" r="2.1" fill="#FFFFFF" />
      </svg>
      {!compact && (
        <div className="leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-bold tracking-wider text-zinc-900">ORVEXA</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-zinc-600 ring-1 ring-zinc-200">
              Enterprise
            </span>
          </div>
          <p className="text-[10px] font-medium text-zinc-500">Intelligence Behind Every Operation</p>
        </div>
      )}
    </div>
  );
}
