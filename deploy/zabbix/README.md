# Zabbix — agent-based monitoring

Cloud APIs only see what the cloud knows about. They can tell you an EC2
instance exists and how busy its hypervisor thinks it is, but not what's
happening *inside* it — disk filling up, a service stopped, memory pressure,
a failing RAID controller, an unreachable switch.

Zabbix fills that gap, and CloudPulse ships it. Nothing external to install.

```
  your host ──agent──▶ zabbix-server ──▶ postgres
                            │
                       zabbix-web ──api──▶ Grafana ──▶ CloudPulse
```

## What comes up

| Service | Port | What it's for |
| --- | --- | --- |
| `zabbix-server` | `10051` | Agents connect here. Must be reachable from monitored hosts. |
| `zabbix-web` | `8090` | Zabbix's own UI, for host and template configuration. Also serves the JSON-RPC API Grafana queries. |
| `zabbix-agent` | — | Monitors the CloudPulse host itself, so there's data immediately. |

Zabbix stores its data in the bundled Postgres, in a **separate `zabbix`
database** — it migrates its own schema aggressively and shouldn't share
tables with CloudPulse.

## First run

1. `docker compose up -d`
2. Open <http://localhost:8090> — Zabbix's UI. Default login **Admin / zabbix**.
3. **Change that password immediately.** It's a well-known default and the
   account is a full administrator. Then update `ZABBIX_API_PASSWORD` in your
   `.env` and `docker compose up -d grafana` so the datasource keeps working.

Grafana installs the Zabbix plugin, enables the app, and creates the datasource
on first start — see `deploy/grafana/provisioning/`. No clicking required.

## Adding a host to monitor

On the machine you want monitored:

```sh
# Debian/Ubuntu
apt install zabbix-agent2

# point it at CloudPulse
sed -i 's/^Server=.*/Server=<cloudpulse-host>/' /etc/zabbix/zabbix_agent2.conf
sed -i 's/^ServerActive=.*/ServerActive=<cloudpulse-host>:10051/' /etc/zabbix/zabbix_agent2.conf
sed -i 's/^Hostname=.*/Hostname=my-server/' /etc/zabbix/zabbix_agent2.conf
systemctl restart zabbix-agent2
```

Then in the Zabbix UI: **Data collection → Hosts → Create host**. Give it the
same `Hostname`, add an interface pointing at the machine's IP, and attach the
*Linux by Zabbix agent* template. Metrics start arriving within a minute.

Network gear without an agent works the same way via SNMP — attach a
*Network device by SNMP* template instead of installing anything.

## Why it's here rather than alongside

Zabbix is a complete monitoring product with its own UI, and CloudPulse does
not try to replace it. Use the Zabbix UI for what it's good at — host
configuration, templates, discovery rules, trigger expressions. CloudPulse
reads the resulting metrics so hosts sit next to your cloud and Kubernetes
data in one place, instead of being a separate tab you forget to check.

## Security

- The agent port (`10051`) is published so agents can reach it. On a machine
  exposed to the internet, firewall it to the hosts you actually monitor.
- `Admin / zabbix` is the shipped default and is documented publicly. Changing
  it is the first thing to do, not a later cleanup.
- The Zabbix UI on `8090` has no TLS in this setup. Don't expose it beyond
  localhost or a trusted network without putting a TLS terminator in front.
