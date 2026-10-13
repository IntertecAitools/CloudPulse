/**
 * OpenTelemetry bootstrap for CloudPulse's own Node services.
 *
 * Imported for side effects *before* anything else, because the auto
 * instrumentations patch http/fetch/pg at require time — load it late and the
 * modules it needs to wrap are already resolved, so nothing is traced.
 *
 * This is what fills the Traces page. It also means CloudPulse demonstrates
 * its own APM pillar rather than shipping an empty Tempo: every alert
 * evaluation shows up as a trace with its outbound Grafana call as a child
 * span, so a slow rule is visible rather than guessed at.
 *
 * Disable with OTEL_SDK_DISABLED=true.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
// Both of these are CommonJS, so named ESM imports fail at parse time with
// "Named export not found". Default-import and destructure instead.
// `Resource` is the 1.x API; 2.x replaces it with resourceFromAttributes().
import resourcesPkg from "@opentelemetry/resources";
import semconvPkg from "@opentelemetry/semantic-conventions";

const { Resource } = resourcesPkg;
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = semconvPkg;

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://tempo:4318";
const serviceName = process.env.OTEL_SERVICE_NAME || "cloudpulse-service";

if (process.env.OTEL_SDK_DISABLED === "true") {
  console.log("telemetry disabled (OTEL_SDK_DISABLED=true)");
} else {
  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: "1.0.0",
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Noisy and of no diagnostic value here.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    console.log(`telemetry -> ${endpoint} as "${serviceName}"`);
  } catch (e) {
    // Tracing must never take the service down with it.
    console.error(`telemetry failed to start: ${e.message}`);
  }

  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      sdk.shutdown().catch(() => {}).finally(() => process.exit(0));
    });
  }
}
