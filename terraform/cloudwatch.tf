# App Runner emits application logs to /aws/apprunner/<service>/<id>/application
# and /aws/apprunner/<service>/<id>/service log groups automatically — no
# CloudWatch log group needs to be declared here.

# ── Alarm notification channel ────────────────────────────────────────────────
# INFRA-010: alarms without alarm_actions are silent. SNS topic always created;
# email subscriptions opt-in via var.alarm_email_subscribers.

resource "aws_sns_topic" "alarms" {
  name = "${local.prefix}-alarms"
  tags = { Name = "${local.prefix}-alarms" }
}

resource "aws_sns_topic_subscription" "alarm_email" {
  for_each  = toset(var.alarm_email_subscribers)
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  alarm_actions = [aws_sns_topic.alarms.arn]
}

# ── Alarms (App Runner metrics) ───────────────────────────────────────────────
# App Runner publishes CPU/memory/latency/5xx to the AWS/AppRunner namespace,
# dimensioned on ServiceName + ServiceId.

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "${local.prefix}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/AppRunner"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "App Runner CPU utilization above 80% for 2 consecutive minutes"
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  dimensions = {
    ServiceName = aws_apprunner_service.app.service_name
    ServiceId   = aws_apprunner_service.app.service_id
  }

  tags = { Name = "${local.prefix}-alarm-cpu" }
}

resource "aws_cloudwatch_metric_alarm" "memory_high" {
  alarm_name          = "${local.prefix}-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/AppRunner"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "App Runner memory utilization above 80% for 2 consecutive minutes"
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  dimensions = {
    ServiceName = aws_apprunner_service.app.service_name
    ServiceId   = aws_apprunner_service.app.service_id
  }

  tags = { Name = "${local.prefix}-alarm-memory" }
}

resource "aws_cloudwatch_metric_alarm" "http_5xx" {
  alarm_name          = "${local.prefix}-http-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5xxStatusResponses"
  namespace           = "AWS/AppRunner"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "More than 10 HTTP 5xx responses in 1 minute"
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions

  dimensions = {
    ServiceName = aws_apprunner_service.app.service_name
    ServiceId   = aws_apprunner_service.app.service_id
  }

  tags = { Name = "${local.prefix}-alarm-5xx" }
}
