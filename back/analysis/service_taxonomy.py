"""Service → category mapping for cross-cloud FinOps analysis.

Both GCP and AWS surface service names as free-text strings; the dashboard
needs a common taxonomy to render category badges and let the user filter
"infra vs analytics vs LLM" without knowing every product name.

The taxonomy uses coarse buckets on purpose — 8 categories is enough to
segment the bill for cost-optimisation conversations without exploding the
UI legend. Add finer sub-buckets only when a client explicitly asks.

Rules:
- Match is **case-insensitive**, substring-based, longest match wins.
- Unknown services default to ``other`` — surfaced in the UI so an operator
  can spot an unlabelled service and extend the map.
"""

from __future__ import annotations

from typing import Literal

Category = Literal[
    "compute",
    "database",
    "storage",
    "analytics",
    "ai_ml",
    "network",
    "security",
    "observability",
    "other",
]


# Ordered from most-specific to most-generic. First substring match wins.
# Keep entries lowercase — the classifier normalises input.
_RULES: list[tuple[str, Category]] = [
    # AI / ML — matched first because names often contain "compute" (e.g.,
    # "vertex ai training" would otherwise flip to compute).
    ("vertex ai", "ai_ml"),
    ("bedrock", "ai_ml"),
    ("sagemaker", "ai_ml"),
    ("comprehend", "ai_ml"),
    ("rekognition", "ai_ml"),
    ("textract", "ai_ml"),
    ("polly", "ai_ml"),
    ("transcribe", "ai_ml"),
    ("translate", "ai_ml"),
    ("claude", "ai_ml"),
    ("gemini", "ai_ml"),
    ("openai", "ai_ml"),
    ("gpt", "ai_ml"),
    ("dialogflow", "ai_ml"),
    ("recommendations ai", "ai_ml"),
    ("automl", "ai_ml"),
    # Analytics / data warehouse
    ("bigquery", "analytics"),
    ("looker", "analytics"),
    ("dataflow", "analytics"),
    ("dataproc", "analytics"),
    ("data fusion", "analytics"),
    ("data catalog", "analytics"),
    ("pub/sub", "analytics"),
    ("pubsub", "analytics"),
    ("athena", "analytics"),
    ("emr", "analytics"),
    ("glue", "analytics"),
    ("kinesis", "analytics"),
    ("msk", "analytics"),
    ("redshift", "analytics"),
    ("quicksight", "analytics"),
    ("opensearch", "analytics"),
    # Database
    ("cloud sql", "database"),
    ("firestore", "database"),
    ("cloud spanner", "database"),
    ("bigtable", "database"),
    ("memorystore", "database"),
    ("rds", "database"),
    ("aurora", "database"),
    ("dynamodb", "database"),
    ("elasticache", "database"),
    ("documentdb", "database"),
    ("neptune", "database"),
    ("keyspaces", "database"),
    ("timestream", "database"),
    # Storage
    ("cloud storage", "storage"),
    ("filestore", "storage"),
    ("persistent disk", "storage"),
    ("s3", "storage"),
    ("simple storage service", "storage"),
    ("ebs", "storage"),
    ("elastic block store", "storage"),
    ("efs", "storage"),
    ("fsx", "storage"),
    ("backup", "storage"),
    ("glacier", "storage"),
    # Network / edge
    ("cloud cdn", "network"),
    ("cloud load balancing", "network"),
    ("cloud dns", "network"),
    ("cloud interconnect", "network"),
    ("cloud vpn", "network"),
    ("cloudfront", "network"),
    ("route 53", "network"),
    ("route53", "network"),
    ("elastic load", "network"),
    ("vpc", "network"),
    ("api gateway", "network"),
    ("nat gateway", "network"),
    ("data transfer", "network"),
    ("direct connect", "network"),
    ("global accelerator", "network"),
    # Compute
    ("cloud run", "compute"),
    ("cloud functions", "compute"),
    ("app engine", "compute"),
    ("compute engine", "compute"),
    ("gke", "compute"),
    ("kubernetes engine", "compute"),
    ("cloud build", "compute"),
    ("ec2", "compute"),
    ("elastic compute", "compute"),
    ("lambda", "compute"),
    ("fargate", "compute"),
    ("ecs", "compute"),
    ("eks", "compute"),
    ("batch", "compute"),
    ("lightsail", "compute"),
    ("app runner", "compute"),
    # Security / IAM
    ("secret manager", "security"),
    ("kms", "security"),
    ("iam", "security"),
    ("cloud armor", "security"),
    ("shield", "security"),
    ("waf", "security"),
    ("guardduty", "security"),
    ("cognito", "security"),
    ("acm", "security"),
    ("certificate manager", "security"),
    # Observability / management
    ("cloud logging", "observability"),
    ("cloud monitoring", "observability"),
    ("cloud trace", "observability"),
    ("cloud profiler", "observability"),
    ("cloudwatch", "observability"),
    ("x-ray", "observability"),
    ("cloudtrail", "observability"),
    ("config", "observability"),
    ("systems manager", "observability"),
]


def categorize(service_name: object) -> Category:
    """Return the category for a service name (substring match, case-insensitive).

    Unknown services — and any non-string input (NaN, None, unexpected types
    from pandas rows) — fall through to ``"other"`` so callers never leak raw
    service labels into the category axis of a chart.
    """
    if not isinstance(service_name, str) or not service_name:
        return "other"
    needle = service_name.lower()
    for keyword, category in _RULES:
        if keyword in needle:
            return category
    return "other"


CATEGORY_LABELS: dict[str, str] = {
    "compute": "Compute",
    "database": "Database",
    "storage": "Storage",
    "analytics": "Analytics",
    "ai_ml": "AI / ML",
    "network": "Network",
    "security": "Security",
    "observability": "Observability",
    "other": "Other",
}
