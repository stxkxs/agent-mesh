# agent-mesh-mcp-server

Generic Helm chart for one MCP backend. Install once per MCP server (filesystem-readonly, weather, github, etc.) into the AKS cluster's MCP subnet. The Application Gateway / WAF v2 (from `terraform/modules/mcp`) fronts every release.

```bash
helm install filesystem ./charts/mcp-server \
  --namespace mcp \
  --create-namespace \
  --set workspace=platform-prod \
  --set project=alpha \
  --set name=filesystem-readonly \
  --set image.repository=myregistry.azurecr.io/mcp-filesystem-readonly \
  --set image.tag=v0.1.0
```

## Defaults

- 2 replicas
- Non-root user (10001), read-only root filesystem, seccomp RuntimeDefault, capabilities dropped
- NetworkPolicy: ingress allowed only from the AppGW subnet (10.40.15.0/24 default); egress allowed to kube-dns + OTel Collector + outbound 443
- nodeSelector targets the `mcp` agentpool (matches the `snet-mcp` subnet from `terraform/modules/network`)

## Workload Identity (optional)

If the MCP server needs Azure access (read from Storage, query Cosmos), enable Workload Identity:

```bash
helm install ... \
  --set workloadIdentity.enabled=true \
  --set workloadIdentity.clientId=<aad-app-client-id> \
  --set workloadIdentity.tenantId=<tenant-id>
```

Most read-only MCP servers (filesystem, calculator, etc.) don't need Azure access and can run with no identity.

## HPA

Off by default. Enable for traffic-shaped backends (the agent runtime workloads use KEDA Service Bus depth instead):

```bash
helm install ... --set hpa.enabled=true --set hpa.targetCPUUtilizationPercentage=70
```

## Wiring with the gateway

After installing the chart, register the backend with the Application Gateway by adding to `terraform/modules/mcp`'s `backend_fqdns`:

```hcl
backend_fqdns = {
  filesystem = "filesystem-readonly.mcp.svc.cluster.local"
}
```

`helm install`'s name argument doesn't have to match the AppGW backend label, but the convention is to keep them identical.
