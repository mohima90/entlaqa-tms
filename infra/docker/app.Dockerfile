# Runtime image for apps/suite (sovereign deployments, ADR 0010). Built from the standalone output of
# `pnpm --filter @jadarat/suite build` (the same artifact Vercel and CI run), so the image contains no
# source and no dev dependencies. Configuration comes from the runtime environment (T-M1-D04).
# Base: distroless Node 24 — no shell, no package manager, no npm (whose bundled packages carried the
# known CVEs in the -slim image), runs as the unprivileged `nonroot` user. Pinned by digest; bump
# deliberately (CI scans the built image, gate 15).
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --chown=nonroot:nonroot apps/suite/.next/standalone/ ./
EXPOSE 3000
# The base image already defaults to nonroot; stated explicitly so the image never runs as root (Trivy DS-0002).
USER 65532:65532
HEALTHCHECK --interval=10s --timeout=3s --retries=12 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/ar').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["apps/suite/server.js"]
