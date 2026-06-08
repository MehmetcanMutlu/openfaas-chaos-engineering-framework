FROM golang:1.24-alpine AS build

ENV GOTOOLCHAIN=auto

RUN apk add --no-cache git

WORKDIR /src
ARG FAAS_NETES_VERSION=0.18.17
RUN git clone --depth 1 --branch "${FAAS_NETES_VERSION}" https://github.com/openfaas/faas-netes.git .

RUN printf '%s\n' \
  'package config' \
  '' \
  'func ConnectivityCheck() error {' \
  '	return nil' \
  '}' \
  > pkg/config/connectivity.go

RUN CGO_ENABLED=0 GOOS=linux go build -o /faas-netes .

FROM ghcr.io/openfaas/faas-netes:0.18.17

USER root
COPY --from=build /faas-netes /home/app/faas-netes
RUN chmod +x /home/app/faas-netes
USER app
