{{/* Generate a fully-qualified name capped to 63 chars. */}}
{{- define "otel.fullname" -}}
{{- printf "%s-%s" .Release.Name "otel-collector" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "otel.labels" -}}
app.kubernetes.io/name: agent-mesh-otel-collector
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
agent-mesh.io/workspace: {{ .Values.workspace | quote }}
{{- end -}}

{{- define "otel.selectorLabels" -}}
app.kubernetes.io/name: agent-mesh-otel-collector
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "otel.datadog.otlpEndpoint" -}}
{{- if .Values.datadog.otlpEndpoint -}}
{{ .Values.datadog.otlpEndpoint }}
{{- else -}}
https://api.{{ .Values.datadog.site }}/api/v0.2/intake
{{- end -}}
{{- end -}}
