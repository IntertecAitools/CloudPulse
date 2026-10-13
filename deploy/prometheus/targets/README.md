# Uptime check targets

Prometheus reloads `uptime-*.yml` and `tcp-*.yml` in this directory every 30
seconds, so checks can be added and removed at runtime with no restart.

One file per check keeps add/remove atomic. Format:

```yaml
- targets:
    - https://api.example.com/health
  labels:
    check: api-health
```

`uptime-*.yml` targets are probed over HTTP (expecting 2xx); `tcp-*.yml`
targets are probed with a TCP connect and should be `host:port`.

Results land in Prometheus as `probe_success`, `probe_duration_seconds` and
`probe_http_status_code`, labelled with whatever you put under `labels`.

This directory ships empty on purpose — every check here should be something
you actually want monitored.
