export type MetricSeries = { label: string; metricName: string; color?: string };

/**
 * A panel is provider-agnostic on purpose — each field is interpreted by the
 * active provider's buildQuery:
 *
 *              AWS (CloudWatch)        Azure (Azure Monitor)
 *   namespace  "AWS/EC2"               "Microsoft.Compute/virtualMachines"
 *   statistic  Average | Sum | ...     Average | Total | ...
 *   period     seconds, e.g. "300"     ISO 8601 grain, e.g. "PT5M"
 *   dimensions CloudWatch dimensions   dimension filters
 *
 * `dimensions` absent means the panel follows the resource picker; present
 * means it queries those dimensions directly. See CloudProvider.isResourceScoped.
 */
export type Panel = {
  title: string;
  unit: "percent" | "bytes" | "count";
  namespace: string;
  statistic: string;
  period: string;
  series: MetricSeries[];
  dimensions?: Record<string, string>;
};

/** Per-provider starter panels live with their provider (lib/providers/*). */
