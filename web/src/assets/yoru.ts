// Copyright (c) 2026 meiyeai. Neutral artwork for self-hosted deployments.
// Personal character artwork is not distributed with the public edition.
const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
export const yoruBody = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120"><rect x="15" y="28" width="70" height="65" rx="22" fill="#e4e4e7" stroke="#52525b" stroke-width="4"/><path d="M50 28V16M42 16h16M15 52H7v25h8M85 52h8v25h-8" fill="none" stroke="#52525b" stroke-width="4" stroke-linecap="round"/><circle cx="36" cy="55" r="5" fill="#27272a"/><circle cx="64" cy="55" r="5" fill="#27272a"/><path d="M36 75h28" stroke="#52525b" stroke-width="4" stroke-linecap="round"/></svg>');
const emptyLayer = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120"/>');
export const yoruBlink = emptyLayer;
export const yoruTail = emptyLayer;
