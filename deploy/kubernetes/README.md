# Kubernetes monitoring

## How it works

CloudPulse never talks to the Kubernetes API. It has no kubeconfig, no service
account, and no agent of its own. What it does is read **metrics that something
inside your cluster already publishes**, through the same query path used for
every other provider:

```
  something in the cluster  ──▶  a metrics store  ──▶  Grafana  ──▶  CloudPulse
   (kube-state-metrics or          (Prometheus or        /api/ds/query
    the CloudWatch agent)           CloudWatch)
```

That matters for two reasons:

- **Nothing shows up until a collector is running in the cluster.** AWS
  credentials alone are not enough — from CloudWatch's point of view an EKS
  worker node is just an EC2 instance, with no notion of pods or deployments.
- **Any cluster works**, not just EKS, as long as its metrics reach one of the
  two stores.

## The two sources

The Kubernetes page lists clusters from both and tags each with where it came
from. If a cluster reports through both, Prometheus wins — it carries more.

| | CloudWatch Container Insights | Prometheus |
| --- | --- | --- |
| Works with | EKS only | Any cluster |
| You install | An EKS add-on (AWS runs it) | kube-state-metrics + a Prometheus agent |
| Cluster access needed | No — enabled via the AWS API | Yes, `kubectl` |
| Nodes, pods, namespaces, services | Yes | Yes |
| CPU / memory / disk utilisation | Yes | Yes |
| Container restarts | Yes | Yes |
| **Pod phase** (Running/Pending/Failed) | No | Yes |
| **Which node a pod is on** | No | Yes |
| **Node conditions** (NotReady, MemoryPressure) | No | Yes |
| **Desired vs ready replicas** | No | Yes |
| Absolute memory (GB) | No — percentages only | Yes |
| Cost | CloudWatch metric + ingest charges | Free (self-hosted) |

Columns a source can't supply are hidden rather than shown blank — see
`SourceCapabilities` in `src/lib/kubernetes/types.ts`.

---

## Option A — CloudWatch Container Insights (EKS, no cluster access)

Best when you can reach AWS but not the cluster itself.

**1. Enable the add-on.** EKS console → your cluster → Add-ons → *Amazon
CloudWatch Observability*. Or:

```sh
aws eks create-addon \
  --cluster-name <cluster> --region <region> \
  --addon-name amazon-cloudwatch-observability
```

**2. Let the nodes write metrics.** The node group's IAM role needs
`CloudWatchAgentServerPolicy`:

```sh
aws iam attach-role-policy \
  --role-name <node-group-role> \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
```

**3. Confirm data is arriving** (a few minutes later). This should list your
cluster:

```sh
aws cloudwatch list-metrics --namespace ContainerInsights \
  --metric-name cluster_node_count --region <region>
```

**4. In CloudPulse**, open Kubernetes and set **Region** to the cluster's
region. CloudWatch has no cross-region listing, so the region selector decides
where it looks.

The AWS account connected in Settings must be the one that owns the cluster.

---

## Option B — Prometheus (any cluster, full fidelity)

**1. Install kube-state-metrics:**

```sh
kubectl apply -k github.com/kubernetes/kube-state-metrics
```

**2. Run a Prometheus agent in the cluster** that scrapes it and the kubelet,
and remote-writes to CloudPulse. CloudPulse's Prometheus already runs with
`--web.enable-remote-write-receiver`.

```yaml
global:
  external_labels:
    cluster: my-cluster          # this becomes the Cluster dropdown
remote_write:
  - url: http://<cloudpulse-host>:9090/api/v1/write
scrape_configs:
  - job_name: kube-state-metrics
    kubernetes_sd_configs: [{ role: service }]
    relabel_configs:
      - source_labels: [__meta_kubernetes_service_name]
        regex: kube-state-metrics
        action: keep
  - job_name: kubelet-cadvisor
    scheme: https
    tls_config: { ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt }
    bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
    kubernetes_sd_configs: [{ role: node }]
    metrics_path: /metrics/cadvisor
    relabel_configs:
      - target_label: __address__
        replacement: kubernetes.default.svc:443
      - source_labels: [__meta_kubernetes_node_name]
        target_label: __metrics_path__
        replacement: /api/v1/nodes/$1/proxy/metrics/cadvisor
```

Set `external_labels.cluster` per cluster if you monitor more than one.

**3. Expose the receiver to the cluster.** Over anything public, put TLS and
authentication in front of it first — the remote-write endpoint is
unauthenticated on its own.

If CloudPulse can reach the cluster directly (kind, minikube, Docker Desktop),
skip the agent and add a scrape job to `deploy/prometheus/prometheus.yml`
instead.

---

## Without either: node-level only

EKS worker nodes are ordinary EC2 instances, so they appear on the
**Infrastructure** page today — CPU, network, health — with no collector
installed. Pick the cluster's region there. You get nodes, but nothing inside
them.

## Metrics each view reads

**Prometheus**

| View | Series |
| --- | --- |
| Nodes | `kube_node_info`, `kube_node_status_condition`, `kube_node_status_capacity`, `kube_node_status_allocatable` |
| Workloads | `kube_deployment_status_replicas{,_available}`, `kube_statefulset_status_replicas{,_ready}`, `kube_daemonset_status_{desired_number_scheduled,number_ready}` |
| Pods | `kube_pod_info`, `kube_pod_status_phase`, `kube_pod_container_status_restarts_total`, `kube_pod_container_status_waiting_reason` |
| Usage | `container_memory_working_set_bytes`, `kube_pod_container_resource_requests` |

Node memory is derived by joining pod memory to `kube_pod_info` on
`(pod, namespace)`, since cAdvisor series carry no node label.

**CloudWatch Container Insights** (namespace `ContainerInsights`)

| View | Metrics |
| --- | --- |
| Cluster | `cluster_node_count`, `cluster_failed_node_count`, `namespace_number_of_running_pods` |
| Nodes | `node_cpu_utilization`, `node_memory_utilization`, `node_filesystem_utilization`, `node_number_of_running_pods` |
| Workloads | `service_number_of_running_pods` |
| Pods | `pod_cpu_utilization`, `pod_memory_utilization`, `pod_number_of_container_restarts` |

Each table issues one CloudWatch `SEARCH` expression that returns a series per
entity, rather than a request per node or pod.
