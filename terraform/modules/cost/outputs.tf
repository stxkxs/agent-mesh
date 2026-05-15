output "cost_export_id" {
  description = "Cost Management Export resource ID."
  value       = azapi_resource.cost_export.id
}

output "cost_exports_container_name" {
  description = "Name of the ADLS container receiving the cost export parquet files."
  value       = azurerm_storage_container.cost_exports.name
}

output "cost_exports_container_url" {
  description = "Full HTTPS URL of the cost-exports container."
  value       = "https://${var.storage_account_name}.blob.core.windows.net/${azurerm_storage_container.cost_exports.name}"
}

locals {
  view_definitions = <<-EOT
    -- Run these from your Synapse Serverless SQL endpoint.
    -- Audit + cost share the same Storage Account; the data source is
    -- declared once and reused.

    IF NOT EXISTS (SELECT * FROM sys.external_data_sources WHERE name = 'cost_lake')
    BEGIN
      CREATE EXTERNAL DATA SOURCE cost_lake
      WITH (
        LOCATION = '${azurerm_storage_container.cost_exports.name}',
        CREDENTIAL = SynapseDefault
      );
    END;

    GO

    CREATE OR ALTER VIEW dbo.cost_by_workspace AS
    SELECT
      CONVERT(date, [Date]) AS [date],
      ResourceGroup,
      ServiceName,
      SUM(CAST(CostInBillingCurrency AS DECIMAL(18,4))) AS cost_usd
    FROM OPENROWSET(
      BULK 'cost-management/*/*/*/manifest.json',
      DATA_SOURCE = 'cost_lake',
      FORMAT = 'PARQUET'
    ) AS rows
    WHERE ResourceGroup = 'rg-agent-mesh-${var.workspace_name}'
    GROUP BY CONVERT(date, [Date]), ResourceGroup, ServiceName;

    GO

    -- Reconcile EMF-emitted SDK cost against the Azure-billed model cost.
    -- Persistent delta > 2% suggests pricing-table drift; surface as a
    -- Datadog monitor.
    CREATE OR ALTER VIEW dbo.cost_reconciliation_emf_vs_cur AS
    WITH emf AS (
      SELECT
        CONVERT(date, JSON_VALUE(jsonPayload, '$.startedAt')) AS [date],
        JSON_VALUE(jsonPayload, '$.workspace') AS workspace,
        JSON_VALUE(jsonPayload, '$.provider') AS provider,
        JSON_VALUE(jsonPayload, '$.model') AS model,
        SUM(CAST(JSON_VALUE(jsonPayload, '$.costUsd') AS FLOAT)) AS emf_cost_usd
      FROM OPENROWSET(
        BULK 'audit/*/*/*/*/*/*.avro',
        DATA_SOURCE = 'audit_lake',
        FORMAT = 'AVRO'
      ) WITH (jsonPayload VARCHAR(MAX)) AS rows
      WHERE JSON_VALUE(jsonPayload, '$.schema') = 'agent-mesh.call-event/v1'
      GROUP BY
        CONVERT(date, JSON_VALUE(jsonPayload, '$.startedAt')),
        JSON_VALUE(jsonPayload, '$.workspace'),
        JSON_VALUE(jsonPayload, '$.provider'),
        JSON_VALUE(jsonPayload, '$.model')
    ),
    cur AS (
      SELECT
        CONVERT(date, [Date]) AS [date],
        SUM(CAST(CostInBillingCurrency AS DECIMAL(18,4))) AS cur_cost_usd
      FROM OPENROWSET(
        BULK 'cost-management/*/*/*/manifest.json',
        DATA_SOURCE = 'cost_lake',
        FORMAT = 'PARQUET'
      ) AS rows
      WHERE ServiceName IN ('Cognitive Services', 'Azure OpenAI')
      GROUP BY CONVERT(date, [Date])
    )
    SELECT
      COALESCE(emf.[date], cur.[date]) AS [date],
      emf.emf_cost_usd,
      cur.cur_cost_usd,
      ROUND(((emf.emf_cost_usd - cur.cur_cost_usd) / NULLIF(cur.cur_cost_usd, 0)) * 100, 2) AS delta_pct
    FROM emf
    FULL OUTER JOIN cur ON emf.[date] = cur.[date]
    ORDER BY [date] DESC;
  EOT
}

output "cost_view_definitions" {
  description = "Synapse Serverless SQL — paste these into the workspace SQL endpoint to create the cost_by_workspace and cost_reconciliation_emf_vs_cur views over the captured cost data."
  value       = var.enable_synapse_views ? local.view_definitions : null
}
