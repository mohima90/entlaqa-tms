# Runtime image for apps/worker (background jobs, ADR 0005; T-M2-06a). Built from the single bundled file
# of `pnpm --filter @jadarat/worker build`: no source, no node_modules, no dev dependencies.
# Configuration comes from the runtime environment. Same base as the app image: distroless Node 24 (no
# shell, no package manager), unprivileged `nonroot` user, pinned by digest (CI scans the built image).
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9fc11f6ee65993285c0fe3c4c9bbc4fd275fd4470572f58834ce490df91056e3
ENV NODE_ENV=production JADARAT_SERVICE=jadarat-worker
WORKDIR /app
COPY --chown=nonroot:nonroot apps/worker/dist/main.mjs ./main.mjs
USER 65532:65532
# Long-running; SIGTERM lets running jobs finish before the process exits.
CMD ["main.mjs", "daemon"]
