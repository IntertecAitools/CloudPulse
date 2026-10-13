-- Runs once, on first initialisation of the postgres volume.
--
-- CloudPulse and Zabbix share one Postgres instance but never share a
-- database: Zabbix owns and migrates its own schema aggressively, and we do
-- not want its upgrades touching CloudPulse tables.

CREATE USER zabbix WITH PASSWORD 'zabbix';
CREATE DATABASE zabbix OWNER zabbix;
GRANT ALL PRIVILEGES ON DATABASE zabbix TO zabbix;
