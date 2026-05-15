/**
 * Workspace dashboard — 5 rows: Volume / Performance / Errors / Cost /
 * Compliance. The JSON-equivalent definition kept inline as HCL so the
 * dashboard is source-of-truth in git, not in Datadog's UI.
 */

resource "datadog_dashboard" "workspace" {
  title       = "agent-mesh — ${var.workspace_name}"
  description = "Per-workspace agent-mesh dashboard. Filters by agent_mesh.workspace:${var.workspace_name}. Source-of-truth in agent-mesh repo."
  layout_type = "ordered"
  reflow_type = "auto"

  template_variable {
    name             = "project"
    prefix           = "agent_mesh.project"
    available_values = []
    defaults         = ["*"]
  }

  template_variable {
    name             = "model"
    prefix           = "agent_mesh.model"
    available_values = []
    defaults         = ["*"]
  }

  # ─── Row 1: Volume ──────────────────────────────────────────────────────

  widget {
    group_definition {
      title       = "Volume"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title = "Calls per minute (by model)"
          request {
            q            = "sum:agent_mesh.messages.requests{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.model}.as_rate()"
            display_type = "line"
          }
        }
      }

      widget {
        query_value_definition {
          title = "Calls (last 1h)"
          request {
            q          = "sum:agent_mesh.messages.requests{agent_mesh.workspace:${var.workspace_name},$project,$model}.as_count()"
            aggregator = "sum"
          }
          precision = 0
        }
      }
    }
  }

  # ─── Row 2: Performance ─────────────────────────────────────────────────

  widget {
    group_definition {
      title       = "Performance"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title = "p50 / p95 / p99 latency by model"
          request {
            q            = "p50:trace.agent_mesh.messages.duration_ms{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.model}"
            display_type = "line"
          }
          request {
            q            = "p95:trace.agent_mesh.messages.duration_ms{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.model}"
            display_type = "line"
          }
          request {
            q            = "p99:trace.agent_mesh.messages.duration_ms{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.model}"
            display_type = "line"
          }
        }
      }

      widget {
        timeseries_definition {
          title = "Cache hit rate (%)"
          request {
            q            = "avg:agent_mesh.cache.hit_rate{agent_mesh.workspace:${var.workspace_name},$project,$model}"
            display_type = "area"
          }
        }
      }
    }
  }

  # ─── Row 3: Errors ──────────────────────────────────────────────────────

  widget {
    group_definition {
      title       = "Errors"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title = "Error rate by class"
          request {
            q            = "sum:agent_mesh.messages.errors{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.error_class}.as_rate()"
            display_type = "bars"
          }
        }
      }

      widget {
        toplist_definition {
          title = "Top failing tools (last 1h)"
          request {
            q = "top(sum:agent_mesh.tool.errors{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.tool}.as_count(), 10, 'sum', 'desc')"
          }
        }
      }
    }
  }

  # ─── Row 4: Cost ────────────────────────────────────────────────────────

  widget {
    group_definition {
      title       = "Cost"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title = "USD/min by provider"
          request {
            q            = "sum:agent_mesh.cost_usd{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.provider}.as_rate()"
            display_type = "area"
          }
        }
      }

      widget {
        query_value_definition {
          title = "Spend today (USD)"
          request {
            q          = "sum:agent_mesh.cost_usd{agent_mesh.workspace:${var.workspace_name},$project,$model}.as_count()"
            aggregator = "sum"
          }
          precision = 2
        }
      }

      widget {
        toplist_definition {
          title = "Top spend by project (last 1h)"
          request {
            q = "top(sum:agent_mesh.cost_usd{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.project}.as_count(), 10, 'sum', 'desc')"
          }
        }
      }
    }
  }

  # ─── Row 5: Compliance ──────────────────────────────────────────────────

  widget {
    group_definition {
      title       = "Compliance"
      layout_type = "ordered"

      widget {
        timeseries_definition {
          title = "Redactions applied (PII proxy)"
          request {
            q            = "sum:agent_mesh.redactions{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.entity_type}.as_count()"
            display_type = "bars"
          }
        }
      }

      widget {
        timeseries_definition {
          title = "Guardrail blocks"
          request {
            q            = "sum:agent_mesh.guardrail.blocks{agent_mesh.workspace:${var.workspace_name},$project,$model} by {agent_mesh.layer}.as_count()"
            display_type = "bars"
          }
        }
      }

      widget {
        timeseries_definition {
          title = "Audit pipeline lag (seconds)"
          request {
            q            = "avg:azure.eventhub_namespaces.capture_backlog_seconds{agent_mesh.workspace:${var.workspace_name}}"
            display_type = "line"
          }
        }
      }
    }
  }
}
