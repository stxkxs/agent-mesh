# observability

Datadog dashboard + monitor stack for an agent-mesh workspace. The dashboard is 5 rows (Volume / Performance / Errors / Cost / Compliance) with `project` + `model` template variables so the same dashboard serves every project under the workspace.

```hcl
provider "datadog" {
  # API key + APP key sourced via environment:
  # DD_API_KEY, DD_APP_KEY
  # OR resolved via Workload Identity from Key Vault (set api_key + app_key here)
}

module "observability" {
  source = "../../modules/observability"

  workspace_name = module.workspace.workspace_name
  notify_handles = ["@slack-platform-oncall", "@pagerduty-platform"]

  slo_p99_latency_ms = {
    opus   = 30000
    sonnet = 12000
    haiku  = 4000
    gpt_4o = 8000
  }
  error_rate_threshold_pct            = 2
  cache_hit_drop_threshold_pp         = 20
  eval_score_regression_threshold_pct = 5
  audit_lag_threshold_minutes         = 15
}
```

## What gets created

- **1 Dashboard**, 5 groups, ~14 widgets total
- **9 Monitors**:
  - p99 latency above SLO (one per model class: Opus, Sonnet, Haiku, GPT-4o)
  - Error rate above threshold (default 2% over 5min)
  - Cache hit-rate week-over-week drop (anomaly detection)
  - Eval-score regression (anomaly detection on worst-case score)
  - Audit pipeline lag (Event Hubs Capture backlog)
  - Spend anomaly (anomaly detection on cost rate)

## Monitor message structure

Every monitor message includes:

- The breach context (what threshold, what window)
- 2-3 things to check
- A direct link to the matching runbook in `docs/runbooks/`
- The configured notify handles

## Datadog auth

The `datadog` provider needs an API key + APP key. Two patterns work:

**Local dev / CI runner OIDC:** set `DD_API_KEY` and `DD_APP_KEY` in the environment.

**Production (preferred):** stash both keys in Key Vault; resolve via Workload Identity at plan/apply time using a small wrapper:

```hcl
data "azurerm_key_vault_secret" "dd_api" {
  name         = "datadog-api-key"
  key_vault_id = module.workspace.key_vault_id
}

data "azurerm_key_vault_secret" "dd_app" {
  name         = "datadog-app-key"
  key_vault_id = module.workspace.key_vault_id
}

provider "datadog" {
  api_key = data.azurerm_key_vault_secret.dd_api.value
  app_key = data.azurerm_key_vault_secret.dd_app.value
  api_url = "https://api.datadoghq.com/"  # or your DD site
}
```

## ADRs

- [ADR-0003 — Datadog over Azure Monitor](../../../docs/adr/0003-datadog-over-azure-monitor.md)
- [ADR-0007 — Datadog dashboards as Terraform](../../../docs/adr/0007-datadog-dashboards-as-terraform.md)
