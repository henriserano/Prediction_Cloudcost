# ── Application Auto Scaling for ECS ──────────────────────────────────────────

resource "aws_appautoscaling_target" "ecs" {
  # INFRA-014: prod keeps a floor of 2 running tasks — one alone is a single
  # point of failure during rolling deploys, Fargate task migration or an AZ
  # outage. Non-prod stays at desired_count to avoid burning cost on empty
  # environments. The max_capacity keeps the same env-based split.
  max_capacity = var.env == "prod" ? max(4, var.desired_count * 2) : max(1, var.desired_count)
  min_capacity = var.env == "prod" ? max(2, var.desired_count) : var.desired_count

  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Scale out on CPU
resource "aws_appautoscaling_policy" "cpu" {
  name               = "${local.prefix}-scale-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# Scale out on Memory
resource "aws_appautoscaling_policy" "memory" {
  name               = "${local.prefix}-scale-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
