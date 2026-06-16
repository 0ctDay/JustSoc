param(
    [string]$Elasticsearch = "http://127.0.0.1:9200",
    [string]$IndexPattern = "selk-alerts-*"
)

Invoke-WebRequest -UseBasicParsing "$Elasticsearch/$IndexPattern/_search?size=5" | Select-Object -ExpandProperty Content
