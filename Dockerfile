FROM node:20-alpine AS front-builder

WORKDIR /app/front

COPY front/package.json front/package-lock.json ./
RUN npm ci

COPY front/ ./
RUN npm run build


FROM golang:1.25-alpine AS backend-builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY config/ ./config/
COPY internal/ ./internal/

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /app/bin/3xbackend ./cmd


FROM alpine:3.20

WORKDIR /app

RUN adduser -D -h /app appuser \
    && mkdir -p /app/config /app/front/dist /app/public/images /app/public/uploads \
    && chown -R appuser:appuser /app

COPY --from=backend-builder /app/bin/3xbackend /app/3xbackend
COPY --from=backend-builder /app/config/config.yaml /app/config/config.yaml
COPY --from=front-builder /app/front/dist /app/front/dist

USER appuser

EXPOSE 3000

CMD ["/app/3xbackend"]
