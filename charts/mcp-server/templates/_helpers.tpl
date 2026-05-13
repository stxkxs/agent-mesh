{{- define "mcp-server.fullname" -}}
{{- printf "%s" .Values.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "mcp-server.labels" -}}
app.kubernetes.io/name: agent-mesh-mcp-server
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
agent-mesh.io/workspace: {{ .Values.workspace | quote }}
agent-mesh.io/project: {{ .Values.project | quote }}
agent-mesh.io/mcp-server: {{ .Values.name | quote }}
{{- end -}}

{{- define "mcp-server.selectorLabels" -}}
app.kubernetes.io/name: agent-mesh-mcp-server
agent-mesh.io/mcp-server: {{ .Values.name | quote }}
{{- end -}}
