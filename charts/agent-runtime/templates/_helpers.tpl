{{- define "agent-runtime.fullname" -}}
{{- printf "%s-%s" .Release.Name .Values.agentId | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "agent-runtime.labels" -}}
app.kubernetes.io/name: agent-mesh-agent-runtime
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
agent-mesh.io/workspace: {{ .Values.workspace | quote }}
agent-mesh.io/project: {{ .Values.project | quote }}
agent-mesh.io/agent: {{ .Values.agentId | quote }}
{{- end -}}

{{- define "agent-runtime.selectorLabels" -}}
app.kubernetes.io/name: agent-mesh-agent-runtime
app.kubernetes.io/instance: {{ .Release.Name }}
agent-mesh.io/agent: {{ .Values.agentId | quote }}
{{- end -}}

{{- define "agent-runtime.serviceAccount" -}}
{{ printf "agent-%s" .Values.agentId | trunc 63 | trimSuffix "-" }}
{{- end -}}
