# Cassette Player Sidecar — standalone Go binary
#
# Kept separate from the Navidrome Dockerfile (which is a complex
# multi-stage cross-compilation build). This produces a tiny Alpine image
# that runs alongside Navidrome in the same docker-compose stack, sharing
# the data volume and Docker network.

FROM golang:1.25-alpine AS build
WORKDIR /src
# Copy module files first so the dep layer caches across source edits.
# go.sum is optional (only present once deps are tidied) — guarded copy.
COPY go.mod ./
COPY go.su[m] ./
RUN go mod download
# Build the binary from all non-test Go sources in this directory.
# Excluding *_test.go keeps the production image lean.
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /sidecar .

FROM alpine:3.20
# curl for health checks; ca-certificates for HTTPS to cassette.digital
RUN apk add --no-cache ca-certificates curl
WORKDIR /app
COPY --from=build /sidecar .
CMD ["/app/sidecar"]
