# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.9 AS web-build
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY VERSION CHANGELOG.md README.md /app/
COPY web ./
COPY backend/internal/app/appearance_theme_packs.json /app/backend/internal/app/appearance_theme_packs.json
COPY backend/internal/app/video_model_presets.json /app/backend/internal/app/video_model_presets.json
ARG VITE_TLDRAW_LICENSE_KEY
ENV VITE_TLDRAW_LICENSE_KEY=${VITE_TLDRAW_LICENSE_KEY}
RUN bun run build

FROM nginx:1.27-alpine
COPY --from=web-build /app/web/dist /opt/canvas-release
COPY docker/canvas-web-entrypoint.sh /usr/local/bin/canvas-web-entrypoint
RUN chmod +x /usr/local/bin/canvas-web-entrypoint
COPY nginx.conf /etc/nginx/conf.d/default.conf
ENTRYPOINT ["/usr/local/bin/canvas-web-entrypoint"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
